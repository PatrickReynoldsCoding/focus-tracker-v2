import { useEffect, useState } from 'preact/hooks';
import { change, del, newId, optimistic, patch, post, put } from '../../core/api';
import { Panels, registerPanel, registerRoute, type ProjectPanelProps } from '../../core/registry';
import { AddInput, daysAgo, fmtDay, fmtMinutes, go, InlineEdit, Linkify, Loading, MarkdownEditor, todayLocal, useData } from '../../core/ui';
import { Board, type Column } from './Board';
import { CategorySelect } from './CategorySelect';
import { lastProject } from './last-project';

type Criterion = { id: string; text: string; done: boolean };
type Resource = { id: string; title: string; type: string; value: string; grp: string | null; note: string | null };
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
  resources: Resource[];
  notes: string;
  lists: { id: string; name: string; kind: string }[];
  recent_log: LogEntry[];
};

function href(r: Resource): string | undefined {
  if (r.type === 'link' || r.type === 'drive') return /^https?:\/\//.test(r.value) ? r.value : undefined;
  if (r.type === 'email') return `mailto:${r.value}`;
  if (r.type === 'phone') return `tel:${r.value}`;
  return undefined;
}

function Resources({ p }: { p: Full }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  return (
    <section class="card">
      <div class="card-head">
        <h2>Resources</h2>
        <button class="ghost small" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : '+ Add'}
        </button>
      </div>
      <ul class="plain resources">
        {p.resources.map((r) => (
          <li key={r.id}>
            {href(r) ? (
              <a href={href(r)} target="_blank" rel="noopener noreferrer">
                {r.title}
              </a>
            ) : (
              <span>
                {r.title}: {r.value}
              </span>
            )}
            {r.grp && <span class="tag">{r.grp}</span>}
            <button class="icon small" aria-label="Delete" onClick={() => change(() => del(`/resources/${r.id}`), 'Removed')}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {adding && (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const v = value.trim();
            const type = /^https?:\/\//.test(v) ? 'link' : /^[^@\s]+@[^@\s]+$/.test(v) ? 'email' : /^[+\d][\d\s-]{5,}$/.test(v) ? 'phone' : 'text';
            change(() => post('/resources', { project_id: p.id, title: title.trim() || v, value: v, type }));
            setTitle('');
            setValue('');
            setAdding(false);
          }}
        >
          <input placeholder="Title" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
          <input placeholder="Link, email, phone or text" required value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
          <p class="muted small">Never add bank details, passwords or ID numbers.</p>
          <button class="primary">Add</button>
        </form>
      )}
    </section>
  );
}

export function ProjectPage({ id }: { id: string }) {
  const { data: p, error, setData } = useData<Full>(`/projects/${id}/full`);
  const { data: cats } = useData<{ id: string; label: string }[]>('/categories');
  useEffect(() => {
    if (p) lastProject.set(id);
    else if (error) lastProject.clear(id);
  }, [id, !!p, error]);
  if (!p) return <Loading error={error} />;
  const save = (fields: Partial<Full>) => {
    setData((d) => ({ ...d, ...fields }));
    change(() => patch(`/projects/${p.id}`, fields));
  };
  const today = todayLocal();
  return (
    <div class="stack project">
      <div class="page-head">
        <a href="#/projects" class="muted back" onClick={() => lastProject.clear()}>
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
          <CategorySelect value={p.category_id ?? null} cats={cats} onPick={(category_id) => save({ category_id })} />
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
      <MarkdownEditor value={project.notes} note={{ kind: 'project', id: project.id }} placeholder="Notes for this project…" onSave={(body) => change(() => put(`/notes/of/project/${project.id}`, { body }))} />
    </section>
  ),
});
registerPanel('project', { id: 'resources', order: 40, render: ({ project }) => <Resources p={project} /> });
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
              {l.where_stopped && (
                <div class="small">
                  <Linkify text={l.where_stopped} />
                </div>
              )}
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
          lastProject.clear(project.id);
          go('/projects');
        }}
      >
        Delete project
      </button>
    </div>
  ),
});
