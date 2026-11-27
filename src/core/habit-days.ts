// The weekdays a habit shows on (DECISIONS D68): habits.days holds them as text, Monday first,
// "tue,thu"; null means every day. Shared by the server and the web app's day picker.

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const SHORT: Record<DayKey, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** The weekday of an ISO day ("2026-11-24" → "tue"). */
export function dayKeyOf(day: string): DayKey {
  return DAY_KEYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];
}

/**
 * Read what was given for `days` ("tue,thu", "Tue, Thu", "tuesday thursday", a list) into the stored
 * text: known weekdays, Monday first, no repeats. Nothing, or all seven, is null (every day).
 * Throws a message naming the word it could not read.
 */
export function normaliseDays(value: unknown): string | null {
  if (value == null) return null;
  const words = Array.isArray(value) ? value.map(String) : String(value).split(/[\s,;/]+/);
  const chosen = new Set<DayKey>();
  for (const raw of words) {
    const w = raw.trim().toLowerCase();
    if (!w) continue;
    const key = DAY_KEYS.find((k) => w.startsWith(k) && (w.length === 3 || fullName(k).startsWith(w)));
    if (!key) throw new Error(`days: "${raw}" is not a weekday. Use mon, tue, wed, thu, fri, sat, sun, comma-separated ("tue,thu"), or empty for every day`);
    chosen.add(key);
  }
  if (chosen.size === 0 || chosen.size === 7) return null;
  return DAY_KEYS.filter((k) => chosen.has(k)).join(',');
}

function fullName(k: DayKey): string {
  return { mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' }[k];
}

/** The stored text as a list (empty = every day). Unknown words are ignored. */
export function daysList(days: string | null | undefined): DayKey[] {
  if (!days) return [];
  const set = new Set(String(days).split(',').map((s) => s.trim()));
  return DAY_KEYS.filter((k) => set.has(k));
}

/** Does a habit with these days show on `day`? Every day when none are chosen. */
export function showsOn(days: string | null | undefined, day: string): boolean {
  const list = daysList(days);
  return list.length === 0 || list.includes(dayKeyOf(day));
}

/** "Tue, Thu" (null when every day), for summaries such as "2 a week · Tue, Thu". */
export function formatDays(days: string | null | undefined): string | null {
  const list = daysList(days);
  return list.length ? list.map((k) => SHORT[k]).join(', ') : null;
}
