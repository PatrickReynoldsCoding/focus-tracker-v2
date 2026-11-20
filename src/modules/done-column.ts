// The Done column (docs/DECISIONS.md D34, flag `done-column`): a project board's columns are
// statuses, and every project has one fixed Done status (columns.is_done), always last, that
// cannot be deleted. A card is done exactly while it is in it: these hooks keep tasks.done in
// step whichever way a card is changed (dragging, the card dialog, the Today list's tick,
// Claude's tools, the REST API). projects.hide_done folds the column on the board.

import type { Ctx } from '../core/ctx';
import type { Row } from '../core/entity';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { update } from '../core/store';
import { columnsEntity, DONE_FLAG, firstColumn } from './projects';

/** Projects being deleted in this request: their Done columns go with them. */
const deleting = new WeakMap<Ctx, Set<string>>();

/** A project's Done column, without making one. */
async function doneOf(ctx: Ctx, projectId: string): Promise<{ id: string } | null> {
  return ctx.db.prepare('SELECT id FROM columns WHERE mode = ? AND project_id = ? AND is_done = 1 LIMIT 1').bind(ctx.mode, projectId).first<{ id: string }>();
}

/** After the end of a column's cards. */
async function endOf(ctx: Ctx, columnId: string): Promise<number> {
  const r = await ctx.db.prepare('SELECT MAX(ord) AS m FROM tasks WHERE mode = ? AND column_id = ?').bind(ctx.mode, columnId).first<{ m: number | null }>();
  return (r?.m ?? 0) + 1;
}

/** Put the Done column back at the end of its board when another column was put after it. */
async function keepDoneLast(ctx: Ctx, projectId: string): Promise<void> {
  const cols = (
    await ctx.db
      .prepare('SELECT id, ord, is_done FROM columns WHERE mode = ? AND project_id = ? ORDER BY ord, created')
      .bind(ctx.mode, projectId)
      .all<{ id: string; ord: number; is_done: number }>()
  ).results;
  const done = cols.find((c) => c.is_done);
  if (!done || cols[cols.length - 1].id === done.id) return;
  const max = Math.max(...cols.filter((c) => !c.is_done).map((c) => c.ord));
  await update(ctx, columnsEntity, done.id, { ord: max + 1 });
}

/** Keep a project card's done day in step with its column (data is the new row or the patch, in database form). */
async function syncCard(ctx: Ctx, data: Record<string, unknown>, before: Row | null): Promise<void> {
  const projectId = (data.project_id ?? before?.project_id) as string | null | undefined;
  if (!projectId) return;
  const done = await doneOf(ctx, projectId);
  if (!done) return;
  if (!before) {
    if (data.done && data.column_id !== done.id) data.column_id = done.id;
    else if (data.column_id === done.id) data.done ??= await ctx.today();
    else data.done = null;
    return;
  }
  if ('column_id' in data && data.column_id !== before.column_id) {
    data.done = data.column_id === done.id ? (data.done ?? before.done ?? (await ctx.today())) : null;
    return;
  }
  // A new day sent with done cleared (set_card_day, the card dialog's day picker: "clears an
  // earlier tick") is for the Today list; a project card's status stays as its column says.
  if ('day' in data && data.done == null) delete data.done;
  if (!('done' in data)) return;
  const inDone = before.column_id === done.id;
  if (data.done && !inDone) {
    data.column_id = done.id;
    data.ord = await endOf(ctx, done.id);
  } else if (!data.done && inDone) {
    const first = await firstColumn(ctx, projectId, null);
    data.column_id = first.id;
    data.ord = await endOf(ctx, first.id);
  }
}

export const doneColumnModule: Module = {
  id: 'done-column',
  description: 'A fixed Done status on every project board; done cards can be folded away.',
  features: [
    {
      id: DONE_FLAG,
      label: 'Done column',
      description:
        'Every project board has a fixed Done column, always last. A card is done exactly while it is in it (ticking it in the Today list moves it there), and “Hide done” folds the column into a slim strip. Off: the last column counts as done and every column can be moved or deleted.',
      default: true,
    },
  ],
  async beforeWrite(ctx, e, data, before) {
    if (e.name === 'columns') {
      if (!('is_done' in data)) return;
      const want = data.is_done === 1;
      if (before) {
        if (want !== !!before.is_done) throw bad('The Done column is fixed: a board always has exactly one');
      } else if (want) {
        if (!data.project_id) throw bad('Only a project board has a Done column');
        if (await doneOf(ctx, String(data.project_id))) throw bad('This board already has a Done column');
      }
      return;
    }
    if (e.name === 'tasks' && (await ctx.feature(DONE_FLAG))) await syncCard(ctx, data, before);
  },
  async afterWrite(ctx, e, row, before) {
    if (e.name !== 'columns' || !row.project_id || (before && before.ord === row.ord)) return;
    if (await ctx.feature(DONE_FLAG)) await keepDoneLast(ctx, String(row.project_id));
  },
  async beforeDelete(ctx, e, row) {
    if (e.name === 'projects') {
      const set = deleting.get(ctx) ?? new Set<string>();
      set.add(row.id);
      deleting.set(ctx, set);
      return;
    }
    if (e.name !== 'columns' || !row.is_done) return;
    if (deleting.get(ctx)?.has(String(row.project_id))) return;
    if (await ctx.feature(DONE_FLAG)) throw bad('The Done column cannot be deleted (rename it if you like). Hide done folds it on the board.');
  },
};
