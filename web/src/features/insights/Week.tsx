import { useFlag } from '../../core/features';
import { fmtMinutes, Loading } from '../../core/ui';
import { DayBars, rangeLabel, TargetBar } from './charts';
import { usePref, useInsights } from './prefs';
import type { WeekData, WeekSummary } from './types';

const WHICH = ['this', 'last'] as const;

function Tile({ label, value, other, otherLabel }: { label: string; value: string; other?: string; otherLabel: string }) {
  return (
    <div class="ins-tile">
      <span class="ins-tile-label">{label}</span>
      <strong class="ins-tile-value">{value}</strong>
      {other && (
        <span class="ins-tile-other">
          {otherLabel}: {other}
        </span>
      )}
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function habitNote(h: WeekSummary['habits'][number]): string {
  switch (h.status) {
    case 'paused':
      return 'Paused';
    case 'partial':
      return 'Started part-way through the week';
    default: {
      const parts = [`${h.counted} of ${h.target}`];
      if (h.over) parts.push(`+${h.over} over`);
      if (h.planned_later) parts.push(`${h.planned_later} planned later`);
      return parts.join(' · ');
    }
  }
}

export function Week() {
  const habitsOn = useFlag('habits');
  const { data, error } = useInsights<WeekData>('/insights/week');
  const [which, setWhich] = usePref<'this' | 'last'>('week', WHICH, 'this');
  if (!data) return <Loading error={error} />;
  const [cur, last] = data.weeks;
  const w = which === 'this' ? cur : last;
  const o = which === 'this' ? last : cur;
  const otherLabel = which === 'this' ? 'Last week' : 'This week';
  const habitsText = (x: WeekSummary) => (x.habit_totals.target ? `${x.habit_totals.counted} of ${x.habit_totals.target}` : '—');
  return (
    <div class="stack">
      <div class="ins-bar-row">
        <div class="seg" role="radiogroup" aria-label="Week">
          {WHICH.map((x) => (
            <button key={x} role="radio" aria-checked={which === x} class={which === x ? 'on' : ''} onClick={() => setWhich(x)}>
              {x === 'this' ? 'This week' : 'Last week'}
            </button>
          ))}
        </div>
        <span class="muted small">{rangeLabel(w.start, w.end)}</span>
      </div>

      <div class="ins-tiles">
        <Tile label="Focus sessions" value={String(w.focus.sessions)} other={String(o.focus.sessions)} otherLabel={otherLabel} />
        <Tile label="Focus time" value={fmtMinutes(w.focus.minutes)} other={fmtMinutes(o.focus.minutes)} otherLabel={otherLabel} />
        {habitsOn && <Tile label="Habit sessions" value={habitsText(w)} other={habitsText(o)} otherLabel={otherLabel} />}
        <Tile label="To-dos done" value={String(w.todos.done)} other={String(o.todos.done)} otherLabel={otherLabel} />
      </div>

      <div class="ins-two">
      <section class="card">
        <h2>Focus per day</h2>
        <DayBars days={w.focus.days} today={data.today} />
        {w.skips > 0 && <p class="muted small">Focus was swapped away from a project {plural(w.skips, 'time')} this week.</p>}
      </section>

      {habitsOn && (
      <section class="card">
        <h2>Habits against target</h2>
        {w.habits.length === 0 ? (
          <p class="muted">No habits this week.</p>
        ) : (
          <ul class="plain ins-habit-list">
            {w.habits.map((h) => (
              <li key={h.id} class="ins-habit-row">
                <div class="ins-habit-head">
                  <span class="ins-habit-name">{h.name}</span>
                  <span class="muted small">{h.level}</span>
                </div>
                <TargetBar counted={h.counted} over={h.over} target={h.status === 'paused' || h.status === 'partial' ? 0 : h.target} light={h.status === 'open'} />
                <span class="small ins-habit-note">{habitNote(h)}</span>
              </li>
            ))}
          </ul>
        )}
        <p class="ins-legend small muted">
          <i class="sw solid" /> Done <i class="sw hatch" /> Extra above the target <i class="sw tick" /> Target
        </p>
      </section>
      )}
      </div>

      <section class="card">
        <h2>To-dos</h2>
        <p class="ins-todos">
          <span>
            <strong>{w.todos.done}</strong> done
          </span>
          {w.todos.still_open > 0 && (
            <span>
              <strong>{w.todos.still_open}</strong> due and still open
            </span>
          )}
          {w.todos.coming_up > 0 && (
            <span>
              <strong>{w.todos.coming_up}</strong> coming up
            </span>
          )}
        </p>
      </section>
    </div>
  );
}
