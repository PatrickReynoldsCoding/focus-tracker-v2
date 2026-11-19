// A small view of this week for Today and the Habits tab: per day what it is for, planned sessions and
// to-dos, with the way into Plan my week.
import { Loading, useData } from '../../core/ui';
import { leadName } from './PlanWeek';
import type { Plan } from './types';
import './plan.css';

const letter = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' });
const num = (day: string) => Number(day.slice(8, 10));

export function WeekStrip({ title }: { title: string }) {
  const { data: plan, error } = useData<Plan>('/plan?week=this');
  if (!plan) return error ? <Loading error={error} /> : null;
  const today = plan.days.find((d) => d.today);
  const planned = (d: Plan['days'][number]) => d.habits.reduce((n, h) => n + Math.max(0, h.planned - h.done), 0);
  const todayPlanned = today ? today.habits.filter((h) => h.planned > h.done) : [];
  const names = todayPlanned.map((h) => plan.habits.find((x) => x.id === h.habit_id)?.name).filter(Boolean);
  // From Saturday, next week is the one to plan.
  const late = today && (today.weekday === 'saturday' || today.weekday === 'sunday');
  return (
    <section class="card plan-strip-card" aria-label={title}>
      <div class="card-head">
        <h2>{title}</h2>
        <a href={late ? '#/plan/next' : '#/plan'} class="small">
          {late ? 'Plan next week' : 'Plan my week'}
        </a>
      </div>
      <a class="plan-strip" href="#/plan" aria-label="Open Plan my week">
        {plan.days.map((d) => {
          const p = planned(d);
          const t = d.todos.filter((x) => !x.done).length;
          return (
            <span key={d.day} class={`plan-cell ${d.today ? 'today' : ''} ${d.away ? 'away' : ''} ${d.past ? 'past' : ''}`} title={leadName(plan, d.lead.value)}>
              <span class="plan-cell-l">
                {letter(d.day)} {num(d.day)}
              </span>
              <span class="plan-cell-lead">{d.away ? 'Away' : d.lead.value === 'any' ? '·' : leadName(plan, d.lead.value)}</span>
              <span class="plan-cell-n" aria-label={`${p} sessions and ${t} to-dos planned`}>
                {p ? `○${p}` : ''}
                {p && t ? ' ' : ''}
                {t ? `☐${t}` : ''}
              </span>
            </span>
          );
        })}
      </a>
      {names.length > 0 && <p class="small muted">Planned today: {names.join(', ')}.</p>}
    </section>
  );
}
