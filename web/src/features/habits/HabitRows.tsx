// The Habits panel as slim rows (D49, flag `panel-restyle`), the same look as the Today list's
// habit lines (D30): a circle to check in (one session), the name (opens the habit's notes and settings, D56), how far
// it is ("1/2", "2/3 wk") and Undo for a session done today. A habit whose target is met is
// ticked and struck through. Waiting prompts (Accept a new level, step-up) show above, as before.

import { useFlag } from '../../core/features';
import { record, type SetHabits } from './actions';
import { HabitCards } from './HabitRow';
import { HabitName } from './HabitName';
import type { Progress } from './types';
import '../today-list/today-list.css';

export const RESTYLE_FLAG = 'panel-restyle';

/** Is the restyle on? (Off: the older habit cards with dots and the day strip.) */
export const useRestyle = () => useFlag(RESTYLE_FLAG);

/** "1/2" today, "2/3 wk" this week, or how many today with no target. */
export function progressOf(h: Progress) {
  if (!h.target) return `${h.done_today} today`;
  const done = Math.min(h.done_this_period, h.target);
  return h.per === 'week' ? `${done}/${h.target} wk` : `${done}/${h.target}`;
}

const isMet = (h: Progress) => !!h.target && h.done_this_period >= h.target;

function HabitRowSlim({ h, set }: { h: Progress; set: SetHabits }) {
  const met = isMet(h);
  return (
    <li class={`tl-row hr-row${met ? ' done' : ''}`}>
      <button class={`tl-tick${met ? ' on' : ''}`} aria-label={`Done a session of ${h.name}`} title="Done a session" onClick={() => record(set, h, h.day, 1)}>
        {met ? '✓' : ''}
      </button>
      <HabitName id={h.id} name={h.name} notes={h.notes} class="tl-name">
        <span class="tl-title">{h.name}</span>
        {h.size && <small> · {h.size}</small>}
      </HabitName>
      <span class="tl-meta">
        {(h.planned_today ?? 0) > h.done_today && <span class="tag">planned</span>}
        {h.skipped_today && !met && <span>not today</span>}
        {h.off_day && !h.skipped_today && !met && <span>rest day</span>}
        {progressOf(h)}
      </span>
      {h.done_today > 0 && (
        <button class="link small tl-act" aria-label={`Take one session off ${h.name}`} title="Take one session off today" onClick={() => record(set, h, h.day, -1)}>
          Undo
        </button>
      )}
    </li>
  );
}

/** The slim rows, prompts first (also in the small version: a phone shows only that). `prompts: false` leaves them out. */
export function HabitRows({ habits, set, prompts = true }: { habits: Progress[]; set: SetHabits; prompts?: boolean }) {
  return (
    <>
      {prompts && habits.map((h) => <HabitCards key={h.id} h={h} set={set} />)}
      <ul class="tl-rows hr-rows">
        {habits.map((h) => (
          <HabitRowSlim key={h.id} h={h} set={set} />
        ))}
      </ul>
    </>
  );
}
