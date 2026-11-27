// The focus queue (docs/DECISIONS.md D67, flag `focus-queue`): the owner queues cards and to-dos
// (rows of tasks, from any project) in an ordered list with no size limit. The first is "Now",
// which the focus bar shows (GET /api/today's focus_now). A task is queued at most once: adding it
// again moves it. Ticking a task done, whichever way, takes it out of the queue so the next one
// becomes Now; deleting a task takes it out too (cascade). Every change is one undo step.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity } from '../core/entity';
import { bad } from '../core/errors';
import { requireFeature } from '../core/features';
import type { Module } from '../core/registry';
import { create, find, list, move, remove } from '../core/store';

export const FOCUS_QUEUE_FLAG = 'focus-queue';

export const focusQueueEntity: Entity = {
  name: 'focus_queue',
  table: 'focus_queue',
  singular: 'focus queue item',
  desc: 'One place in the focus queue: a card or to-do the owner means to work on, in order. The first is Now.',
  modeScoped: true,
  internal: true,
  orderGroup: [],
  filters: ['task_id'],
  feature: FOCUS_QUEUE_FLAG,
  fields: {
    task_id: { type: 'text', ref: 'tasks', cascade: true, required: true, desc: 'The card or to-do queued' },
  },
};

export type FocusItem = {
  id: string;
  task_id: string;
  title: string;
  done: string | null;
  project_id: string | null;
  project_name: string | null;
  list_id: string | null;
  list_name: string | null;
  ord: number;
};

// A to-do's project is the one it is about, else its list's project.
const PROJECT = 'COALESCE(t.project_id, t.about_project_id, l.project_id)';
const ITEMS = `SELECT q.id, q.task_id, t.title, t.done, ${PROJECT} AS project_id, p.name AS project_name, t.list_id, l.name AS list_name, q.ord
  FROM focus_queue q JOIN tasks t ON t.id = q.task_id LEFT JOIN lists l ON l.id = t.list_id LEFT JOIN projects p ON p.id = ${PROJECT}
  WHERE q.mode = ? ORDER BY q.ord, q.created`;

/** The queue, in order (the first is Now). */
export async function focusQueue(ctx: Ctx, limit?: number): Promise<FocusItem[]> {
  return (
    await ctx.db
      .prepare(limit ? `${ITEMS} LIMIT ${limit}` : ITEMS)
      .bind(ctx.mode)
      .all<FocusItem>()
  ).results;
}

/** The first item of the queue (Now), or null when it is empty or the flag is off. */
export async function focusNow(ctx: Ctx): Promise<FocusItem | null> {
  if (!(await ctx.feature(FOCUS_QUEUE_FLAG))) return null;
  return (await focusQueue(ctx, 1))[0] ?? null;
}

const queuedRow = async (ctx: Ctx, taskId: string) => (await list(ctx, focusQueueEntity, { where: { task_id: taskId }, limit: 1 }))[0] ?? null;

/** Queue a task at the end, or first ('now'). A task already queued just moves there. */
export async function addToQueue(ctx: Ctx, taskId: string, at: 'now' | 'end' = 'end', id?: string): Promise<FocusItem[]> {
  await requireFeature(ctx, FOCUS_QUEUE_FLAG);
  if (typeof taskId !== 'string' || !taskId) throw bad('task_id is needed');
  if (at !== 'now' && at !== 'end') throw bad('at is now or end');
  const queued = await queuedRow(ctx, taskId);
  if (queued) await move(ctx, focusQueueEntity, queued.id, at === 'now' ? { index: 0 } : {});
  else {
    const input: Record<string, unknown> = { task_id: taskId };
    if (id) input.id = id;
    if (at === 'now') {
      const r = await ctx.db.prepare('SELECT MIN(ord) AS m FROM focus_queue WHERE mode = ?').bind(ctx.mode).first<{ m: number | null }>();
      if (r?.m != null) input.ord = r.m - 1;
    }
    await create(ctx, focusQueueEntity, input);
  }
  return focusQueue(ctx);
}

/** Take an item out of the queue (by its id, or by the task's id). */
export async function removeFromQueue(ctx: Ctx, by: { id?: string; task_id?: string }): Promise<FocusItem[]> {
  await requireFeature(ctx, FOCUS_QUEUE_FLAG);
  let id = by.id;
  if (!id && by.task_id) {
    const queued = await queuedRow(ctx, by.task_id);
    if (!queued) throw bad(`Task ${by.task_id} is not in the focus queue`);
    id = queued.id;
  }
  if (!id) throw bad('Give id or task_id');
  await remove(ctx, focusQueueEntity, id);
  return focusQueue(ctx);
}

