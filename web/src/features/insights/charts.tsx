// Hand-made SVG charts. One hue (the app's accent) plus neutral ink, so nothing depends on telling hues apart:
//   done        solid accent
//   extra       hatched accent (45 degrees), above the target, separated by a 2px gap
//   target      a short dark line across the column
//   not over    the same bar, lighter
// Text is HTML (under or beside the SVG), never inside it, so it stays sharp and wraps on a phone.
import { useState } from 'preact/hooks';
import { fmtMinutes } from '../../core/ui';
import type { HabitWeek } from './types';

/** Defined once per page: the hatch used by every "extra" mark. */
export function ChartDefs() {
  return (
    <svg class="ins-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="ins-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" class="ins-hatch-bg" />
          <rect width="3" height="6" class="ins-hatch-ink" />
        </pattern>
      </defs>
    </svg>
  );
}

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const dayLabel = shortDay;
export const rangeLabel = (a: string, b: string) => `${shortDay(a)} to ${shortDay(b)}`;

/** A column with a rounded top (4px) and a square foot. */
function column(x: number, y: number, w: number, h: number): string {
  const r = Math.max(0, Math.min(4, h, w / 2));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const COL = 40; // width of one column in the SVG's own units
const BAR = 24; // the bar inside it (never wider than 24)
const TOP = 6;
const BASE = 74;
const GAP = 2;

function readoutOf(w: HabitWeek): string {
  const range = `Week of ${shortDay(w.week)}`;
  switch (w.status) {
    case 'met':
      return `${range}: ${w.counted} of ${w.target}, on target${w.over ? `, +${w.over} over` : ''}`;
    case 'short':
      return `${range}: ${w.done} of ${w.target}`;
    case 'open':
      return `${range}: ${w.done} of ${w.target} so far${w.over ? ` (+${w.over} over)` : ''}${w.planned_later ? `, ${w.planned_later} planned later` : ''}`;
    case 'partial':
      return `${range}: ${w.done} done; the habit began part-way through, so it is not counted`;
    case 'paused':
      return `${range}: paused, not counted`;
    default:
      return `${range}: before this habit began`;
  }
}

/** Per-week bars for one habit: done against the target that applied then, extra above it shown apart. */
export function HabitBars({ weeks, name }: { weeks: HabitWeekWithLevel[]; name: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const shown = weeks.find((w) => w.week === picked) ?? [...weeks].reverse().find((w) => w.status !== 'before') ?? weeks[weeks.length - 1];
  const max = Math.max(1, ...weeks.filter((w) => w.status !== 'before' && w.status !== 'paused').flatMap((w) => [w.target, w.done]));
  const k = (BASE - TOP) / max;
  const width = weeks.length * COL;
  return (
    <div class="ins-chart">
      <div class="ins-plot">
        <span class="ins-ymax" aria-hidden="true">
          {max}
        </span>
        <svg viewBox={`0 0 ${width} 80`} role="group" aria-label={`${name}: sessions per week against the target`}>
          <line x1="0" x2={width} y1={BASE + 0.5} y2={BASE + 0.5} class="ins-axis" />
          {weeks.map((w, i) => {
            const x = i * COL;
            const bx = x + (COL - BAR) / 2;
            const draws = w.status !== 'before' && w.status !== 'paused';
            const hc = draws ? w.counted * k : 0;
            const ho = draws && w.status !== 'partial' ? w.over * k : 0;
            const light = w.status === 'open' || w.status === 'partial';
            const shownCounted = light && w.status === 'partial' ? Math.min(w.done, max) * k : hc;
            return (
              <g
                key={w.week}
                tabIndex={0}
                role="img"
                aria-label={readoutOf(w)}
                class={`ins-col ${shown === w ? 'sel' : ''}`}
                onMouseEnter={() => setPicked(w.week)}
                onFocus={() => setPicked(w.week)}
                onClick={() => setPicked(w.week)}
              >
                <rect x={x} y="0" width={COL} height="80" class="ins-hit" />
                {shown === w && <rect x={x + 2} y={TOP - 2} width={COL - 4} height={BASE - TOP + 2} rx="4" class="ins-sel" />}
                {w.status === 'paused' && <line x1={bx + 4} x2={bx + BAR - 4} y1={BASE - 3} y2={BASE - 3} class="ins-paused" />}
                {shownCounted > 0.5 && <path d={column(bx, BASE - shownCounted, BAR, shownCounted)} class={light ? 'ins-bar light' : 'ins-bar'} />}
                {ho > 0.5 && <path d={column(bx, BASE - hc - GAP - ho, BAR, ho)} class="ins-over" />}
                {draws && w.status !== 'partial' && w.target > 0 && (
                  <>
                    <line x1={bx - 4} x2={bx + BAR + 4} y1={BASE - w.target * k} y2={BASE - w.target * k} class="ins-target-halo" />
                    <line x1={bx - 4} x2={bx + BAR + 4} y1={BASE - w.target * k} y2={BASE - w.target * k} class="ins-target" />
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div class={`ins-xlabels ${weeks.length > 8 ? 'dense' : ''}`} style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {weeks.map((w, i) => (
          <span key={w.week} class={i % 2 === (weeks.length - 1) % 2 ? 'every' : 'odd'}>
            {shortDay(w.week)}
          </span>
        ))}
      </div>
      <p class="ins-readout" aria-live="polite">
        {readoutOf(shown)}
        {shown.level && shown.status !== 'before' ? <span class="muted"> · {shown.level}</span> : null}
      </p>
    </div>
  );
}
type HabitWeekWithLevel = HabitWeek & { level?: string };

/** Focus minutes for each day of a week. */
export function DayBars({ days, today }: { days: { day: string; minutes: number; sessions: number }[]; today: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const max = Math.max(30, ...days.map((d) => d.minutes));
  const k = (BASE - TOP) / max;
  const text = (d: { day: string; minutes: number; sessions: number }) =>
    `${new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}: ${d.sessions ? `${d.sessions} ${d.sessions === 1 ? 'session' : 'sessions'}, ${fmtMinutes(d.minutes)}` : d.day > today ? 'not yet' : 'no focus session'}`;
  const sel = days.find((d) => d.day === picked) ?? days.find((d) => d.day === today) ?? days[0];
  return (
    <div class="ins-chart">
      <div class="ins-plot">
        <span class="ins-ymax" aria-hidden="true">
          {fmtMinutes(max)}
        </span>
        <svg viewBox={`0 0 ${days.length * COL} 80`} role="group" aria-label="Focus time per day">
          <line x1="0" x2={days.length * COL} y1={BASE + 0.5} y2={BASE + 0.5} class="ins-axis" />
          {days.map((d, i) => {
            const x = i * COL;
            const h = d.minutes * k;
            return (
              <g key={d.day} tabIndex={0} role="img" aria-label={text(d)} class={`ins-col ${sel === d ? 'sel' : ''}`} onMouseEnter={() => setPicked(d.day)} onFocus={() => setPicked(d.day)} onClick={() => setPicked(d.day)}>
                <rect x={x} y="0" width={COL} height="80" class="ins-hit" />
                {sel === d && <rect x={x + 2} y={TOP - 2} width={COL - 4} height={BASE - TOP + 2} rx="4" class="ins-sel" />}
                {h > 0.5 ? <path d={column(x + (COL - BAR) / 2, BASE - h, BAR, h)} class={d.day > today ? 'ins-bar light' : 'ins-bar'} /> : d.sessions > 0 ? <circle cx={x + COL / 2} cy={BASE - 3} r="3" class="ins-dot" /> : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div class="ins-xlabels" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {days.map((d) => (
          <span key={d.day} class={`every ${d.day === today ? 'today' : ''}`}>
            {new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}
          </span>
        ))}
      </div>
      <p class="ins-readout" aria-live="polite">
        {text(sel)}
      </p>
    </div>
  );
}

/** A thin bar: `counted` solid, `over` hatched, a line at `target`. Scale ends at the larger of target and done. */
export function TargetBar({ counted, over, target, light }: { counted: number; over: number; target: number; light?: boolean }) {
  const total = Math.max(target, counted + over, 1);
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <span class="ins-tbar" aria-hidden="true">
      <span class={light ? 'fill light' : 'fill'} style={{ width: pct(counted) }} />
      {over > 0 && <span class="extra" style={{ left: `calc(${pct(counted)} + 2px)`, width: `calc(${pct(over)} - 2px)` }} />}
      {target > 0 && <span class="mark" style={{ left: pct(target) }} />}
    </span>
  );
}

/** One whole split into a part: a thin fully rounded bar. */
export function ShareBar({ share }: { share: number }) {
  return (
    <span class="ins-share" aria-hidden="true">
      <span style={{ width: `${Math.max(share > 0 ? 1.5 : 0, share * 100)}%` }} />
    </span>
  );
}
