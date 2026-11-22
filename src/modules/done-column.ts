// The Done column (docs/DECISIONS.md D34 and D40): a board's columns are statuses (a project) or
// groups (a to-do), and every project and every to-do has one fixed Done column
// (columns.is_done), always last, that cannot be deleted. A card is done exactly while it is in
// it: these hooks keep tasks.done in step whichever way a card is changed (dragging, the card
// dialog, a tick in the Today list or on a to-do, Claude's tools, the REST API). Project boards
// follow the flag `done-column`; to-dos always have their Done column. projects.hide_done folds
// the column on a project's board. A plain list has no Done column.

import type { Ctx } from '../core/ctx';
import type { Row } from '../core/entity';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { update } from '../core/store';
import { boardKind, columnsEntity, DONE_FLAG, doneOf, firstColumn, hasDoneColumn, ownerOf, todoDoneColumn, type Owner } from './boards';

/** Projects and lists being deleted in this request: their Done columns go with them. */
const deleting = new WeakMap<Ctx, Set<string>>();

/** After the end of a column's cards. */
async function endOf(ctx: Ctx, columnId: string): Promise<number> {
  const r = await ctx.db.prepare('SELECT MAX(ord) AS m FROM tasks WHERE mode = ? AND column_id = ?').bind(ctx.mode, columnId).first<{ m: number | null }>();
  return (r?.m ?? 0) + 1;
}

/** Put the Done column back at the end of its board when another column was put after it. */
async function keepDoneLast(ctx: Ctx, owner: Owner): Promise<void> {
  const col = owner.project_id ? 'project_id' : 'list_id';
  const cols = (
    await ctx.db
      .prepare(`SELECT id, ord, is_done FROM columns WHERE mode = ? AND ${col} = ? ORDER BY ord, created`)
      .bind(ctx.mode, owner.project_id ?? owner.list_id)
      .all<{ id: string; ord: number; is_done: number }>()
  ).results;
  const done = cols.find((c) => c.is_done);
  if (!done || cols[cols.length - 1].id === done.id) return;
  const max = Math.max(...cols.filter((c) => !c.is_done).map((c) => c.ord));
  await update(ctx, columnsEntity, done.id, { ord: max + 1 });
}

/** Where an unticked card goes: a to-do's card back to the group it came from (if it is still there), a project card to the first column. */
async function backFromDone(ctx: Ctx, owner: Owner, before: Row): Promise<string> {
  if (owner.list_id && before.from_column_id) {
    const from = await ctx.db
      .prepare('SELECT id FROM columns WHERE id = ? AND mode = ? AND list_id = ? AND is_done = 0')
      .bind(before.from_column_id, ctx.mode, owner.list_id)
      .first<{ id: string }>();
    if (from) return from.id;
  }
  return (await firstColumn(ctx, owner.project_id ?? null, owner.list_id ?? null)).id;
}

/**
 * Keep a card's done day in step with its board's Done column (data is the new row or the
 * patch, in database form). A card going into Done remembers the column it came from
 * (from_column_id). Ticked from outside the board, a project card goes to the end of Done; a
 * to-do's card keeps its place number, so the list shows it where it was (and it comes back there).
 */
async function syncCard(ctx: Ctx, data: Record<string, unknown>, before: Row | null): Promise<void> {
  const owner = ownerOf({ project_id: data.project_id ?? before?.project_id, list_id: data.list_id ?? before?.list_id });
  if (!owner || !(await hasDoneColumn(ctx, owner))) return;
  // A to-do always has its Done column (one imported without it gets it now); a project's is made by migration 0019 or doneColumn().
  const done = owner.list_id ? await todoDoneColumn(ctx, owner.list_id) : await doneOf(ctx, owner);
  if (!done) return;
  const project = !!owner.project_id;
  if (!before) {
    if (data.done && data.column_id !== done.id) {
      data.from_column_id ??= data.column_id;
      data.column_id = done.id;
    } else if (data.column_id === done.id) data.done ??= await ctx.today();
    else data.done = null;
    return;
  }
  const wasInDone = before.column_id === done.id;
  if ('column_id' in data && data.column_id !== before.column_id) {
    if (data.column_id === done.id) {
      data.done = data.done ?? before.done ?? (await ctx.today());
      if (!wasInDone) data.from_column_id ??= before.column_id;
    } else {
      data.done = null;
      if (!('from_column_id' in data)) data.from_column_id = null;
    }
    return;
  }
  // A new day sent with done cleared (set_card_day, the card dialog's day picker: "clears an
  // earlier tick") is for the Today list; the card's status stays as its column says.
  if ('day' in data && data.done == null) delete data.done;
  if (!('done' in data)) return;
  if (data.done && !wasInDone) {
    data.from_column_id ??= before.column_id;
    data.column_id = done.id;
    if (project) data.ord = await endOf(ctx, done.id);
  } else if (!data.done && wasInDone) {
    data.column_id = await backFromDone(ctx, owner, before);
    data.from_column_id = null;
    if (project) data.ord = await endOf(ctx, String(data.column_id));
  }
}

export const doneColumnModule: Module = {
  id: 'done-column',
  description: 'A fixed Done status on every project board and every to-do; done cards can be folded away.',
  features: [
    {
      id: DONE_FLAG,
      label: 'Done column',
      description:
        'Every project board has a fixed Done column, always last. A card is done exactly while it is in it (ticking it in the Today list moves it there), and “Hide done” folds the column into a slim strip. Off: the last column counts as done and every column can be moved or deleted. (To-dos always have their Done column.)',
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
        const owner = ownerOf(data);
        if (!owner || (await boardKind(ctx, owner)) === 'list') throw bad('Only a project board or a to-do has a Done column');
        if (await doneOf(ctx, owner)) throw bad('This board already has a Done column');
      }
      return;
    }
    if (e.name === 'tasks') await syncCard(ctx, data, before);
  },
  async afterWrite(ctx, e, row, before) {
    if (e.name !== 'columns' || (before && before.ord === row.ord)) return;
    const owner = ownerOf(row);
    if (owner && (await hasDoneColumn(ctx, owner))) await keepDoneLast(ctx, owner);
  },
  async beforeDelete(ctx, e, row) {
    if (e.name === 'projects' || e.name === 'lists') {
      const set = deleting.get(ctx) ?? new Set<string>();
      set.add(row.id);
      deleting.set(ctx, set);
      return;
    }
    if (e.name !== 'columns' || !row.is_done) return;
    if (deleting.get(ctx)?.has(String(row.project_id ?? row.list_id))) return;
    if (row.list_id || (await ctx.feature(DONE_FLAG))) throw bad('The Done column cannot be deleted (rename it if you like). Hide done folds it on the board.');
  },
};
