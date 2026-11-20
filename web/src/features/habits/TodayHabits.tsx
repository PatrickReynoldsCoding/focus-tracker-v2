import { registerPanel } from '../../core/registry';
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

registerPanel('today', {
  id: 'habits',
  icon: '◎',
  title: 'Habits',
  description: 'Each habit with its sessions this week; tap to check in.',
  count: ({ today }) => (today.habits.length ? `${today.habits.filter((h: Progress) => h.left === 0).length}/${today.habits.length}` : null),
  order: 30,
  render: ({ today, setToday }) => <HabitPanel data={today} setData={setToday} />,
});
