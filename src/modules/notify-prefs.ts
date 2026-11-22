// Notification settings: a master switch, one switch per kind, quiet hours and which
// clients show notifications. The server applies them (notifications.ts), so every
// client obeys without changes. Stored per profile (mode) as one JSON setting `notify`, with
// the daily nudge's hour and "untouched for N days" (nudge.hour, nudge.days). It was one setting
// for every profile until v0.30.0 (D17); D35 made it per profile, as the owner asked. Each part can
// also be set for every profile (D46): the switches, quiet hours, devices, the nudge's hour and days.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { parseScope, scopedSetting, SCOPES, wholeNumber, writeScoped, type Scope, type ScopedSetting } from '../core/setting-scope';

export const CLIENTS = ['android', 'swiftbar', 'web'] as const;
export type NotifyClient = (typeof CLIENTS)[number];
export const isClient = (s: unknown): s is NotifyClient => typeof s === 'string' && (CLIENTS as readonly string[]).includes(s);

/** Notification kinds grouped the way the owner switches them. */
export type Group = 'reminders' | 'habits' | 'nudge' | 'session';
export function groupOf(kind: string): Group | null {
  switch (kind) {
    case 'reminder':
      return 'reminders';
    case 'habit':
      return 'habits';
    case 'nudge':
      return 'nudge';
    case 'pomodoro':
    case 'session':
      return 'session';
    default:
      return null; // 'message': only the master switch and quiet hours apply
  }
}

export interface NotifyPrefs {
  enabled: boolean;
  reminders: boolean;
  habits: boolean;
  nudge: boolean;
  session: boolean;
  quiet: { enabled: boolean; from: string; to: string };
  clients: Record<NotifyClient, boolean>;
}

export const DEFAULT_PREFS: NotifyPrefs = {
  enabled: true,
  reminders: true,
  habits: true,
  nudge: true,
  session: true,
  quiet: { enabled: false, from: '22:00', to: '07:00' },
  clients: { android: true, swiftbar: true, web: true },
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 22:30');
const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  reminders: z.boolean().optional(),
  habits: z.boolean().optional(),
  nudge: z.boolean().optional(),
  session: z.boolean().optional(),
  quiet: z.object({ enabled: z.boolean().optional(), from: hhmm.optional(), to: hhmm.optional() }).optional(),
  clients: z.object({ android: z.boolean().optional(), swiftbar: z.boolean().optional(), web: z.boolean().optional() }).optional(),
  /** Hour (0-23) after which the daily nudge may appear. Per mode. */
  nudge_hour: z.number().int().min(0).max(23).optional(),
  /** A project counts as neglected after this many days. Per mode. */
  nudge_days: z.number().int().min(1).max(365).optional(),
});
export type NotifyPatch = z.infer<typeof PatchSchema>;

export async function getPrefs(ctx: Ctx): Promise<NotifyPrefs> {
  const raw = await ctx.jsonSetting<Partial<NotifyPrefs>>('notify', {});
  const p: NotifyPrefs = {
    ...DEFAULT_PREFS,
    ...raw,
    quiet: { ...DEFAULT_PREFS.quiet, ...(raw.quiet ?? {}) },
    clients: { ...DEFAULT_PREFS.clients, ...(raw.clients ?? {}) },
  };
  // The older per-mode switch (nudge.enabled = off) still counts.
  if ((await ctx.setting('nudge.enabled')) === 'off') p.nudge = false;
  return p;
}