/** Move an item to a place in the queue (0 = first, Now). */
export async function moveInQueue(ctx: Ctx, id: string, index: unknown): Promise<FocusItem[]> {
  await requireFeature(ctx, FOCUS_QUEUE_FLAG);
  if (typeof index !== 'number' || !Number.isFinite(index)) throw bad('index must be a number (0 = first)');
  if (!(await find(ctx, focusQueueEntity, id))) throw bad(`No focus queue item with id ${id}`);
  await move(ctx, focusQueueEntity, id, { index });
  return focusQueue(ctx);
}

export const focusQueueModule: Module = {
  id: 'focus-queue',
  description: 'Focus queue: an ordered queue of cards and to-dos to work on; the first is Now.',
  entities: [focusQueueEntity],
  features: [
    {
      id: FOCUS_QUEUE_FLAG,
      label: 'Focus queue',
      description:
        'Queue cards and to-dos (from any project) in the order you mean to work on them, with no limit. The first is Now and shows in the focus bar. Ticking one done takes it out, so the next becomes Now. Off: the queue is hidden (it is kept).',
      default: true,
    },
  ],
  // A task ticked done, whichever way (tick, moved into Done, Claude), leaves the queue: same undo step.
  async afterWrite(ctx, e, row, before) {
    if (e.name !== 'tasks' || !row.done || (before && before.done)) return;
    const queued = await queuedRow(ctx, row.id);
    if (queued) await remove(ctx, focusQueueEntity, queued.id);
  },
  routes(api) {
    api.get('/focus-queue', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FOCUS_QUEUE_FLAG);
      return c.json(await focusQueue(ctx));
    });
    api.post('/focus-queue', async (c) => {
      const ctx = c.get('ctx');
      const b = await c.req.json<{ task_id?: unknown; at?: unknown; id?: unknown }>().catch(() => ({}) as Record<string, unknown>);
      ctx.label = 'queue for focus';
      return c.json(await addToQueue(ctx, b.task_id as string, (b.at ?? 'end') as 'now' | 'end', typeof b.id === 'string' ? b.id : undefined));
    });
    api.delete('/focus-queue/:id', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'take out of focus queue';
      return c.json(await removeFromQueue(ctx, { id: c.req.param('id') }));
    });
    api.post('/focus-queue/:id/move', async (c) => {
      const ctx = c.get('ctx');
      const b = await c.req.json<{ index?: unknown }>().catch(() => ({}) as { index?: unknown });
      ctx.label = 'reorder focus queue';
      return c.json(await moveInQueue(ctx, c.req.param('id'), b.index));
    });
  },
  tools: [
    {
      name: 'get_focus_queue',
      description: 'List the focus queue in order: the cards and to-dos the owner means to work on, the first being Now.',
      readOnly: true,
      feature: FOCUS_QUEUE_FLAG,
      input: z.object({}),
      run: (ctx) => focusQueue(ctx),
    },
    {
      name: 'add_to_focus_queue',
      description: 'Add a card or to-do (by its task id) to the end of the focus queue, or first (Now) with now: true; one already queued just moves.',
      feature: FOCUS_QUEUE_FLAG,
      input: z.object({ task_id: z.string().describe('The card or to-do id'), now: z.boolean().optional().describe('Put it first, as Now') }),
      run: (ctx, a) => addToQueue(ctx, a.task_id, a.now ? 'now' : 'end'),
    },
    {
      name: 'remove_from_focus_queue',
      description: 'Take an item out of the focus queue, by the queue item id or the task id (the task itself is not changed).',
      feature: FOCUS_QUEUE_FLAG,
      input: z.object({ id: z.string().optional().describe('The queue item id'), task_id: z.string().optional().describe('Or the card or to-do id') }),
      run: (ctx, a) => removeFromQueue(ctx, a),
    },
    {
      name: 'move_in_focus_queue',
      description: 'Move a focus queue item (by its queue item id) to a new place, where index 0 is first (Now).',
      feature: FOCUS_QUEUE_FLAG,
      input: z.object({ id: z.string().describe('The queue item id'), index: z.number().int().min(0) }),
      run: (ctx, a) => moveInQueue(ctx, a.id, a.index),
    },
  ],
};
