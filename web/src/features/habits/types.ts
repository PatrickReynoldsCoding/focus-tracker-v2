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
  project_id: string | null;
  description: string | null;
  /** Notes and useful information (Markdown, D56). */
  notes?: string | null;
  /** The weekdays it shows on Today ("tue,thu"), null = every day (D68). */
  days?: string | null;
  status: string;
  updated_at?: string;
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
  project_id?: string | null;
  per: string | null;
  target: number | null;
  done_today: number;
  done_this_period: number;
  skipped_today: boolean;
  left: number;
  small_version: string | null;
  /** The habit's notes (Markdown), null when none. */
  notes?: string | null;
  /** Its weekdays ("tue,thu"), null = every day; off_day: this day is not one of them (D68). */
  on_days?: string | null;
  off_day?: boolean;
  level: string;
  size: string | null;
  goal: string | null;
  /** planned: sessions planned that day in Plan my week. */
  days: { day: string; count: number; future: boolean; planned?: number; off?: boolean }[];
  /** Sessions planned for this day, and for the days after it this week (Plan my week). */
  planned_today?: number;
  planned_later?: number;
  pending: { day: string; text: string; due: boolean } | null;
  step_up: StepUp | null;
  ask_stop: boolean;
};
