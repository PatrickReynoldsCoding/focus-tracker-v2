// Notifications any client can read (web, Android, SwiftBar). Made from due
// reminders, habit prompts and the daily nudge by the cron job and on reads.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity } from '../core/entity';
import { newId } from '../core/ids';
import type { Module } from '../core/registry';
import { find, list, update } from '../core/store';
import { deliverable, getPrefs, kindAllowed } from './notify-prefs';

export const notificationsEntity: Entity = {
  name: 'notifications',
  table: 'notifications',
  singular: 'notification',
  desc: 'Messages for the owner’s devices. due = when to show; dismissed ones are hidden.',
  modeScoped: true,
  filters: ['kind'],
  sort: 'due DESC',
  fields: {
    kind: { type: 'text', required: true, enum: ['reminder', 'habit', 'session', 'pomodoro', 'nudge', 'message'] },
    title: { type: 'text', required: true },
    body: { type: 'text' },
    due: { type: 'time', required: true },
    dedupe_key: { type: 'text', readonly: true },
    seen_at: { type: 'time' },
    dismissed_at: { type: 'time' },
  },
};

async function insertOnce(ctx: Ctx, n: { kind: string; title: string; body?: string | null; due: string; dedupe_key: string }) {
  // INSERT OR IGNORE on dedupe_key: making the same notification twice is harmless.
  await ctx.db
    .prepare(
      'INSERT OR IGNORE INTO notifications (id, mode, kind, title, body, due, dedupe_key, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(newId(), ctx.mode, n.kind, n.title, n.body ?? null, n.due, n.dedupe_key, ctx.now(), ctx.now())
    .run();
}

/** Turn whatever is due into notifications. Cheap enough to run on every status read. */
export async function generate(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  // Notification settings (notify-prefs.ts): a switched-off kind is not made at all. Quiet hours only
  // hold back delivery (pendingNotifications), so what is made during them waits until they end.
  const prefs = await getPrefs(ctx);
  if (kindAllowed(prefs, 'pomodoro')) await pomodoroNotice(ctx);
  else await clearPomodoro(ctx);
  const reminders = !kindAllowed(prefs, 'reminder')
    ? { results: [] as { id: string; text: string | null; due: string; project: string | null }[] }
    : await ctx.db
    .prepare(
      `SELECT r.id, r.text, r.due, p.name AS project FROM reminders r LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.mode = ? AND r.done IS NULL AND r.due <= ? AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.dedupe_key = 'reminder:' || r.id)`,
    )
    .bind(ctx.mode, now)
    .all<{ id: string; text: string | null; due: string; project: string | null }>();
  for (const r of reminders.results) {
    await insertOnce(ctx, { kind: 'reminder', title: r.project ?? 'Reminder', body: r.text, due: r.due, dedupe_key: `reminder:${r.id}` });
  }
  const habits = !kindAllowed(prefs, 'habit')
    ? { results: [] as { id: string; name: string; small_version: string | null; next_prompt: string }[] }
    : await ctx.db
    .prepare(`SELECT id, name, small_version, next_prompt FROM habits WHERE mode = ? AND status = 'active' AND next_prompt IS NOT NULL AND next_prompt <= ?`)
    .bind(ctx.mode, now)
    .all<{ id: string; name: string; small_version: string | null; next_prompt: string }>();
  for (const h of habits.results) {
    await insertOnce(ctx, {
      kind: 'habit',
      title: h.name,
      body: h.small_version ? `Even the small version counts: ${h.small_version}` : null,
      due: h.next_prompt,
      dedupe_key: `habit:${h.id}:${h.next_prompt}`,
    });
  }
}

/** Session alerts switched off: make no pomodoro or "Time is up" notices, and clear any left from before. */
async function clearPomodoro(ctx: Ctx): Promise<void> {
  await ctx.db
    .prepare("UPDATE notifications SET dismissed_at = ? WHERE mode = ? AND dismissed_at IS NULL AND (kind = 'pomodoro' OR (kind = 'session' AND dedupe_key LIKE 'timeup:%'))")
    .bind(ctx.now(), ctx.mode)
    .run();
}

/**
 * Notices for the running session (sessions.ts sessionNotices): a pomodoro
 * period ending ("Time for a break" / "Break over" while it waits for a click,
 * or "Break time" / "Back to work" when periods follow by themselves) and
 * "Time is up" for the planned length (kind 'session'). Both are switched by the
 * "session" group in notification settings. Older ones are cleared.
 */
async function pomodoroNotice(ctx: Ctx): Promise<void> {
  const { storedSession, sessionNotices, waitsForClick } = await import('./sessions');
  const s = await storedSession(ctx);
  const waits = s ? await waitsForClick(ctx) : true;
  let notices = s ? sessionNotices(s, ctx.nowDate.getTime(), waits) : [];
  if (s?.project_id && notices.some((n) => n.kind === 'session')) {
    // Only look the project up when "Time is up" needs its name.
    const p = await ctx.db.prepare('SELECT name FROM projects WHERE id = ? AND mode = ?').bind(s.project_id, ctx.mode).first<{ name: string }>();
    notices = sessionNotices(s, ctx.nowDate.getTime(), waits, p?.name);
  }
  for (const n of notices) await insertOnce(ctx, n);
  const keys = notices.map((n) => n.dedupe_key);
  const keep = keys.length ? `AND dedupe_key NOT IN (${keys.map(() => '?').join(', ')})` : '';
  await ctx.db
    .prepare(
      `UPDATE notifications SET dismissed_at = ? WHERE mode = ? AND dismissed_at IS NULL
       AND (kind = 'pomodoro' OR (kind = 'session' AND dedupe_key LIKE 'timeup:%')) ${keep}`,
    )
    .bind(ctx.now(), ctx.mode, ...keys)
    .run();
}

/** Morning nudge about neglected projects, once a day, after the configured hour (default 9). */
export async function dailyNudge(ctx: Ctx): Promise<void> {
  const tz = await ctx.timezone();
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(ctx.nowDate));
  if (hour < Number((await ctx.setting('nudge.hour')) ?? 9)) return;
  if (!kindAllowed(await getPrefs(ctx), 'nudge')) return; // master switch, the nudge switch, and the older nudge.enabled
  const day = await ctx.today();
  const { neglected } = await import('./today');
  const projects = await neglected(ctx, day);
  if (!projects.length) return;
  await insertOnce(ctx, {
    kind: 'nudge',
    title: `${projects.length} project${projects.length > 1 ? 's' : ''} waiting`,
    body: projects.map((p) => p.name).join(', '),
    due: ctx.now(),
    dedupe_key: `nudge:${ctx.mode}:${day}`,
  });
}

