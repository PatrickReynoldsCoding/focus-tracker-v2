import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE, mcp, tool, toolError } from './helpers';

describe('MCP connector', () => {
  it('asks for OAuth without a token and publishes its metadata', async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata');
    const meta = await (await SELF.fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json<any>();
    expect(meta.resource).toBe(`${BASE}/mcp`);
    const as = await (await SELF.fetch(`${BASE}/.well-known/oauth-authorization-server`)).json<any>();
    expect(as.authorization_endpoint).toBe(`${BASE}/authorize`);
    expect(as.registration_endpoint).toBe(`${BASE}/register`);
  });

  it('initializes and lists tools', async () => {
    const init = await mcp<any>('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(init.protocolVersion).toBe('2025-06-18');
    expect(init.serverInfo.name).toBe('focus-tracker');
    expect(await mcp('notifications/initialized', {}, null)).toBe(202);
    const { tools } = await mcp<any>('tools/list');
    const names = tools.map((t: any) => t.name);
    for (const n of ['get_today', 'create_project', 'add_card', 'move_card', 'write_note', 'add_todo', 'log_session', 'undo', 'list_items']) expect(names).toContain(n);
    const add = tools.find((t: any) => t.name === 'add_card');
    expect(add.inputSchema.properties.mode).toBeDefined();
    expect(add.inputSchema.required).toContain('title');
  });

  it('runs a full day through the connector', async () => {
    const p = await tool('create_project', { name: 'Novel', notes: '# Plot' });
    expect(p.columns).toHaveLength(3);
    const card = await tool('add_card', { project_id: p.id, title: 'Chapter 1', column: 'to do' });
    await tool('move_card', { id: card.id, column: 'Doing' });
    await tool('write_note', { project_id: p.id, body: 'Chapter 1 started', how: 'append' });
    const list = await tool('create_list', { name: 'Shopping', kind: 'todo', items: ['Milk', 'Bread'] });
    expect(list.groups[0].todos.map((t: any) => t.title)).toEqual(['Milk', 'Bread']);
    const todo = await tool('add_todo', { title: 'Email editor', day: '2026-11-18' });
    await tool('tick_todo', { id: todo.id });
    await tool('set_focus', { project_id: p.id });
    await tool('start_session', {});
    const log = await tool('stop_session', { where_stopped: 'end of scene 2', next_action: 'scene 3' });
    expect(log.project_id).toBe(p.id);
    const full = await tool('get_project', { id: p.id });
    expect(full.columns[1].cards[0].title).toBe('Chapter 1');
    expect(full.notes).toBe('# Plot\n\nChapter 1 started');
    expect(full.next_action).toBe('scene 3');
    expect(full.recent_log).toHaveLength(1);
    const found = await tool('search', { query: 'Chapter' });
    expect(found.some((r: any) => r.kind === 'tasks')).toBe(true);
    const today = await tool('get_today');
    expect(today.focus.id).toBe(p.id);
  });

  it('works in another mode and with the generic tools', async () => {
    const kinds = await tool('describe_kinds');
    expect(kinds.map((k: any) => k.kind)).toContain('habits');
    const h = await tool('create_item', { kind: 'habits', fields: { name: 'Read', sessions: 1, per: 'day' }, mode: 'work' });
    const work = await tool('list_items', { kind: 'habits', mode: 'work' });
    expect(work.map((x: any) => x.id)).toContain(h.id);
    const personal = await tool('list_items', { kind: 'habits' });
    expect(personal.map((x: any) => x.id)).not.toContain(h.id);
    await tool('update_item', { kind: 'habits', id: h.id, fields: { sessions: 2 }, mode: 'work' });
    expect((await tool('get_item', { kind: 'habits', id: h.id, mode: 'work' })).sessions).toBe(2);
    await tool('undo', { mode: 'work' });
    expect((await tool('get_item', { kind: 'habits', id: h.id, mode: 'work' })).sessions).toBe(1);
  });

  it('reports errors as tool errors', async () => {
    expect(await toolError('get_project', { id: 'missing' })).toContain('No project');
    expect(await toolError('add_card', {})).toContain('title');
    expect(await toolError('create_item', { kind: 'accounts', fields: {} })).toContain('cannot be changed');
    const r = await mcp<any>('tools/call', { name: 'nope', arguments: {} });
    expect(r.isError).toBe(true);
  });
});
