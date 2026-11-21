import { describe, expect, it } from 'vitest';
import { call, mcp, tool, toolError, flagEverywhere } from './helpers';

// Each test works in its own mode, so Today's suggestions and undo see only its rows.
let n = 0;
async function freshMode() {
  const m = await call('POST', '/modes', { label: `Links test ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  const opts = { mode: m.id as string };
  const req = <T = any>(method: string, path: string, body?: unknown, expect?: number) => call<T>(method, path, body, { ...opts, expect });
  return { mode: m.id as string, req };
}

describe('issue links', () => {
  it('links any two kinds and reads each way', async () => {
    const { req } = await freshMode();
    const p = await req('POST', '/projects', { name: 'House' });
    const q = await req('POST', '/projects', { name: 'Garden' });
    const card = await req('POST', '/tasks', { project_id: p.id, title: 'Fix roof' });
    const todo = await req('POST', '/todos', { title: 'Buy nails' });
    const b = await req('POST', '/backlog', { title: 'Shed' });
    const l = await req('POST', '/lists', { name: 'Ideas', kind: 'note' });

    await req('POST', '/links', { from_kind: 'tasks', from_id: card.id, type: 'blocks', to_kind: 'projects', to_id: q.id });
    // an inward phrase swaps the ends: the card is blocked by the to-do
    const l2 = await req('POST', '/links', { from_kind: 'card', from_id: card.id, type: 'is blocked by', to_kind: 'todo', to_id: todo.id });
    expect(l2).toMatchObject({ from_kind: 'todos', from_id: todo.id, to_kind: 'tasks', to_id: card.id, type: 'blocks' });
    await req('POST', '/links', { from_kind: 'projects', from_id: p.id, type: 'relates', to_kind: 'backlog', to_id: b.id, note: 'same street' });
    await req('POST', '/links', { from_kind: 'lists', from_id: l.id, type: 'duplicates', to_kind: 'projects', to_id: p.id });

    const of = await req('GET', `/links/of/card/${card.id}`);
    expect(of.item).toMatchObject({ kind: 'tasks', title: 'Fix roof', status: 'open', context: 'House' });
    expect(of.links.map((x: any) => `${x.phrase} ${x.item.title}`)).toEqual(['blocks Garden', 'is blocked by Buy nails']);
    expect(of.blocked_by.map((x: any) => x.title)).toEqual(['Buy nails']);

    const full = await req('GET', `/projects/${p.id}/full`);
    expect(full.links.map((x: any) => `${x.phrase} ${x.item.title}`)).toEqual(['relates to Shed', 'is duplicated by Ideas']);
    expect(full.links[0].note).toBe('same street');
    expect(full.blocked_by).toEqual([]);

    const garden = await req('GET', `/projects/${q.id}/full`);
    expect(garden.blocked_by.map((x: any) => x.title)).toEqual(['Fix roof']);
    // moving the card to Done unblocks Garden
    const done = garden.columns ? (await req('GET', `/projects/${p.id}/full`)).columns.find((c: any) => c.name === 'Done') : null;
    await req('POST', `/tasks/${card.id}/move`, { column_id: done.id });
    expect((await req('GET', `/projects/${q.id}/full`)).blocked_by).toEqual([]);
    expect((await req('GET', `/links/of/tasks/${card.id}`)).item.status).toBe('done');
  });

  it('refuses self-links, duplicates, loops, a second parent and unknown types or items', async () => {
    const { req } = await freshMode();
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((name) => req('POST', '/projects', { name })));
    const link = (from: any, type: string, to: any, expect = 201) => req('POST', '/links', { from_id: from.id, type, to_id: to.id }, expect);
    expect((await link(a, 'blocks', a, 400)).error).toMatch(/itself/);
    await link(a, 'blocks', b);
    expect((await link(a, 'blocks', b, 400)).error).toMatch(/already blocks/);
    expect((await link(b, 'is blocked by', a, 400)).error).toMatch(/already blocks/);
    await link(b, 'blocks', c);
    expect((await link(c, 'blocks', a, 400)).error).toMatch(/loop/);
    expect((await link(b, 'blocks', a, 400)).error).toMatch(/loop/);
    // relates has no direction: the reverse is a duplicate
    await link(a, 'relates to', c);
    expect((await link(c, 'relates', a, 400)).error).toMatch(/already relates to/);
    // the reverse of a directed type is refused too
    await link(a, 'duplicates', b);
    expect((await link(b, 'duplicates', a, 400)).error).toMatch(/already duplicates/);
    // a different type between the same pair is fine
    await link(a, 'causes', b);
    // parent / child: one parent, no loops
    await link(a, 'is parent of', b);
    expect((await link(c, 'parent', b, 400)).error).toMatch(/already is child of “A”/);
    await link(b, 'parent', c);
    expect((await link(c, 'parent', a, 400)).error).toMatch(/loop/);
    expect((await link(a, 'eats', b, 400)).error).toMatch(/Unknown link type/);
    expect((await req('POST', '/links', { from_kind: 'habits', from_id: a.id, to_id: b.id }, 400)).error).toMatch(/Cannot link/);
    expect((await req('POST', '/links', { from_id: 'nope123', to_id: b.id }, 400)).error).toMatch(/No project/);
    // only the note can change
    const l = (await req('GET', `/links/of/projects/${a.id}`)).links[0];
    expect((await req('PATCH', `/links/${l.id}`, { note: 'why' })).note).toBe('why');
    await req('PATCH', `/links/${l.id}`, { type: 'relates' }, 400);
  });

  it('deletes an item’s links with it, and undo brings them back', async () => {
    const { req } = await freshMode();
    const p = await req('POST', '/projects', { name: 'Kept' });
    const gone = await req('POST', '/projects', { name: 'Gone' });
    const card = await req('POST', '/tasks', { project_id: gone.id, title: 'Card on Gone' });
    await req('POST', '/links', { from_id: gone.id, type: 'blocks', to_id: p.id });
    await req('POST', '/links', { from_kind: 'card', from_id: card.id, type: 'relates', to_id: p.id });
    expect((await req('GET', `/links/of/projects/${p.id}`)).links).toHaveLength(2);

    // deleting the project deletes its card too (store cascade), and both their links
    await req('DELETE', `/projects/${gone.id}`);
    expect((await req('GET', '/links')).length).toBe(0);
    const after = await req('GET', `/projects/${p.id}/full`);
    expect(after.links).toEqual([]);
    expect(after.blocked_by).toEqual([]);

    await req('POST', '/undo');
    const back = await req('GET', `/links/of/projects/${p.id}`);
    expect(back.links.map((x: any) => `${x.phrase} ${x.item.title}`).sort()).toEqual(['is blocked by Gone', 'relates to Card on Gone']);

    // removing one link is one undo step
    await req('DELETE', `/links/${back.links[0].id}`);
    expect((await req('GET', `/links/of/projects/${p.id}`)).links).toHaveLength(1);
    await req('POST', '/undo');
    expect((await req('GET', `/links/of/projects/${p.id}`)).links).toHaveLength(2);
  });

  it('keeps a backlog item’s links when it is started as a project', async () => {
    const { req } = await freshMode();
    const p = await req('POST', '/projects', { name: 'Waiting' });
    const b = await req('POST', '/backlog', { title: 'First' });
    await req('POST', '/links', { from_kind: 'backlog', from_id: b.id, type: 'blocks', to_id: p.id });
    expect((await req('GET', `/projects/${p.id}/full`)).blocked_by.map((x: any) => x.title)).toEqual(['First']);
    const started = await req('POST', `/backlog/${b.id}/start`);
    const full = await req('GET', `/projects/${p.id}/full`);
    expect(full.blocked_by).toMatchObject([{ kind: 'projects', id: started.id, title: 'First' }]);
    expect((await req('GET', '/links')).length).toBe(1);
  });

  it('leaves blocked projects out of Today’s suggestions', async () => {
    const { req } = await freshMode();
    const a = await req('POST', '/projects', { name: 'Free' });
    const b = await req('POST', '/projects', { name: 'Blocked' });
    const todo = await req('POST', '/todos', { title: 'Call the council' });
    await req('POST', '/links', { from_kind: 'todo', from_id: todo.id, type: 'blocks', to_id: b.id });
    // a done project blocks nothing
    const old = await req('POST', '/projects', { name: 'Old', status: 'done' });
    await req('POST', '/links', { from_id: old.id, type: 'blocks', to_id: a.id });
    let names = (await req('GET', '/today')).suggestions.map((p: any) => p.name);
    expect(names).toContain('Free');
    expect(names).not.toContain('Blocked');
    expect(Object.keys((await req('GET', '/links/blocked')).projects)).toEqual([b.id]);

    await req('POST', `/todos/${todo.id}/tick`, { done: true });
    names = (await req('GET', '/today')).suggestions.map((p: any) => p.name);
    expect(names).toContain('Blocked');

    // with the feature off, links have no effect and their routes are gone
    await req('POST', `/todos/${todo.id}/tick`, { done: false });
    await flagEverywhere('issue-links', false);
    try {
      expect((await req('GET', '/today')).suggestions.map((p: any) => p.name)).toContain('Blocked');
      expect((await req('GET', `/projects/${b.id}/full`)).links).toEqual([]);
      await req('GET', `/links/of/projects/${b.id}`, undefined, 404);
      const { tools } = await mcp<any>('tools/list');
      expect(tools.map((t: any) => t.name)).not.toContain('link_items');
    } finally {
      await flagEverywhere('issue-links', true);
    }
  });

  it('searches items to link across kinds', async () => {
    const { req } = await freshMode();
    const p = await req('POST', '/projects', { name: 'Paint fence' });
    await req('POST', '/tasks', { project_id: p.id, title: 'Buy paint' });
    await req('POST', '/todos', { title: 'Paint sample' });
    await req('POST', '/backlog', { title: 'Repaint door' });
    const found = await req('GET', '/links/search?q=paint');
    expect(found.map((x: any) => x.kind).sort()).toEqual(['backlog', 'projects', 'tasks', 'todos']);
    expect(found.find((x: any) => x.kind === 'tasks').context).toBe('Paint fence');
    const only = await req('GET', `/links/search?q=paint&kind=project&exclude=projects:${p.id}`);
    expect(only).toEqual([]);
    expect((await req('GET', '/links/search')).length).toBeGreaterThan(0);
  });

  it('lets the owner add and remove custom link types behind a flag', async () => {
    const { req } = await freshMode();
    await req('POST', '/links/types', { outward: 'funds', inward: 'is funded by' }, 404);
    await flagEverywhere('custom-link-types', true);
    try {
      const types = await req('POST', '/links/types', { outward: 'Funds', inward: 'is funded by' });
      expect(types.at(-1)).toMatchObject({ id: 'funds', outward: 'funds', inward: 'is funded by', custom: true });
      expect((await req('POST', '/links/types', { outward: 'blocks' }, 400)).error).toMatch(/already/);
      const a = await req('POST', '/projects', { name: 'Grant' });
      const b = await req('POST', '/projects', { name: 'Studio' });
      const l = await req('POST', '/links', { from_id: b.id, type: 'is funded by', to_id: a.id });
      expect(l).toMatchObject({ from_id: a.id, to_id: b.id, type: 'funds' });
      expect((await req('GET', `/links/of/projects/${b.id}`)).links[0].phrase).toBe('is funded by');
      expect((await req('DELETE', '/links/types/funds', undefined, 400)).error).toMatch(/1 link uses/);
      await req('DELETE', `/links/${l.id}`);
      expect((await req('DELETE', '/links/types/funds')).some((t: any) => t.id === 'funds')).toBe(false);
      await req('DELETE', '/links/types/blocks', undefined, 400);
    } finally {
      await flagEverywhere('custom-link-types', false);
    }
  });
});

describe('issue link tools', () => {
  it('links, lists and unlinks through Claude', async () => {
    const p = await tool('create_project', { name: 'Tool blocked' });
    const q = await tool('create_project', { name: 'Tool blocker' });
    const card = await tool('add_card', { project_id: q.id, title: 'Tool card' });
    const r = await tool('link_items', { from_kind: 'project', from_id: p.id, type: 'is blocked by', to_kind: 'card', to_id: card.id, note: 'waiting' });
    expect(r.reads).toBe('“Tool card” blocks “Tool blocked”');
    expect(await toolError('link_items', { from_kind: 'card', from_id: card.id, type: 'blocks', to_kind: 'project', to_id: p.id })).toMatch(/already blocks/);
    expect(await toolError('link_items', { from_kind: 'project', from_id: p.id, type: 'blocks', to_kind: 'card', to_id: card.id })).toMatch(/loop/);

    const got = await tool('get_project', { id: p.id });
    expect(got.links).toMatchObject([{ phrase: 'is blocked by', note: 'waiting', item: { kind: 'tasks', title: 'Tool card', status: 'open', context: 'Tool blocker' } }]);
    expect(got.blocked_by.map((x: any) => x.title)).toEqual(['Tool card']);

    const listed = await tool('list_links', { kind: 'card', id: card.id });
    expect(listed.links[0]).toMatchObject({ phrase: 'blocks', item: { title: 'Tool blocked' } });
    expect((await tool('list_link_types')).map((t: any) => t.id)).toEqual(['blocks', 'relates', 'duplicates', 'clones', 'causes', 'parent']);

    expect(await tool('unlink_items', { from_kind: 'card', from_id: card.id, to_kind: 'project', to_id: p.id })).toEqual({ removed: 1 });
    expect(await toolError('unlink_items', { from_kind: 'card', from_id: card.id, to_kind: 'project', to_id: p.id })).toMatch(/not linked/);
    await tool('undo');
    const back = await tool('list_links', { kind: 'project', id: p.id });
    expect(back.links).toHaveLength(1);
    expect(await tool('unlink_items', { id: back.links[0].id })).toEqual({ removed: 1 });
  });
});
