// A habit can be linked to one project.
import { describe, expect, it } from 'vitest';
import { call } from './helpers';

const M = { mode: 'work' };

describe('habit linked to a project', () => {
  it('shows the project in progress, and unlinking or deleting the project clears it', async () => {
    const p = await call('POST', '/projects', { name: 'Habit home' }, M);
    const h = await call('POST', '/habits', { name: 'Stretch', sessions: 3, per: 'week', project_id: p.id }, M);
    expect(h.project_id).toBe(p.id);
    const progress = await call('GET', '/habits/progress', undefined, M);
    expect(progress.find((x: { id: string }) => x.id === h.id).project_id).toBe(p.id);
    const unlinked = await call('PATCH', `/habits/${h.id}`, { project_id: null }, M);
    expect(unlinked.project_id).toBeNull();
    await call('PATCH', `/habits/${h.id}`, { project_id: p.id }, M);
    await call('DELETE', `/projects/${p.id}`, undefined, M);
    expect((await call('GET', `/habits/${h.id}`, undefined, M)).project_id).toBeNull();
  });
});
