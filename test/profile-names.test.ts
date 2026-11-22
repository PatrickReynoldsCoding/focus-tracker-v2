// Claude names a profile by its id or its name (D54): every tool's `mode`, and the profile tools' own ids.
import { describe, expect, it } from 'vitest';
import { matchProfile } from '../src/core/profile-name';
import { call, mcp, tool, toolError } from './helpers';

const make = async (label: string) => (await call('POST', '/profiles', { label }, { expect: 201 })).profile as { id: string; label: string };

describe('profiles by name for Claude', () => {
  it('matches an id, then a name, in any case', () => {
    const ps = [
      { id: 'personal', label: 'Personal' },
      { id: 'work', label: 'My Work' },
      { id: 'abc123', label: 'Side projects' },
    ];
    expect(matchProfile(ps, 'work')).toBe('work');
    expect(matchProfile(ps, 'WORK')).toBe('work');
    expect(matchProfile(ps, 'my work')).toBe('work');
    expect(matchProfile(ps, '  My   Work ')).toBe('work');
    expect(matchProfile(ps, 'side Projects')).toBe('abc123');
    expect(matchProfile(ps, 'my side projects profile')).toBe('abc123');
    expect(matchProfile(ps, 'Personal')).toBe('personal');
    expect(matchProfile(ps, 'holiday')).toBeNull();
    expect(matchProfile(ps, '')).toBeNull();
    // An id wins over another profile's name.
    expect(matchProfile([{ id: 'a', label: 'b' }, { id: 'b', label: 'c' }], 'b')).toBe('b');
  });

  it('takes a profile name as any tool’s mode', async () => {
    const p = await make(`Name Test ${Math.random().toString(36).slice(2, 6)}`);
    const made = await tool('create_project', { name: 'Garden plan', mode: p.label.toUpperCase() });
    const there = await call('GET', '/projects', undefined, { mode: p.id });
    expect(there.map((x: { id: string }) => x.id)).toContain(made.id);
    // "add X to Y in my <profile> profile"
    await tool('add_card', { project_id: made.id, title: 'Dig beds', mode: `my ${p.label.toLowerCase()} profile` });
    const board = await tool('get_board', { project_id: made.id, mode: p.id });
    expect(JSON.stringify(board)).toContain('Dig beds');
  });

  it('refuses an unknown profile with the list of profiles', async () => {
    const p = await make(`Listed ${Math.random().toString(36).slice(2, 6)}`);
    const msg = await toolError('list_projects', { mode: 'no such profile' });
    expect(msg).toMatch(/No profile "no such profile"/);
    expect(msg).toContain(`${p.label} (${p.id})`);
    expect(msg).toContain('Personal (personal)');
  });

  it('takes names in the profile tools too', async () => {
    const p = await make(`Tools ${Math.random().toString(36).slice(2, 6)}`);
    const before = (await call('GET', '/profiles')).default;
    expect((await tool('set_default_profile', { id: p.label.toLowerCase() })).default).toBe(p.id);
    await tool('set_default_profile', { id: before });
    const renamed = await tool('update_profile', { id: p.label, label: `${p.label} 2` });
    expect(renamed.label ?? renamed.profile?.label).toBe(`${p.label} 2`);
    const copy = await tool('create_profile', { label: `Copy ${p.id}`, copy_from: `${p.label} 2` });
    expect(copy.profile.id).toBeTruthy();
    const gone = await tool('delete_profile', { id: `${p.label} 2`, confirm_name: `${p.label} 2` });
    expect(gone.deleted).toBe(p.id);
    expect((await tool('restore_profile', { id: `${p.label} 2` })).restored.id).toBe(p.id);
    expect(await toolError('restore_profile', { id: 'never deleted' })).toMatch(/No deleted profile/);
  });

  it('tells Claude in the connector instructions', async () => {
    const init = await mcp<any>('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(init.instructions).toMatch(/id or its name/);
    expect(init.instructions).toMatch(/in my work profile/);
    const list = await mcp<any>('tools/list', {});
    const mode = list.tools.find((t: any) => t.name === 'list_projects').inputSchema.properties.mode;
    expect(mode.description).toMatch(/name/);
  });
});
