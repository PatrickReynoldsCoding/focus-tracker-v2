// What GET /api/insights/* return (src/modules/insights.ts).

export type WeekStatus = 'met' | 'short' | 'open' | 'partial' | 'paused' | 'before';

export interface HabitWeek {
  week: string;
  done: number;
  counted: number;
  over: number;
  target: number;
  status: WeekStatus;
  planned_later: number;
}

export interface WeekSummary {
  start: string;
  end: string;
  current: boolean;
  focus: { sessions: number; minutes: number; days: { day: string; sessions: number; minutes: number }[] };
  habits: (HabitWeek & { id: string; name: string; per: string; level: string })[];
  habit_totals: { counted: number; target: number; over: number };
  todos: { done: number; still_open: number; coming_up: number };
  skips: number;
}
export interface WeekData {
  today: string;
  weeks: WeekSummary[];
}

export interface HabitHistory {
  id: string;
  name: string;
  status: string;
  per: string;
  level: string;
  weeks: (HabitWeek & { level: string })[];
  counted_weeks: number;
  on_target_weeks: number;
}
export interface HabitsData {
  today: string;
  weeks: string[];
  habits: HabitHistory[];
}

export interface ProjectInsight {
  id: string | null;
  name: string;
  status: string;
  sessions: number;
  minutes: number;
  share: number;
  last_touched: string | null;
  days_since: number | null;
  stale: boolean;
  skips: number;
}
export interface ProjectsData {
  today: string;
  from: string;
  weeks: number;
  total_sessions: number;
  total_minutes: number;
  total_skips: number;
  projects: ProjectInsight[];
}

export interface LogLine {
  id: string;
  date: string;
  project_id: string | null;
  project_name: string | null;
  minutes: number | null;
  where_stopped: string | null;
}
export interface LogsData {
  rows: LogLine[];
  has_more: boolean;
  sessions: number;
  minutes: number;
}
