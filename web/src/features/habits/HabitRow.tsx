import { useState } from 'preact/hooks';
import { answerPending, answerStepUp, record, type SetHabits } from './actions';
import type { Progress } from './types';
import './habits.css';

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const weekdayLetter = (day: string) => LETTERS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];
const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** One dot per target session in the period, filled when done; sessions beyond the target show as "+n". */
export function Dots({ h, set }: { h: Progress; set: SetHabits }) {
  const target = h.target ?? 0;
  const shown = Math.min(target, 14);
  const extra = Math.max(0, h.done_this_period - target);
  const word = h.per === 'week' ? 'this week' : 'today';
  if (!target) {
    return (
      <div class="dots">
        <button class="dot-add" aria-label={`Done a session of ${h.name}`} onClick={() => record(set, h, h.day, 1)}>
          +
        </button>
        <span class="muted small">{h.done_today} today</span>
      </div>
    );
  }
  return (
    <div class="dots" role="group" aria-label={`${h.name}: ${Math.min(h.done_this_period, target)} of ${target} ${word}`}>
      {Array.from({ length: shown }, (_, i) => {
        const filled = i < h.done_this_period;
        return (
          <button
            key={i}
            class={`dot ${filled ? 'on' : ''}`}
            aria-pressed={filled}
            aria-label={`${h.name}: session ${i + 1} of ${target}, ${filled ? 'done' : 'not done'}. Tap to add a session`}
            onClick={() => record(set, h, h.day, 1)}
          />
        );
      })}
      {extra > 0 && <span class="dot-extra">+{extra}</span>}
      {h.done_today > 0 && (
        <button class="dot-minus" aria-label={`Take one session off ${h.name}`} onClick={() => record(set, h, h.day, -1)}>
          −
        </button>
      )}
    </div>
  );
}

/** The week (weekly habits) or the last 7 days (daily ones): tap a day to see or change its sessions. */
export function DayStrip({ h, set }: { h: Progress; set: SetHabits }) {
  const [open, setOpen] = useState<string | null>(null);
  const sel = h.days.find((d) => d.day === open);
  return (
    <div class="strip">
      <div class="strip-days" role="group" aria-label={`${h.name}: ${h.per === 'week' ? 'this week' : 'last 7 days'}`}>
        {h.days.map((d) => (
          <button
            key={d.day}
            class={`strip-day ${d.count ? 'has' : ''} ${d.day === h.day ? 'today' : ''} ${open === d.day ? 'sel' : ''}`}
            disabled={d.future}
            aria-label={`${dayName(d.day)}: ${d.count} ${d.count === 1 ? 'session' : 'sessions'}${d.planned ? `, ${d.planned} planned` : ''}`}
            aria-expanded={open === d.day}
            onClick={() => setOpen(open === d.day ? null : d.day)}
          >
            <span class="strip-l">{weekdayLetter(d.day)}</span>
            <span class="strip-n">{d.count || (d.future && d.planned ? '○' : '·')}</span>
          </button>
        ))}
      </div>
      {sel && (
        <div class="strip-edit">
          <span>{dayName(sel.day)}</span>
          <button class="icon" aria-label="One fewer" disabled={sel.count === 0} onClick={() => record(set, h, sel.day, -1)}>
            −
          </button>
          <strong aria-live="polite">{sel.count}</strong>
          <button class="icon" aria-label="One more" onClick={() => record(set, h, sel.day, 1)}>
            +
          </button>
        </div>
      )}
    </div>
  );
}

