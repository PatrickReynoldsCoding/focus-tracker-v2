import { useState } from 'preact/hooks';
import { change, del, newId, optimistic, patch, post } from '../../core/api';
import { Panels, registerTab, type HabitsSectionProps } from '../../core/registry';
import { AddInput, InlineEdit, Loading, useData } from '../../core/ui';
import { withDays } from './DayPicker';
import { HabitDialog } from './HabitDialog';
import { HabitGroups } from './Groups';
import { HabitName, NotesMark } from './HabitName';
import { openHabit } from './open';
import { HabitCards, HabitLine } from './HabitRow';
import { NewHabitDialog } from './NewHabit';
import type { Habit, Progress } from './types';
import './habits.css';

const GROUPS: [string, string][] = [
  ['active', 'Active'],
  ['aspiring', 'Aspiring'],
  ['paused', 'Paused'],
  ['ended', 'Ended'],
];

/** The Habits page. `inDialog`: drawn inside the Today list's pop-out (HabitsPopup), whose title is Habits. */
export function Habits({ inDialog }: { inDialog?: boolean } = {}) {
  const { data: habits, error, setData: setHabits } = useData<Habit[]>('/habits');
  const { data: progress, setData: setProgress } = useData<Progress[]>('/habits/progress');
  const [creating, setCreating] = useState<Habit | null | undefined>(undefined); // null = new, a habit = start an aspiring one
  const [editing, setEditing] = useState<Habit | null>(null);
  if (!habits) return <Loading error={error} />;
  const setProg = (fn: (l: Progress[]) => Progress[]) => setProgress(fn);

  /** Move a habit one place up or down among the habits of its status and category (the order is shared by all of them). */
  const mover = (h: Habit) => {
    const group = habits.filter((x) => x.status === h.status && x.category_id === h.category_id);
    const i = group.findIndex((x) => x.id === h.id);
    const swap = (to: number, body: Record<string, string>) => () =>
      optimistic(
        () => {
          const before = habits;
          setHabits((list) => {
            const next = list.filter((x) => x.id !== h.id);
            const at = next.findIndex((x) => x.id === group[to].id);
            next.splice(to < i ? at : at + 1, 0, h);
            return next;
          });
          return () => setHabits(() => before);
        },
        () => post(`/habits/${h.id}/move`, body),
      );
    return {
      up: i > 0 ? swap(i - 1, { before_id: group[i - 1].id }) : undefined,
      down: i < group.length - 1 ? swap(i + 1, { after_id: group[i + 1].id }) : undefined,
    };
  };

  const addIdea = (name: string) => {
    const id = newId();
    return optimistic(
      () => {
        setHabits((l) => [...l, { id, name, status: 'aspiring' } as Habit]);
        return () => setHabits((l) => l.filter((x) => x.id !== id));
      },
      () => post('/habits', { id, name, status: 'aspiring' }),
    );
  };

  return (
    <div class="stack habits-page">
      <div class={`page-head row ${inDialog ? 'in-dialog' : ''}`}>
        {inDialog ? <span /> : <h1>Habits</h1>}
        <button class="primary" onClick={() => setCreating(null)}>
          + New
        </button>
      </div>
      <Panels<HabitsSectionProps> place="habits" props={{}} />
      {GROUPS.map(([status, label]) => {
        const hs = habits.filter((h) => h.status === status);
        if (!hs.length && status !== 'aspiring') return null;
        return (
          <section class="card" key={status} aria-label={label}>
            <div class="card-head">
              <h2>{label}</h2>
              {status === 'aspiring' && <span class="muted small">Ideas for later. They never show on Today.</span>}
            </div>
            {status === 'aspiring' && <AddInput placeholder="An idea for a habit…" onAdd={addIdea} />}
            <HabitGroups place={`habits-${status}`} items={hs} habitId={(h) => h.id}>
              {(inCategory) => (
                <ul class="habit-list">
                  {inCategory.map((h) => {
                    const p = progress?.find((x) => x.id === h.id);
                    const m = mover(h);
                    if (status === 'aspiring')
                      return (
                        <li key={h.id} class="idea">
                          <div class="idea-name">
                            <span class="row tight">
                              <InlineEdit value={h.name} placeholder="Name" onSave={(v) => v && change(() => patch(`/habits/${h.id}`, { name: v }))} />
                              <NotesMark notes={h.notes} />
                            </span>
                            {h.intention || h.description ? <span class="muted small">{h.intention ?? h.description}</span> : null}
                          </div>
                          <button class="icon small" aria-label={`Move ${h.name} up`} disabled={!m.up} onClick={m.up}>
                            ▲
                          </button>
                          <button class="icon small" aria-label={`Move ${h.name} down`} disabled={!m.down} onClick={m.down}>
                            ▼
                          </button>
                          <button class="small" aria-label={`Notes for ${h.name}`} onClick={() => openHabit(h.id)}>
                            Notes
                          </button>
                          <button class="small" onClick={() => setCreating(h)}>
                            Start
                          </button>
                          <button class="icon small danger" aria-label={`Delete ${h.name}`} onClick={() => change(() => del(`/habits/${h.id}`), 'Idea deleted')}>
                            ✕
                          </button>
                        </li>
                      );
                    return (
                      <li key={h.id} class="habit-item">
                        {status === 'active' && p ? (
                          <div class="habit-main">
                            <HabitCards h={p} set={setProg} />
                            <HabitLine h={p} set={setProg} strip="toggle" />
                            <span class="muted small">Level {withDays(p.level, p.on_days)}{p.goal ? ` · goal ${p.goal}` : ''}</span>
                          </div>
                        ) : (
                          <div class="habit-main">
                            <HabitName id={h.id} name={h.name} notes={h.notes}>
                              <strong>{h.name}</strong>
                            </HabitName>
                            <span class="muted small">{withDays([h.sessions ? `${h.sessions} a ${h.per ?? 'day'}` : null, h.size].filter(Boolean).join(', '), h.days) || h.intention}</span>
                          </div>
                        )}
                        <button class="small" aria-label={`Edit ${h.name}`} onClick={() => setEditing(h)}>
                          Edit
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </HabitGroups>
            {status === 'aspiring' && !hs.length && <p class="muted small">Nothing here yet. Type an idea above and press Enter.</p>}
          </section>
        );
      })}
      {!habits.length && <p class="empty">No habits yet.</p>}
      {creating !== undefined && <NewHabitDialog habit={creating} onClose={() => setCreating(undefined)} />}
      {editing && <HabitDialog id={editing.id} onMove={mover(editing)} onClose={() => setEditing(null)} />}
    </div>
  );
}

registerTab({ id: 'habits', path: '/habits', label: 'Habits', icon: '✓', order: 40, phone: true, feature: 'habits', render: () => <Habits /> });
