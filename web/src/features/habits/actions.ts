// Changes to habits: each shows on screen first (optimistic) and is sent behind.
import { optimistic, post } from '../../core/api';
import type { Progress } from './types';

export type SetHabits = (fn: (list: Progress[]) => Progress[]) => void;

/** The same habit with `add` sessions more (or fewer) on `day`. */
export function withRecorded(h: Progress, day: string, add: number): Progress {
  const cur = h.days.find((d) => d.day === day);
  if (!cur) return h;
  const change = Math.max(-cur.count, add);
  const inPeriod = h.per === 'week' || day === h.day;
  const period = h.done_this_period + (inPeriod ? change : 0);
  return {
    ...h,
    days: h.days.map((d) => (d.day === day ? { ...d, count: d.count + change } : d)),
    done_today: h.done_today + (day === h.day ? change : 0),
    done_this_period: period,
    left: h.target == null || h.skipped_today ? 0 : Math.max(0, h.target - period),
  };
}

const replace = (set: SetHabits, id: string, fn: (h: Progress) => Progress) => set((list) => list.map((x) => (x.id === id ? fn(x) : x)));

/** Add (or take off) sessions on a day: today, or up to 7 days back. */
export function record(set: SetHabits, h: Progress, day: string, add: number) {
  return optimistic(
    () => {
      replace(set, h.id, (x) => withRecorded(x, day, add));
      return () => replace(set, h.id, () => h);
    },
    () => post(`/habits/${h.id}/check`, { day, add }),
  );
}

export function answerStepUp(set: SetHabits, h: Progress, answer: string, option?: string) {
  return optimistic(
    () => {
      replace(set, h.id, (x) => ({ ...x, step_up: null, ask_stop: false }));
      return () => replace(set, h.id, () => h);
    },
    () => post(`/habits/${h.id}/step-up`, { answer, option }),
    answer === 'yes' ? 'Saved. Accept the new level on Today when it falls due.' : undefined,
  );
}

export function answerPending(set: SetHabits, h: Progress, answer: 'accept' | 'not yet') {
  return optimistic(
    () => {
      replace(set, h.id, (x) => ({ ...x, pending: answer === 'accept' ? null : x.pending && { ...x.pending, due: false } }));
      return () => replace(set, h.id, () => h);
    },
    () => post(`/habits/${h.id}/pending`, { answer }),
    answer === 'accept' ? 'New level accepted' : undefined,
  );
}
