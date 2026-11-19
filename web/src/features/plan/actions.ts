// Plan my week's changes: each shows on screen first and is sent behind (optimistic), so a refused one is rolled back.
import { newId, optimistic, patch, post, put } from '../../core/api';
import type { Plan, Todo } from './types';

export type SetPlan = (fn: (p: Plan) => Plan) => void;

/** Add (1) or take off (-1) a planned session of a habit on a day. */
export function planSession(set: SetPlan, plan: Plan, habitId: string, day: string, add: 1 | -1) {
  return optimistic(
    () => {
      set((p) => ({
        ...p,
        days: p.days.map((d) => {
          if (d.day !== day) return d;
          const has = d.habits.some((h) => h.habit_id === habitId);
          const habits = has ? d.habits : [...d.habits, { habit_id: habitId, planned: 0, done: 0, skipped: false }];
          return { ...d, habits: habits.map((h) => (h.habit_id === habitId ? { ...h, planned: Math.max(0, h.planned + add) } : h)) };
        }),
        habits: p.habits.map((h) => (h.id === habitId ? { ...h, planned: Math.max(0, h.planned + add) } : h)),
      }));
      return () => set(() => plan);
    },
    () => post('/plan/sessions', { habit_id: habitId, day, add }),
  );
}

/** What a day is for: a category id, "any" or "away"; the usual value means "no change". */
export function setLead(set: SetPlan, plan: Plan, day: string, value: string) {
  return optimistic(
    () => {
      set((p) => ({ ...p, days: p.days.map((d) => (d.day === day ? { ...d, away: value === 'away', lead: { ...d.lead, value, changed: value !== d.lead.usual } } : d)) }));
      return () => set(() => plan);
    },
    () => put('/plan/lead', { day, value }),
  );
}

const without = (p: Plan, id: string): Plan => ({
  ...p,
  days: p.days.map((d) => ({ ...d, todos: d.todos.filter((t) => t.id !== id) })),
  unscheduled: p.unscheduled.filter((t) => t.id !== id),
  earlier: p.earlier.filter((t) => t.id !== id),
});

/** Put a to-do on a day of the week shown, or take it off its day (null = anytime). */
export function moveTodo(set: SetPlan, plan: Plan, todo: Todo, day: string | null) {
  if (todo.day === day) return;
  const moved = { ...todo, day };
  return optimistic(
    () => {
      set((p) => {
        const q = without(p, todo.id);
        if (day == null) return { ...q, unscheduled: [...q.unscheduled, moved] };
        return { ...q, days: q.days.map((d) => (d.day === day ? { ...d, todos: [...d.todos, moved] } : d)) };
      });
      return () => set(() => plan);
    },
    () => patch(`/todos/${todo.id}`, { day }),
    day == null ? 'To-do moved to anytime' : undefined,
  );
}

/** Add a to-do straight into a day. */
export function addTodo(set: SetPlan, plan: Plan, day: string, title: string) {
  const id = newId();
  return optimistic(
    () => {
      set((p) => ({ ...p, days: p.days.map((d) => (d.day === day ? { ...d, todos: [...d.todos, { id, title, day, done: null, project_id: null, list_id: '' }] } : d)) }));
      return () => set(() => plan);
    },
    () => post('/todos', { id, title, day }),
  );
}
