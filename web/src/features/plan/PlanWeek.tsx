// Plan my week (#/plan, #/plan/next): this week or next, one card per day (a column each on a wide screen).
// Per day: what the day is for (the rotation), planned habit sessions (rings; filled once done) and to-dos.
// To-dos move by dragging (mouse) or with Move, then "Put here" on a day (any screen).
import { useEffect, useState } from 'preact/hooks';
import { localStorageSet } from '../../core/api';
import { AddInput, go, Linkify, Loading, useData } from '../../core/ui';
import { addTodo, moveTodo, planSession, setLead, type SetPlan } from './actions';
import type { Plan, PlanDay, PlanHabit, Todo } from './types';
import './plan.css';

const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
const shortDay = (day: string) => dayLabel(day, { weekday: 'short', day: 'numeric' });
const longDay = (day: string) => dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' });
const range = (p: Plan) => `${dayLabel(p.week_of, { day: 'numeric', month: 'short' })} – ${dayLabel(p.end, { day: 'numeric', month: 'short' })}`;

export function leadName(p: Plan, value: string): string {
  if (value === 'any') return 'Any project';
  if (value === 'away') return 'Away';
  return p.categories.find((c) => c.id === value)?.label ?? 'A category';
}

const PICK_KEY = 'ft.plan.habit';
function readPick(): string | null {
  try {
    return localStorage.getItem(PICK_KEY);
  } catch {
    return null;
  }
}

/** "2 of 3 planned" for a habit's week. */
function plannedText(h: PlanHabit) {
  return h.target ? `${h.planned} of ${h.target} planned` : `${h.planned} planned`;
}

function HabitPicker({ plan, pick, setPick }: { plan: Plan; pick: string | null; setPick: (id: string) => void }) {
  if (!plan.habits.length)
    return (
      <section class="card plan-picker">
        <h2>Habit sessions</h2>
        <p class="muted small">
          No active habits yet. <a href="#/habits">Add one in Habits</a>.
        </p>
      </section>
    );
  const chosen = plan.habits.find((h) => h.id === pick);
  return (
    <section class="card plan-picker" aria-label="Habit sessions">
      <div class="card-head">
        <h2>Habit sessions</h2>
        <span class="muted small">Pick a habit, then tap + on a day. Tap a ring to take it off.</span>
      </div>
      <div class="chips" role="radiogroup" aria-label="Habit to plan">
        {plan.habits.map((h) => (
          <button key={h.id} role="radio" aria-checked={h.id === pick} class={`chip plan-chip ${h.id === pick ? 'on' : ''}`} onClick={() => setPick(h.id)}>
            <strong>{h.name}</strong>
            <span class={`small ${h.target && h.planned >= h.target ? 'plan-full' : 'muted'}`}>{plannedText(h)}</span>
          </button>
        ))}
      </div>
      {chosen && (
        <p class="muted small">
          {chosen.name}: {chosen.level}
          {chosen.per === 'week' ? ', any days of the week' : ''}. {chosen.done} done so far.
          {chosen.away_days_left_out ? ` Away days ask nothing (${chosen.away_days_left_out} left out).` : ''} A plan is only a plan: a session on another day still counts.
        </p>
      )}
    </section>
  );
}

function Rings({ plan, set, d, h }: { plan: Plan; set: SetPlan; d: PlanDay; h: PlanHabit }) {
  const row = d.habits.find((x) => x.habit_id === h.id);
  if (!row) return null;
  const marks = Math.max(row.planned, row.done);
  const label = `${h.name} on ${longDay(d.day)}: ${row.planned} planned, ${row.done} done`;
  return (
    <li class="plan-hab" aria-label={label}>
      <span class="plan-hname">{h.name}</span>
      <span class="plan-rings">
        {Array.from({ length: Math.min(marks, 12) }, (_, i) =>
          i < row.done ? (
            <span key={i} class="ring done" aria-hidden="true" />
          ) : d.past ? (
            <span key={i} class="ring" aria-hidden="true" />
          ) : (
            <button key={i} class="ring" aria-label={`Take a planned session of ${h.name} off ${longDay(d.day)}`} onClick={() => planSession(set, plan, h.id, d.day, -1)} />
          ),
        )}
        {marks > 12 && <span class="small">+{marks - 12}</span>}
        {row.skipped && <span class="muted small">not today</span>}
      </span>
    </li>
  );
}

