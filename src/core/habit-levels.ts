// Habit levels: the pure maths shared by the server (src/modules/habits.ts) and the
// new-habit dialog (web/src/features/habits). No imports, so both can use it.
//
// A level is "how much, how often": sessions per day or week, and an optional size.
// It is stored as text in the v1 style, so imported data and Claude's edits read the same:
//   "3 a week, 30 min"   "1 a day"   goal: "5 a week, 45 min"

export type Per = 'day' | 'week';

export interface Level {
  sessions: number | null;
  per: Per;
  /** Size of one session, as a number, with its unit ("min", "km", "push-ups"). */
  size: number | null;
  unit: string | null;
}

function normaliseUnit(u: string): string | null {
  const unit = u.trim().toLowerCase();
  if (!unit) return null;
  if (['minute', 'minutes', 'mins', 'min'].includes(unit)) return 'min';
  if (['hour', 'hours', 'hrs', 'hr', 'h'].includes(unit)) return 'h';
  return unit;
}

/** "30 min" -> { size: 30, unit: 'min' }. A text that does not start with a number gives null. */
export function parseSize(text: string | null | undefined): { size: number; unit: string | null } | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(.*?)\s*$/.exec(text ?? '');
  if (!m) return null;
  const size = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(size) || size <= 0) return null;
  return { size, unit: normaliseUnit(m[2]) };
}

/**
 * "4 a week, 30 min" or "2 per day" or "3/week". `fallbackPer` is used when the text names none.
 * Returns null when the text does not start with a number of sessions.
 */
export function parseLevel(text: string | null | undefined, fallbackPer: Per = 'day'): Level | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  const [head, ...rest] = t.split(',');
  const m = /^(\d+)\s*(?:x|×|times?)?\s*(?:(?:a|an|per|every|\/|each)\s*(day|week|daily|weekly))?\s*$/i.exec(head.trim());
  if (!m) return null;
  const per: Per = m[2] ? (/^w/i.test(m[2]) ? 'week' : 'day') : fallbackPer;
  const size = parseSize(rest.join(',').trim());
  return { sessions: Number(m[1]), per, size: size?.size ?? null, unit: size?.unit ?? null };
}

export function formatSize(size: number | null, unit: string | null): string {
  if (size == null) return '';
  const n = Number.isInteger(size) ? String(size) : String(Math.round(size * 10) / 10);
  return unit ? `${n} ${unit}` : n;
}

export function formatLevel(l: Level): string {
  const head = l.sessions == null ? '' : `${l.sessions} a ${l.per}`;
  return [head, formatSize(l.size, l.unit)].filter(Boolean).join(', ');
}

/** The level a habit row holds in its own columns (sessions, per, size text). */
export function levelFromRow(row: Record<string, unknown>): Level {
  const sz = parseSize(typeof row.size === 'string' ? row.size : null);
  return {
    sessions: typeof row.sessions === 'number' ? row.sessions : null,
    per: row.per === 'week' ? 'week' : 'day',
    size: sz?.size ?? null,
    unit: sz?.unit ?? null,
  };
}

/** "2 weeks", "10 days", "1 month" -> days. Null when there is no pace. */
export function parseEvery(text: string | null | undefined): number | null {
  const m = /^\s*(\d+)\s*(day|week|month)s?\s*$/i.exec(text ?? '');
  if (!m) return null;
  const unit = m[2].toLowerCase();
  const n = Number(m[1]) * (unit === 'day' ? 1 : unit === 'week' ? 7 : 30);
  return n > 0 ? n : null;
}

/** Sessions the level asks for in one week (a daily habit counts seven days). */
export const weekTarget = (l: Level): number => (l.sessions ?? 0) * (l.per === 'day' ? 7 : 1);

const isMinutes = (unit: string | null) => unit === 'min' || unit === null;

/** The next size after `size`: +5 under 30 minutes, then +10 or about 20 %; other units grow by about 20 %. Never past `goal`. */
export function nextSize(size: number, unit: string | null, goal: number | null): number {
  let step: number;
  if (isMinutes(unit)) step = size < 30 ? 5 : Math.max(10, Math.round((size * 0.2) / 5) * 5);
  else step = Math.max(1, Math.round(size * 0.2));
  const next = size + step;
  return goal != null ? Math.min(next, goal) : next;
}

export interface Step {
  kind: 'sessions' | 'size';
  level: Level;
  text: string;
}

const mkStep = (kind: Step['kind'], level: Level): Step => ({ kind, level, text: formatLevel(level) });

/** One step from `cur` towards `goal`: one more session, a longer session, or both as a choice. */
export function nextSteps(cur: Level, goal: Level): { options: Step[]; suggested: number } {
  const options: Step[] = [];
  const more = cur.sessions != null && goal.sessions != null && cur.sessions < goal.sessions;
  const longer = cur.size != null && goal.size != null && cur.size < goal.size;
  if (more) options.push(mkStep('sessions', { ...cur, sessions: cur.sessions! + 1 }));
  if (longer) options.push(mkStep('size', { ...cur, size: nextSize(cur.size!, cur.unit, goal.size) }));
  let suggested = 0;
  if (options.length === 2) {
    // Take the step on the road with more steps left, so the long road is not left to the end.
    const sessionsLeft = goal.sessions! - cur.sessions!;
    let sizeLeft = 0;
    for (let s = cur.size!; s < goal.size! && sizeLeft < 50; sizeLeft++) s = nextSize(s, cur.unit, goal.size);
    suggested = sizeLeft > sessionsLeft ? 1 : 0;
  }
  return { options, suggested };
}

/** The levels from `start` to `goal`, one step at a time (the preview in the new-habit dialog). */
export function stepsToGoal(start: Level, goal: Level): Level[] {
  const out: Level[] = [start];
  let cur = start;
  for (let i = 0; i < 40; i++) {
    const { options, suggested } = nextSteps(cur, goal);
    if (!options.length) break;
    cur = options[suggested].level;
    out.push(cur);
  }
  return out;
}

/** A start level at about a third of the goal's sessions and half its size, rounded down, never below 1 session or 5 minutes. */
export function suggestStart(goal: Level): Level {
  const sessions = goal.sessions == null ? null : Math.max(1, Math.min(goal.sessions, Math.round(goal.sessions / 3)));
  let size: number | null = null;
  if (goal.size != null) {
    size = Math.floor(goal.size / 2);
    if (isMinutes(goal.unit)) size = size >= 10 ? Math.floor(size / 5) * 5 : Math.max(5, size);
    size = Math.max(1, Math.min(size, goal.size));
  }
  return { sessions, per: goal.per, size, unit: goal.unit };
}

/** True when no step towards the goal is left. */
export const atGoal = (cur: Level, goal: Level): boolean => nextSteps(cur, goal).options.length === 0;
