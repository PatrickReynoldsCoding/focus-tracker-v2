// A habit's name that opens its dialog (notes and settings, D56), with 📝 when it has notes.
// Only the name opens it: the tick circle and the row's other buttons keep their own jobs.
import type { ComponentChildren } from 'preact';
import { firstLine, openHabit } from './open';

/** The 📝 mark for a habit with notes; its tooltip is the notes' first line. */
export function NotesMark({ notes }: { notes?: string | null }) {
  const line = firstLine(notes);
  if (!notes?.trim()) return null;
  return (
    <span class="habit-notes-mark" title={line || 'Has notes'} aria-label={`Has notes${line ? `: ${line}` : ''}`} role="img">
      📝
    </span>
  );
}

/** `class` is the row's own name class (tl-name, plan-hname …), so it keeps its look. */
export function HabitName({ id, name, notes, class: cls = '', children }: { id: string; name: string; notes?: string | null; class?: string; children?: ComponentChildren }) {
  const open = (e: Event) => {
    if ((e.target as Element).closest('a')) return;
    e.stopPropagation();
    openHabit(id);
  };
  return (
    <span
      class={`habit-name ${cls}`}
      role="button"
      tabIndex={0}
      title="Notes and settings"
      aria-label={`${name}. Open its notes and settings`}
      data-habit={id}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(e))}
    >
      {children ?? <span class="tl-title">{name}</span>}
      <NotesMark notes={notes} />
    </span>
  );
}
