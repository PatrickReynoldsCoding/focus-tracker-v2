import { Loading } from '../../core/ui';
import { HabitBars, dayLabel } from './charts';
import { usePref, useInsights } from './prefs';
import type { HabitHistory, HabitsData } from './types';

const RANGES = [8, 12] as const;
const VIEWS = ['chart', 'table'] as const;

const cell = (w: HabitHistory['weeks'][number]): string => {
  if (w.status === 'before') return '';
  if (w.status === 'paused') return 'paused';
  if (w.status === 'partial') return `${w.done} (part week)`;
  const base = `${w.status === 'open' ? w.done : w.counted} of ${w.target}`;
  return w.over ? `${base} +${w.over}` : base;
};

function Table({ data }: { data: HabitsData }) {
  return (
    <div class="ins-table-wrap">
      <table class="ins-table">
        <caption class="sr-only">Sessions done against the target, by habit and week (week starting)</caption>
        <thead>
          <tr>
            <th scope="col">Habit</th>
            {data.weeks.map((w) => (
              <th key={w} scope="col">
                {dayLabel(w)}
              </th>
            ))}
            <th scope="col">On target</th>
          </tr>
        </thead>
        <tbody>
          {data.habits.map((h) => (
            <tr key={h.id}>
              <th scope="row">{h.name}</th>
              {h.weeks.map((w) => (
                <td key={w.week}>{cell(w)}</td>
              ))}
              <td>
                {h.on_target_weeks} of {h.counted_weeks}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HabitsTab() {
  const [weeks, setWeeks] = usePref<number>('habit-weeks', RANGES, 8);
  const [view, setView] = usePref<'chart' | 'table'>('habit-view', VIEWS, 'chart');
  const { data, error } = useInsights<HabitsData>(`/insights/habits?weeks=${weeks}`);
  return (
    <div class="stack">
      <div class="ins-bar-row">
        <div class="seg" role="radiogroup" aria-label="Range">
          {RANGES.map((n) => (
            <button key={n} role="radio" aria-checked={weeks === n} class={weeks === n ? 'on' : ''} onClick={() => setWeeks(n)}>
              {n} weeks
            </button>
          ))}
        </div>
        <button class="ghost small" onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
          {view === 'chart' ? 'Show as table' : 'Show as charts'}
        </button>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : data.habits.length === 0 ? (
        <p class="empty">No habits yet. Add one on the Habits tab.</p>
      ) : view === 'table' ? (
        <Table data={data} />
      ) : (
        <>
          <p class="ins-legend small muted">
            <i class="sw solid" /> Done <i class="sw hatch" /> Extra above the target <i class="sw tick" /> Target that week
          </p>
          <div class="ins-grid">
          {data.habits.map((h) => (
            <section class="card" key={h.id}>
              <div class="ins-habit-head">
                <h2>{h.name}</h2>
                <span class="muted small">{h.level}</span>
              </div>
              <p class="ins-ontarget">
                {h.counted_weeks === 0 ? (
                  <span class="muted">No full weeks yet</span>
                ) : (
                  <>
                    On target <strong>{h.on_target_weeks}</strong> of <strong>{h.counted_weeks}</strong> {h.counted_weeks === 1 ? 'week' : 'weeks'}
                  </>
                )}
                {h.status === 'paused' && <span class="tag">Paused</span>}
              </p>
              <HabitBars weeks={h.weeks} name={h.name} />
            </section>
          ))}
          </div>
          <p class="muted small">Weeks that are not over, that began part-way through or that had a pause are left out of the count.</p>
        </>
      )}
    </div>
  );
}
