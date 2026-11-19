// What the habits screens read from the server (src/modules/habits.ts: habitProgress and the habits table).

export type Habit = {
  id: string;
  name: string;
  intention: string | null;
  sessions: number | null;
  per: string | null;
  size: string | null;
  small_version: string | null;
  goal: string | null;
  step_up_every: string | null;
  prompts: string | null;
  category_id: string | null;
  description: string | null;
  status: string;
  started: string | null;
  next_prompt: string | null;
};

export type StepUp = {
  options: { kind: 'sessions' | 'size'; text: string }[];
  suggested: number;
  current: string;
  goal: string;
  weeks: { weeks: number; done: number; target: number };
};

export type Progress = {
  id: string;
  day: string;
  name: string;
  per: string | null;
  target: number | null;
  done_today: number;
  done_this_period: number;
  skipped_today: boolean;
  left: number;
  small_version: string | null;
  level: string;
  size: string | null;
  goal: string | null;
  days: { day: string; count: number; future: boolean }[];
  pending: { day: string; text: string; due: boolean } | null;
  step_up: StepUp | null;
  ask_stop: boolean;
};
