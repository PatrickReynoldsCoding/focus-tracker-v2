// The Done column on a project board (DECISIONS D34, flag `done-column`): the board's fixed last
// status. "Hide done" (projects.hide_done, saved on the server so every device shows the same)
// folds it into a slim strip with its count; tapping the strip opens it again. Cards can still be
// dropped on the strip.

import { optimistic, patch } from '../../core/api';
import './done-column.css';

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
