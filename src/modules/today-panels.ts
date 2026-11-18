// What the Today tab shows beyond the focus card: reminder banners, and notes and lists
// as full panels. Which notes and lists are on Today is stored on the rows (show_today and
// today_at, the time they were added), so every device shows the same, in the order added.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { get, list, update } from '../core/store';
import { fullList, listsEntity } from './lists';
import { notesEntity, setNote } from './notes';
import { pendingNotifications } from './notifications';
import { projectsEntity } from './projects';

/** Notification kinds that make a banner. Pomodoro and session notices belong to the timer. */
const BANNER_KINDS = ['reminder', 'habit', 'nudge', 'message'];

/** Due notifications for banners, with the project a reminder is about. */
export async function banners(ctx: Ctx) {
  const pending = (await pendingNotifications(ctx)).filter((n) => BANNER_KINDS.includes(String(n.kind)));
  const ids = pending.filter((n) => n.kind === 'reminder').map((n) => n.id);
  const about = new Map<string, { project_id: string; project_name: string }>();
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    const rows = await ctx.db
      .prepare(
        `SELECT n.id AS id, r.project_id AS project_id, p.name AS project_name FROM notifications n
         JOIN reminders r ON n.dedupe_key = 'reminder:' || r.id JOIN projects p ON p.id = r.project_id
         WHERE n.mode = ? AND n.id IN (${marks})`,
      )
      .bind(ctx.mode, ...ids)
      .all<{ id: string; project_id: string; project_name: string }>();
    for (const r of rows.results) about.set(r.id, r);
  }
  return pending.map((n) => ({ ...n, project_id: about.get(n.id)?.project_id ?? null, project_name: about.get(n.id)?.project_name ?? null }));
}

type Item = Record<string, unknown> & { type: 'note' | 'list'; key: string; today_at: string | null };

/** Every note and list on Today, with its contents, in the order they were added. */
export async function panels(ctx: Ctx) {
  const [lists, projectNotes] = await Promise.all([
    list(ctx, listsEntity, { where: { show_today: true } }),
    ctx.db
      .prepare(
        `SELECT n.id AS note_id, n.project_id, n.body, n.today_at, n.updated_at, p.name FROM notes n JOIN projects p ON p.id = n.project_id
         WHERE n.mode = ? AND n.show_today = 1 AND n.project_id IS NOT NULL`,
      )
      .bind(ctx.mode)
      .all<{ note_id: string; project_id: string; body: string; today_at: string | null; updated_at: string; name: string }>(),
  ]);
  const items: Item[] = [];
  for (const l of lists) {
    const full = (await fullList(ctx, String(l.id))) as Record<string, unknown>;
    items.push({ ...full, type: l.kind === 'note' ? 'note' : 'list', key: `list:${l.id}`, today_at: (l.today_at as string | null) ?? (l.created as string) });
  }
  for (const n of projectNotes.results) {
    items.push({ type: 'note', key: `project:${n.project_id}`, project_id: n.project_id, name: n.name, kind: 'project', color: null, body: n.body, today_at: n.today_at ?? n.updated_at });
  }
  items.sort((a, b) => String(a.today_at).localeCompare(String(b.today_at)) || a.key.localeCompare(b.key));
  return items;
}

/** What could still be added: notes, lists and project notes not on Today yet. */
export async function available(ctx: Ctx) {
  const [lists, projectNotes] = await Promise.all([
    list(ctx, listsEntity, { where: { show_today: false } }),
    ctx.db
      .prepare(
        `SELECT p.id AS project_id, p.name FROM notes n JOIN projects p ON p.id = n.project_id
         WHERE n.mode = ? AND n.show_today = 0 AND n.project_id IS NOT NULL AND n.body != '' AND p.status = 'active'`,
      )
      .bind(ctx.mode)
      .all<{ project_id: string; name: string }>(),
  ]);
  return [
    ...lists.map((l) => ({ key: `list:${l.id}`, list_id: l.id, project_id: null, name: l.name, kind: l.kind, color: l.color ?? null })),
    ...projectNotes.results.map((n) => ({ key: `project:${n.project_id}`, list_id: null, project_id: n.project_id, name: `${n.name} (notes)`, kind: 'project', color: null })),
  ];
}

/** Put a note or list on Today, or take it off. A project's notes are made empty on first use. */
export async function setOnToday(ctx: Ctx, target: { list_id?: string; project_id?: string }, on: boolean) {
  if (!target.list_id === !target.project_id) throw bad('Give exactly one of list_id or project_id');
  if (target.list_id) return update(ctx, listsEntity, target.list_id, { show_today: on });
  await get(ctx, projectsEntity, target.project_id!);
  const note = (await list(ctx, notesEntity, { where: { project_id: target.project_id! }, limit: 1 }))[0] ?? (await setNote(ctx, { project_id: target.project_id! }, ''));
  return update(ctx, notesEntity, note.id, { show_today: on });
}

export const todayPanelsModule: Module = {
  id: 'today-panels',
  description: 'Reminder banners, and notes and lists as full panels on Today.',
  features: [
    {
      id: 'list-one-at-a-time',
      label: 'Lists one at a time on Today',
      description: 'A list can show one random item at a time as a quote card on Today. Off: every list shows in full.',
      default: true,
    },
  ],
  routes(api) {
    api.get('/today-panels', async (c) => c.json(await panels(c.get('ctx'))));
    api.get('/today-panels/available', async (c) => c.json(await available(c.get('ctx'))));
    api.get('/today-panels/banners', async (c) => c.json(await banners(c.get('ctx'))));
    api.put('/today-panels/show', async (c) => {
      const ctx = c.get('ctx');
      const b = await c.req.json<{ list_id?: string; project_id?: string; on?: boolean }>();
      ctx.label = b.on === false ? 'take off Today' : 'add to Today';
      return c.json(await setOnToday(ctx, b, b.on !== false));
    });
  },
  tools: [
    {
      name: 'show_on_today',
      description:
        'Put a note, list or to-do list on the owner’s Today page as a full panel (or take it off with on=false). Give list_id for a note/list/to-do list, or project_id for a project’s notes. Panels keep the order they were added.',
      input: z.object({ list_id: z.string().optional(), project_id: z.string().optional(), on: z.boolean().default(true) }),
      run: (ctx, a) => setOnToday(ctx, a, a.on),
    },
  ],
};
