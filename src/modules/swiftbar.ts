// The Mac menu bar (SwiftBar). The server writes the plugin's whole output as
// text, so the plugin (clients/swiftbar/) is a few lines of shell with no JSON
// parsing, and everything it shows is tested here.

import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { update } from '../core/store';
import { checkHabit } from './habits';
import { dismiss, notificationsEntity } from './notifications';
import { startSession, status, stopSession } from './today';

/** SwiftBar treats "|" as the start of parameters; keep text safe and short. */
const clean = (s: unknown, max = 60) => {
  const t = String(s ?? '').replace(/[|\n\r\t]/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export async function swiftbarText(ctx: Ctx, origin: string): Promise<string> {
  const s = await status(ctx);
  // __SELF__ becomes the plugin's own path in the plugin (the server cannot know it).
  const act = (a: string, id = '') => `bash=__SELF__ param1=${a}${id ? ` param2=${id}` : ''} terminal=false refresh=true`;
  const lines: string[] = [];

  // The menu bar itself.
  let bar = '◎';
  if (s.session) {
    const p = s.session.pomodoro;
    bar = p ? `${p.phase === 'break' ? '☕' : '◉'} ${clean(s.session.project_name, 18)} ${mmss(p.seconds_left)}` : `◉ ${clean(s.session.project_name, 18)} ${mmss(s.session.elapsed_seconds)}`;
  } else if (s.focus) bar = `◎ ${clean(s.focus.name, 22)}`;
  const unseen = s.notifications.filter((n) => !n.seen_at);
  if (unseen.length) bar += ` •${unseen.length}`;
  lines.push(bar, '---');

  if (s.focus) {
    lines.push(`Focus: ${clean(s.focus.name)} | href=${origin}/#/p/${s.focus.id}`);
  } else lines.push(`No focus chosen | href=${origin}/#/today`);
  if (s.session) lines.push(`Stop session… | ${act('stop')}`);
  else if (s.focus) lines.push(`Start session | ${act('start')}`);

  if (s.todos_due.length) {
    lines.push('---', `To do today (${s.todos_due.length})`);
    for (const t of s.todos_due.slice(0, 15)) lines.push(`☐ ${clean(t.title)} | ${act('tick', String(t.id))}`);
  }
  if (s.habits_left.length) {
    lines.push('---', 'Habits left');
    for (const h of s.habits_left) lines.push(`+ ${clean(h.name)} (${h.left} ${h.per === 'week' ? 'this week' : 'today'}) | ${act('habit', h.id)}`);
  }
  if (s.notifications.length) {
    lines.push('---', 'Reminders');
    for (const n of s.notifications.slice(0, 10)) {
      lines.push(`${clean(n.title)}${n.body ? `: ${clean(n.body, 50)}` : ''} | ${act('dismiss', n.id)}`);
    }
  }
  lines.push('---', `Open Focus Tracker | href=${origin}/#/today`, `Mode: ${ctx.mode}`, 'Refresh | refresh=true');
  // Lines the plugin turns into macOS notifications (and then marks seen). SwiftBar never shows them:
  // the plugin removes every line starting with "#notify" before printing.
  for (const n of unseen) lines.push(`#notify\t${n.id}\t${clean(n.title, 80)}\t${clean(n.body ?? '', 200)}`);
  return lines.join('\n') + '\n';
}

export async function swiftbarAction(ctx: Ctx, form: Record<string, string>) {
  const id = form.id ?? '';
  switch (form.action) {
    case 'start':
      return startSession(ctx, {});
    case 'stop':
      return stopSession(ctx, { where_stopped: form.where_stopped || undefined });
    case 'tick': {
      const { todosEntity } = await import('./lists');
      return update(ctx, todosEntity, id, { done: await ctx.today() });
    }
    case 'habit':
      return checkHabit(ctx, id);
    case 'dismiss':
      return dismiss(ctx, id);
    case 'seen':
      return update(ctx, notificationsEntity, id, { seen_at: ctx.now() });
    default:
      throw bad(`Unknown action ${form.action}`);
  }
}

export const swiftbarModule: Module = {
  id: 'swiftbar',
  description: 'Text output and actions for the SwiftBar menu bar plugin on a Mac.',
  routes(api) {
    api.get('/swiftbar', async (c) => {
      const origin = c.env.PUBLIC_URL?.replace(/\/$/, '') || new URL(c.req.url).origin;
      c.get('ctx').client ??= 'swiftbar';
      return c.text(await swiftbarText(c.get('ctx'), origin));
    });
    // Form-encoded so the plugin can send it with curl --data-urlencode, no JSON needed.
    api.post('/swiftbar/action', async (c) => {
      const ctx = c.get('ctx');
      const form = Object.fromEntries([...(await c.req.formData()).entries()].map(([k, v]) => [k, String(v)]));
      ctx.label = `menu bar: ${form.action}`;
      await swiftbarAction(ctx, form);
      return c.text('ok\n');
    });
  },
};
