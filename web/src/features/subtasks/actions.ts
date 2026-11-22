// Changes to a card's subtasks: shown at once, then sent (rolled back with a message if refused).
// `set` puts the card's new list of subtasks on screen (the board, or the open card dialog).
import { del, newId, optimistic, patch, post } from '../../core/api';
import { todayLocal } from '../../core/ui';
import type { Subtask } from '../board/model';

export type SetSubs = (subs: Subtask[]) => void;

const withRollback = (subs: Subtask[], set: SetSubs, next: Subtask[]) => () => {
  set(next);
  return () => set(subs);
};

export function addSubtask(taskId: string, subs: Subtask[], set: SetSubs, title: string) {
  const id = newId();
  const ord = subs.reduce((m, s) => Math.max(m, s.ord), 0) + 1;
  return optimistic(withRollback(subs, set, [...subs, { id, title, done: null, ord }]), () => post('/subtasks', { id, task_id: taskId, title }));
}

export function tickSubtask(subs: Subtask[], set: SetSubs, s: Subtask, done: boolean) {
  const next = subs.map((x) => (x.id === s.id ? { ...x, done: done ? todayLocal() : null } : x));
  return optimistic(withRollback(subs, set, next), () => post(`/subtasks/${s.id}/tick`, { done }));
}

export function renameSubtask(subs: Subtask[], set: SetSubs, s: Subtask, title: string) {
  if (!title || title === s.title) return;
  return optimistic(withRollback(subs, set, subs.map((x) => (x.id === s.id ? { ...x, title } : x))), () => patch(`/subtasks/${s.id}`, { title }));
}

export function deleteSubtask(subs: Subtask[], set: SetSubs, s: Subtask) {
  return optimistic(
    withRollback(
      subs,
      set,
      subs.filter((x) => x.id !== s.id),
    ),
    () => del(`/subtasks/${s.id}`),
    `Deleted ${s.title}`,
  );
}

/** Move a subtask one place up (-1) or down (1). */
export function moveSubtask(subs: Subtask[], set: SetSubs, s: Subtask, by: -1 | 1) {
  const at = subs.findIndex((x) => x.id === s.id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= subs.length) return;
  const next = [...subs];
  next.splice(to, 0, next.splice(at, 1)[0]);
  return optimistic(withRollback(subs, set, next), () => post(`/subtasks/${s.id}/move`, { index: to }));
}

export const progress = (subs: Subtask[]) => ({ done: subs.filter((s) => s.done).length, total: subs.length });