export function StepUpCard({ h, set }: { h: Progress; set: SetHabits }) {
  const su = h.step_up!;
  const [pick, setPick] = useState(su.suggested);
  const w = su.weeks;
  return (
    <div class="notice" role="group" aria-label={`Want to go further with ${h.name}?`}>
      <strong>Want to go further?</strong>
      <span>
        {h.name}: {w.done} of {w.target} sessions in the last {w.weeks} {w.weeks === 1 ? 'week' : 'weeks'}. Now {su.current}; goal {su.goal}.
      </span>
      {su.options.length > 1 ? (
        <div class="chips" role="radiogroup" aria-label="Which step">
          {su.options.map((o, i) => (
            <button key={o.kind} role="radio" aria-checked={pick === i} class={`chip ${pick === i ? 'on' : ''}`} onClick={() => setPick(i)}>
              {o.kind === 'sessions' ? 'More often' : 'Longer'}: {o.text}
            </button>
          ))}
        </div>
      ) : (
        <span>Next step: {su.options[0].text}</span>
      )}
      <div class="row">
        <button class="primary small" onClick={() => answerStepUp(set, h, 'yes', su.options[pick].kind)}>
          Yes, adjust
        </button>
        <button class="small" onClick={() => answerStepUp(set, h, 'not now')}>
          Not yet
        </button>
        <button class="ghost small" onClick={() => answerStepUp(set, h, 'at goal')}>
          I’m at my goal
        </button>
      </div>
    </div>
  );
}

export function PendingCard({ h, set }: { h: Progress; set: SetHabits }) {
  return (
    <div class="notice" role="group" aria-label={`New level for ${h.name}`}>
      <strong>New level for {h.name}</strong>
      <span>
        {h.pending!.text} (now {h.level}). It applies from {h.per === 'week' ? 'this week' : 'today'}.
      </span>
      <div class="row">
        <button class="primary small" onClick={() => answerPending(set, h, 'accept')}>
          Accept
        </button>
        <button class="small" onClick={() => answerPending(set, h, 'not yet')}>
          Not yet
        </button>
      </div>
    </div>
  );
}

export function AskStopCard({ h, set }: { h: Progress; set: SetHabits }) {
  return (
    <div class="notice" role="group" aria-label={`Stop asking about ${h.name}?`}>
      <strong>Stop asking about {h.name}?</strong>
      <span>You have said “not yet” three times.</span>
      <div class="row">
        <button class="small" onClick={() => answerStepUp(set, h, 'stop asking')}>
          Stop asking
        </button>
        <button class="small" onClick={() => answerStepUp(set, h, 'keep asking')}>
          Keep asking
        </button>
      </div>
    </div>
  );
}

/** Which cards a habit has waiting (Accept comes before a new prompt). */
export function HabitCards({ h, set }: { h: Progress; set: SetHabits }) {
  return (
    <>
      {h.pending?.due && <PendingCard h={h} set={set} />}
      {h.step_up && !h.pending && <StepUpCard h={h} set={set} />}
      {h.ask_stop && <AskStopCard h={h} set={set} />}
    </>
  );
}

/** Name, level, dots and the day strip of one active habit. */
export function HabitLine({ h, set, strip }: { h: Progress; set: SetHabits; strip?: 'always' | 'toggle' }) {
  const [showDays, setShowDays] = useState(strip === 'always');
  const met = !!h.target && h.left === 0;
  return (
    <div class={`habit ${met ? 'met' : ''}`}>
      <div class="habit-top">
        <strong>{h.name}</strong>
        <span class="muted small">
          {h.target ? `${Math.min(h.done_this_period, h.target)} of ${h.target} ${h.per === 'week' ? 'this week' : 'today'}` : `${h.done_today} today`}
          {h.size ? ` · ${h.size}` : ''}
          {(h.planned_today ?? 0) > h.done_today ? ' · planned today' : ''}
          {h.planned_later ? ` · ${h.planned_later} planned later this week` : ''}
        </span>
      </div>
      <Dots h={h} set={set} />
      {!met && h.small_version && <span class="muted small">Small version: {h.small_version}</span>}
      {strip === 'toggle' && (
        <button class="link small" aria-expanded={showDays} onClick={() => setShowDays(!showDays)}>
          {showDays ? 'Hide days' : h.per === 'week' ? 'Days this week' : 'Earlier days'}
        </button>
      )}
      {showDays && <DayStrip h={h} set={set} />}
    </div>
  );
}
