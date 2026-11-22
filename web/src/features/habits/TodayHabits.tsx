import { registerPanel } from '../../core/registry';
import { record } from './actions';
import { HabitCards, HabitLine } from './HabitRow';
import type { Progress } from './types';
import './habits.css';

type TodayData = { habits: Progress[] };

/** The habits on Today: waiting cards first (Accept a new level, step-up prompt), then each habit with its dots. */
export function HabitPanel({ data, setData }: { data: TodayData; setData: (fn: (d: TodayData) => TodayData) => void }) {
  if (!data.habits.length) return null;
  const set = (fn: (l: Progress[]) => Progress[]) => setData((d) => ({ ...d, habits: fn(d.habits) }));
  return (
    <section class="card habits-panel">
      <div class="card-head">
        <h2>Habits</h2>
        <a href="#/habits" class="muted">
          All
        </a>
      </div>
      {data.habits.map((h) => (
        <HabitCards key={h.id} h={h} set={set} />
      ))}
      <ul class="habit-list">
        {data.habits.map((h) => (
          <li key={h.id}>
            <HabitLine h={h} set={set} strip="toggle" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The small Habits: each open habit with how many sessions are left, and a + to check in. */
function HabitsSmall({ data, setData }: { data: TodayData; setData: (fn: (d: TodayData) => TodayData) => void }) {
  const set = (fn: (l: Progress[]) => Progress[]) => setData((d) => ({ ...d, habits: fn(d.habits) }));
  if (!data.habits.length) return null;
  return (
    <section class="card panel-small">
      <div class="card-head">
        <h2>Habits</h2>
        <span class="muted">
          {data.habits.filter((h) => h.left === 0).length}/{data.habits.length}
        </span>
      </div>
      <ul class="plain">
        {data.habits.map((h) => (
          <li key={h.id} class="row spread">
            <span>
              {h.name} <span class="muted small">{h.left === 0 ? 'done' : `${h.left} left`}</span>
            </span>
            <button class="icon small" aria-label={`Done a session of ${h.name}`} onClick={() => record(set, h, h.day, 1)}>
              +
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

registerPanel('today', {
  id: 'habits',
  feature: 'habits',
  icon: '◎',
  title: 'Habits',
  description: 'Each habit with its sessions this week; tap to check in.',
  count: ({ today }) => (today.habits.length ? `${today.habits.filter((h: Progress) => h.left === 0).length}/${today.habits.length}` : null),
  order: 30,
  render: ({ today, setToday }) => <HabitPanel data={today} setData={setToday} />,
  small: ({ today, setToday }) => <HabitsSmall data={today} setData={setToday} />,
});
