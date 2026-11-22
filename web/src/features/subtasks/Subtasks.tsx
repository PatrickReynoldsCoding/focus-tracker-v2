// Subtasks on a card (D57). Three places:
//  - List view (mockup 1B): a ▸/▾ and a count "1/3" on the to-do's row; open, the subtasks sit
//    indented under it, each ticked with its own circle, with "+ Add subtask".
//  - Board view (mockup 2B): a progress bar and "☑ 1/3 ▸ show"; shown, a checklist you tick on the card.
//  - The card dialog: the full list (rename, tick, move, delete, add).
// They plug in as the board's `card-extra` panel and a section of the card dialog; ticking every
// subtask never ticks the card.
import { useFlag } from '../../core/features';
import { AddInput, InlineEdit, Linkify } from '../../core/ui';
import { patchCard, type Card } from '../board/model';
import type { BoardCtx } from '../board/actions';
import { addSubtask, deleteSubtask, moveSubtask, progress, renameSubtask, tickSubtask, type SetSubs } from './actions';
import { useSubtasksOpen } from './state';

const subsOf = (c: Card) => c.subtasks ?? [];
const setOnBoard = (b: BoardCtx, c: Card): SetSubs => (subtasks) => b.set((cs) => patchCard(cs, c.id, { subtasks }));
const stop = (e: Event) => e.stopPropagation();

function Check({ on, label, onTick, small }: { on: boolean; label: string; onTick: () => void; small?: boolean }) {
  return (
    <button class={`sub-check${on ? ' on' : ''}${small ? ' small' : ''}`} role="checkbox" aria-checked={on} aria-label={label} onClick={onTick}>
      {on ? '✓' : ''}
    </button>
  );
}

/** List view and Board view: what a card shows of its subtasks. */
export function CardSubtasks({ card, b, view }: { card: Card; b: BoardCtx; view: 'board' | 'list' }) {
  const on = useFlag('subtasks');
  const [open, setOpen] = useSubtasksOpen(card.id);
  const subs = subsOf(card);
  if (!on) return null;
  const { done, total } = progress(subs);
  const set = setOnBoard(b, card);
  const toggle = (e: Event) => {
    stop(e);
    setOpen(!open);
  };
  if (view === 'list') {
    if (!total) return null;
    return (
      <>
        <button class="sub-chip" aria-expanded={open} aria-label={`Subtasks of ${card.title}: ${done} of ${total} done. ${open ? 'Hide' : 'Show'}`} onClick={toggle}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> {done}/{total}
        </button>
        {open && (
          <div class="sub-block sub-in-list" onClick={stop}>
            <ul class="sub-items">
              {subs.map((s) => (
                <li key={s.id} class={`sub-item${s.done ? ' done' : ''}`}>
                  <Check on={!!s.done} small label={s.done ? `Not done: ${s.title}` : `Done: ${s.title}`} onTick={() => tickSubtask(subs, set, s, !s.done)} />
                  <span class="sub-title">
                    <Linkify text={s.title} />
                  </span>
                </li>
              ))}
            </ul>
            <AddInput placeholder="+ Add subtask" onAdd={(t) => addSubtask(card.id, subs, set, t)} />
          </div>
        )}
      </>
    );
  }
  if (!total) return null;
  return (
    <div class="sub-block sub-in-board" onClick={stop}>
      <div class="sub-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Subtasks done">
        <i style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <button class="sub-foot" aria-expanded={open} aria-label={`Subtasks: ${done} of ${total} done. ${open ? 'Hide' : 'Show'}`} onClick={toggle}>
        <span>☑ {done}/{total}</span>
        <span class="muted">{open ? '▾ hide' : '▸ show'}</span>
      </button>
      {open && (
        <ul class="sub-items">
          {subs.map((s) => (
            <li key={s.id} class={`sub-item${s.done ? ' done' : ''}`}>
              <Check on={!!s.done} small label={s.done ? `Not done: ${s.title}` : `Done: ${s.title}`} onTick={() => tickSubtask(subs, set, s, !s.done)} />
              <span class="sub-title">{s.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The card dialog's section: every subtask with its tick, name (tap to rename), ↑ ↓ and ✕, and a box to add one. */
export function SubtasksSection({ card, update }: { card: Card; update: (f: Record<string, unknown> | null) => void }) {
  const subs = subsOf(card);
  const set: SetSubs = (subtasks) => update({ subtasks });
  const { done, total } = progress(subs);
  return (
    <section class="sub-section" aria-label="Subtasks">
      <h3 class="sub-head">
        Subtasks {total > 0 && <span class="muted small">{done}/{total}</span>}
      </h3>
      <ul class="sub-items">
        {subs.map((s, i) => (
          <li key={s.id} class={`sub-item${s.done ? ' done' : ''}`}>
            <Check on={!!s.done} label={s.done ? `Not done: ${s.title}` : `Done: ${s.title}`} onTick={() => tickSubtask(subs, set, s, !s.done)} />
            <InlineEdit class="sub-title" value={s.title} onSave={(t) => renameSubtask(subs, set, s, t)} />
            {i > 0 && (
              <button class="icon small" aria-label={`Move ${s.title} up`} onClick={() => moveSubtask(subs, set, s, -1)}>
                ↑
              </button>
            )}
            {i < subs.length - 1 && (
              <button class="icon small" aria-label={`Move ${s.title} down`} onClick={() => moveSubtask(subs, set, s, 1)}>
                ↓
              </button>
            )}
            <button class="icon small" aria-label={`Delete ${s.title}`} onClick={() => deleteSubtask(subs, set, s)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <AddInput placeholder="Add a subtask" onAdd={(t) => addSubtask(card.id, subs, set, t)} />
    </section>
  );
}
