// The Done column (DECISIONS D34, D41): the fixed last column of a project (flag `done-column`) and
// of every to-do. "Hide done" folds it: into a slim strip with its count in Board view, into its
// heading in List view; tapping it opens it again, and cards can still be dropped on it. A
// project's Hide done is saved on the server (projects.hide_done, the same on every device); a
// to-do's on this device (features/board/memory.ts).

import { optimistic, patch } from '../../core/api';
import './done.css';

export const DONE_FLAG = 'done-column';

/** Save Hide done for a project, showing it at once. */
export function setHideDone(projectId: string, hide: boolean, show: (hide: boolean) => void) {
  optimistic(
    () => {
      show(hide);
      return () => show(!hide);
    },
    () => patch(`/projects/${projectId}`, { hide_done: hide }),
  );
}

/** The board-tools button. */
export function HideDoneButton({ hidden, count, onToggle }: { hidden: boolean; count: number; onToggle: () => void }) {
  return (
    <button class="ghost small" aria-pressed={hidden} onClick={onToggle}>
      {hidden ? `Show done (${count})` : 'Hide done'}
    </button>
  );
}

/** The folded Done column's face: its name and count. */
export function DoneStripLabel({ name, count, onOpen }: { name: string; count: number; onOpen: () => void }) {
  return (
    <button class="done-strip-btn" onClick={onOpen} aria-label={`${name}: ${count} cards hidden. Show them`} title="Show done cards">
      <span class="done-strip-tick" aria-hidden="true">
        ✓
      </span>
      <span class="done-strip-name">{name}</span>
      <span class="done-strip-count">{count}</span>
    </button>
  );
}
