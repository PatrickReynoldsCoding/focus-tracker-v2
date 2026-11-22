// Settings → Notifications: master switch, a switch per kind, the daily nudge's hour and days,
// quiet hours and which devices show notifications. The server applies all of it
// (src/modules/notify-prefs.ts), so the Android app, the Mac menu bar and the web app obey.

import './notifications-settings.css';
import { optimistic, put } from '../../core/api';
import { useFlag } from '../../core/features';
import { registerPanel } from '../../core/registry';
import { OwnValue, scopedChange, ScopeChoice, useScopeStates } from '../../core/scope';
import { Loading, useData } from '../../core/ui';

const SECTION = 'notifications';
/** The scoped setting (D46) each part of a change belongs to. */
const idOf = (key: string) => (key === 'nudge_hour' ? 'nudge.hour' : key === 'nudge_days' ? 'nudge.days' : `notify.${key}`);

interface Prefs {
  enabled: boolean;
  reminders: boolean;
  habits: boolean;
  nudge: boolean;
  session: boolean;
  quiet: { enabled: boolean; from: string; to: string };
  clients: { android: boolean; swiftbar: boolean; web: boolean };
  nudge_hour: number;
  nudge_days: number;
  timezone: string;
  quiet_now: boolean;
}

const KINDS: [keyof Pick<Prefs, 'reminders' | 'habits' | 'nudge' | 'session'>, string, string][] = [
  ['reminders', 'Reminders', 'When a reminder you set is due.'],
  ['habits', 'Habit prompts', 'A nudge to do a habit.'],
  ['nudge', 'Daily nudge', 'Once a day, about projects you have not touched for a while.'],
  ['session', 'Pomodoro and session alerts', 'When a pomodoro period or the planned session time ends.'],
];

function Notifications() {
  const habitsOn = useFlag('habits');
  const { data, setData } = useData<Prefs>('/notification-settings');
  const { states, of } = useScopeStates();
  if (!data) return <Loading />;
  // Show the change at once, send it, and put it back with a message if the server refuses. With
  // All profiles chosen, ask first when other profiles have their own value for it.
  const save = async (patch: Record<string, unknown>, show: (p: Prefs) => Prefs) => {
    const before = data;
    const sent = await scopedChange(SECTION, Object.keys(patch).map(idOf), states, (scope) =>
      optimistic(
        () => {
          setData(show);
          return () => setData(() => before);
        },
        () => put('/notification-settings', { ...patch, scope }),
        scope === 'all' ? 'Saved for every profile' : undefined,
      ),
    );
    if (sent === false) setData((p) => ({ ...p })); // said no: draw the controls as they were
  };
  const mark = (id: string) => <OwnValue state={of(id)} section={SECTION} />;
  const off = !data.enabled;
  const q = data.quiet;
  return (
    <section class="card ns">
      <h2>Notifications</h2>
      <ScopeChoice section={SECTION} />
      <label class="inline ns-master">
        <input type="checkbox" checked={data.enabled} onChange={(e) => save({ enabled: (e.target as HTMLInputElement).checked }, (p) => ({ ...p, enabled: (e.target as HTMLInputElement).checked }))} />
        <span>
          <strong>Notifications {data.enabled ? 'on' : 'off'}</strong>
          {mark('notify.enabled')}
          <span class="muted small ns-hint">{data.enabled ? 'Turn this off to stop all of this profile’s notifications, on every device.' : 'Nothing is shown on any device until you turn this on.'}</span>
        </span>
      </label>

      <div class={`stack ns-body ${off ? 'ns-off' : ''}`} aria-disabled={off}>
        <fieldset disabled={off}>
          <legend>What to be told about</legend>
          {KINDS.filter(([key]) => key !== 'habits' || habitsOn).map(([key, label, hint]) => (
            <label key={key} class="inline ns-kind">
              <input type="checkbox" checked={data[key]} onChange={(e) => save({ [key]: (e.target as HTMLInputElement).checked }, (p) => ({ ...p, [key]: (e.target as HTMLInputElement).checked }))} />
              <span>
                {label}
                {mark(`notify.${key}`)}
                <span class="muted small ns-hint">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset disabled={off || !data.nudge}>
          <legend>Daily nudge</legend>
          <div class="row">
            <label>
              Not before (hour, 0–23)
              <input
                type="number"
                min={0}
                max={23}
                key={`h${data.nudge_hour}`}
                defaultValue={data.nudge_hour}
                onBlur={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  if (Number.isInteger(v) && v >= 0 && v <= 23 && v !== data.nudge_hour) save({ nudge_hour: v }, (p) => ({ ...p, nudge_hour: v }));
                }}
              />
              {mark('nudge.hour')}
            </label>
            <label>
              Untouched for (days)
              <input
                type="number"
                min={1}
                key={`d${data.nudge_days}`}
                defaultValue={data.nudge_days}
                onBlur={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  if (Number.isInteger(v) && v >= 1 && v !== data.nudge_days) save({ nudge_days: v }, (p) => ({ ...p, nudge_days: v }));
                }}
              />
              {mark('nudge.days')}
            </label>
          </div>
        </fieldset>

        <fieldset disabled={off}>
          <legend>
            Quiet hours
            {mark('notify.quiet')}
          </legend>
          <label class="inline">
            <input type="checkbox" checked={q.enabled} onChange={(e) => save({ quiet: { enabled: (e.target as HTMLInputElement).checked } }, (p) => ({ ...p, quiet: { ...p.quiet, enabled: (e.target as HTMLInputElement).checked } }))} />
            Hold notifications back during quiet hours
          </label>
          <div class="row">
            <label>
              From
              <input type="time" value={q.from} disabled={!q.enabled} onChange={(e) => (e.target as HTMLInputElement).value && save({ quiet: { from: (e.target as HTMLInputElement).value } }, (p) => ({ ...p, quiet: { ...p.quiet, from: (e.target as HTMLInputElement).value } }))} />
            </label>
            <label>
              Until
              <input type="time" value={q.to} disabled={!q.enabled} onChange={(e) => (e.target as HTMLInputElement).value && save({ quiet: { to: (e.target as HTMLInputElement).value } }, (p) => ({ ...p, quiet: { ...p.quiet, to: (e.target as HTMLInputElement).value } }))} />
            </label>
          </div>
          <p class="muted small">
            In your time zone ({data.timezone}). Anything due in this window waits and shows when it ends.{q.enabled && data.quiet_now ? ' Quiet hours are on right now.' : ''}
          </p>
        </fieldset>

        <fieldset disabled={off}>
          <legend>
            Show on
            {mark('notify.clients')}
          </legend>
          {(
            [
              ['android', 'Phone (Android app)'],
              ['swiftbar', 'Mac menu bar'],
              ['web', 'Web app (banners on Today)'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} class="inline">
              <input type="checkbox" checked={data.clients[key]} onChange={(e) => save({ clients: { [key]: (e.target as HTMLInputElement).checked } }, (p) => ({ ...p, clients: { ...p.clients, [key]: (e.target as HTMLInputElement).checked } }))} />
              {label}
            </label>
          ))}
          <p class="muted small">For this profile’s notifications. A device shows the profile it follows (the default profile, unless it names one).</p>
        </fieldset>
      </div>
    </section>
  );
}

registerPanel('settings', { id: 'notifications', order: 15, scope: 'profile', icon: '🔔', summary: () => { const { data } = useData<Prefs>('/notification-settings'); return data ? (data.enabled ? (data.quiet.enabled ? `On · quiet ${data.quiet.from}–${data.quiet.to}` : 'On') : 'Off') : null; }, render: () => <Notifications /> });
