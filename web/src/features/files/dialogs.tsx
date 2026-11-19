// The Files tab's dialogs: a name (new folder, rename), Move… (pick a folder) and deleting a
// folder that is not empty.
import { useState } from 'preact/hooks';
import { Dialog, Loading, useData } from '../../core/ui';
import { FolderIcon } from './icons';
import type { Folder, Listing } from './model';

export function NameDialog({ title, initial = '', action, note, onSave, onClose }: { title: string; initial?: string; action: string; note?: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          onClose();
          if (n !== initial) onSave(n);
        }}
      >
        <label>
          Name
          <input value={name} autoFocus maxLength={120} onInput={(e) => setName((e.target as HTMLInputElement).value)} onFocus={(e) => (e.target as HTMLInputElement).select()} />
        </label>
        {note && <p class="muted small">{note}</p>}
        <button class="primary" disabled={!name.trim()}>
          {action}
        </button>
      </form>
    </Dialog>
  );
}

/** Pick a folder to move things to: open folders to go down, the path to go up, then "Move here". */
export function MoveDialog({ what, start, moving, onMove, onClose }: { what: string; start: string | null; moving: string[]; onMove: (to: { id: string | null; name: string }) => void; onClose: () => void }) {
  const [at, setAt] = useState<string | null>(start);
  const { data, error } = useData<Listing>(`/files?${at ? `folder=${at}&` : ''}sort=name`);
  const here = data?.folder ?? null;
  const name = here?.name ?? 'Files';
  return (
    <Dialog title={`Move ${what}`} onClose={onClose}>
      <div class="stack files-move">
        <nav class="files-crumbs small" aria-label="Folder path">
          <button type="button" class="crumb" onClick={() => setAt(null)} disabled={!at}>
            Files
          </button>
          {data?.path.map((c, i) => (
            <span key={c.id} class="crumb-wrap">
              <span class="crumb-sep" aria-hidden="true">
                ›
              </span>
              <button type="button" class="crumb" disabled={i === data.path.length - 1} onClick={() => setAt(c.id)}>
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        {!data ? (
          <Loading error={error} />
        ) : (
          <ul class="files-move-list" aria-label={`Folders in ${name}`}>
            {data.folders.map((f: Folder) => {
              const self = moving.includes(f.id);
              return (
                <li key={f.id}>
                  <button type="button" class="files-move-row" disabled={self} onClick={() => setAt(f.id)} title={self ? 'This is what you are moving' : undefined}>
                    <FolderIcon project={!!f.project_id} />
                    <span class="files-name">{f.name}</span>
                    <span aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
            {!data.folders.length && <li class="muted small files-move-empty">No folders in here.</li>}
          </ul>
        )}
        <div class="row spread">
          <button type="button" class="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="primary"
            disabled={!data || (at !== null && moving.includes(at))}
            onClick={() => {
              onClose();
              onMove({ id: at, name });
            }}
          >
            Move here
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export type Count = { folders: number; files: number; projects: number };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function DeleteFolderDialog({ folder, count, parent, onDelete, onClose }: { folder: Folder; count: Count; parent: string; onDelete: (contents: 'move' | 'delete') => void; onClose: () => void }) {
  const parts = [count.files && plural(count.files, 'file'), count.folders && plural(count.folders, 'folder')].filter(Boolean).join(' and ');
  return (
    <Dialog title={`Delete ${folder.name}?`} onClose={onClose}>
      <div class="stack">
        <p>
          It holds {parts}.{count.projects ? ` Project folders inside are kept and move to ${parent}.` : ''}
        </p>
        <button
          class="primary"
          onClick={() => {
            onClose();
            onDelete('move');
          }}
        >
          Move them to {parent}, delete the folder
        </button>
        <button
          class="danger"
          onClick={() => {
            onClose();
            onDelete('delete');
          }}
        >
          Delete the folder and everything in it
        </button>
        <p class="muted small">Undo brings it all back.</p>
      </div>
    </Dialog>
  );
}