/** Minutes since midnight in the owner's time zone. */
export async function minutesNow(ctx: Ctx): Promise<number> {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: await ctx.timezone(), hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(ctx.nowDate);
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Is `now` (minutes since midnight) inside from..to? The window may cross midnight (22:00 to 07:00). from == to is an empty window. */
export function inWindow(now: number, from: string, to: string): boolean {
  const a = toMin(from);
  const b = toMin(to);
  if (a === b) return false;
  return a < b ? now >= a && now < b : now >= a || now < b;
}

export async function inQuietHours(ctx: Ctx, p?: NotifyPrefs): Promise<boolean> {
  const q = (p ?? (await getPrefs(ctx))).quiet;
  return q.enabled && inWindow(await minutesNow(ctx), q.from, q.to);
}

/** May a notification of this kind be made at all? (Master switch and the kind's own switch.) */
export function kindAllowed(p: NotifyPrefs, kind: string): boolean {
  if (!p.enabled) return false;
  const g = groupOf(kind);
  return g ? p[g] : true;
}

/** Whether notifications may be delivered to this client right now (not quiet hours, client not switched off). */
export async function deliverable(ctx: Ctx, p: NotifyPrefs, client: string | null | undefined): Promise<boolean> {
  if (!p.enabled) return false;
  if (isClient(client) && !p.clients[client]) return false;
  return !(await inQuietHours(ctx, p));
}

export async function describePrefs(ctx: Ctx) {
  const p = await getPrefs(ctx);
  return {
    ...p,
    nudge_hour: Number((await ctx.setting('nudge.hour')) ?? 9),
    nudge_days: Number((await ctx.setting('nudge.days')) ?? 14),
    timezone: await ctx.timezone(),
    quiet_now: await inQuietHours(ctx, p),
  };
}

const SWITCHES = ['enabled', 'reminders', 'habits', 'nudge', 'session'] as const;
const SWITCH_LABELS: Record<(typeof SWITCHES)[number], string> = {
  enabled: 'Notifications on or off',
  reminders: 'Reminders',
  habits: 'Habit prompts',
  nudge: 'Daily nudge',
  session: 'Pomodoro and session alerts',
};

/** Each part of the notification settings, settable for this profile or for every profile (D46). */
const aSwitch = (v: unknown) => {
  if (typeof v !== 'boolean') throw bad('Send true or false');
  return v;
};
const fullQuiet = (v: unknown) => {
  const q = { ...DEFAULT_PREFS.quiet, ...(PatchSchema.shape.quiet.parse(v) ?? {}) };
  if (q.enabled && q.from === q.to) throw bad('Quiet hours need different start and end times');
  return q;
};
const fullClients = (v: unknown) => ({ ...DEFAULT_PREFS.clients, ...(PatchSchema.shape.clients.parse(v) ?? {}) });

export const notifySettings: ScopedSetting[] = [
  ...SWITCHES.map((k) => ({ id: `notify.${k}`, key: 'notify', field: k, label: SWITCH_LABELS[k], section: 'notifications', parse: aSwitch })),
  { id: 'notify.quiet', key: 'notify', field: 'quiet', label: 'Quiet hours', section: 'notifications', parse: fullQuiet },
  { id: 'notify.clients', key: 'notify', field: 'clients', label: 'Show on', section: 'notifications', parse: fullClients },
  { id: 'nudge.hour', key: 'nudge.hour', label: 'Daily nudge not before', section: 'notifications', parse: wholeNumber(0, 23, 'nudge_hour') },
  { id: 'nudge.days', key: 'nudge.days', label: 'Daily nudge: untouched for (days)', section: 'notifications', parse: wholeNumber(1, 365, 'nudge_days') },
];

export async function updatePrefs(ctx: Ctx, input: unknown, scope: Scope = 'profile') {
  const patch = PatchSchema.parse(input);
  const cur = await getPrefs(ctx);
  // Only what is sent is written, each part on its own, so a part set for every profile stays so.
  const writes: [id: string, value: unknown][] = [];
  for (const k of SWITCHES) if (patch[k] !== undefined) writes.push([`notify.${k}`, patch[k]]);
  if (patch.quiet) {
    const quiet = { ...cur.quiet, ...patch.quiet };
    if (quiet.enabled && quiet.from === quiet.to) throw bad('Quiet hours need different start and end times');
    writes.push(['notify.quiet', quiet]);
  }
  if (patch.clients) writes.push(['notify.clients', { ...cur.clients, ...patch.clients }]);
  if (patch.nudge_hour !== undefined) writes.push(['nudge.hour', patch.nudge_hour]);
  if (patch.nudge_days !== undefined) writes.push(['nudge.days', patch.nudge_days]);
  const cleared = new Set<string>();
  for (const [id, value] of writes) for (const m of (await writeScoped(ctx, scopedSetting(id), value, scope)).cleared) cleared.add(m);
  if (patch.nudge !== undefined) {
    // The switch above replaces the older per-profile setting.
    if (scope === 'all') await ctx.db.prepare("DELETE FROM settings WHERE key = 'nudge.enabled'").run();
    await ctx.setSetting('nudge.enabled', null);
  }
  return { ...(await describePrefs(ctx)), scope, cleared: [...cleared] };
}

const scopeArg = z.enum(SCOPES).optional().describe('"profile" (the usual): only this profile. "all": every profile (clears what other profiles set for themselves).');

export const notifyPrefsModule: Module = {
  id: 'notify-prefs',
  description: 'Notification settings: master switch, kinds, quiet hours and which clients show them.',
  scopedSettings: notifySettings,
  routes(api) {
    api.get('/notification-settings', async (c) => c.json(await describePrefs(c.get('ctx'))));
    api.put('/notification-settings', async (c) => {
      const { scope, ...body } = await c.req.json<Record<string, unknown>>();
      return c.json(await updatePrefs(c.get('ctx'), body, parseScope(scope ?? c.req.query('scope'))));
    });
  },
  tools: [
    {
      name: 'get_notification_settings',
      description:
        'The owner’s notification settings: master switch, switches for reminders, habit prompts, the daily nudge and session/pomodoro alerts, quiet hours (in their time zone), which clients show notifications (android, swiftbar, web), and the nudge hour and days. All of it belongs to the profile (mode) asked about.',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => describePrefs(ctx),
    },
    {
      name: 'set_notification_settings',
      description:
        'Change notification settings; send only what changes. enabled = master switch; reminders, habits, nudge, session = per kind; quiet = { enabled, from: "22:00", to: "07:00" } (may cross midnight; notifications wait until it ends); clients = { android, swiftbar, web } booleans; nudge_hour (0-23) and nudge_days. Changes only the profile (mode) given, or the default one, unless scope is "all": then every profile gets these values (other profiles lose their own values for them).',
      input: PatchSchema.extend({ scope: scopeArg }),
      run: (ctx, { scope, ...a }) => updatePrefs(ctx, a, parseScope(scope)),
    },
  ],
};
