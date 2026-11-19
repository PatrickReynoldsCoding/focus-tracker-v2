import { fmtMinutes, Loading } from '../../core/ui';
import { ShareBar, dayLabel } from './charts';
import { usePref, useInsights } from './prefs';
import type { ProjectInsight, ProjectsData } from './types';

const RANGES = [4, 12, 26] as const;

function touched(p: ProjectInsight): string {
  if (!p.id) return '';
  if (!p.last_touched || p.days_since == null) return 'Never';
  if (p.days_since <= 0) return 'Today';
  if (p.days_since === 1) return 'Yesterday';
  return `${p.days_since} days ago`;
}

export function ProjectsTab() {
  const [weeks, setWeeks] = usePref<number>('project-weeks', RANGES, 4);
  const { data, error } = useInsights<ProjectsData>(`/insights/projects?weeks=${weeks}`);
  return (
    <div class="stack">
      <div class="ins-bar-row">
        <div class="seg" role="radiogroup" aria-label="Range">
          {RANGES.map((n) => (
            <button key={n} role="radio" aria-checked={weeks === n} class={weeks === n ? 'on' : ''} onClick={() => setWeeks(n)}>
              {n} weeks
            </button>
          ))}
        </div>
        {data && <span class="muted small">Since {dayLabel(data.from)}</span>}
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <p class="ins-summary">
            <strong>{data.total_sessions}</strong> {data.total_sessions === 1 ? 'session' : 'sessions'} · <strong>{fmtMinutes(data.total_minutes)}</strong>
            {data.total_skips > 0 && (
              <>
                {' '}
                · focus swapped away <strong>{data.total_skips}</strong> {data.total_skips === 1 ? 'time' : 'times'}
              </>
            )}
          </p>
          {data.projects.length === 0 ? (
            <p class="empty">No projects yet.</p>
          ) : (
            <section class="card">
              <ul class="plain ins-projects">
                {data.projects.map((p) => (
                  <li key={p.id ?? 'none'} class="ins-project">
                    <div class="ins-project-top">
                      {p.id ? <a href={`#/p/${p.id}`}>{p.name}</a> : <span>{p.name}</span>}
                      <span class="ins-nums">
                        {fmtMinutes(p.minutes)} · {Math.round(p.share * 100)}%
                      </span>
                    </div>
                    <ShareBar share={p.share} />
                    <div class="ins-project-meta small">
                      <span class="muted">{p.sessions === 1 ? '1 session' : `${p.sessions} sessions`}</span>
                      {p.id && <span class={p.stale ? 'stale' : 'muted'}>Last touched: {touched(p)}</span>}
                      {p.skips > 0 && <span class="muted">Swapped away {p.skips === 1 ? 'once' : `${p.skips} times`}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p class="muted small">Last touched in bold: nothing logged for over two weeks. Time comes from the minutes on log lines.</p>
        </>
      )}
    </div>
  );
}
