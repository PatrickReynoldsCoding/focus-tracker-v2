// Lists of boards (the Whiteboards tab, a project's panel, Today), the board options dialog and
// "+ New whiteboard".
import { useState } from 'preact/hooks';
import { del, newId, optimistic, patch, post } from '../../core/api';
import { Dialog } from '../../core/ui';
import { openBoard, savedAgo, type Board } from './model';

type Project = { id: string; name: string };

/** Run `fn` once a closing dialog has taken its history entry back (see Dialog in core/ui.tsx), so a
 *  new page opened from a dialog is not undone by that step back. */
function afterDialog(fn: () => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', run);
    fn();
  };
  window.addEventListener('popstate', run);
  setTimeout(run, 400);
}

export function Preview({ board }: { board: Pick<Board, 'thumbnail' | 'name'> }) {
  return board.thumbnail ? (
    <img class="wb-thumb" src={board.thumbnail} alt="" loading="lazy" decoding="async" />
  ) : (
    <span class="wb-thumb wb-none" aria-hidden="true">
      <svg viewBox="0 0 64 40" width="64" height="40">
        <path d="M6 30 C 14 10, 22 34, 30 18 S 46 8, 58 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
        <rect x="38" y="26" width="16" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
    </span>
  );
}

/** A grid of boards. `onChange` changes the list on screen (an option was saved); null removes the board. */
export function BoardGrid({
  boards,
  projects,
  showProject,
  onChange,
}: {
  boards: Board[];
  projects?: Project[];
  showProject?: boolean;
  onChange: (id: string, fields: Partial<Board> | null) => void;
}) {
  const [options, setOptions] = useState<Board | null>(null);
  const name = (id: string | null) => (id ? projects?.find((p) => p.id === id)?.name : null);
  return (
    <>
      <ul class="wb-grid">
        {boards.map((b) => (
          <li key={b.id} class="wb-tile">
            <button class="wb-open" onClick={() => openBoard(b.id)} aria-label={`Open ${b.name}`}>
              <Preview board={b} />
            </button>
            <div class="wb-meta">
              <button class="wb-name" onClick={() => openBoard(b.id)}>
                {b.name}
              </button>
              <span class="muted small">
                {showProject && name(b.project_id) ? `${name(b.project_id)} · ` : ''}
                {savedAgo(b.updated_at)}
                {b.show_today ? ' · on Today' : ''}
              </span>
            </div>
            <button class="icon small wb-more" aria-label={`Options for ${b.name}`} title="Rename, move, delete" onClick={() => setOptions(b)}>
              ⋯
            </button>
          </li>
        ))}
      </ul>
      {options && <BoardOptions board={options} projects={projects} onChange={onChange} onClose={() => setOptions(null)} />}
    </>
  );
}

function BoardOptions({ board, projects, onChange, onClose }: { board: Board; projects?: Project[]; onChange: (id: string, f: Partial<Board> | null) => void; onClose: () => void }) {
  const [name, setName] = useState(board.name);
  const [today, setToday] = useState(board.show_today);
  const save = (fields: Partial<Board>, done?: string) =>
    optimistic(
      () => {
        onChange(board.id, fields);
        return () => onChange(board.id, board);
      },
      () => patch(`/whiteboards/${board.id}`, fields),
      done,
    );
  return (
    <Dialog title="Whiteboard" onClose={onClose}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (n && n !== board.name) save({ name: n });
          onClose();
        }}
      >
        <label>
          Name
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} maxLength={120} />
        </label>
        {projects && (
          <label>
            Project
            <select
              value={board.project_id ?? ''}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value || null;
                save({ project_id: v }, v ? `Moved to ${projects.find((p) => p.id === v)?.name ?? 'project'}` : 'Board has no project now');
                onClose();
              }}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label class="inline">
          <input
            type="checkbox"
            checked={today}
            onChange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              setToday(on);
              save({ show_today: on }, on ? `${name.trim() || board.name} is on Today` : undefined);
            }}
          />
          Show on Today
        </label>
        <div class="row spread">
          <button
            type="button"
            class="danger ghost"
            onClick={() => {
              onClose();
              optimistic(
                () => {
                  onChange(board.id, null);
                  return () => onChange(board.id, board);
                },
                () => del(`/whiteboards/${board.id}`),
                `Deleted ${board.name}`,
              );
            }}
          >
            Delete
          </button>
          <button class="primary">Done</button>
        </div>
      </form>
    </Dialog>
  );
}

export function NewBoardDialog({ projects, project, onClose }: { projects?: Project[]; project?: string | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [pid, setPid] = useState<string>(project ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="New whiteboard" onClose={onClose}>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const id = newId();
          const made = await optimistic(
            () => () => {},
            () => post('/whiteboards', { id, name: name.trim() || 'Whiteboard', project_id: pid || null }),
          );
          setBusy(false);
          if (!made) return;
          onClose();
          afterDialog(() => openBoard(id));
        }}
      >
        <label>
          Name
          <input value={name} placeholder="Whiteboard" autoFocus maxLength={120} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        {projects && (
          <label>
            Project (optional)
            <select value={pid} onChange={(e) => setPid((e.target as HTMLSelectElement).value)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button class="primary" disabled={busy}>
          {busy ? 'Making…' : 'Make and open'}
        </button>
      </form>
    </Dialog>
  );
}
