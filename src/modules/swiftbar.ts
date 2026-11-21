// The Mac menu bar (SwiftBar). The server writes the plugin's whole output as
// text, so the plugin (clients/swiftbar/) is a few lines of shell with no JSON
// parsing, and everything it shows is tested here.

import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { update } from '../core/store';
import { checkHabit } from './habits';
import { dismiss, notificationsEntity } from './notifications';
import { nextPomodoroPeriod, pausePomodoro, resumePomodoro, startPomodoro, stopPomodoro } from './pomodoro';
import { extendSession, nextPeriod, pauseSession, resumeSession, startSession, stopSession } from './sessions';
import { status } from './today';
import { tickCard } from './today-list';

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
    const pl = s.session.planned;
    const name = clean(s.session.project_name, 18);
    if (s.session.paused) bar = `⏸ ${name} ${mmss(s.session.worked_seconds)}`;
    else if (pl?.time_up) bar = `⏰ ${name}: time is up`;
    else if (p?.waiting) bar = `⏰ ${name}: ${p.next_phase === 'break' ? 'break time' : 'back to work'}`;
    else if (p) bar = `${p.phase === 'break' ? '☕' : '◉'} ${name} ${mmss(p.seconds_left)}`;
    else if (pl) bar = `◉ ${name} ${mmss(pl.seconds_left)}`;
    else bar = `◉ ${name} ${mmss(s.session.elapsed_seconds)}`;
  } else if (s.focus) bar = `◎ ${clean(s.focus.name, 22)}`;
  const pomo = s.pomodoro;
  // Setting 'swiftbar.show_pomodoro' (default on): the Pomodoro countdown in the menu bar itself.
  if (pomo && (await ctx.setting('swiftbar.show_pomodoro')) !== 'off') {
    const icon = pomo.phase === 'work' ? '🍅' : '☕';
    // A running countdown is a marker the plugin turns into the time left on every redraw (it redraws every few seconds
    // from the saved text, so the countdown ticks without calling the server each time).
    const ends = Math.floor(Date.parse(pomo.phase_ends_at) / 1000);
    const label = pomo.waiting ? (pomo.next_phase === 'work' ? 'back to work' : 'break time') : pomo.paused ? `⏸ ${mmss(pomo.seconds_left)}` : `@@P:${ends}@@`;
    bar = `${icon} ${label} ${bar}`;
  }
  const unseen = s.notifications.filter((n) => !n.seen_at);
  if (unseen.length) bar += ` •${unseen.length}`;
  lines.push(bar, '---');

  if (s.focus) {
    lines.push(`Focus: ${clean(s.focus.name)} | href=${origin}/#/p/${s.focus.id}`);
  } else lines.push(`No focus chosen | href=${origin}/#/today`);
  if (s.session) {
    const p = s.session.pomodoro;
    if (p?.waiting) lines.push(`${p.next_phase === 'break' ? 'Start break' : 'Start work'} | ${act('next')}`);
    if (s.session.planned?.time_up) lines.push(`Keep going +10 min | ${act('extend', '10')}`, `Keep going +25 min | ${act('extend', '25')}`);
    lines.push(s.session.paused ? `Resume | ${act('resume')}` : `Pause | ${act('pause')}`);
    lines.push(`Stop session… | ${act('stop')}`);
  }
  else if (s.focus) lines.push(`Start session | ${act('start')}`);

  if (pomo) {
    if (pomo.waiting) lines.push(`${pomo.next_phase === 'work' ? 'Start work' : pomo.next_phase === 'long_break' ? 'Start long break' : 'Start break'} | ${act('pomodoro-next')}`);
    else lines.push(`Skip to ${pomo.phase === 'work' ? 'break' : 'work'} | ${act('pomodoro-next')}`);
    lines.push(pomo.paused ? `Resume pomodoro | ${act('pomodoro-resume')}` : `Pause pomodoro | ${act('pomodoro-pause')}`, `Stop pomodoro | ${act('pomodoro-stop')}`);
  } else lines.push(`Start pomodoro | ${act('pomodoro-start')}`);

  if (s.today_list) {
    // The Today list (flag today-panel): habits, then to-dos and cards, as on Today.
    const open = s.today_list.items;
    if (open.length) {
      lines.push('---', `Today (${open.length} left)`);
      for (const x of open.slice(0, 20)) {
        const extra = x.progress ? ` (${x.progress})` : x.late ? ' (late)' : '';
        const action = x.kind === 'habit' ? act('habit', x.id) : act(x.kind === 'card' ? 'card' : 'tick', x.id);
        lines.push(`${x.kind === 'habit' ? '○' : '☐'} ${clean(x.title)}${extra} | ${action}`);
      }
    } else if (s.today_list.done) lines.push('---', `Today: all done (${s.today_list.done})`);
  } else if (s.todos_due.length) {
    lines.push('---', `To do today (${s.todos_due.length})`);
    for (const t of s.todos_due.slice(0, 15)) lines.push(`☐ ${clean(t.title)} | ${act('tick', String(t.id))}`);
  }
  if (!s.today_list && s.habits_left.length) {
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
    case 'pause':
      return pauseSession(ctx);
    case 'resume':
      return resumeSession(ctx);
    case 'next':
      return nextPeriod(ctx);
    case 'pomodoro-start':
      return startPomodoro(ctx);
    case 'pomodoro-next':
      return nextPomodoroPeriod(ctx);
    case 'pomodoro-pause':
      return pausePomodoro(ctx);
    case 'pomodoro-resume':
      return resumePomodoro(ctx);
    case 'pomodoro-stop':
      return stopPomodoro(ctx);
    case 'extend':
      return extendSession(ctx, Number(id) || 10);
    case 'stop':
      return stopSession(ctx, { where_stopped: form.where_stopped || undefined });
    case 'tick': {
      const { todosEntity } = await import('./lists');
      return update(ctx, todosEntity, id, { done: await ctx.today() });
    }
    case 'card':
      return tickCard(ctx, id, true);
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
