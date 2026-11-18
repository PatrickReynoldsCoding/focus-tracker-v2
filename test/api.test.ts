import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE, call } from './helpers';

describe('auth', () => {
  it('refuses the API without a token', async () => {
    const res = await SELF.fetch(`${BASE}/api/projects`);
    expect(res.status).toBe(401);
  });

  it('refuses a wrong token', async () => {
    const res = await SELF.fetch(`${BASE}/api/projects`, { headers: { Authorization: 'Bearer ft_nope' } });
    expect(res.status).toBe(401);
  });

  it('logs in with the password and needs X-FT-Client for changes', async () => {
    const bad = await SELF.fetch(`${BASE}/auth/login`, { method: 'POST', body: JSON.stringify({ password: 'wrong' }) });
    expect(bad.status).toBe(401);
    const res = await SELF.fetch(`${BASE}/auth/login`, { method: 'POST', body: JSON.stringify({ password: 'test-password' }) });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie')!.split(';')[0];
    expect(cookie).toMatch(/^ft_session=/);
    const list = await SELF.fetch(`${BASE}/api/projects`, { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    const forged = await SELF.fetch(`${BASE}/api/projects`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
    expect(forged.status).toBe(403);
    const ok = await SELF.fetch(`${BASE}/api/projects`, { method: 'POST', headers: { Cookie: cookie, 'X-FT-Client': 'web', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
    expect(ok.status).toBe(201);
  });

  it('serves health without auth', async () => {
    const res = await SELF.fetch(`${BASE}/health`);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe('projects and boards', () => {
  it('creates a project with To do, Doing and Done', async () => {
    const p = await call('POST', '/projects', { name: 'Website' });
    expect(p).toMatchObject({ name: 'Website', status: 'active', mode: 'personal' });
    const full = await call('GET', `/projects/${p.id}/full`);
    expect(full.columns.map((c: any) => c.name)).toEqual(['To do', 'Doing', 'Done']);
  });

  it('adds cards, moves them between columns and keeps order', async () => {
    const p = await call('POST', '/projects', { name: 'Board' });
    const [todo, doing] = (await call('GET', `/projects/${p.id}/full`)).columns;
    const a = await call('POST', '/tasks', { project_id: p.id, title: 'A' });
    const b = await call('POST', '/tasks', { project_id: p.id, title: 'B' });
    const c = await call('POST', '/tasks', { column_id: todo.id, title: 'C', note: '**bold**' });
    expect(a.column_id).toBe(todo.id);
    expect(c.project_id).toBe(p.id);
    // C to the top
    await call('POST', `/tasks/${c.id}/move`, { index: 0 });
    let cols = (await call('GET', `/projects/${p.id}/full`)).columns;
    expect(cols[0].cards.map((x: any) => x.title)).toEqual(['C', 'A', 'B']);
    // A to Doing
    await call('POST', `/tasks/${a.id}/move`, { column_id: doing.id });
    // B before C
    await call('POST', `/tasks/${b.id}/move`, { before_id: c.id });
    cols = (await call('GET', `/projects/${p.id}/full`)).columns;
    expect(cols[0].cards.map((x: any) => x.title)).toEqual(['B', 'C']);
    expect(cols[1].cards.map((x: any) => x.title)).toEqual(['A']);
  });

  it('renumbers when the gaps run out', async () => {
    const p = await call('POST', '/projects', { name: 'Gaps' });
    const x = await call('POST', '/tasks', { project_id: p.id, title: 'x' });
    const y = await call('POST', '/tasks', { project_id: p.id, title: 'y' });
    const z = await call('POST', '/tasks', { project_id: p.id, title: 'z' });
    for (let i = 0; i < 60; i++) await call('POST', `/tasks/${(i % 2 ? y : z).id}/move`, { after_id: x.id });
    const cards = (await call('GET', `/boards/project/${p.id}`))[0].cards.map((c: any) => c.title);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toBe('x');
  });

  it('validates input', async () => {
    await call('POST', '/projects', { name: 'P', status: 'nonsense' }, { expect: 400 });
    await call('POST', '/projects', { nope: 1, name: 'P' }, { expect: 400 });
    await call('POST', '/tasks', { title: 'orphan' }, { expect: 400 });
    await call('POST', '/tasks', { title: 'x', column_id: 'missing123' }, { expect: 400 });
    await call('GET', '/nothing', undefined, { expect: 400 });
    await call('GET', '/projects/doesnotexist', undefined, { expect: 404 });
  });

  it('deletes a project with its board, criteria and notes, and undo brings it back', async () => {
    const p = await call('POST', '/projects', { name: 'Doomed' });
    await call('POST', '/tasks', { project_id: p.id, title: 'card' });
    await call('POST', '/criteria', { project_id: p.id, text: 'it works' });
    await call('PUT', `/notes/of/project/${p.id}`, { body: '# Notes' });
    await call('DELETE', `/projects/${p.id}`);
    await call('GET', `/projects/${p.id}`, undefined, { expect: 404 });
    expect(await call('GET', `/tasks?project_id=${p.id}`)).toEqual([]);
    expect(await call('GET', `/criteria?project_id=${p.id}`)).toEqual([]);
    const undone = await call('POST', '/undo');
    expect(undone.changes).toBeGreaterThan(5);
    const full = await call('GET', `/projects/${p.id}/full`);
    expect(full.columns[0].cards[0].title).toBe('card');
    expect(full.criteria[0].text).toBe('it works');
    expect(full.notes).toBe('# Notes');
  });

  it('undo reverts an edit', async () => {
    const p = await call('POST', '/projects', { name: 'Before' });
    await call('PATCH', `/projects/${p.id}`, { name: 'After' });
    await call('POST', '/undo');
    expect((await call('GET', `/projects/${p.id}`)).name).toBe('Before');
    await call('POST', '/undo');
    await call('GET', `/projects/${p.id}`, undefined, { expect: 404 });
  });
});

describe('modes', () => {
  it('keeps Personal and Work apart', async () => {
    const w = await call('POST', '/projects', { name: 'Work thing' }, { mode: 'work' });
    const personal = await call('GET', '/projects');
    expect(personal.find((p: any) => p.id === w.id)).toBeUndefined();
    await call('GET', `/projects/${w.id}`, undefined, { expect: 404 });
    expect((await call('GET', `/projects/${w.id}`, undefined, { mode: 'work' })).name).toBe('Work thing');
    await call('GET', '/projects', undefined, { mode: 'nope', expect: 400 });
  });

  it('refuses a card on a column of another mode', async () => {
    const w = await call('POST', '/projects', { name: 'W' }, { mode: 'work' });
    const col = (await call('GET', `/projects/${w.id}/full`, undefined, { mode: 'work' })).columns[0];
    await call('POST', '/tasks', { column_id: col.id, title: 'sneaky' }, { expect: 400 });
  });
});

describe('lists, to-dos and notes', () => {
  it('makes the three kinds of list', async () => {
    const plain = await call('POST', '/lists', { name: 'Read and watch' });
    const todo = await call('POST', '/lists', { name: 'Errands', kind: 'todo' });
    const note = await call('POST', '/lists', { name: 'Ideas', kind: 'note' });
    await call('POST', '/tasks', { list_id: plain.id, title: 'A book' });
    await call('POST', '/todos', { list_id: todo.id, title: 'Post office' });
    await call('PUT', `/notes/of/list/${note.id}`, { body: '- one\n- two' });
    expect((await call('GET', `/lists/${plain.id}/full`)).columns[0].cards[0].title).toBe('A book');
    expect((await call('GET', `/lists/${todo.id}/full`)).groups[0].todos[0].title).toBe('Post office');
    expect((await call('GET', `/lists/${note.id}/full`)).body).toBe('- one\n- two');
    await call('PATCH', `/lists/${plain.id}`, { kind: 'note' }, { expect: 400 });
  });

  it('puts a to-do without a list on the first to-do list, making one if needed', async () => {
    const t = await call('POST', '/todos', { title: 'Call mum' }, { mode: 'work' });
    const lists = await call('GET', '/lists?kind=todo', undefined, { mode: 'work' });
    expect(lists.map((l: any) => l.id)).toContain(t.list_id);
    const plain = await call('POST', '/lists', { name: 'Plain' }, { mode: 'work' });
    await call('POST', '/todos', { title: 'x', list_id: plain.id }, { mode: 'work', expect: 400 });
  });

  it('ticks a to-do with today’s date', async () => {
    const t = await call('POST', '/todos', { title: 'Tick me' });
    const done = await call('POST', `/todos/${t.id}/tick`, { done: true });
    expect(done.done).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const undone = await call('POST', `/todos/${t.id}/tick`, { done: false });
    expect(undone.done).toBeNull();
  });
});

describe('today, sessions and status', () => {
  it('starts empty, then focus, session and shutdown note', async () => {
    let t = await call('GET', '/today', undefined, { mode: 'work' });
    expect(t.focus).toBeNull();
    expect(t.show_session_controls).toBe(false);
    const p = await call('POST', '/projects', { name: 'Focus me' }, { mode: 'work' });
    t = await call('PUT', '/focus', { project_id: p.id }, { mode: 'work' });
    expect(t.focus.id).toBe(p.id);
    expect(t.show_session_controls).toBe(true);
    const s = await call('POST', '/session/start', {}, { mode: 'work' });
    expect(s.project_id).toBe(p.id);
    expect(s.pomodoro.phase).toBe('work');
    await call('POST', '/session/start', {}, { mode: 'work', expect: 400 });
    const status = await call('GET', '/status', undefined, { mode: 'work' });
    expect(status.session.project_name).toBe('Focus me');
    const log = await call('POST', '/session/stop', { where_stopped: 'half way' }, { mode: 'work' });
    expect(log).toMatchObject({ project_id: p.id, where_stopped: 'half way', minutes: 1 });
    expect((await call('GET', '/session', undefined, { mode: 'work' }))).toBeNull();
  });

  it('remembers a skipped project with a reminder', async () => {
    const a = await call('POST', '/projects', { name: 'First' });
    const b = await call('POST', '/projects', { name: 'Second' });
    await call('PUT', '/focus', { project_id: a.id });
    await call('PUT', '/focus', { project_id: b.id });
    const skips = await call('GET', `/skips?project_id=${a.id}`);
    expect(skips).toHaveLength(1);
    const rem = await call('GET', `/reminders?project_id=${a.id}`);
    expect(rem[0].text).toContain('First');
    await call('PUT', '/focus', { project_id: null });
  });

  it('shows due to-dos, habits left and due reminders in status', async () => {
    const h = await call('POST', '/habits', { name: 'Stretch', sessions: 2, per: 'day' });
    await call('POST', '/todos', { title: 'Due', day: '2000-01-01' });
    await call('POST', '/reminders', { text: 'Ping', due: '2000-01-01T00:00:00Z' });
    let s = await call('GET', '/status');
    expect(s.todos_due.map((t: any) => t.title)).toContain('Due');
    expect(s.habits_left.find((x: any) => x.id === h.id).left).toBe(2);
    const n = s.notifications.find((x: any) => x.body === 'Ping');
    expect(n.kind).toBe('reminder');
    await call('POST', `/habits/${h.id}/check`, {});
    s = await call('GET', '/status');
    expect(s.habits_left.find((x: any) => x.id === h.id).left).toBe(1);
    await call('POST', `/notifications/${n.id}/dismiss`);
    s = await call('GET', '/status');
    expect(s.notifications.find((x: any) => x.body === 'Ping')).toBeUndefined();
    // and it is not made again
    s = await call('GET', '/status');
    expect(s.notifications.find((x: any) => x.body === 'Ping')).toBeUndefined();
  });

  it('counts weekly habits across the week', async () => {
    const h = await call('POST', '/habits', { name: 'Run', sessions: 3, per: 'week' });
    const today = (await call('GET', '/today')).day;
    await call('POST', `/habits/${h.id}/check`, { count: 2, day: today });
    const prog = await call('GET', '/habits/progress');
    expect(prog.find((x: any) => x.id === h.id)).toMatchObject({ done_this_period: 2, left: 1 });
  });

  it('keeps a weekly rotation with this-week changes', async () => {
    const cat = await call('POST', '/categories', { label: 'Coding' });
    const r = await call('PUT', '/rotation', { usual: { monday: cat.id, saturday: 'away' }, this_week: { monday: 'any' } });
    expect(r.usual.monday).toBe(cat.id);
    expect(r.this_week.monday).toBe('any');
  });
});

describe('backlog, resources, settings, tokens', () => {
  it('starts a backlog item as a project', async () => {
    const b = await call('POST', '/backlog', { title: 'Learn Rust', note: 'from the book' });
    const p = await call('POST', `/backlog/${b.id}/start`);
    expect(p.name).toBe('Learn Rust');
    await call('GET', `/backlog/${b.id}`, undefined, { expect: 404 });
    expect((await call('GET', `/projects/${p.id}/full`)).notes).toBe('from the book');
  });

  it('types Drive links as drive and needs an owner', async () => {
    const p = await call('POST', '/projects', { name: 'R' });
    const r = await call('POST', '/resources', { project_id: p.id, title: 'Doc', value: 'https://docs.google.com/document/d/x' });
    expect(r.type).toBe('drive');
    await call('POST', '/resources', { title: 'loose', value: 'x' }, { expect: 400 });
  });

  it('stores settings and protects session ones', async () => {
    await call('PUT', '/settings/pomodoro.work', { value: '50' });
    await call('PUT', '/settings/timezone', { value: 'America/New_York', global: true });
    await call('PUT', '/settings/timezone', { value: 'Mars/Base', global: true }, { expect: 400 });
    await call('PUT', '/settings/session.current', { value: '{}' }, { expect: 400 });
    const s = await call('GET', '/settings');
    expect(s.mode['pomodoro.work']).toBe('50');
    expect(s.global.timezone).toBe('America/New_York');
    await call('PUT', '/settings/timezone', { value: 'Europe/London', global: true });
  });

  it('makes API tokens that work and can be revoked', async () => {
    const t = await call('POST', '/tokens', { name: 'phone' });
    expect(t.token).toMatch(/^ft_/);
    const res = await SELF.fetch(`${BASE}/api/status`, { headers: { Authorization: `Bearer ${t.token}` } });
    expect(res.status).toBe(200);
    const listed = await call('GET', '/tokens');
    expect(JSON.stringify(listed)).not.toContain(t.token);
    await call('DELETE', `/tokens/${t.id}`);
    const after = await SELF.fetch(`${BASE}/api/status`, { headers: { Authorization: `Bearer ${t.token}` } });
    expect(after.status).toBe(401);
  });

  it('never returns Google tokens', async () => {
    await env.DB.prepare("INSERT INTO accounts (id, email, refresh_token_enc, created, updated_at) VALUES ('acc1', 'a@example.com', 'SECRET', 'x', 'x')").run();
    const rows = await call('GET', '/accounts');
    expect(JSON.stringify(rows)).not.toContain('SECRET');
    await call('POST', '/accounts', { email: 'b@example.com' }, { expect: 400 });
  });
});

describe('migrations', () => {
  it('lists every migration file and splits it into statements', async () => {
    const { MIGRATIONS, statements } = await import('../src/core/migrate');
    const files = env.TEST_MIGRATIONS.map((m) => m.name);
    expect(MIGRATIONS.map(([n]) => n)).toEqual(files);
    const sql = MIGRATIONS[0][1];
    expect(statements(sql).length).toBe(env.TEST_MIGRATIONS[0].queries.length);
  });
});

describe('import', () => {
  it('keeps ids and dates, skips existing rows, makes no default columns and reports bad rows', async () => {
    const m = { mode: 'work' };
    let r = await call('POST', '/import/projects', { rows: [{ id: 'imp00001', name: 'Old', created: '2025-01-02T03:04:05Z' }, { id: 'imp00002', status: 'bogus', name: 'x' }] }, m);
    expect(r).toMatchObject({ created: 1, skipped: 0 });
    expect(r.errors[0].id).toBe('imp00002');
    r = await call('POST', '/import/projects', { rows: [{ id: 'imp00001', name: 'Old' }] }, m);
    expect(r).toMatchObject({ created: 0, skipped: 1 });
    const p = await call('GET', '/projects/imp00001/full', undefined, m);
    expect(p.created).toBe('2025-01-02T03:04:05.000Z');
    expect(p.columns).toEqual([]);
    await call('POST', '/import/accounts', { rows: [] }, { ...m, expect: 400 });
  });
});

describe('feature flags', () => {
  it('lists flags and refuses unknown ones', async () => {
    const list = await call('GET', '/features');
    expect(Array.isArray(list)).toBe(true);
    await call('PUT', '/features/no-such-flag', { enabled: true }, { expect: 400 });
  });
});
