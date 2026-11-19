import { change, del, newId, optimistic, patch, post, put } from '../../core/api';
import { Panels, registerPanel, registerRoute, type ProjectPanelProps } from '../../core/registry';
import { AddInput, daysAgo, fmtDay, fmtMinutes, go, InlineEdit, Loading, MarkdownEditor, todayLocal, useData } from '../../core/ui';
import { Board, type Column } from './Board';

type Criterion = { id: string; text: string; done: boolean };
type LogEntry = { id: string; date: string; minutes: number | null; where_stopped: string | null };
type Full = {
  id: string;
  name: string;
  status: string;
  category_id: string | null;
  last_touched: string | null;
  locked_until: string | null;
  columns: Column[];
  criteria: Criterion[];
  resources: unknown[];
  notes: string;
  lists: { id: string; name: string; kind: string }[];
  recent_log: LogEntry[];
};

function Criteria({ p, setData }: { p: Full; setData: (fn: (d: Full) => Full) => void }) {
  const done = p.criteria.filter((c) => c.done).length;
  return (
    <section class="card">
      <div class="card-head">
        <h2>Done when</h2>
        <span class="muted">
          {done}/{p.criteria.length}
        </span>
      </div>
      <ul class="checks">
        {p.criteria.map((c) => (
          <li key={c.id} class={c.done ? 'done' : ''}>
            <label>
              <input
                type="checkbox"
                checked={c.done}
                onChange={() =>
                  optimistic(
                    () => {
                      setData((d) => ({ ...d, criteria: d.criteria.map((x) => (x.id === c.id ? { ...x, done: !c.done } : x)) }));
                      return () => setData((d) => ({ ...d, criteria: d.criteria.map((x) => (x.id === c.id ? c : x)) }));
                    },
                    () => patch(`/criteria/${c.id}`, { done: !c.done }),
                  )
                }
              />
              <span>{c.text}</span>
            </label>
            <button class="icon small" aria-label="Delete" onClick={() => change(() => del(`/criteria/${c.id}`))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <AddInput
        placeholder="Add a done criterion"
        onAdd={(text) => {
          const id = newId();
          optimistic(
            () => {
              setData((d) => ({ ...d, criteria: [...d.criteria, { id, text, done: false }] }));
              return () => setData((d) => ({ ...d, criteria: d.criteria.filter((x) => x.id !== id) }));
            },
            () => post('/criteria', { id, project_id: p.id, text }),
          );
        }}
      />
    </section>
  );
}

export function ProjectPage({ id }: { id: string }) {
  const { data: p, error, setData } = useData<Full>(`/projects/${id}/full`);
  const { data: cats } = useData<{ id: string; label: string }[]>('/categories');
  if (!p) return <Loading error={error} />;
  const save = (fields: Partial<Full>) => {
    setData((d) => ({ ...d, ...fields }));
    change(() => patch(`/projects/${p.id}`, fields));
  };
  const today = todayLocal();
  return (
    <div class="stack project">
      <div class="page-head">
        <a href="#/projects" class="muted back">
          ← Projects
        </a>
        <h1>
          <InlineEdit value={p.name} onSave={(name) => name && save({ name })} />
        </h1>
        <div class="meta">
          <select value={p.status} onChange={(e) => save({ status: (e.target as HTMLSelectElement).value })} aria-label="Status">
            {['active', 'paused', 'done', 'dropped'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={p.category_id ?? ''} onChange={(e) => save({ category_id: (e.target as HTMLSelectElement).value || null })} aria-label="Category">
            <option value="">No category</option>
            {cats?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span class="muted small">touched {daysAgo(p.last_touched, today)}</span>
          <button class="ghost small" onClick={() => change(() => put('/focus', { project_id: p.id }), `Focus: ${p.name}`)}>
            ◎ Focus today
          </button>
        </div>
      </div>
      <Panels<ProjectPanelProps> place="project" props={{ project: p, setProject: setData }} />
    </div>
  );
}

registerRoute({ id: 'project', prefix: '/p', tab: 'projects', render: ({ params }) => <ProjectPage id={params[0]} /> });

registerPanel('project', { id: 'board', order: 10, wide: true, render: ({ project }) => <Board columns={project.columns} owner={{ project_id: project.id }} /> });
registerPanel('project', {
  id: 'notes',
  order: 20,
  render: ({ project }) => (
    <section class="card">
      <h2>Notes</h2>
      <MarkdownEditor value={project.notes} placeholder="Notes for this project (Markdown)…" onSave={(body) => change(() => put(`/notes/of/project/${project.id}`, { body }))} />
    </section>
  ),
});
registerPanel('project', { id: 'criteria', order: 30, render: ({ project, setProject }) => <Criteria p={project} setData={setProject} /> });
// The 'resources' panel (order 40) is registered by features/resources.
registerPanel('project', {
  id: 'sessions',
  order: 50,
  render: ({ project }) => (
    <section class="card">
      <h2>Sessions</h2>
      {project.recent_log.length ? (
        <ul class="plain log">
          {project.recent_log.map((l: LogEntry) => (
            <li key={l.id}>
              <strong>{fmtDay(l.date)}</strong> {l.minutes ? <span class="muted">{fmtMinutes(l.minutes)}</span> : null}
              {l.where_stopped && <div class="small">{l.where_stopped}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">No sessions yet.</p>
      )}
    </section>
  ),
});
registerPanel('project', {
  id: 'lists',
  order: 60,
  render: ({ project }) =>
    project.lists.length ? (
      <section class="card">
        <h2>Lists</h2>
        <div class="chips">
          {project.lists.map((l: { id: string; name: string }) => (
            <a key={l.id} class="chip" href={`#/n/${l.id}`}>
              {l.name}
            </a>
          ))}
        </div>
      </section>
    ) : null,
});
registerPanel('project', {
  id: 'delete',
  order: 1000,
  wide: true,
  render: ({ project }) => (
    <div class="row">
      <button
        class="danger ghost"
        onClick={async () => {
          if (!confirm(`Delete ${project.name} with its board, notes and criteria? Undo brings it back.`)) return;
          await change(() => del(`/projects/${project.id}`), 'Project deleted');
          go('/projects');
        }}
      >
        Delete project
      </button>
    </div>
  ),
});