/**
 * What clients should show now. Applies the notification settings on every read: master switch,
 * the kind's switch, the client's switch (ctx.client, from ?client=android|swiftbar|web) and quiet
 * hours (nothing is delivered then; it stays pending and shows when they end).
 */
export async function pendingNotifications(ctx: Ctx) {
  await generate(ctx);
  const prefs = await getPrefs(ctx);
  if (!(await deliverable(ctx, prefs, ctx.client))) return [];
  const all = await list(ctx, notificationsEntity, { sql: 'dismissed_at IS NULL AND due <= ?', params: [ctx.now()], order: 'due', limit: 50 });
  return all.filter((n: any) => kindAllowed(prefs, n.kind)).map(({ dedupe_key, ...n }: any) => n);
}

export async function dismiss(ctx: Ctx, id: string) {
  const n = await update(ctx, notificationsEntity, id, { dismissed_at: ctx.now() });
  // Dismissing a reminder's notification finishes the reminder.
  const raw = await ctx.db.prepare('SELECT dedupe_key FROM notifications WHERE id = ?').bind(id).first<{ dedupe_key: string | null }>();
  const m = raw?.dedupe_key?.match(/^reminder:(.+)$/);
  if (m) {
    const { remindersEntity } = await import('./today');
    if (await find(ctx, remindersEntity, m[1])) await update(ctx, remindersEntity, m[1], { done: ctx.now() });
  }
  return n;
}

export const notificationsModule: Module = {
  id: 'notifications',
  description: 'Notifications for all clients, made from reminders, habit prompts and nudges.',
  entities: [notificationsEntity],
  routes(api) {
    api.get('/notifications/pending', async (c) => c.json(await pendingNotifications(c.get('ctx'))));
    api.post('/notifications/:id/seen', async (c) => c.json(await update(c.get('ctx'), notificationsEntity, c.req.param('id'), { seen_at: c.get('ctx').now() })));
    api.post('/notifications/:id/dismiss', async (c) => c.json(await dismiss(c.get('ctx'), c.req.param('id'))));
  },
  tools: [
    {
      name: 'add_reminder',
      description: 'Set a reminder (optionally about a project). due is an ISO date-time; it shows as a notification on the owner’s devices then.',
      input: z.object({ text: z.string(), due: z.string(), project_id: z.string().optional() }),
      run: async (ctx, a) => {
        const { remindersEntity } = await import('./today');
        const { create } = await import('../core/store');
        return create(ctx, remindersEntity, a);
      },
    },
  ],
};
