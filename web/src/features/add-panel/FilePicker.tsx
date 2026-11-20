// Add file: a small Files tab in a dialog (GET /api/files). Recent files first, then the folders
// and files of the folder on screen, with a path to go back up, a search and type chips; files
// show with their registered icons (registerFileType). Choosing one adds it (PanelAdderTarget.files);
// + New makes a note, list, to-do list or whiteboard in the folder on screen and adds it.

import { useEffect, useRef, useState } from 'preact/hooks';
import { get } from '../../core/api';
import { useFileTypes, type FileItem, type FileTypeDef, type PanelAdderTarget } from '../../core/registry';
import { Loading } from '../../core/ui';
import { FolderIcon } from '../files/icons';

type Folder = {
  id: string;
  name: string;
  project_id: string | null;
  status?: string | null;
  location?: string | null;
};
type Crumb = { id: string; name: string };
type Listing = { path: Crumb[]; folders: Folder[]; files: FileItem[] };
type Files = NonNullable<PanelAdderTarget['files']>;

const FINISHED = ['done', 'dropped'];
const RECENT = 6;

/** "14:05" today, "3 Nov" this year, "3 Nov 2025" before. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function FilePicker({ files, onBack, onClose }: { place: string; files: Files; onBack: () => void; onClose: () => void }) {
  const types = useFileTypes().filter(files.accepts);
  const typeOf = new Map(types.map((t) => [t.type, t]));
  const typeIds = types.map((t) => t.type).join(',');
  const groups = [...new Map(types.map((t) => [t.group.id, t.group])).values()].sort((a, b) => a.order - b.order);
  const makers = types.flatMap((t) => (t.create ?? []).filter((c) => c.make).map((c) => ({ c, t })));

  const [folder, setFolder] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [list, setList] = useState<Listing | null>(null);
  const [recent, setRecent] = useState<FileItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  // A search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const deep = !!query || !!group;
  useEffect(() => {
    let live = true;
    setError(null);
    const p = new URLSearchParams({
      folder: folder ?? 'root',
      sort: 'changed',
    });
    if (query) p.set('q', query);
    if (deep) p.set('type', group || typeIds);
    get<Listing>(`/files?${p}`)
      .then((d) => live && setList(d))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [folder, query, group, typeIds]);
  useEffect(() => {
    if (!typeIds) return;
    get<Listing>(`/files?type=${encodeURIComponent(typeIds)}&sort=changed&limit=${RECENT}`)
      .then((d) => setRecent(d.files))
      .catch(() => setRecent([]));
  }, [typeIds]);
  useEffect(() => {
    // The keyboard starts in the search on a computer (on a phone it would open the keyboard).
    if (matchMedia('(pointer: fine)').matches) search.current?.focus();
  }, []);

  const choose = async (f: FileItem, t: FileTypeDef) => {
    if (busy) return;
    setBusy(true);
    onClose();
    await files.add(f, t.panel?.(f) ?? null);
  };
  const make = async (e: Event) => {
    e.preventDefault();
    const m = makers.find((x) => x.c.id === making);
    if (!m || !name.trim() || busy) return;
    setBusy(true);
    const f = await m.c.make!(name.trim(), folder);
    if (!f) return setBusy(false);
    onClose();
    await files.add(f, m.t.panel?.(f) ?? null);
  };

  const fileRow = (f: FileItem, key: string) => {
    const t = typeOf.get(f.type);
    if (!t) return null;
    const panel = t.panel?.(f) ?? null;
    const here = files.has(f, panel);
    const sub = [t.detail?.(f) ?? t.label, f.location ?? null, when(f.updated_at)].filter(Boolean).join(' · ');
    return (
      <li key={key}>
        <button class="ap-row" disabled={here || busy} onClick={() => choose(f, t)} aria-label={here ? `${f.name}, here already` : `Add ${f.name}`}>
          {t.icon(f, 28)}
          <span class="ap-text">
            <strong>{f.name}</strong>
            <span class="muted small">{sub}</span>
          </span>
          <span class="ap-go small">{here ? '✓ Here' : 'Add'}</span>
        </button>
      </li>
    );
  };

  const folders = (list?.folders ?? []).filter((f) => !(folder === null && !deep && f.project_id && FINISHED.includes(f.status ?? '')));
  const shown = (list?.files ?? []).filter((f) => typeOf.has(f.type));
  const top = !folder && !deep;

  return (
    <div class="ap ap-picker">
      <div class="ap-head">
        <button class="ghost small" onClick={onBack}>
          ← Panels
        </button>
        <span class="muted small">{files.hint}</span>
      </div>
      <div class="ap-bar">
        <input ref={search} type="search" class="files-search" placeholder="Search files" aria-label="Search files" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        {makers.length > 0 && (
          <button class={`small ${making ? '' : 'primary'}`} aria-expanded={!!making} onClick={() => setMaking(making ? null : makers[0].c.id)}>
            + New
          </button>
        )}
      </div>
      {making && (
        <form class="ap-new card" onSubmit={make}>
          <div class="chips" role="radiogroup" aria-label="What to make">
            {makers.map(({ c }) => (
              <button type="button" key={c.id} role="radio" aria-checked={making === c.id} class={`chip ${making === c.id ? 'on' : ''}`} onClick={() => setMaking(c.id)}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>
          <div class="ap-bar">
            <input placeholder="Name" aria-label="Name" value={name} maxLength={200} autoFocus onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            <button class="primary small" disabled={!name.trim() || busy}>
              Make and add
            </button>
          </div>
          <p class="muted small">{list?.path.length ? `In ${list.path.map((c) => c.name).join(' › ')}.` : 'At the top of Files.'}</p>
        </form>
      )}
      {groups.length > 1 && (
        <div class="chips ap-chips" role="radiogroup" aria-label="Type">
          {[{ id: '', label: 'All' }, ...groups].map((g) => (
            <button key={g.id} role="radio" aria-checked={group === g.id} class={`chip ${group === g.id ? 'on' : ''}`} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
      )}
      {folder && (
        <nav class="files-crumbs ap-crumbs" aria-label="Folder">
          <button class="crumb" disabled={!folder} onClick={() => setFolder(null)}>
            Files
          </button>
          {(list?.path ?? []).map((c, i, all) => (
            <span key={c.id} class="crumb-wrap">
              <span class="crumb-sep">›</span>
              <button class="crumb" disabled={i === all.length - 1} onClick={() => setFolder(c.id)}>
                {c.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      {top && recent && recent.length > 0 && (
        <section>
          <h3 class="files-sec">Recent</h3>
          <ul class="ap-list">{recent.map((f) => fileRow(f, `r-${f.type}-${f.id}`))}</ul>
        </section>
      )}
      {!list ? (
        <Loading error={error} />
      ) : (
        <section>
          {top && <h3 class="files-sec">All files</h3>}
          <ul class="ap-list">
            {folders.map((f) => (
              <li key={`f-${f.id}`}>
                <button class="ap-row" onClick={() => (setFolder(f.id), setQ(''), setQuery(''), setGroup(''))}>
                  <FolderIcon project={!!f.project_id} size={28} />
                  <span class="ap-text">
                    <strong>{f.name}</strong>
                    <span class="muted small">{[f.project_id ? 'Project folder' : 'Folder', f.location].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span class="ap-go" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
            {shown.map((f) => fileRow(f, `${f.type}-${f.id}`))}
          </ul>
          {!folders.length && !shown.length && <p class="muted">{deep ? 'Nothing found.' : 'This folder is empty.'}</p>}
        </section>
      )}
    </div>
  );
}
