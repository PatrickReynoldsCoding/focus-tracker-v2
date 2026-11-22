// Subtasks (docs/DECISIONS.md D57, flag `subtasks`): a card of a project board or a to-do, or an
// item of a plain list, can have a short checklist, one level deep. They live in a table of their
// own (subtasks.task_id), so nothing that reads cards (the Today list, widgets, insights, search)
// ever sees them. They belong to the parent: deleting it deletes them (one undo step), ticking
// them never ticks it and ticking it leaves them alone. A board's answer carries each card's
// subtasks (attachSubtasks), so the web app draws them with no extra request.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import { requireFeature } from '../core/features';
import { onOff } from '../core/setting-scope';
import type { Module } from '../core/registry';
import { create, get, list, update } from '../core/store';

export const SUBTASKS_FLAG = 'subtasks';
/** The setting (per profile or all profiles, D46): "on" (the default) or "off". */
export const OPEN_SETTING = 'subtasks.open_default';

export const subtasksEntity: Entity = {
  name: 'subtasks',
  table: 'subtasks',
  singular: 'subtask',
  desc: 'A subtask: one line of a card’s (or to-do’s) checklist. One level only. done is the day it was ticked. Ticking all of them does not tick the card.',
  modeScoped: true,
  orderGroup: ['task_id'],
  filters: ['task_id'],
  feature: SUBTASKS_FLAG,
  fields: {
    title: { type: 'text', required: true },
    task_id: { type: 'text', ref: 'tasks', cascade: true, required: true, desc: 'The card or to-do it belongs to' },
    done: { type: 'day', desc: 'The day it was ticked (empty: not done)' },
  },
};

export type Subtask = { id: string; title: string; done: string | null; ord: number };

/** Add the subtasks to each card of a board's answer (each card gets `subtasks`, empty for most). Nothing while the flag is off. */
export async function attachSubtasks<C extends { id: string }>(ctx: Ctx, where: { project_id?: string; list_id?: string }, cards: C[]): Promise<(C & { subtasks?: Subtask[] })[]> {
  if (!cards.length || !(await ctx.feature(SUBTASKS_FLAG))) return cards;
  const col = where.project_id ? 'project_id' : 'list_id';
  const rows = (
    await ctx.db
      .prepare(`SELECT s.id, s.task_id, s.title, s.done, s.ord FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.mode = ? AND t.${col} = ? ORDER BY s.ord, s.created`)
      .bind(ctx.mode, where.project_id ?? where.list_id)
      .all<Subtask & { task_id: string }>()
  ).results;
  const by = new Map<string, Subtask[]>();
  for (const { task_id, ...s } of rows) by.set(task_id, [...(by.get(task_id) ?? []), s]);
  return cards.map((c) => ({ ...c, subtasks: by.get(c.id) ?? [] }));
}

/** Subtasks of one card, in order. */
export async function subtasksOf(ctx: Ctx, taskId: string): Promise<Row[]> {
  return list(ctx, subtasksEntity, { where: { task_id: taskId }, limit: 500 });
}

/** How many subtasks each of the given cards has and how many are done: id → [done, total] (only cards with subtasks). */
export async function subtaskCounts(ctx: Ctx, taskIds: string[]): Promise<Record<string, [number, number]>> {
  if (!taskIds.length || !(await ctx.feature(SUBTASKS_FLAG))) return {};
  const out: Record<string, [number, number]> = {};
  for (let i = 0; i < taskIds.length; i += 80) {
    const part = taskIds.slice(i, i + 80);
    const rows = (
      await ctx.db
        .prepare(`SELECT task_id, COUNT(*) AS total, COUNT(done) AS done FROM subtasks WHERE mode = ? AND task_id IN (${part.map(() => '?').join(',')}) GROUP BY task_id`)
        .bind(ctx.mode, ...part)
        .all<{ task_id: string; total: number; done: number }>()
    ).results;
    for (const r of rows) out[r.task_id] = [r.done, r.total];
  }
  return out;
}

/** Add subtasks (titles) to the end of a card's checklist. Refused while the flag is off. */
export async function addSubtasks(ctx: Ctx, taskId: string, titles: string[]): Promise<Row[]> {
  await requireFeature(ctx, SUBTASKS_FLAG);
  const added: Row[] = [];
  for (const title of titles.map((t) => t.trim()).filter(Boolean)) added.push(await create(ctx, subtasksEntity, { task_id: taskId, title }));
  return added;
}

/** Refuse before anything is made when subtasks are given while the flag is off. */
export async function needSubtasks(ctx: Ctx, given: string[] | undefined): Promise<void> {
  if (given?.length) await requireFeature(ctx, SUBTASKS_FLAG);
}

/** Tick a subtask (done today) or untick it. Never touches the card. */
export async function tickSubtask(ctx: Ctx, id: string, done: boolean): Promise<Row> {
  const s = await get(ctx, subtasksEntity, id);
  return update(ctx, subtasksEntity, id, { done: done ? (s.done ?? (await ctx.today())) : null });
}

const titles = z.array(z.string().min(1)).max(50);

/** The `subtasks` argument of Claude's add tools. */
export const subtasksArg = titles.optional().describe('Subtask titles to add as the card’s checklist (one level; needs the subtasks feature)');

export const subtasksModule: Module = {
  id: 'subtasks',
  description: 'Subtasks: a short checklist on a card or to-do, one level deep.',
  entities: [subtasksEntity],
  scopedSettings: [{ id: OPEN_SETTING, key: OPEN_SETTING, label: 'Subtasks open by default', section: 'subtasks', parse: onOff('Subtasks open by default') }],
  features: [
    {
      id: SUBTASKS_FLAG,
      label: 'Subtasks',
      description:
        'Cards and to-dos can have a checklist of subtasks (one level). List view shows them under the to-do with ▸/▾ and a count; Board view shows a progress bar and a checklist you can tick on the card. Ticking all subtasks does not tick the to-do. Off: subtasks are hidden and Claude cannot add them (they are kept).',
      default: true,
    },
  ],
  routes(api) {
    api.post('/subtasks/:id/tick', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, SUBTASKS_FLAG);
      const b = await c.req.json<{ done?: unknown }>().catch(() => ({}) as { done?: unknown });
      ctx.label = b.done === false ? 'untick subtask' : 'tick subtask';
      return c.json(await tickSubtask(ctx, c.req.param('id'), b.done !== false));
    });
  },
  tools: [
    {
      name: 'add_subtask',
      description: 'Add one or more subtasks (checklist lines) to a card or to-do, by its id. One level only: a subtask cannot have subtasks. They stay with the parent (Today, Done, Not today, delete). Give title, or titles for several.',
      feature: SUBTASKS_FLAG,
      input: z.object({ task_id: z.string().describe('The card or to-do id'), title: z.string().optional(), titles: titles.optional() }),
      run: async (ctx, a) => {
        const all = [...(a.title ? [a.title] : []), ...(a.titles ?? [])];
        if (!all.length) throw bad('Give title or titles');
        return addSubtasks(ctx, a.task_id, all);
      },
    },
    {
      name: 'tick_subtask',
      description: 'Mark a subtask done (today) or not done. This never ticks the card or to-do itself. Subtasks are listed in get_board (each card’s subtasks) and by list_items kind subtasks with task_id.',
      feature: SUBTASKS_FLAG,
      input: z.object({ id: z.string(), done: z.boolean().default(true) }),
      run: (ctx, a) => tickSubtask(ctx, a.id, a.done),
    },
  ],
};
