import { useEffect, useState } from 'preact/hooks';
import { change, newId, optimistic, post, put } from '../api';
import { AddInput, daysAgo, Dialog, fmtDay, Loading, useData } from '../ui';

type Project = { id: string; name: string; next_action?: string | null; last_touched?: string | null; show_next_action?: string | null; category_id?: string | null; show_next?: boolean };
type Todo = { id: string; title: string; day: string | null; done: string | null };
type Habit = { id: string; name: string; per: string | null; target: number | null; done_today: number; done_this_period: number; left: number; small_version: string | null };
type Session = { project_id: string; project_name: string; started: string; elapsed_seconds: number; pomodoro: null | { phase: string; seconds_left: number; round: number; work: number; break: number } };
type TodayData = {
  day: string;
  focus: Project | null;
  show_session_controls: boolean;
  rotation: { category: string; weekday: string };
  suggestions: Project[];
  session: Session | null;
  todos: Todo[];
  habits: Habit[];
  lists: { id: string; name: string; kind: string }[];
  neglected: Project[];
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function SessionTimer({ session }: { session: Session }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.floor((now - Date.parse(session.started)) / 1000);
  let pomo = null;
  if (session.pomodoro) {
    const work = session.pomodoro.work * 60;
    const cycle = work + session.pomodoro.break * 60;
    const inCycle = elapsed % cycle;
    const phase = inCycle < work ? 'Work' : 'Break';
    const left = phase === 'Work' ? work - inCycle : cycle - inCycle;
    pomo = (
      <div class={`pomo ${phase.toLowerCase()}`}>
        <span class="big">{clock(left)}</span>
        <span class="muted">
          {phase} · round {Math.floor(elapsed / cycle) + 1}
        </span>
      </div>
    );
  }
  return (
    <div class="timer">
      {pomo}
      <span class="muted">Session {clock(elapsed)}</span>
    </div>
  );
}

function ShutdownDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const [where, setWhere] = useState('');
  const [next, setNext] = useState(project?.next_action ?? '');
  return (
    <Dialog title="Finish session" onClose={onClose}>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          onClose();
          await change(() => post('/session/stop', { where_stopped: where || undefined, next_action: next || undefined }), 'Session logged');
        }}
      >
        <label>
          Where did you stop?
          <textarea rows={3} value={where} onInput={(e) => setWhere((e.target as HTMLTextAreaElement).value)} autoFocus />
        </label>
        <label>
          Next action
          <input value={next} onInput={(e) => setNext((e.target as HTMLInputElement).value)} />
        </label>
        <div class="row">
          <button
            type="button"
            class="ghost"
            onClick={async () => {
              onClose();
              await change(() => post('/session/stop', { discard: true }), 'Session discarded');
            }}
          >
            Discard
          </button>
          <button class="primary">Log session</button>
        </div>
      </form>
    </Dialog>
  );
}

