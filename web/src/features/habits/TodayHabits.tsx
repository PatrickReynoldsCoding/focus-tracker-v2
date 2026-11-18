import { optimistic, post } from '../../core/api';
import { registerPanel } from '../../core/registry';

type Habit = { id: string; name: string; per: string | null; target: number | null; done_today: number; done_this_period: number; left: number; small_version: string | null };
type TodayData = { habits: Habit[] };

export function HabitPanel({ data, setData }: { data: TodayData; setData: (fn: (d: TodayData) => TodayData) => void }) {
  if (!data.habits.length) return null;
  const bump = (h: Habit, add: number) =>
    optimistic(
      () => {
        const upd = (x: Habit) => (x.id === h.id ? { ...x, done_today: x.done_today + add, done_this_period: x.done_this_period + add, left: Math.max(0, x.left - add) } : x);
        setData((d) => ({ ...d, habits: d.habits.map(upd) }));
        return () => setData((d) => ({ ...d, habits: d.habits.map((x) => (x.id === h.id ? h : x)) }));
      },
      () => post(`/habits/${h.id}/check`, { add }),
    );
  return (
    <section class="card">
      <div class="card-head">
        <h2>Habits</h2>
        <a href="#/habits" class="muted">
          All
        </a>
      </div>
      <ul class="habits">
        {data.habits.map((h) => (
          <li key={h.id} class={h.left === 0 && h.target ? 'met' : ''}>
            <button class="habit-tap" onClick={() => bump(h, 1)} aria-label={`Done a session of ${h.name}`}>
              {h.left === 0 && h.target ? '✓' : '+'}
            </button>
            <div>
              <strong>{h.name}</strong>
              <span class="muted">
                {h.target ? `${h.done_this_period}/${h.target} ${h.per === 'week' ? 'this week' : 'today'}` : `${h.done_today} today`}
                {h.left > 0 && h.small_version ? ` · small: ${h.small_version}` : ''}
              </span>
            </div>
            {h.done_today > 0 && (
              <button class="icon" aria-label="Remove one" onClick={() => bump(h, -1)}>
                −
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

registerPanel('today', { id: 'habits', order: 30, render: ({ today, setToday }) => <HabitPanel data={today} setData={setToday} /> });
