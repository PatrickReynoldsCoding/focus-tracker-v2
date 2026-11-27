// The weekdays a habit shows on Today (D68): Mon–Sun toggle chips, "Every day" when none is chosen.
// The value is the stored text ("tue,thu") or null for every day (src/core/habit-days.ts).
import { DAY_KEYS, daysList, formatDays, normaliseDays, type DayKey } from '../../../../src/core/habit-days';

/** A level summary with the habit's days: "2 a week · Tue, Thu" (unchanged for every day). */
export const withDays = (text: string, days: string | null | undefined) => {
  const d = formatDays(days);
  return d ? (text ? `${text} · ${d}` : d) : text;
};

const LABEL: Record<DayKey, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const LONG: Record<DayKey, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export function DayPicker({ value, per, onChange }: { value: string | null; per: string | null; onChange: (days: string | null) => void }) {
  const chosen = daysList(value);
  const toggle = (k: DayKey) => onChange(normaliseDays(chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k]));
  return (
    <fieldset class="group day-picker">
      <legend>Days on Today</legend>
      <div class="day-chips" role="group" aria-label="Days the habit shows on Today">
        <button type="button" class={`chip day-every ${chosen.length ? '' : 'on'}`} aria-pressed={!chosen.length} onClick={() => onChange(null)}>
          Every day
        </button>
        {DAY_KEYS.map((k) => (
          <button key={k} type="button" class={`chip day-chip ${chosen.includes(k) ? 'on' : ''}`} aria-pressed={chosen.includes(k)} aria-label={LONG[k]} onClick={() => toggle(k)}>
            {LABEL[k]}
          </button>
        ))}
      </div>
      <span class="muted small">
        {!chosen.length
          ? 'It shows on Today every day.'
          : per === 'week'
            ? 'It shows on Today only on these days. The weekly target stays the same.'
            : 'It shows on Today, and counts, only on these days.'}
      </span>
    </fieldset>
  );
}
