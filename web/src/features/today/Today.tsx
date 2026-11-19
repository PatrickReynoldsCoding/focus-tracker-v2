import { useState } from 'preact/hooks';
import { change, newId, optimistic, post, put } from '../../core/api';
import { Panels, registerPanel, registerPlace, registerTab, type TodayPanelProps } from '../../core/registry';
import { AddInput, daysAgo, fmtDay, Linkify, Loading, useData } from '../../core/ui';
import { useSession, type Session } from './session';
import { SessionArea } from './SessionControls';
import './sessions';
import { SwapDialog } from './SwapDialog';

type Project = { id: string; name: string; last_touched?: string | null; category_id?: string | null };
type Todo = { id: string; title: string; day: string | null; done: string | null };
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

function readAway(): string | null {
  try {
    return localStorage.getItem('ft.away.shown');
  } catch {
    return null;
  }
}

/** The focus card: the day's focus project and its session (sessions.tsx, SessionControls.tsx).
 *  `compact`: the short version at the top of a phone's Today (name and session, More for the rest). */
function FocusCard({ data, compact }: { data: TodayData; compact?: boolean }) {
  const [picking, setPicking] = useState(false);
  const [more, setMore] = useState(false);
  const [anyway, setAnyway] = useState(() => readAway() === data.day);
  const { live } = useSession();
  const f = data.focus;
  const running = !!(live ?? data.session);
  const head = (
    <div class="card-head">
      <h2>Focus</h2>
      <span class="muted">{fmtDay(data.day)}</span>
    </div>
  );
  if (data.rotation?.category === 'away' && !f && !running && !anyway)
    return (
      <section class="card focus away">
        {head}
        <p class="away-title">Day off — nothing planned</p>
        <p class="muted">Rest counts too.</p>
        <div class="row">
          <button
            class="ghost"
            onClick={() => {
              setAnyway(true);
              try {
                localStorage.setItem('ft.away.shown', data.day);
              } catch {
                /* private mode */
              }
            }}
          >
            Show my focus anyway
          </button>
        </div>
      </section>
    );
  if (compact && !more)
    return (
      <section class="card focus compact">
        <div class="card-head">
          {f ? (
            <a class="focus-name" href={`#/p/${f.id}`}>
              <span class="muted small">Focus · </span>
              {f.name}
            </a>
          ) : (
            <h2>Focus</h2>
          )}
          <button class="ghost small" aria-expanded={false} onClick={() => setMore(true)}>
            More
          </button>
        </div>
        {!f && <p class="muted small">No focus yet. Each day starts empty until you choose.</p>}
        {!f && data.suggestions.length > 0 && (
          <div class="chips">
            {data.suggestions.map((p) => (
              <button key={p.id} class="chip" onClick={() => change(() => put('/focus', { project_id: p.id }), `Focus: ${p.name}`)}>
                {p.name}
              </button>
            ))}
          </div>
        )}
        {live && f && live.session.project_id !== f.id && <p class="muted small">Session running on {live.session.project_name}.</p>}
        <SessionArea projectId={null} showStart={data.show_session_controls && !!f} />
      </section>
    );
  return (
    <section class="card focus">
      {head}
      {f ? (
        <a class="focus-name" href={`#/p/${f.id}`}>
          {f.name}
        </a>
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
      {live && f && live.session.project_id !== f.id && <p class="muted small">Session running on {live.session.project_name}.</p>}
      <SessionArea projectId={null} showStart={data.show_session_controls && !!f} />
      <div class="row">
        <button class="ghost" onClick={() => setPicking(true)}>
          {f ? 'Swap' : 'Choose…'}
        </button>
        {compact && (
          <button class="ghost" aria-expanded={true} onClick={() => setMore(false)}>
            Less
          </button>
        )}
      </div>
      {picking && <SwapDialog current={f} day={data.day} onClose={() => setPicking(false)} />}
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
              <span><Linkify text={t.title} /></span>
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

// Today's panels drawn away from Today (a pop-out window on another tab) load Today themselves.
registerPlace<TodayPanelProps>({
  place: 'today',
  useProps: () => {
    const { data, error, setData } = useData<TodayData>('/today');
    return { props: data ? { today: data, setToday: setData as TodayPanelProps['setToday'] } : null, error };
  },
  keyOf: () => '',
  label: () => 'Today',
});

registerTab({ id: 'today', path: '/today', label: 'Today', icon: '◎', order: 10, phone: true, render: () => <Today /> });

registerPanel('today', {
  id: 'focus',
  title: 'Focus',
  description: 'Today’s focus project and its session.',
  alwaysShown: true,
  order: 10,
  wide: true,
  render: ({ today }) => <FocusCard data={today} />,
  compact: ({ today }) => <FocusCard data={today} compact />,
});
registerPanel('today', { id: 'todos', title: 'To do today', description: 'To-dos for today, with tick and add.', order: 20, count: ({ today }) => today.todos.filter((t: Todo) => !t.done).length, render: ({ today, setToday }) => <TodoPanel data={today} setData={setToday} /> });
registerPanel('today', {
  id: 'on-today',
  title: 'On Today',
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
  title: 'Waiting for you',
  description: 'Active projects not touched for a while. Shown only when there are some.',
  order: 80,
  count: ({ today }) => today.neglected.length || null,
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
