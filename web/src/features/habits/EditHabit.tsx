import { useState } from 'preact/hooks';
import { change, del, patch } from '../../core/api';
import { useData } from '../../core/ui';
import type { Habit } from './types';

type Category = { id: string; label: string };

/** A habit's settings (the lower part of the habit dialog, HabitDialog.tsx): its words, level, goal
 *  and pace; move it up or down (on the Habits tab); pause, end or delete it. */
export function EditHabitForm({
  habit,
  onClose,
  onMove,
}: {
  habit: Habit;
  onClose: () => void;
  /** Move within its group; undefined when it cannot go that way. None: no move buttons (opened away from the Habits tab). */
  onMove?: { up?: () => void; down?: () => void };
}) {
  const { data: cats } = useData<Category[]>('/categories');
  const { data: projects } = useData<{ id: string; name: string; status: string }[]>('/projects');
  const [h, setH] = useState<Habit>(habit);
  const set = (k: keyof Habit, v: unknown) => setH({ ...h, [k]: v === '' ? null : v });
  const text = (k: keyof Habit) => (e: Event) => set(k, (e.target as HTMLInputElement).value);
  const every = h.step_up_every ?? '';
  const levelChanged = h.sessions !== habit.sessions || (h.per ?? 'day') !== (habit.per ?? 'day') || (h.size ?? '') !== (habit.size ?? '');
  const status = (s: string, done: string) => {
    onClose();
    change(() => patch(`/habits/${habit.id}`, { status: s }), done);
  };

  return (
      <form
        class="stack habit-settings"
        aria-label="Settings"
        onSubmit={(e) => {
          e.preventDefault();
          const { id, ...fields } = h;
          void id;
          onClose();
          change(
            () =>
              patch(`/habits/${habit.id}`, {
                name: fields.name,
                intention: fields.intention,
                category_id: fields.category_id,
                project_id: fields.project_id ?? null,
                sessions: fields.sessions,
                per: fields.per,
                size: fields.size,
                goal: fields.goal,
                small_version: fields.small_version,
                step_up_every: fields.step_up_every,
                prompts: fields.prompts,
              }),
            'Saved',
          );
        }}
      >
        <label>
          Name
          <input required value={h.name} onInput={text('name')} />
        </label>
        <label>
          Why (your intention)
          <input value={h.intention ?? ''} onInput={text('intention')} />
        </label>
        <label>
          Category
          <select value={h.category_id ?? ''} onChange={text('category_id')}>
            <option value="">None</option>
            {(cats ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select value={h.project_id ?? ''} onChange={(e) => set('project_id', (e.target as HTMLSelectElement).value || null)}>
            <option value="">None</option>
            {(projects ?? [])
              .filter((p) => p.status === 'active' || p.id === h.project_id)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <span class="muted small">The habit also shows on that project’s page.</span>
        </label>
        <div class="row">
          <label>
            Sessions
            <input type="number" min={0} value={h.sessions ?? ''} onInput={(e) => set('sessions', (e.target as HTMLInputElement).value === '' ? null : Number((e.target as HTMLInputElement).value))} />
          </label>
          <label>
            a
            <select value={h.per ?? 'day'} onChange={text('per')}>
              <option value="day">day</option>
              <option value="week">week</option>
            </select>
          </label>
          <label>
            Size
            <input value={h.size ?? ''} placeholder="30 min" onInput={text('size')} />
          </label>
        </div>
        {levelChanged && <p class="muted small">A new level applies from {h.per === 'week' ? 'this week' : 'today'}; earlier weeks keep the level they had. A waiting step-up is dropped.</p>}
        <label>
          Goal
          <input value={h.goal ?? ''} placeholder="5 a week, 45 min" onInput={text('goal')} />
        </label>
        <label>
          Small version for bad days
          <input value={h.small_version ?? ''} onInput={text('small_version')} />
        </label>
        <div class="row">
          <label>
            Ask about stepping up
            <select value={every} onChange={text('step_up_every')}>
              <option value="">Never</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={`${n} ${n === 1 ? 'week' : 'weeks'}`}>
                  Every {n} {n === 1 ? 'week' : 'weeks'}
                </option>
              ))}
            </select>
          </label>
          <label class="inline">
            <input type="checkbox" checked={h.prompts !== 'off' && h.prompts !== 'at goal'} onChange={(e) => set('prompts', (e.target as HTMLInputElement).checked ? 'on' : 'off')} />
            Prompts on
          </label>
        </div>
        {h.prompts === 'at goal' && <p class="muted small">You said you are at your goal. Tick “Prompts on” to be asked again.</p>}
        {onMove && (
          <div class="row">
            <button type="button" aria-label="Move up" disabled={!onMove.up} onClick={onMove.up}>
              ▲ Move up
            </button>
            <button type="button" aria-label="Move down" disabled={!onMove.down} onClick={onMove.down}>
              ▼ Move down
            </button>
          </div>
        )}
        <div class="row">
          {habit.status === 'active' && (
            <button type="button" onClick={() => status('paused', 'Paused. Paused weeks do not count against a step-up.')}>
              Pause
            </button>
          )}
          {habit.status === 'paused' && (
            <button type="button" onClick={() => status('active', 'Resumed')}>
              Resume
            </button>
          )}
          {habit.status !== 'ended' ? (
            <button type="button" onClick={() => status('ended', 'Habit ended')}>
              End
            </button>
          ) : (
            <button type="button" onClick={() => status('active', 'Habit active again')}>
              Start again
            </button>
          )}
          <button
            type="button"
            class="danger ghost"
            onClick={() => {
              onClose();
              change(() => del(`/habits/${habit.id}`), 'Habit deleted');
            }}
          >
            Delete
          </button>
          <button class="primary">Save</button>
        </div>
      </form>
  );
}
