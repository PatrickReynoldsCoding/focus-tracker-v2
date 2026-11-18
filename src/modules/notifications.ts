// Notifications any client can read (web, Android, SwiftBar). Made from due
// reminders, habit prompts and the daily nudge by the cron job and on reads.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity } from '../core/entity';
import { newId } from '../core/ids';
import type { Module } from '../core/registry';
import { find, list, update } from '../core/store';

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
  const reminders = await ctx.db
    .prepare(
      `SELECT r.id, r.text, r.due, p.name AS project FROM reminders r LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.mode = ? AND r.done IS NULL AND r.due <= ? AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.dedupe_key = 'reminder:' || r.id)`,
    )
    .bind(ctx.mode, now)
    .all<{ id: string; text: string | null; due: string; project: string | null }>();
  for (const r of reminders.results) {
    await insertOnce(ctx, { kind: 'reminder', title: r.project ?? 'Reminder', body: r.text, due: r.due, dedupe_key: `reminder:${r.id}` });
  }
  const habits = await ctx.db
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

/** Morning nudge about neglected projects, once a day, after the configured hour (default 9). */
export async function dailyNudge(ctx: Ctx): Promise<void> {
  const tz = await ctx.timezone();
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(ctx.nowDate));
  if (hour < Number((await ctx.setting('nudge.hour')) ?? 9)) return;
  if ((await ctx.setting('nudge.enabled')) === 'off') return;
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

export async function pendingNotifications(ctx: Ctx) {
  await generate(ctx);
  return (
    await list(ctx, notificationsEntity, { sql: 'dismissed_at IS NULL AND due <= ?', params: [ctx.now()], order: 'due', limit: 50 })
  ).map(({ dedupe_key, ...n }) => n);
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
