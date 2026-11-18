import { Loading, fmtDay, fmtMinutes, useData } from '../../core/ui';

type Entry = { id: string; date: string; project_id: string | null; minutes: number | null; where_stopped: string | null };

export function Log() {
  const { data, error } = useData<Entry[]>('/log?limit=200');
  const { data: projects } = useData<{ id: string; name: string }[]>('/projects?limit=2000');
  if (!data) return <Loading error={error} />;
  const name = (id: string | null) => projects?.find((p) => p.id === id)?.name ?? '';
  const days = [...new Set(data.map((e) => e.date))];
  const week = data.filter((e) => Date.parse(e.date) > Date.now() - 7 * 86400000).reduce((n, e) => n + (e.minutes ?? 0), 0);
  return (
    <div class="stack">
      <div class="page-head">
        <h1>Log</h1>
        <p class="muted">Last 7 days: {fmtMinutes(week)}</p>
      </div>
      {days.map((d) => (
        <section class="card" key={d}>
          <h2>{fmtDay(d)}</h2>
          <ul class="plain log">
            {data
              .filter((e) => e.date === d)
              .map((e) => (
                <li key={e.id}>
                  <a href={e.project_id ? `#/p/${e.project_id}` : undefined}>{name(e.project_id) || 'No project'}</a>
                  {e.minutes ? <span class="muted"> · {fmtMinutes(e.minutes)}</span> : null}
                  {e.where_stopped && <div class="small">Stopped: {e.where_stopped}</div>}
                </li>
              ))}
          </ul>
        </section>
      ))}
      {!data.length && <p class="empty">No sessions logged yet.</p>}
    </div>
  );
}

import { registerTab } from '../../core/registry';
registerTab({ id: 'log', path: '/log', label: 'Log', icon: '⏱', order: 50, render: () => <Log /> });
