import { useState } from 'preact/hooks';
import { change, del, localStorageSet, post } from '../api';
import { AddInput, daysAgo, go, Loading, todayLocal, useData } from '../ui';

type Project = { id: string; name: string; category_id: string | null; status: string; next_action: string | null; last_touched: string | null; locked_until: string | null };
type Category = { id: string; label: string; color: string | null };
type Backlog = { id: string; title: string; category_id: string | null; note: string | null };

const STATUSES = ['active', 'paused', 'done', 'dropped'];
type SortKey = 'name' | 'category' | 'status' | 'last_touched';

function loadPrefs(): { status: string[]; sort: SortKey; dir: 1 | -1 } {
  try {
    return { status: ['active'], sort: 'last_touched', dir: 1, ...JSON.parse(localStorage.getItem('ft.projects') ?? '{}') };
  } catch {
    return { status: ['active'], sort: 'last_touched', dir: 1 };
  }
}

export function Projects() {
  const { data: projects, error } = useData<Project[]>('/projects?limit=2000');
  const { data: cats } = useData<Category[]>('/categories');
  const { data: backlog } = useData<Backlog[]>('/backlog');
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const setPrefs = (p: typeof prefs) => {
    setPrefsState(p);
    localStorageSet('ft.projects', JSON.stringify(p));
  };
  if (!projects) return <Loading error={error} />;
  const catName = (id: string | null) => cats?.find((c) => c.id === id)?.label ?? '';
  const today = todayLocal();
  const rows = projects
    .filter((p) => prefs.status.includes(p.status))
    .filter((p) => !cat || p.category_id === cat)
    .filter((p) => !q || `${p.name} ${p.next_action ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      const v = (p: Project) => (prefs.sort === 'category' ? catName(p.category_id) : String((p as any)[prefs.sort] ?? ''));
      return v(a).localeCompare(v(b)) * prefs.dir;
    });
  const sortBy = (k: SortKey) => setPrefs({ ...prefs, sort: k, dir: prefs.sort === k ? ((-prefs.dir) as 1 | -1) : 1 });
  const arrow = (k: SortKey) => (prefs.sort === k ? (prefs.dir === 1 ? ' ↑' : ' ↓') : '');

  return (
    <div class="stack">
      <div class="page-head">
        <h1>Projects</h1>
      </div>
      <div class="filters">
        <input type="search" placeholder="Search" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search projects" />
        <select value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value)} aria-label="Category">
          <option value="">All categories</option>
          {cats?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <div class="chips">
          {STATUSES.map((s) => (
            <button
              key={s}
              class={`chip ${prefs.status.includes(s) ? 'on' : ''}`}
              aria-pressed={prefs.status.includes(s)}
              onClick={() => setPrefs({ ...prefs, status: prefs.status.includes(s) ? prefs.status.filter((x) => x !== s) : [...prefs.status, s] })}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <AddInput
        placeholder="New project"
        onAdd={async (name) => {
          const p = await change(() => post<Project>('/projects', { name, category_id: cat || undefined }));
          if (p) go(`/p/${p.id}`);
        }}
      />
      <table class="table">
        <thead>
          <tr>
            <th>
              <button onClick={() => sortBy('name')}>Name{arrow('name')}</button>
            </th>
            <th class="hide-phone">
              <button onClick={() => sortBy('category')}>Category{arrow('category')}</button>
            </th>
            <th class="hide-phone">
              <button onClick={() => sortBy('status')}>Status{arrow('status')}</button>
            </th>
            <th>
              <button onClick={() => sortBy('last_touched')}>Touched{arrow('last_touched')}</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} onClick={() => go(`/p/${p.id}`)} class="click">
              <td>
                <a href={`#/p/${p.id}`}>{p.name}</a>
                {p.next_action && <div class="muted small">{p.next_action}</div>}
              </td>
              <td class="hide-phone">{catName(p.category_id)}</td>
              <td class="hide-phone">{p.status}</td>
              <td class="muted small">{daysAgo(p.last_touched, today)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p class="empty">No projects match.</p>}

      <section class="card">
        <div class="card-head">
          <h2>Backlog</h2>
          <span class="muted">{backlog?.length ?? ''}</span>
        </div>
        <ul class="plain backlog">
          {backlog?.map((b) => (
            <li key={b.id}>
              <span>{b.title}</span>
              <span class="row tight">
                <button class="ghost small" onClick={() => change(() => post(`/backlog/${b.id}/start`), `Started ${b.title}`)}>
                  Start
                </button>
                <button class="icon" aria-label={`Delete ${b.title}`} onClick={() => change(() => del(`/backlog/${b.id}`), 'Deleted')}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
        <AddInput placeholder="Add to backlog" onAdd={(title) => change(() => post('/backlog', { title }))} />
      </section>
    </div>
  );
}
