// Offline use: a PATCH made from an older copy of a row (base_updated_at, sent by a change queued
// while offline) goes ahead unless the same fields changed since; then 409 with the current row.
import { describe, expect, it } from 'vitest';
import { call } from './helpers';

const tick = () => new Promise((r) => setTimeout(r, 5)); // updated_at has millisecond steps

async function card(title: string) {
  const p = await call('POST', '/projects', { name: `Offline ${title}` });
  const [todo, doing] = (await call('GET', `/projects/${p.id}/full`)).columns;
  const c = await call('POST', '/tasks', { id: `off-${Math.random().toString(36).slice(2, 10)}`, title, column_id: todo.id });
  return { p, c, todo, doing };
}

describe('PATCH with base_updated_at', () => {
  it('saves when the row has not changed since', async () => {
    const { c } = await card('same');
    await tick();
    const r = await call('PATCH', `/tasks/${c.id}`, { title: 'renamed', base_updated_at: c.updated_at });
    expect(r.title).toBe('renamed');
    expect(r.updated_at > c.updated_at).toBe(true);
  });

  it('refuses with 409 and the current row when the same field changed since', async () => {
    const { c } = await card('clash');
    await tick();
    await call('PATCH', `/tasks/${c.id}`, { title: 'from the laptop' });
    await tick();
    const r = await call('PATCH', `/tasks/${c.id}`, { title: 'from the phone', base_updated_at: c.updated_at }, { expect: 409 });
    expect(r.code).toBe('conflict');
    expect(r.fields).toEqual(['title']);
    expect(r.current.title).toBe('from the laptop');
    expect(r.error).toMatch(/changed somewhere else/);
    expect((await call('GET', `/tasks/${c.id}`)).title).toBe('from the laptop');
  });

  it('saves when only other fields changed since (a colour, a move)', async () => {
    const { c, doing } = await card('fields');
    await tick();
    await call('PATCH', `/tasks/${c.id}`, { color: 'red' });
    await tick();
    await call('POST', `/tasks/${c.id}/move`, { column_id: doing.id });
    await tick();
    const r = await call('PATCH', `/tasks/${c.id}`, { title: 'renamed offline', base_updated_at: c.updated_at });
    expect(r).toMatchObject({ title: 'renamed offline', color: 'red', column_id: doing.id });
  });

  it('allows an edit that changes nothing (sent twice), and one with no base at all', async () => {
    const { c } = await card('twice');
    await tick();
    const first = await call('PATCH', `/tasks/${c.id}`, { title: 'once', base_updated_at: c.updated_at });
    await tick();
    const again = await call('PATCH', `/tasks/${c.id}`, { title: 'once', base_updated_at: c.updated_at });
    expect(again.updated_at).toBe(first.updated_at);
    await call('PATCH', `/tasks/${c.id}`, { title: 'no base' });
  });

  it('refuses when the base is older than the history can explain', async () => {
    const { c } = await card('old');
    await tick();
    await call('PATCH', `/tasks/${c.id}`, { color: 'blue' });
    const r = await call('PATCH', `/tasks/${c.id}`, { title: 'very late', base_updated_at: '2020-01-01T00:00:00.000Z' }, { expect: 409 });
    expect(r.fields).toEqual(['title']);
  });

  it('checks every kind through the generic store (a to-do, a project) and rejects a bad base', async () => {
    const todo = await call('POST', '/todos', { title: 'Milk' });
    await tick();
    await call('PATCH', `/todos/${todo.id}`, { title: 'Oat milk' });
    await call('PATCH', `/todos/${todo.id}`, { title: 'Soy milk', base_updated_at: todo.updated_at }, { expect: 409 });
    const p = await call('POST', '/projects', { name: 'Base project' });
    await tick();
    await call('PATCH', `/projects/${p.id}`, { name: 'Renamed', base_updated_at: p.updated_at });
    const bad = await call('PATCH', `/projects/${p.id}`, { name: 'x', base_updated_at: 'yesterday' }, { expect: 400 });
    expect(bad.error).toMatch(/base_updated_at/);
  });

  it('declares the offline flag, on by default', async () => {
    const f = (await call('GET', '/features')).find((x: any) => x.id === 'offline');
    expect(f).toMatchObject({ enabled: true });
  });
});
