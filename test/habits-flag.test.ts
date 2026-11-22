// The flags `habits` and `insights`: each switches a whole feature, per profile, default on.
// Off: routes refuse (404), Claude's tools are hidden, the habit parts of Today, status, the
// Today list, Plan my week and Insights are gone, and the data stays and comes back.
import { describe, expect, it } from 'vitest';
import { call, mcp, tool, toolError, flagEverywhere } from './helpers';

const names = async () => ((await mcp<any>('tools/list')).tools as { name: string }[]).map((t) => t.name);

describe('flags habits and insights', () => {
  it('are on by default', async () => {
    const f = await call('GET', '/features');
    const on = (id: string) => (f as any[]).find((x) => x.id === id);
    expect(on('habits')?.enabled).toBe(true);
    expect(on('insights')?.enabled).toBe(true);
  });

  it('habits off hides the habit parts and refuses its routes and tools, data stays', async () => {
    const h = await call('POST', '/habits', { name: 'Walk', sessions: 3, per: 'week', size: '20 min' });
    await call('POST', `/habits/${h.id}/check`, {});
    expect((await call<any>('GET', '/status')).habits_left.length).toBe(1);
    expect((await call<any>('GET', '/plan')).habits.length).toBe(1);
    expect(await names()).toContain('check_habit');
    expect(await names()).toContain('habit_step_ups');

    await flagEverywhere('habits', false);
    try {
      expect((await call<any>('GET', '/status')).habits_left).toEqual([]);
      expect((await call<any>('GET', '/today')).habits).toEqual([]);
      expect((await call<any>('GET', '/today/list')).items.some((x: any) => x.kind === 'habit')).toBe(false);
      const plan = await call<any>('GET', '/plan');
      expect(plan.habits).toEqual([]);
      expect(plan.days.every((d: any) => d.habits.length === 0)).toBe(true);
      for (const p of ['/habits', `/habits/${h.id}`, '/habits/progress', '/habits/step-ups', '/habit_log', '/insights/habits']) await call('GET', p, undefined, { expect: 404 });
      await call('POST', `/habits/${h.id}/check`, {}, { expect: 404 });
      await call('POST', '/plan/sessions', { habit_id: h.id, day: '2026-11-23' }, { expect: 404 });
      const week = await call<any>('GET', '/insights/week');
      expect(week.weeks[0].habits).toEqual([]);
      const list = await names();
      for (const t of ['habit_progress', 'check_habit', 'habit_step_ups', 'answer_step_up', 'answer_pending_level', 'add_aspiring_habit', 'plan_habit_session', 'unplan_habit_session']) expect(list).not.toContain(t);
      expect(list).toContain('insights');
      expect(await toolError('list_items', { kind: 'habits' })).toMatch(/turned off/);
      expect((await tool('describe_kinds')).some((k: any) => k.kind === 'habits')).toBe(false);
      expect(await toolError('insights', { view: 'habits' })).toMatch(/turned off/);
      expect((await call<any[]>('GET', '/search?q=Walk')).some((r) => r.kind === 'habits')).toBe(false);
    } finally {
      await flagEverywhere('habits', true);
    }
    expect((await call<any>('GET', '/status')).habits_left.length).toBe(1);
    expect((await call<any[]>('GET', '/habits')).length).toBe(1);
    expect((await call<any>('GET', '/insights/habits')).habits.length).toBe(1);
  });

  it('insights off refuses its routes and hides its tool without touching habits', async () => {
    await flagEverywhere('insights', false);
    try {
      for (const p of ['/insights/week', '/insights/habits', '/insights/projects', '/insights/logs']) await call('GET', p, undefined, { expect: 404 });
      expect(await names()).not.toContain('insights');
      expect(await names()).toContain('check_habit');
      expect((await call<any>('GET', '/status')).habits_left).toBeDefined();
      expect((await call<any>('GET', '/habits/progress')).length).toBeGreaterThan(0);
    } finally {
      await flagEverywhere('insights', true);
    }
  });
});
