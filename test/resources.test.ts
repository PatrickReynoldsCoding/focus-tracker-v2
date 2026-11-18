import { describe, expect, it } from 'vitest';
import { Ctx } from '../src/core/ctx';
import { pickerConfig } from '../src/modules/resources';
import { env } from 'cloudflare:test';
import { call, tool, toolError } from './helpers';

const ID = '1aBcD_eFgHiJkLmNoPqRsTuVwXyZ0123456789';
const ID2 = '9zYxWvUtSrQpOnMlKjIhGfEdCbA_9876543210';
const DOC = `https://docs.google.com/document/d/${ID}/edit`;
const DOC2 = `https://docs.google.com/document/d/${ID2}/edit`;

async function project(name = 'Res project', category_id?: string) {
  return call('POST', '/projects', { name, category_id });
}

describe('resources API', () => {
  it('stores the kind and the drive type for a Google address', async () => {
    const p = await project();
    const r = await call('POST', '/resources', { project_id: p.id, title: 'Plan', value: DOC });
    expect(r).toMatchObject({ type: 'drive', kind: 'doc', value: DOC });
    const sheet = await call('POST', '/resources', { project_id: p.id, title: 'Money', value: `docs.google.com/spreadsheets/d/${ID}/edit`, type: 'link' });
    expect(sheet).toMatchObject({ type: 'drive', kind: 'sheet', value: `https://docs.google.com/spreadsheets/d/${ID}/edit` });
    const link = await call('POST', '/resources', { project_id: p.id, title: 'Repo', value: 'https://github.com/a/b' });
    expect(link).toMatchObject({ type: 'link', kind: 'link' });
    const mail = await call('POST', '/resources', { project_id: p.id, title: 'Anna', value: 'anna@example.com' });
    expect(mail).toMatchObject({ type: 'email', kind: 'email' });
    const phone = await call('POST', '/resources', { project_id: p.id, title: 'Plumber', value: '07700 900123', type: 'phone' });
    expect(phone).toMatchObject({ type: 'phone', kind: 'phone' });
    const text = await call('POST', '/resources', { project_id: p.id, title: 'Door code hint', value: 'Ask the caretaker', type: 'text' });
    expect(text).toMatchObject({ type: 'text', kind: 'text' });
    const full = await call('GET', `/projects/${p.id}/full`);
    expect(full.resources.map((x: any) => x.kind)).toEqual(['doc', 'sheet', 'link', 'email', 'phone', 'text']);
  });

  it('works out the kind again when the address or type changes', async () => {
    const p = await project();
    const r = await call('POST', '/resources', { project_id: p.id, title: 'Thing', value: 'https://example.com' });
    const toDoc = await call('PATCH', `/resources/${r.id}`, { value: DOC });
    expect(toDoc).toMatchObject({ type: 'drive', kind: 'doc' });
    const toPhone = await call('PATCH', `/resources/${r.id}`, { value: '01234 567890', type: 'phone' });
    expect(toPhone).toMatchObject({ type: 'phone', kind: 'phone', value: '01234 567890' });
    const renamed = await call('PATCH', `/resources/${r.id}`, { title: 'Renamed', note: 'n' });
    expect(renamed).toMatchObject({ title: 'Renamed', kind: 'phone' });
    // A kind cannot be forced onto a Google Doc.
    const doc = await call('POST', '/resources', { project_id: p.id, title: 'D', value: DOC, kind: 'pdf' });
    expect(doc.kind).toBe('doc');
  });

  it('takes a Drive file hint (file, pdf, image) from the Picker', async () => {
    const p = await project();
    const r = await call('POST', '/resources', { project_id: p.id, title: 'Contract', value: `https://drive.google.com/file/d/${ID}/view`, kind: 'pdf' });
    expect(r).toMatchObject({ type: 'drive', kind: 'pdf' });
    const bad = await call('POST', '/resources', { project_id: p.id, title: 'x', value: 'https://a.com', kind: 'banana' }, { expect: 400 });
    expect(bad.error).toMatch(/kind must be one of/);
  });

  it('adds many at once with one undo, skips repeats and guesses titles', async () => {
    const p = await project();
    await call('POST', '/resources', { project_id: p.id, title: 'Already', value: DOC });
    const r = await call('POST', '/resources/bulk', {
      project_id: p.id,
      group: 'Drive',
      items: [
        { value: `https://docs.google.com/document/u/1/d/${ID}/view` },
        { value: `https://docs.google.com/presentation/d/${ID}b/edit`, title: 'Deck' },
        { value: `https://drive.google.com/drive/folders/${ID}c` },
        { value: `https://docs.google.com/presentation/d/${ID}b/edit` },
      ],
    }, { expect: 201 });
    expect(r.created.map((x: any) => [x.title, x.kind, x.grp])).toEqual([
      ['Deck', 'slides', 'Drive'],
      ['Drive folder', 'folder', 'Drive'],
    ]);
    expect(r.skipped).toHaveLength(2);
    const before = (await call('GET', `/resources?project_id=${p.id}`)).length;
    expect(before).toBe(3);
    await call('POST', '/undo');
    expect((await call('GET', `/resources?project_id=${p.id}`)).length).toBe(1);
  });

  it('shares resources with a category and lists them without the project ones', async () => {
    const cat = await call('POST', '/categories', { label: 'Garden' });
    const p = await project('Shed', cat.id);
    await call('POST', '/resources', { category_id: cat.id, title: 'Suppliers', value: `https://docs.google.com/spreadsheets/d/${ID2}/edit` });
    await call('POST', '/resources', { project_id: p.id, category_id: cat.id, title: 'Own', value: 'https://example.com' });
    const shared = await call('GET', `/resources?category_id=${cat.id}&project_id=`);
    expect(shared.map((r: any) => r.title)).toEqual(['Suppliers']);
    expect(shared[0]).toMatchObject({ kind: 'sheet', type: 'drive' });
    // Without an owner it is refused.
    await call('POST', '/resources', { title: 'Orphan', value: 'x' }, { expect: 400 });
    const bulk = await call('POST', '/resources/bulk', { category_id: cat.id, items: [{ value: DOC }] }, { expect: 201 });
    expect(bulk.created[0]).toMatchObject({ category_id: cat.id, project_id: null, kind: 'doc' });
  });

  it('reorders resources', async () => {
    const p = await project();
    const a = await call('POST', '/resources', { project_id: p.id, title: 'A', value: 'https://a.example.com' });
    const b = await call('POST', '/resources', { project_id: p.id, title: 'B', value: 'https://b.example.com' });
    const c = await call('POST', '/resources', { project_id: p.id, title: 'C', value: 'https://c.example.com' });
    await call('POST', `/resources/${c.id}/move`, { before_id: a.id });
    const list = await call('GET', `/resources?project_id=${p.id}`);
    expect(list.map((r: any) => r.title)).toEqual(['C', 'A', 'B']);
    expect(b.id).toBeTruthy();
  });
});