function TodoItem({ t, onMove, moving, late }: { t: Todo; onMove: (t: Todo) => void; moving: Todo | null; late?: string }) {
  return (
    <li
      class={`plan-todo ${t.done ? 'done' : ''} ${moving?.id === t.id ? 'moving' : ''}`}
      draggable={!t.done}
      onDragStart={(e) => {
        e.dataTransfer?.setData('text/plain', t.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <span class="plan-todo-title">
        <Linkify text={t.title} />
        {late && <span class="tag late">{late}</span>}
      </span>
      {!t.done && (
        <button class="icon small" aria-label={`Move ${t.title}`} title="Move to another day" onClick={() => onMove(t)}>
          ⇄
        </button>
      )}
    </li>
  );
}

/** Drop a dragged to-do here. */
function useDrop(enabled: boolean, onDrop: (id: string) => void) {
  const [over, setOver] = useState(false);
  if (!enabled) return { over: false, props: {} };
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        if (!over) setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer?.getData('text/plain');
        if (id) onDrop(id);
      },
    },
  };
}

function DayCard({ plan, set, d, pick, moving, setMoving, findTodo }: { plan: Plan; set: SetPlan; d: PlanDay; pick: PlanHabit | undefined; moving: Todo | null; setMoving: (t: Todo | null) => void; findTodo: (id: string) => Todo | undefined }) {
  const [adding, setAdding] = useState(false);
  const canPlan = !d.past;
  const drop = useDrop(canPlan, (id) => {
    const t = findTodo(id);
    if (t) moveTodo(set, plan, t, d.day);
  });
  const opts: [string, string][] = [['any', 'Any project'], ['away', 'Away'], ...plan.categories.map((c): [string, string] => [c.id, c.label])];
  return (
    <section class={`plan-day ${d.today ? 'today' : ''} ${d.away ? 'away' : ''} ${d.past ? 'past' : ''} ${drop.over ? 'drop' : ''}`} aria-label={longDay(d.day)} {...drop.props}>
      <div class="plan-day-head">
        <strong>{shortDay(d.day)}</strong>
        {d.today && <span class="tag plan-today">Today</span>}
      </div>
      {d.past ? (
        <span class="small muted">{leadName(plan, d.lead.value)}</span>
      ) : (
        <label class="plan-lead">
          <span class="plan-sr">What {longDay(d.day)} is for</span>
          <select value={d.lead.value} class={d.lead.changed ? 'changed' : ''} onChange={(e) => setLead(set, plan, d.day, (e.target as HTMLSelectElement).value)}>
            {opts.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {d.lead.changed && <span class="small muted">Usually {leadName(plan, d.lead.usual).toLowerCase()}</span>}
        </label>
      )}
      {moving && canPlan && (
        <button
          class="primary small"
          onClick={() => {
            moveTodo(set, plan, moving, d.day);
            setMoving(null);
          }}
        >
          Put here
        </button>
      )}
      <ul class="plan-habs">
        {plan.habits.map((h) => (
          <Rings key={h.id} plan={plan} set={set} d={d} h={h} />
        ))}
      </ul>
      {canPlan && pick && (
        <button class="small plan-add" aria-label={`Plan a session of ${pick.name} on ${longDay(d.day)}`} onClick={() => planSession(set, plan, pick.id, d.day, 1)}>
          + {pick.name}
        </button>
      )}
      {d.todos.length > 0 && (
        <ul class="plan-todos" aria-label={`To-dos on ${longDay(d.day)}`}>
          {d.todos.map((t) => (
            <TodoItem key={t.id} t={t} onMove={setMoving} moving={moving} />
          ))}
        </ul>
      )}
      {canPlan &&
        (adding ? (
          <AddInput placeholder={`To-do for ${shortDay(d.day)}`} autoFocus onAdd={(title) => addTodo(set, plan, d.day, title)} />
        ) : (
          <button class="ghost small plan-add-todo" onClick={() => setAdding(true)}>
            + To-do
          </button>
        ))}
    </section>
  );
}

function Loose({ plan, set, moving, setMoving, findTodo }: { plan: Plan; set: SetPlan; moving: Todo | null; setMoving: (t: Todo | null) => void; findTodo: (id: string) => Todo | undefined }) {
  const drop = useDrop(true, (id) => {
    const t = findTodo(id);
    if (t) moveTodo(set, plan, t, null);
  });
  // Grouped by to-do list: the first list (where new to-dos go) open, the others folded.
  const groups = [...plan.lists, { id: '', name: 'Other' }]
    .map((l) => ({ ...l, todos: plan.unscheduled.filter((t) => (l.id ? t.list_id === l.id : !plan.lists.some((x) => x.id === t.list_id))) }))
    .filter((g) => g.todos.length);
  return (
    <section class={`card plan-loose ${drop.over ? 'drop' : ''}`} aria-label="To-dos without a day" {...drop.props}>
      <div class="card-head">
        <h2>Anytime</h2>
        <span class="muted small">Drag a to-do onto a day, or tap ⇄ and then “Put here”.</span>
      </div>
      {moving && moving.day != null && (
        <button
          class="primary small"
          onClick={() => {
            moveTodo(set, plan, moving, null);
            setMoving(null);
          }}
        >
          Put here (no day)
        </button>
      )}
      {plan.unscheduled.length ? (
        groups.map(({ id, name, todos }, i) =>
          i === 0 && (groups.length === 1 || id === plan.lists[0]?.id) ? (
            <ul key={id} class="plan-todos" aria-label={name}>
              {todos.map((t) => (
                <TodoItem key={t.id} t={t} onMove={setMoving} moving={moving} />
              ))}
            </ul>
          ) : (
            <details key={id} class="plan-list" open={!!moving && todos.some((t) => t.id === moving.id)}>
              <summary>
                {name} <span class="muted small">{todos.length}</span>
              </summary>
              <ul class="plan-todos">
                {todos.map((t) => (
                  <TodoItem key={t.id} t={t} onMove={setMoving} moving={moving} />
                ))}
              </ul>
            </details>
          ),
        )
      ) : (
        <p class="muted small">No to-dos without a day.</p>
      )}
      {plan.earlier.length > 0 && (
        <>
          <h3>Still open from before</h3>
          <ul class="plan-todos">
            {plan.earlier.map((t) => (
              <TodoItem key={t.id} t={t} onMove={setMoving} moving={moving} late={t.day ? shortDay(t.day) : undefined} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function PlanWeek({ which }: { which: 'this' | 'next' }) {
  const { data: plan, error, setData } = useData<Plan>(`/plan?week=${which}`);
  const [pick, setPickState] = useState<string | null>(readPick);
  const [moving, setMoving] = useState<Todo | null>(null);
  useEffect(() => {
    if (!moving) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMoving(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [moving]);
  if (!plan) return <Loading error={error} />;
  const set: SetPlan = setData;
  const chosen = plan.habits.find((h) => h.id === pick) ?? plan.habits[0];
  const setPick = (id: string) => {
    setPickState(id);
    localStorageSet(PICK_KEY, id);
  };
  const allTodos = [...plan.days.flatMap((d) => d.todos), ...plan.unscheduled, ...plan.earlier];
  const findTodo = (id: string) => allTodos.find((t) => t.id === id);
  return (
    <div class="stack plan-page">
      <div class="page-head row">
        <h1>Plan my week</h1>
        <div class="plan-seg" role="tablist" aria-label="Which week">
          <button role="tab" aria-selected={which === 'this'} class={which === 'this' ? 'on' : ''} onClick={() => go('/plan')}>
            This week
          </button>
          <button role="tab" aria-selected={which === 'next'} class={which === 'next' ? 'on' : ''} onClick={() => go('/plan/next')}>
            Next week
          </button>
        </div>
      </div>
      <p class="muted small plan-range">
        {range(plan)}. {which === 'next' ? 'Changes to what a day is for apply only to next week.' : 'Changes to what a day is for apply only to this week.'}
      </p>
      <HabitPicker plan={plan} pick={chosen?.id ?? null} setPick={setPick} />
      {moving && (
        <div class="plan-moving" role="status">
          <span>
            Moving <strong>{moving.title}</strong>: tap “Put here” on a day.
          </span>
          <button class="small" onClick={() => setMoving(null)}>
            Cancel
          </button>
        </div>
      )}
      <div class="plan-days">
        {plan.days.map((d) => (
          <DayCard key={d.day} plan={plan} set={set} d={d} pick={chosen} moving={moving} setMoving={setMoving} findTodo={findTodo} />
        ))}
      </div>
      <Loose plan={plan} set={set} moving={moving} setMoving={setMoving} findTodo={findTodo} />
    </div>
  );
}
