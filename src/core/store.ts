// Generic create, read, update, delete and move for any registered entity.
// Every write is recorded on ctx.changes, so a request can be undone as one step.

import type { Ctx } from './ctx';
import { columnsOf, type Entity, type Field, type Row } from './entity';
import { ApiError, bad, notFound } from './errors';
import { CLIENT_ID, newId } from './ids';
import { allEntities, allModules, entity as getEntity } from './registry';

type Input = Record<string, unknown>;

// ---------- values between JSON and SQLite ----------

function toDb(field: Field, value: unknown, name: string): unknown {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case 'bool':
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (value === 1 || value === 0) return value;
      if (value === 'true' || value === 'yes') return 1;
      if (value === 'false' || value === 'no' || value === '') return 0;
      throw bad(`${name} must be true or false`);
    case 'int': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isInteger(n)) throw bad(`${name} must be a whole number`);
      return n;
    }
    case 'real': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(`${name} must be a number`);
      return n;
    }
    case 'day':
      if (value === '') return null;
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad(`${name} must be a date like 2026-11-18`);
      return value;
    case 'time':
      if (value === '') return null;
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw bad(`${name} must be an ISO date and time`);
      return new Date(value).toISOString();
    case 'json':
      return JSON.stringify(value);
    default: {
      if (typeof value !== 'string' && typeof value !== 'number') throw bad(`${name} must be text`);
      const s = String(value);
      if (field.enum && s !== '' && !field.enum.includes(s)) throw bad(`${name} must be one of: ${field.enum.join(', ')}`);
      if (s.length > 200_000) throw bad(`${name} is too long`);
      return s;
    }
  }
}

function fromDb(e: Entity, raw: Record<string, unknown>): Row {
  // Only the described columns leave the database (accounts keep their tokens hidden this way).
  const out: Record<string, unknown> = {};
  for (const c of columnsOf(e)) if (c in raw) out[c] = raw[c];
  for (const [name, f] of Object.entries(e.fields)) {
    if (!(name in out)) continue;
    if (f.type === 'bool') out[name] = out[name] === 1 || out[name] === true;
    else if (f.type === 'json' && typeof out[name] === 'string') {
      try {
        out[name] = JSON.parse(out[name] as string);
      } catch {
        /* leave as text */
      }
    }
  }
  return out as Row;
}

// ---------- reads ----------

export async function getRaw(ctx: Ctx, e: Entity, id: string): Promise<Record<string, unknown> | null> {
  return ctx.db.prepare(`SELECT * FROM ${e.table} WHERE id = ?`).bind(id).first();
}

/** One row, from this mode. Throws 404. */
export async function get(ctx: Ctx, e: Entity, id: string): Promise<Row> {
  const raw = await getRaw(ctx, e, id);
  if (!raw || (e.modeScoped && raw.mode !== ctx.mode)) throw notFound(e.singular, id);
  return fromDb(e, raw);
}

