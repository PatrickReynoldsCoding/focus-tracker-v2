// The Today list (docs/DECISIONS.md D30): everything for today in one list, as v1's "To do today"
// did. Habits first (in the owner's order), then to-dos and cards for today or left from an
// earlier day (oldest day first). Pure: the server (src/modules/today-list.ts, for Claude, the
// widget and the menu bar) and the web app (features/today-list) both build it here, so they agree.
//
// A daily habit stays until today's sessions are done ("1/3" when there are several). A weekly
// habit stays until the week is met ("1/3 wk"): a session today takes it off for today, and so
// does "Not today" (a skip). A to-do or card stays until ticked; what was done today is kept
// (state "done"), so it can be taken back.

export type TodayKind = 'habit' | 'todo' | 'card';
export type TodayState = 'open' | 'done' | 'skipped';

export interface TodayItem {
  /** `${kind}:${id}`, unique in the list. */
  key: string;
  kind: TodayKind;
  id: string;
  title: string;
  state: TodayState;
  /** Habits: how much one session is ("30 min"). */
  size?: string | null;
  /** Habits: sessions done of the target, "1/3" today or "1/3 wk" this week (none for a single daily session). */
  progress?: string | null;
  /** Habits: "day" or "week". */
  per?: 'day' | 'week';
  /** Habits: planned for today in Plan my week. */
  planned?: boolean;
  /** Weekly habits can be put off with "Not today". */
  can_skip?: boolean;
  /** To-dos and cards from an earlier day: the day they were for. */
  late?: string | null;
  /** To-dos and cards: the day they are for. */
  day?: string | null;
  /** Where it lives: the project's or list's name (cards; to-dos on a to-do list other than the first). */
  from?: string | null;
  list_id?: string | null;
  project_id?: string | null;
}

export interface TodayList {
  day: string;
  /** Open items first (habits, then to-dos and cards), then those done or put off today. */
  items: TodayItem[];
  left: number;
  done: number;
}

/** What the builder reads (GET /api/today has these: habits = habitProgress, todos = todosForDay, cards = cardsForDay). */
export interface TodayHabitIn {
  id: string;
  name: string;
  per: string | null;
  target: number | null;
  done_today: number;
  done_this_period: number;
  skipped_today: boolean;
  size?: string | null;
  planned_today?: number;
}
export interface TodayTodoIn {
  id: string;
  title: string;
  day: string | null;
  done: string | null;
  list_id?: string | null;
  list_name?: string | null;
  project_id?: string | null;
}
export interface TodayCardIn {
  id: string;
  title: string;
  day: string | null;
  done: string | null;
  project_id?: string | null;
  list_id?: string | null;
  /** The project's or list's name. */
  from?: string | null;
  /** A project card in its board's Done column (done there, even if not ticked in the list; D34). */
  in_last?: boolean;
}

export function habitItem(h: TodayHabitIn): TodayItem | null {
  const weekly = h.per === 'week';
  const target = h.target && h.target > 0 ? h.target : 1;
  const base = { key: `habit:${h.id}`, kind: 'habit' as const, id: h.id, title: h.name, size: h.size ?? null, per: weekly ? ('week' as const) : ('day' as const), planned: (h.planned_today ?? 0) > h.done_today };
  if (!weekly) {
    if (h.skipped_today && h.done_today < target) return { ...base, state: 'skipped', progress: null };
    const done = h.done_today >= target;
    return { ...base, state: done ? 'done' : 'open', progress: target > 1 ? `${Math.min(h.done_today, target)}/${target}` : null, can_skip: done ? undefined : true };
  }
  const progress = `${Math.min(h.done_this_period, target)}/${target} wk`;
  if (h.done_today > 0) return { ...base, state: 'done', progress };
  if (h.skipped_today) return { ...base, state: 'skipped', progress };
  if (h.done_this_period >= target) return null; // met for the week: nothing to do today
  return { ...base, state: 'open', progress, can_skip: true };
}

/** `hide`: keys ("todo:<id>", "card:<id>") the owner put off for today ("Not today"): they show as skipped, not open. */
export function buildTodayList(day: string, input: { habits?: TodayHabitIn[]; todos?: TodayTodoIn[]; cards?: TodayCardIn[]; hide?: string[] }): TodayList {
  const hide = new Set(input.hide ?? []);
  const habits = (input.habits ?? []).map(habitItem).filter((x): x is TodayItem => !!x);
  const things: (TodayItem & { at: number })[] = [];
  (input.todos ?? []).forEach((t, i) => {
    if (!(t.day && t.day <= day) && t.done !== day) return; // anytime to-dos stay in their list
    if (t.done && t.done !== day) return;
    things.push({
      key: `todo:${t.id}`,
      kind: 'todo',
      id: t.id,
      title: t.title,
      state: t.done ? 'done' : hide.has(`todo:${t.id}`) ? 'skipped' : 'open',
      day: t.day,
      late: t.day && t.day < day ? t.day : null,
      from: t.list_name ?? null,
      list_id: t.list_id ?? null,
      project_id: t.project_id ?? null,
      at: i,
    });
  });
  (input.cards ?? []).forEach((c, i) => {
    if (!c.day || c.day > day) return;
    const state: TodayState | null = c.done === day ? 'done' : !c.done && !c.in_last ? (hide.has(`card:${c.id}`) ? 'skipped' : 'open') : null;
    if (!state) return;
    things.push({
      key: `card:${c.id}`,
      kind: 'card',
      id: c.id,
      title: c.title,
      state,
      day: c.day,
      late: c.day < day ? c.day : null,
      from: c.from ?? null,
      list_id: c.list_id ?? null,
      project_id: c.project_id ?? null,
      at: 10000 + i,
    });
  });
  // Oldest day first (what was left from earlier comes before today's), to-dos before cards, then their own order.
  things.sort((a, b) => String(a.day ?? day).localeCompare(String(b.day ?? day)) || a.at - b.at);
  const all: TodayItem[] = [...habits, ...things.map(({ at: _at, ...x }) => x)];
  const open = all.filter((x) => x.state === 'open');
  const rest = all.filter((x) => x.state !== 'open');
  return { day, items: [...open, ...rest], left: open.length, done: rest.length };
}
