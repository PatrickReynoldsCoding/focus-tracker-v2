// What GET /api/plan?week=this|next returns (src/modules/plan.ts: weekPlan).

export type Todo = { id: string; title: string; day: string | null; done: string | null; project_id: string | null; list_id: string };

export type Lead = { value: string; usual: string; changed: boolean };

export type DayHabit = { habit_id: string; planned: number; done: number; skipped: boolean };

export type PlanDay = {
  day: string;
  weekday: string;
  past: boolean;
  today: boolean;
  lead: Lead;
  away: boolean;
  habits: DayHabit[];
  todos: Todo[];
};

export type PlanHabit = {
  id: string;
  name: string;
  per: 'day' | 'week';
  sessions: number | null;
  level: string;
  /** The weekdays it can be planned on ("tue,thu"), null = any day (D68). */
  days?: string | null;
  target: number;
  planned: number;
  done: number;
  away_days_left_out: number;
};

export type Plan = {
  week: 'this' | 'next';
  week_of: string;
  end: string;
  today: string;
  plan_from: string;
  plan_to: string;
  away_lowers_targets: boolean;
  categories: { id: string; label: string; color: string | null }[];
  habits: PlanHabit[];
  lists: { id: string; name: string }[];
  days: PlanDay[];
  unscheduled: Todo[];
  earlier: Todo[];
};