export async function find(ctx: Ctx, e: Entity, id: string): Promise<Row | null> {
  try {
    return await get(ctx, e, id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export interface ListOptions {
  where?: Record<string, unknown>;
  /** Extra SQL condition (trusted, written by modules). */
  sql?: string;
  params?: unknown[];
  limit?: number;
  offset?: number;
  order?: string;
}

export async function list(ctx: Ctx, e: Entity, opts: ListOptions = {}): Promise<Row[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (e.modeScoped) {
    cond.push('mode = ?');
    params.push(ctx.mode);
  }
  for (const [k, v] of Object.entries(opts.where ?? {})) {
    if (!(k in e.fields) && k !== 'id') throw bad(`Cannot filter ${e.name} by ${k}`);
    if (v === null) cond.push(`${k} IS NULL`);
    else {
      cond.push(`${k} = ?`);
      params.push(k in e.fields ? toDb(e.fields[k], v, k) : v);
    }
  }
  if (opts.sql) {
    cond.push(`(${opts.sql})`);
    params.push(...(opts.params ?? []));
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const order = opts.order ?? e.sort ?? (e.orderGroup ? 'ord, created' : 'created');
  const limit = Math.min(opts.limit ?? 500, 2000);
  const sql = `SELECT * FROM ${e.table} ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${opts.offset ?? 0}`;
  const res = await ctx.db.prepare(sql).bind(...params).all();
  return res.results.map((r) => fromDb(e, r));
}

// ---------- writes ----------

/** A row the input points at that does not exist is the caller's mistake (400), not a missing page (404). */
async function asInputError(p: Promise<void> | void): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw bad(err.message);
    throw err;
  }
}

function clean(e: Entity, input: Input, creating: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (k === 'id' || k === 'mode' || k === 'created' || k === 'updated_at') continue;
    if (k === 'ord' && e.orderGroup) {
      out.ord = toDb({ type: 'real' }, v, k);
      continue;
    }
    const f = e.fields[k];
    if (!f) throw bad(`${e.singular} has no field "${k}". Fields: ${Object.keys(e.fields).join(', ')}`);
    if (f.readonly) continue;
    if (f.required && (v === null || v === '') && !creating) throw bad(`${k} cannot be empty`);
    out[k] = toDb(f, v, k);
  }
  return out;
}

async function checkRefs(ctx: Ctx, e: Entity, row: Record<string, unknown>): Promise<void> {
  for (const [k, f] of Object.entries(e.fields)) {
    if (!f.ref || row[k] == null || row[k] === '') continue;
    const target = getEntity(f.ref);
    const found = await getRaw(ctx, target, String(row[k]));
    if (!found || (target.modeScoped && found.mode !== ctx.mode)) throw bad(`${k}: no ${target.singular} with id ${row[k]}`);
  }
}

async function nextOrd(ctx: Ctx, e: Entity, row: Record<string, unknown>): Promise<number> {
  const group = e.orderGroup ?? [];
  const cond = group.map((g) => (row[g] == null ? `${g} IS NULL` : `${g} = ?`));
  const params = group.filter((g) => row[g] != null).map((g) => row[g]);
  if (e.modeScoped) {
    cond.push('mode = ?');
    params.push(ctx.mode);
  }
  const r = await ctx.db
    .prepare(`SELECT MAX(ord) AS m FROM ${e.table} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}`)
    .bind(...params)
    .first<{ m: number | null }>();
  return (r?.m ?? 0) + 1;
}

async function insertRaw(ctx: Ctx, e: Entity, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  await ctx.db
    .prepare(`INSERT INTO ${e.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => row[c] ?? null))
    .run();
}

export interface CreateOptions {
  /** Importing old data: keep the given created/updated_at and skip afterCreate (no default columns). */
  raw?: boolean;
}

export async function create(ctx: Ctx, e: Entity, input: Input, opts: CreateOptions = {}): Promise<Row> {
  const row = clean(e, input, true);
  for (const [k, f] of Object.entries(e.fields)) {
    if (row[k] == null && f.default !== undefined) row[k] = toDb(f, f.default, k);
  }
  const id = typeof input.id === 'string' && input.id ? input.id : newId();
  if (!CLIENT_ID.test(id)) throw bad('id must be 6 to 40 letters, digits, _ or -');
  if (await getRaw(ctx, e, id)) throw bad(`A ${e.singular} with id ${id} already exists`);
  row.id = id;
  if (e.modeScoped) row.mode = ctx.mode;
  const stamp = (v: unknown) => (opts.raw && typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : ctx.now());
  row.created = stamp(input.created);
  row.updated_at = stamp(input.updated_at ?? input.created);
  if (e.beforeCreate) await asInputError(e.beforeCreate(ctx, row));
  for (const [k, f] of Object.entries(e.fields)) {
    if (f.required && (row[k] == null || row[k] === '')) throw bad(`${e.singular} needs ${k}`);
  }
  await checkRefs(ctx, e, row);
  if (e.orderGroup && row.ord == null) row.ord = await nextOrd(ctx, e, row);
  await insertRaw(ctx, e, row);
  ctx.changes.push({ entity: e.name, table: e.table, rowId: id, before: null, after: row });
  const out = fromDb(e, row);
  if (e.afterCreate && !opts.raw) await e.afterCreate(ctx, out);
  return out;
}

export async function update(ctx: Ctx, e: Entity, id: string, input: Input): Promise<Row> {
  const beforeRaw = await getRaw(ctx, e, id);
  if (!beforeRaw || (e.modeScoped && beforeRaw.mode !== ctx.mode)) throw notFound(e.singular, id);
  const patch = clean(e, input, false);
  if (e.beforeUpdate) await asInputError(e.beforeUpdate(ctx, fromDb(e, beforeRaw), patch));
  await checkRefs(ctx, e, patch);
  const changed = Object.keys(patch).filter((k) => patch[k] !== beforeRaw[k]);
  if (!changed.length) return fromDb(e, beforeRaw);
  patch.updated_at = ctx.now();
  const cols = [...changed, 'updated_at'];
  await ctx.db
    .prepare(`UPDATE ${e.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .bind(...cols.map((c) => patch[c] ?? null), id)
    .run();
  const after = { ...beforeRaw, ...Object.fromEntries(cols.map((c) => [c, patch[c] ?? null])) };
  ctx.changes.push({ entity: e.name, table: e.table, rowId: id, before: beforeRaw, after });
  return fromDb(e, after);
}

export async function remove(ctx: Ctx, e: Entity, id: string): Promise<Row> {
  const raw = await getRaw(ctx, e, id);
  if (!raw || (e.modeScoped && raw.mode !== ctx.mode)) throw notFound(e.singular, id);
  const row = fromDb(e, raw);
  if (e.onDelete) await e.onDelete(ctx, row);
  for (const m of allModules()) if (m.beforeDelete) await m.beforeDelete(ctx, e, row);
  // Rows of other kinds that point at this one: delete them or clear the pointer.
  for (const other of allEntities()) {
    for (const [k, f] of Object.entries(other.fields)) {
      if (f.ref !== e.name) continue;
      const rows = await list(ctx, other, { where: { [k]: id }, limit: 2000 });
      for (const r of rows) {
        if (f.cascade) {
          if (await getRaw(ctx, other, r.id)) await remove(ctx, other, r.id);
        } else await update(ctx, other, r.id, { [k]: null });
      }
    }
  }
  await ctx.db.prepare(`DELETE FROM ${e.table} WHERE id = ?`).bind(id).run();
  ctx.changes.push({ entity: e.name, table: e.table, rowId: id, before: raw, after: null });
  return row;
}

/** Delete every row matching `where` (used by onDelete cascades). */
export async function removeWhere(ctx: Ctx, e: Entity, where: Record<string, unknown>): Promise<number> {
  const rows = await list(ctx, e, { where, limit: 2000 });
  for (const r of rows) await remove(ctx, e, r.id);
  return rows.length;
}

export interface MoveTarget {
  /** Put the row just before this sibling. */
  before_id?: string;
  /** Put the row just after this sibling. */
  after_id?: string;
  /** Or at this position (0 = first) among its new siblings. */
  index?: number;
  /** Fields that change the row's group, such as column_id for a card. */
  [groupField: string]: unknown;
}

/** Move a row within its group or into another group (for example a card to another column). */
export async function move(ctx: Ctx, e: Entity, id: string, target: MoveTarget): Promise<Row> {
  if (!e.orderGroup) throw bad(`${e.name} cannot be reordered`);
  const current = await get(ctx, e, id);
  const groupPatch: Record<string, unknown> = {};
  for (const g of e.orderGroup) if (g in target) groupPatch[g] = target[g];
  const group = { ...current, ...groupPatch };
  const cond = e.orderGroup.map((g) => (group[g] == null ? `${g} IS NULL` : `${g} = ?`));
  const params = e.orderGroup.filter((g) => group[g] != null).map((g) => group[g]);
  cond.push('id != ?');
  params.push(id);
  if (e.modeScoped) {
    cond.push('mode = ?');
    params.push(ctx.mode);
  }
  const sibs = (
    await ctx.db
      .prepare(`SELECT id, ord FROM ${e.table} WHERE ${cond.join(' AND ')} ORDER BY ord, created`)
      .bind(...params)
      .all<{ id: string; ord: number }>()
  ).results;

  let pos: number;
  if (target.before_id) {
    pos = sibs.findIndex((s) => s.id === target.before_id);
    if (pos < 0) throw bad(`before_id ${target.before_id} is not in the same group`);
  } else if (target.after_id) {
    pos = sibs.findIndex((s) => s.id === target.after_id);
    if (pos < 0) throw bad(`after_id ${target.after_id} is not in the same group`);
    pos += 1;
  } else if (typeof target.index === 'number') {
    pos = Math.max(0, Math.min(sibs.length, Math.floor(target.index)));
  } else {
    pos = sibs.length;
  }
  const prev = sibs[pos - 1]?.ord;
  const next = sibs[pos]?.ord;
  let ord: number;
  if (prev == null && next == null) ord = 1;
  else if (prev == null) ord = next! - 1;
  else if (next == null) ord = prev + 1;
  else ord = (prev + next) / 2;

  if (prev != null && next != null && next - prev < 1e-9) {
    // Gaps are used up: number the group again, 1, 2, 3 ... with this row at pos.
    const ids = sibs.map((s) => s.id);
    ids.splice(pos, 0, id);
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] !== id) await update(ctx, e, ids[i], { ord: i + 1 });
    }
    ord = pos + 1;
  }
  return update(ctx, e, id, { ...groupPatch, ord });
}

