// Conflict protection on PUT /api/notes/of/:kind/:id (the note editor sends the version it started from).
import { describe, expect, it } from 'vitest';
import { call, tool } from './helpers';

describe('note versions and conflicts', () => {
  it('returns the note with its version, null before the first write', async () => {
    const p = await call('POST', '/projects', { name: 'Versioned' });
    expect(await call('GET', `/notes/of/project/${p.id}`)).toEqual({ body: '', updated_at: null });
    const saved = await call('PUT', `/notes/of/project/${p.id}`, { body: 'one', base: null });
    const got = await call('GET', `/notes/of/project/${p.id}`);
    expect(got).toEqual({ body: 'one', updated_at: saved.updated_at });
  });

  it('saves when the base matches and refuses with the current note when it does not', async () => {
    const l = await call('POST', '/lists', { name: 'Shared note', kind: 'note' });
    const first = await call('PUT', `/notes/of/list/${l.id}`, { body: 'start' });
    const mine = await call('PUT', `/notes/of/list/${l.id}`, { body: 'start, edited here', base: first.updated_at });
    expect(mine.body).toBe('start, edited here');
    // Claude (or another device) writes in between
    await tool('write_note', { list_id: l.id, body: 'added by Claude', how: 'append' });
    const res = await call('PUT', `/notes/of/list/${l.id}`, { body: 'stale edit', base: mine.updated_at }, { expect: 409 });
    expect(res.code).toBe('conflict');
    expect(res.current.body).toBe('start, edited here\n\nadded by Claude');
    expect((await call('GET', `/notes/of/list/${l.id}`)).body).toBe('start, edited here\n\nadded by Claude');
    // "Keep mine": save again on top of the version just seen
    const kept = await call('PUT', `/notes/of/list/${l.id}`, { body: 'stale edit', base: res.current.updated_at });
    expect(kept.body).toBe('stale edit');
  });

  it('refuses a "new note" save when one exists, but allows a save that changes nothing', async () => {
    const p = await call('POST', '/projects', { name: 'Two devices' });
    await call('PUT', `/notes/of/project/${p.id}`, { body: 'from the phone' });
    await call('PUT', `/notes/of/project/${p.id}`, { body: 'from the laptop', base: null }, { expect: 409 });
    await call('PUT', `/notes/of/project/${p.id}`, { body: 'from the phone', base: null });
  });

  it('still saves without a base (old clients) and rejects a bad base', async () => {
    const p = await call('POST', '/projects', { name: 'No base' });
    await call('PUT', `/notes/of/project/${p.id}`, { body: 'a' });
    await call('PUT', `/notes/of/project/${p.id}`, { body: 'b' });
    expect((await call('GET', `/projects/${p.id}/full`)).notes).toBe('b');
    await call('PUT', `/notes/of/project/${p.id}`, { body: 'c', base: 5 }, { expect: 400 });
  });
});
