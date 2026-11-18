import { useEffect, useState } from 'preact/hooks';
import { change, newId, optimistic, post, put } from '../../core/api';
import { Panels, registerPanel, registerTab, type TodayPanelProps } from '../../core/registry';
import { AddInput, daysAgo, Dialog, fmtDay, Loading, useData } from '../../core/ui';

type Project = { id: string; name: string; last_touched?: string | null; category_id?: string | null };
type Todo = { id: string; title: string; day: string | null; done: string | null };
type Session = { project_id: string; project_name: string; started: string; elapsed_seconds: number; pomodoro: null | { phase: string; seconds_left: number; round: number; work: number; break: number } };
type TodayData = {
  day: string;
  focus: Project | null;
  show_session_controls: boolean;
  rotation: { category: string; weekday: string };
  suggestions: Project[];
  session: Session | null;
  todos: Todo[];
  habits: unknown[];
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
  return (
    <Dialog title="Finish session" onClose={onClose}>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          onClose();
          await change(() => post('/session/stop', { where_stopped: where || undefined }), 'Session logged');
        }}
      >
        <label>
          Where did you stop?
          <textarea rows={3} value={where} onInput={(e) => setWhere((e.target as HTMLTextAreaElement).value)} autoFocus />
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

export function Today() {
  const { data, error, setData } = useData<TodayData>('/today');
  if (!data) return <Loading error={error} />;
  return (
    <div class="grid today">
      <Panels<TodayPanelProps> place="today" props={{ today: data, setToday: setData }} />
    </div>
  );
}

registerTab({ id: 'today', path: '/today', label: 'Today', icon: '◎', order: 10, phone: true, render: () => <Today /> });

registerPanel('today', { id: 'focus', order: 10, wide: true, render: ({ today }) => <FocusCard data={today} /> });
registerPanel('today', { id: 'todos', order: 20, render: ({ today, setToday }) => <TodoPanel data={today} setData={setToday} /> });
registerPanel('today', {
  id: 'on-today',
  order: 60,
  render: ({ today }) =>
    today.lists.length ? (
      <section class="card">
        <h2>On Today</h2>
        <div class="chips">
          {today.lists.map((l: { id: string; name: string; kind: string }) => (
            <a key={l.id} class="chip" href={`#/n/${l.id}`}>
              {l.kind === 'note' ? '✎ ' : l.kind === 'todo' ? '☐ ' : '≡ '}
              {l.name}
            </a>
          ))}
        </div>
      </section>
    ) : null,
});
registerPanel('today', {
  id: 'neglected',
  order: 80,
  render: ({ today }) =>
    today.neglected.length ? (
      <section class="card">
        <h2>Waiting for you</h2>
        <ul class="plain">
          {today.neglected.map((p: Project) => (
            <li key={p.id}>
              <a href={`#/p/${p.id}`}>{p.name}</a> <span class="muted">· {daysAgo(p.last_touched, today.day)}</span>
            </li>
          ))}
        </ul>
      </section>
    ) : null,
});
