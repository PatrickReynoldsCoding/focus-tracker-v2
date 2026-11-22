// The habit dialog (D56): the habit's notes at the top (the app's note editor, saved as you go
// with the same conflict check and offline queue as a card's note), its settings below. A sheet
// on a phone, a dialog on a computer (core/ui Dialog: Back and Escape close it). Opened by a
// habit's name anywhere (open.ts), or by Edit on the Habits tab.
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { version } from '../../core/api';
import { registerOverlay } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { Dialog, Loading, MarkdownEditor, useData } from '../../core/ui';
import { habitTarget } from '../editor/targets';
import { EditHabitForm } from './EditHabit';
import { openHabitId } from './open';
import type { Habit } from './types';
import './habits.css';

export function HabitDialog({ id, onClose, onMove }: { id: string; onClose: () => void; onMove?: { up?: () => void; down?: () => void } }) {
  const { data: habit, error, setData } = useData<Habit>(`/habits/${id}`);
  const saved = useRef(false);
  const close = () => {
    onClose();
    // Rows elsewhere show 📝 from their own data: reload them once the notes changed.
    if (saved.current) version.value++;
  };
  const target = useMemo(
    () =>
      habitTarget(id, (notes) => {
        saved.current = true;
        setData((h) => ({ ...h, notes }));
      }),
    [id],
  );
  useEffect(() => {
    if (error) close();
  }, [error]);
  return (
    <Dialog title={habit?.name ?? 'Habit'} onClose={close}>
      {!habit ? (
        <Loading />
      ) : (
        <div class="stack habit-dialog">
          <section class="habit-notes" aria-label="Notes">
            <h3 class="habit-sub">Notes</h3>
            <MarkdownEditor
              value={habit.notes ?? ''}
              placeholder="Notes and useful information…"
              rows={5}
              draftKey={`habit:${id}`}
              onSave={(notes) => target.write(notes, undefined)}
              target={target}
            />
          </section>
          <section aria-label="Habit settings">
            <h3 class="habit-sub">Settings</h3>
            <EditHabitForm key={habit.id} habit={habit} onClose={close} onMove={onMove} />
          </section>
        </div>
      )}
    </Dialog>
  );
}

function OpenHabit() {
  const id = useSignal(openHabitId);
  if (!id) return null;
  return <HabitDialog key={id} id={id} onClose={() => (openHabitId.value = null)} />;
}

registerOverlay({ id: 'habit-dialog', order: 60, feature: 'habits', render: () => <OpenHabit /> });
