// The Files tab, like Google Drive: a folder's folders and files as a grid or a list, a path to
// go back up, type filters, a search that looks in the folder and everything inside it, sorting,
// a New menu, and Rename / Move… / Delete on every item (drag onto a folder with a mouse).
// Kinds of files come from the features (registerFileType in core/registry.tsx). The top level
// shows Projects › category › project folders (D52), virtual folders worked out by the server.
import type { VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { del, get, newId, optimistic, patch, post, say } from '../../core/api';
import { FileChips, ProjectLabel, useFileAddons, useFileTypes, type FileAddonDef, type FileItem, type FileTypeDef } from '../../core/registry';
import { go, Loading, Markdown, useData } from '../../core/ui';
import { DeleteFolderDialog, MoveDialog, NameDialog, type Count } from './dialogs';
import { FolderIcon } from './icons';
import { Menu, MenuItem } from '../../core/menu';
import { canDrag, canMoveInto, changed, DRAG_TYPE, entryKey, entryName, entryRef, FINISHED, folderHref, isPhone, movingOf, usePref, virtualSub, type Entry, type Folder, type Listing } from './model';
import './files.css';

type Dlg =
  | { kind: 'new-folder' }
  | { kind: 'create'; id: string }
  | { kind: 'rename'; entry: Entry }
  | { kind: 'move'; entry: Entry }
  | { kind: 'delete-folder'; folder: Folder; count: Count }
  | { kind: 'addon'; id: string; file: FileItem };

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function FilesPage({ route, params }: { route: string; params: string[] }) {
  const query = new URLSearchParams(route.split('?')[1] ?? '');
  const typeInUrl = query.get('type') ?? '';
  // Filters other features add (tags): each is a query parameter of GET /api/files.
  const addons = useFileAddons();
  const filterAddons = addons.filter((a) => a.filter);
  const extraInUrl = () => Object.fromEntries(filterAddons.map((a) => [a.filter!.param, query.get(a.filter!.param) ?? '']));
  const extraKey = filterAddons.map((a) => query.get(a.filter!.param) ?? '').join('|');
  const folderParam = params[0] && params[0] !== 'p' ? params[0] : null;
  const projectParam = params[0] === 'p' ? (params[1] ?? null) : null;
  const types = useFileTypes();
  const [group, setGroup] = useState(typeInUrl);
  const [q, setQ] = useState('');
  const [extra, setExtra] = useState<Record<string, string>>(extraInUrl);
  // A new folder (or an address with ?type= or ?tag=) starts with its own filters and no search.
  useEffect(() => {
    setGroup(typeInUrl);
    setExtra(extraInUrl());
    setQ('');
  }, [folderParam, projectParam, typeInUrl, extraKey]);
  const dq = useDebounced(q.trim(), 250);
  const [sort, setSort] = usePref<'name' | 'changed'>('ft.files.sort', 'name');
  const [view, setView] = usePref<'grid' | 'list'>('ft.files.view', isPhone() ? 'list' : 'grid');
  const [finished, setFinished] = usePref<'0' | '1'>('ft.files.finished', '0');
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; entry: Entry | null } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  const groups = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; order: number }>();
    for (const t of types) if (!seen.has(t.group.id)) seen.set(t.group.id, t.group);
    return [...seen.values()].sort((a, b) => a.order - b.order);
  }, [types]);
  const typeOf = (f: FileItem): FileTypeDef | undefined => types.find((t) => t.type === f.type);

  const qs = new URLSearchParams();
  if (folderParam) qs.set('folder', folderParam);
  if (projectParam) qs.set('project', projectParam);
  if (group) qs.set('type', group);
  if (dq) qs.set('q', dq);
  const extraOn = filterAddons.filter((a) => extra[a.filter!.param]);
  for (const a of extraOn) qs.set(a.filter!.param, extra[a.filter!.param]);
  qs.set('sort', sort);
  const { data, error, setData } = useData<Listing>(`/files?${qs}`);

  if (!data) return <Loading error={error} />;
  const here = data.folder;
  const hereId = here?.id ?? null;
  const parentOfHere = data.path.length > 1 ? data.path[data.path.length - 2] : null;
  // Inside a project's folder its files need no label saying so.
  const inProject = data.path.find((c) => c.project_id)?.project_id ?? null;
  const label = (f: FileItem) => (f.project_id && f.project_id !== inProject && f.type !== 'project-note' ? <ProjectLabel projectId={f.project_id} /> : null);
  const deep = !!dq || !!group || extraOn.length > 0;
  const known = data.files.filter((f) => typeOf(f));
  // Finished projects' folders (in their category's folder) wait behind "Show n finished projects".
  const hiddenFinished = !deep && finished !== '1' ? data.folders.filter((f) => f.project_id && f.status && FINISHED.includes(f.status)) : [];
  const virtualHere = here?.virtual ?? null;
  const folders = data.folders.filter((f) => !hiddenFinished.includes(f));
  const drag = canDrag();

  // ---------- changes ----------

  const without = (keys: string[]) => (d: Listing): Listing => ({
    ...d,
    folders: d.folders.filter((f) => !keys.includes(`folder:${f.id}`)),
    files: d.files.filter((f) => !keys.includes(`${f.type}:${f.id}`)),
  });
  const snapshot = () => {
    const before = data;
    return () => setData(() => before);
  };

  const move = (entries: Entry[], to: { id: string | null; name: string; virtual?: 'projects' | 'category' }) => {
    const items = entries.map(entryRef).filter((r) => !(r.type === 'folder' && r.id === to.id));
    if (entries.some((e) => !canMoveInto(movingOf(e), to.id ? to : null))) return;
    if (!items.length) return;
    const keys = entries.map(entryKey);
    optimistic(
      () => {
        const back = snapshot();
        setData(without(keys));
        return back;
      },
      () => post('/files/move', { items, folder_id: to.id }),
      entries.some((e) => movingOf(e) === 'project-folder') && to.virtual === 'category' ? `Moved to ${to.name}: the project’s category is ${to.name === 'No category' ? 'cleared' : to.name}` : `Moved to ${to.name}`,
    );
  };

  const rename = (entry: Entry, name: string) => {
    const back = snapshot();
    if (entry.kind === 'folder') {
      optimistic(
        () => (setData((d) => ({ ...d, folders: d.folders.map((f) => (f.id === entry.folder.id ? { ...f, name } : f)) })), back),
        () => patch(`/folders/${entry.folder.id}`, { name }),
        entry.folder.project_id ? 'Project renamed' : entry.folder.virtual === 'category' ? 'Category renamed' : undefined,
      );
      return;
    }
    const t = typeOf(entry.file);
    if (!t?.rename) return;
    optimistic(
      () => (setData((d) => ({ ...d, files: d.files.map((f) => (f.type === entry.file.type && f.id === entry.file.id ? { ...f, name } : f)) })), back),
      () => t.rename!(entry.file, name),
    );
  };

  const removeFile = (f: FileItem) => {
    const t = typeOf(f);
    if (!t?.remove) return;
    optimistic(
      () => {
        const back = snapshot();
        setData(without([`${f.type}:${f.id}`]));
        return back;
      },
      () => t.remove!(f),
      `Deleted ${f.name}`,
    );
  };

  const deleteFolder = (folder: Folder, contents: 'move' | 'delete') =>
    optimistic(
      () => {
        const back = snapshot();
        setData(without([`folder:${folder.id}`]));
        return back;
      },
      () => del(`/folders/${folder.id}${contents === 'delete' ? '?contents=delete' : ''}`),
      `Deleted ${folder.name}`,
    );

  const askDeleteFolder = async (folder: Folder) => {
    let count: Count;
    try {
      count = await get<Count>(`/folders/${folder.id}/count`);
    } catch (e) {
      say((e as Error).message, 'error');
      return;
    }
    if (!count.files && !count.folders) deleteFolder(folder, 'move');
    else setDlg({ kind: 'delete-folder', folder, count });
  };

  const newFolder = (name: string) => {
    const id = newId();
    optimistic(
      () => {
        const back = snapshot();
        const now = new Date().toISOString();
        setData((d) => ({ ...d, folders: [...d.folders, { id, name, parent_id: hereId, project_id: null, created: now, updated_at: now }] }));
        return back;
      },
      () => post('/folders', { id, name, parent_id: hereId }),
    );
  };

  // ---------- drag and drop (mouse) ----------

  const dragProps = (e: Entry) =>
    drag && !(e.kind === 'folder' && e.folder.virtual)
      ? {
          draggable: true,
          onDragStart: (ev: DragEvent) => {
            ev.dataTransfer?.setData(DRAG_TYPE, JSON.stringify({ key: entryKey(e) }));
            if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
            dragging = e;
          },
          onDragEnd: () => {
            dragging = null;
            setDropOn(null);
          },
        }
      : {};
  const dropProps = (target: { id: string | null; name: string; virtual?: 'projects' | 'category' }, key: string) =>
    drag
      ? {
          onDragOver: (ev: DragEvent) => {
            if (!dragging || !ev.dataTransfer?.types.includes(DRAG_TYPE)) return;
            if (dragging.kind === 'folder' && dragging.folder.id === target.id) return;
            if (!canMoveInto(movingOf(dragging), target.id ? target : null)) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'move';
            if (dropOn !== key) setDropOn(key);
          },
          onDragLeave: () => dropOn === key && setDropOn(null),
          onDrop: (ev: DragEvent) => {
            ev.preventDefault();
            setDropOn(null);
            const e = dragging;
            dragging = null;
            if (e) move([e], target);
          },
        }
      : {};

  // ---------- pieces ----------

  const openFile = (f: FileItem) => (ev: MouseEvent) => {
    const t = typeOf(f);
    if (!t?.open || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
    ev.preventDefault();
    t.open(f);
  };
  const more = (entry: Entry) => (
    <button
      class="icon small files-more"
      aria-label={`Options for ${entryName(entry)}`}
      aria-haspopup="menu"
      onClick={(ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setMenu({ anchor: ev.currentTarget as HTMLElement, entry });
      }}
    >
      ⋯
    </button>
  );
  const sub = (f: FileItem): string => {
    const t = typeOf(f);
    const parts = [deep && f.location ? f.location : deep ? 'Files' : null, t?.detail?.(f), changed(f.updated_at)].filter(Boolean);
    return parts.join(' · ');
  };
  const folderSub = (f: Folder) =>
    [deep ? (f.location ?? 'Files') : null, f.virtual ? virtualSub(f) : null, f.project_id ? (f.status && f.status !== 'active' ? `Project · ${f.status}` : 'Project') : null].filter(Boolean).join(' · ');
  const icon = (f: Folder, size?: number) => <FolderIcon project={!!f.project_id} virtual={f.virtual} color={f.color} size={size} />;

  const folderTile = (f: Folder) => {
    const e: Entry = { kind: 'folder', folder: f };
    const key = entryKey(e);
    return (
      <li key={f.id} class={`folder-tile ${dropOn === key ? 'drop-on' : ''} ${f.status && FINISHED.includes(f.status) ? 'is-finished' : ''}`} {...dragProps(e)} {...dropProps(f, key)}>
        <a class="files-open" href={folderHref(f.id)} draggable={false}>
          {icon(f)}
          <span class="files-text">
            <span class="files-name">{f.name}</span>
            {folderSub(f) && <span class="files-sub">{folderSub(f)}</span>}
          </span>
        </a>
        {more(e)}
      </li>
    );
  };

  const fileIcon = (f: FileItem, size = 24): VNode | null => typeOf(f)?.icon(f, size) ?? null;
  const fileCard = (f: FileItem) => {
    const t = typeOf(f)!;
    const e: Entry = { kind: 'file', file: f };
    const preview = t.preview?.(f) ?? (f.preview ? <Markdown text={f.preview} blankLines class="file-text-preview" /> : null);
    return (
      <li key={entryKey(e)} class="file-card" {...dragProps(e)}>
        <a class="files-open" href={t.href(f)} draggable={false} onClick={openFile(f)} {...(t.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          <span class="file-thumb">{preview ?? <span class="file-big-icon">{fileIcon(f, 44)}</span>}</span>
          <span class="file-meta">
            {fileIcon(f)}
            <span class="files-text">
              <span class="files-name">{f.name}</span>
              <span class="files-sub">{sub(f)}</span>
            </span>
          </span>
        </a>
        <span class="file-labels">
          {label(f)}
          <FileChips file={f} />
        </span>
        {more(e)}
      </li>
    );
  };
  const fileRow = (f: FileItem) => {
    const t = typeOf(f)!;
    const e: Entry = { kind: 'file', file: f };
    return (
      <li key={entryKey(e)} class="file-row" {...dragProps(e)}>
        <a class="files-open" href={t.href(f)} draggable={false} onClick={openFile(f)} {...(t.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {fileIcon(f)}
          <span class="files-text">
            <span class="files-name">{f.name}</span>
            <span class="files-sub">{sub(f)}</span>
          </span>
        </a>
        <span class="file-labels">
          {label(f)}
          <FileChips file={f} />
        </span>
        {more(e)}
      </li>
    );
  };
  const folderRow = (f: Folder) => {
    const e: Entry = { kind: 'folder', folder: f };
    const key = entryKey(e);
    return (
      <li key={key} class={`file-row ${dropOn === key ? 'drop-on' : ''}`} {...dragProps(e)} {...dropProps(f, key)}>
        <a class="files-open" href={folderHref(f.id)} draggable={false}>
          {icon(f)}
          <span class="files-text">
            <span class="files-name">{f.name}</span>
            <span class="files-sub">{[folderSub(f), f.updated_at ? changed(f.updated_at) : null].filter(Boolean).join(' · ')}</span>
          </span>
        </a>
        {more(e)}
      </li>
    );
  };

  const creates = types.flatMap((t) => t.create ?? []).sort((a, b) => a.order - b.order);
  const making = dlg?.kind === 'create' ? creates.find((c) => c.id === dlg.id) : null;
  const where = here ? here.name : 'Files';
  const empty = !folders.length && !known.length;

  return (
    <div class="stack files" data-view={view}>
      <div class="page-head row files-head">
        <h1>Files</h1>
        {!virtualHere && (
          <button class="primary" aria-haspopup="menu" onClick={(ev) => setMenu({ anchor: ev.currentTarget as HTMLElement, entry: null })}>
            + New
          </button>
        )}
      </div>
      <input type="search" class="files-search" placeholder={hereId ? `Search in ${where}` : 'Search files'} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label={hereId ? `Search in ${where}` : 'Search files'} />
      {hereId && (
        <nav class="files-crumbs" aria-label="Folder path">
          <a href="#/files" class={`crumb ${dropOn === 'crumb:root' ? 'drop-on' : ''}`} {...dropProps({ id: null, name: 'Files' }, 'crumb:root')}>
            Files
          </a>
          {data.path.map((c, i) => {
            const last = i === data.path.length - 1;
            return (
              <span key={c.id} class="crumb-wrap">
                <span class="crumb-sep" aria-hidden="true">
                  ›
                </span>
                <a href={folderHref(c.id)} class={`crumb ${dropOn === `crumb:${c.id}` ? 'drop-on' : ''}`} aria-current={last ? 'page' : undefined} {...(!last ? dropProps(c, `crumb:${c.id}`) : {})}>
                  {c.name}
                </a>
              </span>
            );
          })}
          {here && here.virtual !== 'projects' && (
            <button class="icon small files-more" aria-label={`Options for ${here.name}`} aria-haspopup="menu" onClick={(ev) => setMenu({ anchor: ev.currentTarget as HTMLElement, entry: { kind: 'folder', folder: here } })}>
              ⋯
            </button>
          )}
        </nav>
      )}
      {virtualHere && (
        <p class="muted small files-virtual-note">
          {virtualHere === 'projects'
            ? 'A folder for each category, made from your categories (Projects tab → Manage categories), and No category.'
            : `The folders of the projects in ${here!.name === 'No category' ? 'no category' : `the category ${here!.name}`}. Move a project’s folder into another category’s folder to change its category.`}
        </p>
      )}
      {here?.project_id && (
        <p class="muted small files-project-note">
          This is the project’s folder: what is in it shows on the project’s page too. <a href={`#/p/${here.project_id}`}>Open the project</a>
        </p>
      )}
      <div class="files-tools">
        <div class="chips files-chips" role="group" aria-label="Type">
          {[{ id: '', label: 'All' }, ...groups].map((g) => (
            <button key={g.id} class={`chip ${group === g.id ? 'on' : ''}`} aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <div class="files-view">
          <select value={sort} aria-label="Sort by" onChange={(e) => setSort((e.target as HTMLSelectElement).value as 'name' | 'changed')}>
            <option value="name">Name</option>
            <option value="changed">Last changed</option>
          </select>
          <button class="icon files-view-toggle" aria-label={view === 'grid' ? 'Show as a list' : 'Show as a grid'} title={view === 'grid' ? 'List view' : 'Grid view'} onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>
            {view === 'grid' ? '☰' : '▦'}
          </button>
        </div>
      </div>
      {filterAddons.map((a) => {
        const F = a.filter!.component;
        const param = a.filter!.param;
        return <F key={a.id} value={extra[param] ?? ''} onChange={(v) => setExtra((x) => ({ ...x, [param]: v }))} />;
      })}

      {view === 'grid' ? (
        <>
          {folders.length > 0 && (
            <section class="files-section">
              <h2 class="files-sec">Folders</h2>
              <ul class="folder-grid">{folders.map(folderTile)}</ul>
            </section>
          )}
          {known.length > 0 && (
            <section class="files-section">
              <h2 class="files-sec">{deep ? `${known.length}${data.more ? '+' : ''} found` : 'Files'}</h2>
              <ul class="file-grid">{known.map(fileCard)}</ul>
            </section>
          )}
        </>
      ) : (
        !empty && (
          <ul class="file-list">
            {folders.map(folderRow)}
            {known.map(fileRow)}
          </ul>
        )
      )}
      {hiddenFinished.length > 0 && (
        <button class="ghost small files-finished" onClick={() => setFinished('1')}>
          Show {hiddenFinished.length} finished project{hiddenFinished.length === 1 ? '' : 's'}
        </button>
      )}
      {!deep && finished === '1' && data.folders.some((f) => f.project_id && f.status && FINISHED.includes(f.status)) && (
        <button class="ghost small files-finished" onClick={() => setFinished('0')}>
          Hide finished projects
        </button>
      )}
      {empty && <p class="empty">{dq ? `Nothing matches “${dq}”.` : extraOn.length ? 'No files with these tags here.' : group ? 'Nothing of this type here.' : virtualHere ? (hiddenFinished.length ? 'Only finished projects here.' : 'No projects in this category yet.') : hereId ? 'This folder is empty. Use New to add something.' : 'Nothing here yet. Use New to make a folder, note, list or whiteboard.'}</p>}

      {menu && !menu.entry && (
        <Menu anchor={menu.anchor} label="New" onClose={() => setMenu(null)}>
          <MenuItem icon={<FolderIcon size={20} />} onClick={() => setDlg({ kind: 'new-folder' })}>
            Folder
          </MenuItem>
          <div class="files-menu-line" role="separator" />
          {creates.map((c) => (
            <MenuItem key={c.id} icon={c.icon} onClick={() => setDlg({ kind: 'create', id: c.id })}>
              {c.label}
            </MenuItem>
          ))}
        </Menu>
      )}
      {menu?.entry && (
        <ItemMenu
          entry={menu.entry}
          anchor={menu.anchor}
          type={menu.entry.kind === 'file' ? typeOf(menu.entry.file) : undefined}
          onClose={() => setMenu(null)}
          onRename={(e) => setDlg({ kind: 'rename', entry: e })}
          onMove={(e) => setDlg({ kind: 'move', entry: e })}
          onDelete={(e) => (e.kind === 'folder' ? askDeleteFolder(e.folder) : removeFile(e.file))}
          addons={addons}
          onAddon={(id, file) => setDlg({ kind: 'addon', id, file })}
        />
      )}

      {dlg?.kind === 'addon' &&
        (() => {
          const D = addons.find((a) => a.id === dlg.id)?.menu?.dialog;
          const { file } = dlg;
          return D ? <D file={file} onClose={() => setDlg(null)} onSaved={(p) => setData((d) => ({ ...d, files: d.files.map((f) => (f.type === file.type && f.id === file.id ? { ...f, ...p } : f)) }))} /> : null;
        })()}
      {dlg?.kind === 'new-folder' && <NameDialog title={`New folder in ${where}`} action="Make folder" onSave={newFolder} onClose={() => setDlg(null)} />}
      {making && <making.dialog folderId={hereId} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'rename' && (
        <NameDialog
          title={dlg.entry.kind === 'folder' && dlg.entry.folder.project_id ? 'Rename project' : dlg.entry.kind === 'folder' && dlg.entry.folder.virtual ? 'Rename category' : 'Rename'}
          initial={entryName(dlg.entry)}
          action="Save"
          note={
            dlg.entry.kind === 'folder' && dlg.entry.folder.project_id
              ? 'This is a project’s folder: the project gets the new name too.'
              : dlg.entry.kind === 'folder' && dlg.entry.folder.virtual
                ? 'This folder is a category: the category gets the new name.'
                : undefined
          }
          onSave={(n) => {
            if (dlg.entry.kind === 'folder' && dlg.entry.folder.id === hereId) {
              const id = hereId;
              optimistic(
                () => {
                  const back = snapshot();
                  setData((d) => ({ ...d, folder: d.folder && { ...d.folder, name: n }, path: d.path.map((c) => (c.id === id ? { ...c, name: n } : c)) }));
                  return back;
                },
                () => patch(`/folders/${id}`, { name: n }),
              );
            } else rename(dlg.entry, n);
          }}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg?.kind === 'move' && (
        <MoveDialog
          what={entryName(dlg.entry)}
          start={dlg.entry.kind === 'folder' ? (dlg.entry.folder.parent_id ?? null) : (dlg.entry.file.folder_id ?? null)}
          moving={dlg.entry.kind === 'folder' ? [dlg.entry.folder.id] : []}
          kind={movingOf(dlg.entry)}
          onMove={(to) => {
            const e = dlg.entry;
            if (e.kind === 'folder' && e.folder.id === hereId) {
              // Moving the folder on screen: it stays open, its path changes.
              optimistic(() => () => {}, () => post('/files/move', { items: [entryRef(e)], folder_id: to.id }), `Moved to ${to.name}`);
            } else move([e], to);
          }}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg?.kind === 'delete-folder' && (
        <DeleteFolderDialog
          folder={dlg.folder}
          count={dlg.count}
          parent={dlg.folder.id === hereId ? (parentOfHere?.name ?? 'Files') : where}
          onDelete={(contents) => {
            const f = dlg.folder;
            if (f.id === hereId) {
              go(folderHref(f.parent_id ?? null).slice(1));
              optimistic(() => () => {}, () => del(`/folders/${f.id}${contents === 'delete' ? '?contents=delete' : ''}`), `Deleted ${f.name}`);
            } else deleteFolder(f, contents);
          }}
          onClose={() => setDlg(null)}
        />
      )}
    </div>
  );
}

/** What is being dragged (the browser hides the data until the drop). */
let dragging: Entry | null = null;

function ItemMenu({
  entry,
  anchor,
  type,
  onClose,
  onRename,
  onMove,
  onDelete,
  addons,
  onAddon,
}: {
  entry: Entry;
  anchor: HTMLElement;
  type?: FileTypeDef;
  onClose: () => void;
  onRename: (e: Entry) => void;
  onMove: (e: Entry) => void;
  onDelete: (e: Entry) => void;
  addons: FileAddonDef[];
  onAddon: (id: string, file: FileItem) => void;
}) {
  if (entry.kind === 'folder') {
    const f = entry.folder;
    if (f.virtual)
      return (
        <Menu anchor={anchor} label={f.name} onClose={onClose}>
          <MenuItem icon="↗" href={folderHref(f.id)}>
            Open
          </MenuItem>
          {f.virtual === 'category' && f.category_id && (
            <MenuItem icon="✎" onClick={() => onRename(entry)}>
              Rename category
            </MenuItem>
          )}
          <MenuItem icon="▤" href="#/projects">
            Projects tab
          </MenuItem>
        </Menu>
      );
    return (
      <Menu anchor={anchor} label={f.name} onClose={onClose}>
        <MenuItem icon="↗" href={folderHref(f.id)}>
          Open
        </MenuItem>
        {f.project_id && (
          <MenuItem icon="▤" href={`#/p/${f.project_id}`}>
            Open project page
          </MenuItem>
        )}
        <MenuItem icon="✎" onClick={() => onRename(entry)}>
          {f.project_id ? 'Rename project' : 'Rename'}
        </MenuItem>
        <MenuItem icon="➜" onClick={() => onMove(entry)}>
          Move…
        </MenuItem>
        {!f.project_id && (
          <MenuItem icon="✕" danger onClick={() => onDelete(entry)}>
            Delete
          </MenuItem>
        )}
      </Menu>
    );
  }
  const f = entry.file;
  return (
    <Menu anchor={anchor} label={f.name} onClose={onClose}>
      {type?.open ? (
        <MenuItem icon="↗" onClick={() => type.open!(f)}>
          Open
        </MenuItem>
      ) : (
        <MenuItem icon="↗" href={type?.href(f)} external={type?.external}>
          Open
        </MenuItem>
      )}
      {f.project_id && (
        <MenuItem icon="▤" href={`#/p/${f.project_id}`}>
          Open project page
        </MenuItem>
      )}
      {type?.rename && (
        <MenuItem icon="✎" onClick={() => onRename(entry)}>
          Rename
        </MenuItem>
      )}
      {!type?.fixed && (
        <MenuItem icon="➜" onClick={() => onMove(entry)}>
          Move…
        </MenuItem>
      )}
      {addons
        .filter((a) => a.menu)
        .map((a) => (
          <MenuItem key={a.id} icon={a.menu!.icon} onClick={() => onAddon(a.id, f)}>
            {a.menu!.label}
          </MenuItem>
        ))}
      {type?.remove && (
        <MenuItem icon="✕" danger onClick={() => onDelete(entry)}>
          Delete
        </MenuItem>
      )}
    </Menu>
  );
}
