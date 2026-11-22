// A habit has notes (Markdown, D56): REST, progress, Today, Claude's tools, conflict-safe saves, per profile.
import { describe, expect, it } from 'vitest';
import { call, tool } from './helpers';

const M = { mode: 'work' };

describe('habit notes', () => {
  it('are kept, read back and listed with progress and Today', async () => {
    const h = await call('POST', '/habits', { name: 'Swim', sessions: 2, per: 'week', notes: '# Kit\n- goggles' }, M);
    expect(h.notes).toBe('# Kit\n- goggles');
    expect((await call('GET', `/habits/${h.id}`, undefined, M)).notes).toBe('# Kit\n- goggles');
    const progress = await call<any[]>('GET', '/habits/progress', undefined, M);
    expect(progress.find((x) => x.id === h.id).notes).toBe('# Kit\n- goggles');
    const today = await call<any>('GET', '/today', undefined, M);
    expect(today.habits.find((x: any) => x.id === h.id).notes).toBe('# Kit\n- goggles');
    const cleared = await call('PATCH', `/habits/${h.id}`, { notes: '' }, M);
    expect(cleared.notes ?? '').toBe('');
    expect((await call<any[]>('GET', '/habits/progress', undefined, M)).find((x) => x.id === h.id).notes).toBeNull();
  });

  it('are profile-scoped', async () => {
    const h = await call('POST', '/habits', { name: 'Read', notes: 'Kindle' }, M);
    await call('GET', `/habits/${h.id}`, undefined, { mode: 'personal', expect: 404 });
  });

  it('refuse a save from an older copy when the notes changed since (409), and allow other fields', async () => {
    const h = await call('POST', '/habits', { name: 'Run', notes: 'one' }, M);
    const base = h.updated_at as string;
    await new Promise((r) => setTimeout(r, 5));
    await call('PATCH', `/habits/${h.id}`, { notes: 'two' }, M);
    await call('PATCH', `/habits/${h.id}`, { notes: 'mine', base_updated_at: base }, { ...M, expect: 409 });
    expect((await call('GET', `/habits/${h.id}`, undefined, M)).notes).toBe('two');
    const renamed = await call('PATCH', `/habits/${h.id}`, { name: 'Jog', base_updated_at: base }, M);
    expect(renamed.name).toBe('Jog');
  });

  it('Claude reads and writes them', async () => {
    const made = await tool<any>('create_item', { kind: 'habits', mode: 'work', fields: { name: 'Stretch', sessions: 1, per: 'day', notes: 'Hamstrings first' } });
    expect(made.notes).toBe('Hamstrings first');
    await tool('update_item', { kind: 'habits', mode: 'work', id: made.id, fields: { notes: 'Calves too' } });
    expect((await tool<any>('get_item', { kind: 'habits', mode: 'work', id: made.id })).notes).toBe('Calves too');
    const progress = await tool<any[]>('habit_progress', { mode: 'work' });
    expect(progress.find((x) => x.id === made.id).notes).toBe('Calves too');
    const idea = await tool<any>('add_aspiring_habit', { mode: 'work', name: 'Climb', notes: 'Wall on Mill Rd' });
    expect(idea.notes).toBe('Wall on Mill Rd');
  });
});