// ---------- undo ----------

/** Undo the latest change batch in this mode that is not undone yet. */
export async function undoLast(ctx: Ctx): Promise<{ label: string; changes: number } | null> {
  const last = await ctx.db
    .prepare('SELECT batch, label FROM undo WHERE mode = ? AND undone = 0 ORDER BY id DESC LIMIT 1')
    .bind(ctx.mode)
    .first<{ batch: string; label: string }>();
  if (!last) return null;
  const rows = (
    await ctx.db
      .prepare('SELECT * FROM undo WHERE batch = ? ORDER BY id DESC')
      .bind(last.batch)
      .all<{ entity: string; row_id: string; before: string | null; after: string | null }>()
  ).results;
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const e = getEntity(r.entity);
    if (r.before == null) {
      stmts.push(ctx.db.prepare(`DELETE FROM ${e.table} WHERE id = ?`).bind(r.row_id));
    } else {
      const before = JSON.parse(r.before) as Record<string, unknown>;
      const cols = Object.keys(before).filter((c) => columnsOf(e).includes(c));
      stmts.push(
        ctx.db
          .prepare(`INSERT OR REPLACE INTO ${e.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .bind(...cols.map((c) => before[c] ?? null)),
      );
    }
  }
  stmts.push(ctx.db.prepare('UPDATE undo SET undone = 1 WHERE batch = ?').bind(last.batch));
  await ctx.db.batch(stmts);
  return { label: last.label, changes: rows.length };
}

/** Redo the oldest undone change batch in this mode, by writing its `after` rows again. */
export async function redoLast(ctx: Ctx): Promise<{ label: string; changes: number } | null> {
  const next = await ctx.db
    .prepare('SELECT batch, label FROM undo WHERE mode = ? AND undone = 1 ORDER BY id ASC LIMIT 1')
    .bind(ctx.mode)
    .first<{ batch: string; label: string }>();
  if (!next) return null;
  const rows = (
    await ctx.db
      .prepare('SELECT * FROM undo WHERE batch = ? ORDER BY id ASC')
      .bind(next.batch)
      .all<{ entity: string; row_id: string; before: string | null; after: string | null }>()
  ).results;
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const e = getEntity(r.entity);
    if (r.after == null) {
      stmts.push(ctx.db.prepare(`DELETE FROM ${e.table} WHERE id = ?`).bind(r.row_id));
    } else {
      const after = JSON.parse(r.after) as Record<string, unknown>;
      const cols = Object.keys(after).filter((c) => columnsOf(e).includes(c));
      stmts.push(
        ctx.db
          .prepare(`INSERT OR REPLACE INTO ${e.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .bind(...cols.map((c) => after[c] ?? null)),
      );
    }
  }
  stmts.push(ctx.db.prepare('UPDATE undo SET undone = 0 WHERE batch = ?').bind(next.batch));
  await ctx.db.batch(stmts);
  return { label: next.label, changes: rows.length };
}

/** Keep the undo history small: drop entries older than `days`. */
export async function pruneUndo(db: D1Database, days = 14): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  await db.prepare('DELETE FROM undo WHERE created < ?').bind(cutoff).run();
}