function FocusPicker({ data, onClose }: { data: TodayData; onClose: () => void }) {
  const { data: projects } = useData<Project[]>('/projects?status=active');
  return (
    <Dialog title={data.focus ? 'Swap focus' : 'Choose today’s focus'} onClose={onClose}>
      {data.focus && <p class="muted">{data.focus.name} will be remembered, with a reminder tomorrow.</p>}
      {!projects ? (
        <Loading />
      ) : (
        <ul class="pick">
          {projects
            .filter((p) => p.id !== data.focus?.id)
            .map((p) => (
              <li key={p.id}>
                <button
                  onClick={async () => {
                    onClose();
                    await change(() => put('/focus', { project_id: p.id }), `Focus: ${p.name}`);
                  }}
                >
                  <strong>{p.name}</strong>
                  <span class="muted">touched {daysAgo(p.last_touched, data.day)}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </Dialog>
  );
}

function FocusCard({ data }: { data: TodayData }) {
  const [picking, setPicking] = useState(false);
  const [stopping, setStopping] = useState(false);
  const f = data.focus;
  const s = data.session;
  return (
    <section class="card focus">
      <div class="card-head">
        <h2>Focus</h2>
        <span class="muted">{fmtDay(data.day)}</span>
      </div>
      {f ? (
        <>
          <a class="focus-name" href={`#/p/${f.id}`}>
            {f.name}
          </a>
          {f.next_action && f.show_next && <p class="next">Next: {f.next_action}</p>}
        </>
      ) : (
        <>
          <p class="muted">No focus yet. Each day starts empty until you choose.</p>
          {data.suggestions.length > 0 && (
            <div class="chips">
              {data.suggestions.map((p) => (
                <button key={p.id} class="chip" onClick={() => change(() => put('/focus', { project_id: p.id }), `Focus: ${p.name}`)}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {s && <SessionTimer session={s} />}
      <div class="row">
        <button class="ghost" onClick={() => setPicking(true)}>
          {f ? 'Swap' : 'Choose…'}
        </button>
        {data.show_session_controls &&
          (s ? (
            <button class="primary" onClick={() => setStopping(true)}>
              Stop
            </button>
          ) : (
            <button class="primary" onClick={() => change(() => post('/session/start', {}), 'Session started')}>
              Start session
            </button>
          ))}
      </div>
      {picking && <FocusPicker data={data} onClose={() => setPicking(false)} />}
      {stopping && <ShutdownDialog project={f} onClose={() => setStopping(false)} />}
    </section>
  );
}

function TodoPanel({ data, setData }: { data: TodayData; setData: (fn: (d: TodayData) => TodayData) => void }) {
  const tick = (t: Todo) => {
    const done = t.done ? null : data.day;
    optimistic(
      () => {
        setData((d) => ({ ...d, todos: d.todos.map((x) => (x.id === t.id ? { ...x, done } : x)) }));
        return () => setData((d) => ({ ...d, todos: d.todos.map((x) => (x.id === t.id ? t : x)) }));
      },
      () => post(`/todos/${t.id}/tick`, { done: !!done }),
    );
  };
  return (
    <section class="card">
      <div class="card-head">
        <h2>To do today</h2>
        <span class="muted">{data.todos.filter((t) => !t.done).length}</span>
      </div>
      <ul class="checks">
        {data.todos.map((t) => (
          <li key={t.id} class={t.done ? 'done' : ''}>
            <label>
              <input type="checkbox" checked={!!t.done} onChange={() => tick(t)} />
              <span>{t.title}</span>
              {t.day && t.day < data.day && !t.done && <span class="tag late">{fmtDay(t.day)}</span>}
            </label>
          </li>
        ))}
      </ul>
      <AddInput
        placeholder="Add a to-do for today"
        onAdd={(title) => {
          const id = newId();
          optimistic(
            () => {
              setData((d) => ({ ...d, todos: [...d.todos, { id, title, day: d.day, done: null }] }));
              return () => setData((d) => ({ ...d, todos: d.todos.filter((x) => x.id !== id) }));
            },
            () => post('/todos', { id, title, day: data.day }),
          );
        }}
      />
    </section>
  );
}

function HabitPanel({ data, setData }: { data: TodayData; setData: (fn: (d: TodayData) => TodayData) => void }) {
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

export function Today() {
  const { data, error, setData } = useData<TodayData>('/today');
  if (!data) return <Loading error={error} />;
  return (
    <div class="grid today">
      <FocusCard data={data} />
      <TodoPanel data={data} setData={setData} />
      <HabitPanel data={data} setData={setData} />
      {data.lists.length > 0 && (
        <section class="card">
          <h2>On Today</h2>
          <div class="chips">
            {data.lists.map((l) => (
              <a key={l.id} class="chip" href={`#/n/${l.id}`}>
                {l.kind === 'note' ? '✎ ' : l.kind === 'todo' ? '☐ ' : '≡ '}
                {l.name}
              </a>
            ))}
          </div>
        </section>
      )}
      {data.neglected.length > 0 && (
        <section class="card">
          <h2>Waiting for you</h2>
          <ul class="plain">
            {data.neglected.map((p) => (
              <li key={p.id}>
                <a href={`#/p/${p.id}`}>{p.name}</a> <span class="muted">· {daysAgo(p.last_touched, data.day)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
