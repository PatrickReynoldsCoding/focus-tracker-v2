import { useState } from 'preact/hooks';
import { change, del } from '../../core/api';
import { fmtDay, fmtMinutes, Linkify, Loading, useData } from '../../core/ui';
import { EditEntry, type Entry } from '../log/Log';
import { readPref, useInsights, writePref } from './prefs';
import type { LogLine, LogsData } from './types';

const PAGE = 100;

export function LogsTab({ project: startProject = '' }: { project?: string }) {
  // The filters are remembered on this device; a project chosen in a link wins.
  const [project, setProjectState] = useState(() => startProject || readPref('log-project') || '');
  const [from, setFromState] = useState(() => readPref('log-from') ?? '');
  const [to, setToState] = useState(() => readPref('log-to') ?? '');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Entry | null>(null);
  const { data: projects } = useData<{ id: string; name: string }[]>('/projects?limit=2000');
  const set = (name: string, setter: (v: string) => void) => (v: string) => (setter(v), writePref(name, v), setLimit(PAGE));
  const setProject = set('log-project', setProjectState);
  const setFrom = set('log-from', setFromState);
  const setTo = set('log-to', setToState);
  const q = new URLSearchParams({ limit: String(limit) });
  if (project) q.set('project', project);
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const { data, error } = useInsights<LogsData>(`/insights/logs?${q}`);
  const filtered = !!(project || from || to);
  const days = data ? [...new Set(data.rows.map((r) => r.date))] : [];
  const bad = from && to && from > to;
  return (
    <div class="stack">
      <div class="ins-filters">
        <label>
          Project
          <select value={project} onChange={(e) => setProject((e.target as HTMLSelectElement).value)}>
            <option value="">All projects</option>
            <option value="none">No project</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
        </label>
        {filtered && (
          <button
            class="ghost small"
            onClick={() => {
              setProject('');
              setFrom('');
              setTo('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {bad && <p class="error small">The start date is after the end date.</p>}
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <p class="ins-summary">
            <strong>{data.sessions}</strong> {data.sessions === 1 ? 'session' : 'sessions'} · <strong>{fmtMinutes(data.minutes)}</strong>
            {filtered ? ' in this filter' : ' in all'}
          </p>
          {days.map((d) => (
            <section class="card" key={d}>
              <h2>{fmtDay(d)}</h2>
              <ul class="plain log">
                {data.rows
                  .filter((e) => e.date === d)
                  .map((e: LogLine) => (
                    <li key={e.id} class="log-line">
                      <div class="log-text">
                        <a href={e.project_id ? `#/p/${e.project_id}` : undefined}>{e.project_name || 'No project'}</a>
                        {e.minutes ? <span class="muted"> · {fmtMinutes(e.minutes)}</span> : null}
                        {e.where_stopped && (
                          <div class="small">
                            Stopped: <Linkify text={e.where_stopped} />
                          </div>
                        )}
                      </div>
                      <span class="row tight">
                        <button class="icon small" aria-label="Edit log line" onClick={() => setEditing(e)}>
                          ✎
                        </button>
                        <button class="icon small" aria-label="Delete log line" onClick={() => change(() => del(`/log/${e.id}`), 'Log line deleted')}>
                          ✕
                        </button>
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          {!data.rows.length && <p class="empty">{filtered ? 'No log lines match these filters.' : 'No sessions logged yet.'}</p>}
          {data.has_more && (
            <button class="ghost" onClick={() => setLimit(limit + PAGE)}>
              Show older lines
            </button>
          )}
        </>
      )}
      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
