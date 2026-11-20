import { useEffect } from 'preact/hooks';
import { change, del, newId, optimistic, patch, post, put } from '../../core/api';
import { Panels, registerPanel, registerPlace, registerRoute, type ProjectPanelProps } from '../../core/registry';
import { AddInput, daysAgo, fmtDay, fmtMinutes, go, InlineEdit, Linkify, Loading, MarkdownEditor, todayLocal, useData } from '../../core/ui';
import { Board, type Column } from './Board';
import { CategorySelect } from './CategorySelect';
import { lastProject } from './last-project';

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

// A project's panels drawn away from its page (a pop-out window) load the project themselves.
registerPlace<ProjectPanelProps>({
  place: 'project',
  useProps: (id) => {
    const { data, error, setData } = useData<Full>(`/projects/${id}/full`);
    return { props: data ? { project: data, setProject: setData as ProjectPanelProps['setProject'] } : null, error };
  },
  keyOf: (p) => p.project.id,
  label: (p) => p.project.name,
});

registerRoute({ id: 'project', prefix: '/p', tab: 'projects', render: ({ params }) => <ProjectPage id={params[0]} /> });

registerPanel('project', { id: 'board', title: 'Board', description: 'The project’s cards in their columns.', alwaysShown: true, order: 10, wide: true, render: ({ project, setProject }) => <Board columns={project.columns} owner={{ project_id: project.id }} onColumns={(columns) => setProject((p) => ({ ...p, columns }))} /> });
registerPanel('project', {
  id: 'notes',
  icon: '✎',
  title: 'Notes',
  description: 'The project’s notes.',
  order: 20,
  oneCopy: ({ project }) => `note:project:${project.id}`,
  render: ({ project }) => (
    <section class="card">
      <h2>Notes</h2>
      <MarkdownEditor value={project.notes} note={{ kind: 'project', id: project.id }} placeholder="Notes for this project…" onSave={(body) => change(() => put(`/notes/of/project/${project.id}`, { body }))} />
    </section>
  ),
});
// The 'resources' panel (order 40) is registered by features/resources.
registerPanel('project', {
  id: 'sessions',
  icon: '⏱',
  title: 'Sessions',
  description: 'Recent sessions on this project and where you stopped.',
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
  icon: '≡',
  title: 'Lists',
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
  title: 'Delete project',
  order: 1000,
  wide: true,
  fixed: 'bottom',
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
