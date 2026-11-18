import { useState } from 'preact/hooks';
import { change, del, patch, post } from '../../core/api';
import { Dialog, Loading, useData } from '../../core/ui';

type Habit = {
  id: string;
  name: string;
  intention: string | null;
  sessions: number | null;
  per: string | null;
  size: string | null;
  small_version: string | null;
  goal: string | null;
  prompts: string | null;
  status: string;
};
type Progress = { id: string; done_today: number; done_this_period: number; left: number; target: number | null; per: string | null };

const FIELDS: [keyof Habit, string][] = [
  ['intention', 'Intention'],
  ['size', 'Size of one session'],
  ['small_version', 'Small version (for bad days)'],
  ['goal', 'Goal'],
  ['prompts', 'When / after what'],
];

function HabitDialog({ habit, onClose }: { habit: Partial<Habit> | null; onClose: () => void }) {
  const [h, setH] = useState<Partial<Habit>>(habit ?? { status: 'active', per: 'day', sessions: 1 });
  const set = (k: keyof Habit, v: unknown) => setH({ ...h, [k]: v });
  return (
    <Dialog title={habit?.id ? 'Edit habit' : 'New habit'} onClose={onClose}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const { id, ...fields } = h as Habit;
          onClose();
          change(() => (id ? patch(`/habits/${id}`, fields) : post('/habits', fields)), 'Saved');
        }}
      >
        <label>
          Name
          <input required value={h.name ?? ''} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} autoFocus />
        </label>
        <div class="row">
          <label>
            Sessions
            <input type="number" min={0} value={h.sessions ?? ''} onInput={(e) => set('sessions', (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : null)} />
          </label>
          <label>
            per
            <select value={h.per ?? 'day'} onChange={(e) => set('per', (e.target as HTMLSelectElement).value)}>
              <option value="day">day</option>
              <option value="week">week</option>
            </select>
          </label>
          <label>
            Status
            <select value={h.status ?? 'active'} onChange={(e) => set('status', (e.target as HTMLSelectElement).value)}>
              {['active', 'paused', 'aspiring', 'ended'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        {FIELDS.map(([k, label]) => (
          <label key={k}>
            {label}
            <input value={(h[k] as string) ?? ''} onInput={(e) => set(k, (e.target as HTMLInputElement).value || null)} />
          </label>
        ))}
        <div class="row">
          {habit?.id && (
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
          )}
          <button class="primary">Save</button>
        </div>
      </form>
    </Dialog>
  );
}

export function Habits() {
  const { data: habits, error } = useData<Habit[]>('/habits');
  const { data: progress } = useData<Progress[]>('/habits/progress');
  const [editing, setEditing] = useState<Partial<Habit> | null | undefined>(undefined);
  if (!habits) return <Loading error={error} />;
  const groups = ['active', 'aspiring', 'paused', 'ended'];
  return (
    <div class="stack">
      <div class="page-head row">
        <h1>Habits</h1>
        <button class="primary" onClick={() => setEditing(null)}>
          + New
        </button>
      </div>
      {groups.map((g) => {
        const hs = habits.filter((h) => h.status === g);
        if (!hs.length) return null;
        return (
          <section class="card" key={g}>
            <h2 class="cap">{g}</h2>
            <ul class="habits">
              {hs.map((h) => {
                const p = progress?.find((x) => x.id === h.id);
                return (
                  <li key={h.id}>
                    {g === 'active' && (
                      <button class="habit-tap" aria-label={`Done a session of ${h.name}`} onClick={() => change(() => post(`/habits/${h.id}/check`, { add: 1 }))}>
                        {p && p.target && p.left === 0 ? '✓' : '+'}
                      </button>
                    )}
                    <div class="click" onClick={() => setEditing(h)}>
                      <strong>{h.name}</strong>
                      <span class="muted">
                        {h.sessions ? `${p ? `${p.done_this_period}/` : ''}${h.sessions} per ${h.per ?? 'day'}` : h.intention ?? ''}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!habits.length && <p class="empty">No habits yet.</p>}
      {editing !== undefined && <HabitDialog habit={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

import { registerTab } from '../../core/registry';
registerTab({ id: 'habits', path: '/habits', label: 'Habits', icon: '✓', order: 40, phone: true, render: () => <Habits /> });