describe('Claude tools for resources', () => {
  it('add_resource sets type and kind', async () => {
    const p = await project();
    const r = await tool('add_resource', { project_id: p.id, value: `https://docs.google.com/forms/d/${ID}/edit`, group: 'Forms' });
    expect(r).toMatchObject({ title: 'Google Form', type: 'drive', kind: 'form', grp: 'Forms' });
    const phone = await tool('add_resource', { project_id: p.id, value: '+44 20 7946 0000', title: 'Office' });
    expect(phone).toMatchObject({ type: 'phone', kind: 'phone' });
    expect(await toolError('add_resource', { project_id: p.id, value: `https://docs.google.com/forms/d/${ID}/edit` })).toMatch(/already added/);
    expect(await toolError('add_resource', { value: DOC })).toMatch(/project_id or category_id/);
  });

  it('create_item resources sets type and kind too', async () => {
    const p = await project();
    const r = await tool('create_item', { kind: 'resources', fields: { project_id: p.id, title: 'Plan', value: DOC } });
    expect(r).toMatchObject({ type: 'drive', kind: 'doc' });
  });

  it('add_resources reads a pasted list', async () => {
    const p = await project();
    const r = await tool('add_resources', {
      project_id: p.id,
      text: `Budget - https://docs.google.com/spreadsheets/d/${ID}/edit\n${DOC2}\nnotes without address`,
    });
    expect(r.created.map((x: any) => [x.title, x.kind])).toEqual([
      ['Budget', 'sheet'],
      ['Google Doc', 'doc'],
    ]);
    expect(await toolError('add_resources', { project_id: p.id, text: 'nothing here' })).toMatch(/No web addresses/);
  });
});

describe('Google Picker settings', () => {
  const withKeys = { ...env, GOOGLE_PICKER_CLIENT_ID: 'client.apps.googleusercontent.com', GOOGLE_PICKER_API_KEY: 'key123' };

  it('stays hidden while the flag is off, even with credentials', async () => {
    expect(await call('GET', '/resources/picker')).toEqual({ enabled: false });
    expect(await pickerConfig(new Ctx(withKeys, 'personal'))).toEqual({ enabled: false });
  });

  it('stays hidden while the flag is on but the Worker has no credentials', async () => {
    await call('PUT', '/features/google-picker', { enabled: true });
    try {
      expect(await call('GET', '/resources/picker')).toEqual({ enabled: false });
      expect(await pickerConfig(new Ctx({ ...env, GOOGLE_PICKER_CLIENT_ID: 'x' }, 'personal'))).toEqual({ enabled: false });
    } finally {
      await call('PUT', '/features/google-picker', { enabled: false });
    }
  });

  it('is offered when the flag is on and both values are set', async () => {
    await call('PUT', '/features/google-picker', { enabled: true });
    try {
      expect(await pickerConfig(new Ctx(withKeys, 'personal'))).toEqual({ enabled: true, client_id: 'client.apps.googleusercontent.com', api_key: 'key123', app_id: null });
    } finally {
      await call('PUT', '/features/google-picker', { enabled: false });
    }
  });

  it('lists the flag as off by default', async () => {
    const f = (await call('GET', '/features')).find((x: any) => x.id === 'google-picker');
    expect(f).toMatchObject({ enabled: false, default: false, experimental: true });
  });
});
