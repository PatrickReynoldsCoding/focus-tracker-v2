import { useEffect } from 'preact/hooks';
import { put, say, version } from '../../core/api';
import { useDraggable } from '../../core/draggable';
import { OwnValue, scopedChange, ScopeChoice, useScopeStates } from '../../core/scope';
import { Loading } from '../../core/ui';
import { mmss, nextLabel, nextPomodoro, pausePomodoro, phaseLabel, resumePomodoro, startPomodoro, startPomodoroClock, stopPomodoro, usePomodoro, type LivePomodoro } from './store';

const icon = (p: LivePomodoro) => (p.phase === 'work' ? '🍅' : '☕');

function Controls({ p, small }: { p: LivePomodoro; small?: boolean }) {
  const cls = small ? 'small' : '';
  return (
    <div class="row pomo-controls">
      {p.waiting ? (
        <button class={`primary ${cls}`} onClick={() => nextPomodoro()}>
          {nextLabel(p)}
        </button>
      ) : (
        <>
          <button class={`ghost ${cls}`} onClick={() => (p.paused ? resumePomodoro() : pausePomodoro())}>
            {p.paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button class={`ghost ${cls}`} onClick={() => nextPomodoro()} title="Skip to the next period now">
            ⏭ {p.phase === 'work' ? 'Break now' : 'Work now'}
          </button>
        </>
      )}
      <button class={`ghost ${cls}`} onClick={() => stopPomodoro()} title="Stop the pomodoro">
        ✕ Stop
      </button>
    </div>
  );
}

/** A small timer on every page, Today and project pages included, while the Pomodoro runs: bottom right, or wherever it was dragged. */
export function FloatingPomodoro() {
  useEffect(startPomodoroClock, []);
  const { pomodoro: p } = usePomodoro();
  const { ref, onPointerDown, gripProps, moving } = useDraggable<HTMLDivElement>('ft.pomodoro.place');
  if (!p) return null;
  return (
    <div
      ref={ref}
      class={`pomo-float drag-float${p.waiting ? ' waiting' : ''}${moving ? ' dragging' : ''}`}
      role="timer"
      aria-label="Pomodoro"
      onPointerDown={(e) => onPointerDown(e as unknown as PointerEvent)}
    >
      <span class="pomo-time">
        <span {...gripProps}>⠿</span>
        {icon(p)} {p.waiting ? (p.phase === 'work' ? 'Break time' : 'Back to work') : mmss(p.left)}
        {p.paused && ' ⏸'}
      </span>
      <span class="muted small">
        {phaseLabel(p)} · {p.round}/{p.rounds}
      </span>
      <Controls p={p} small />
    </div>
  );
}

/** The Today panel: start the Pomodoro, or see and steer the running one. */
export function PomodoroPanel() {
  useEffect(startPomodoroClock, []);
  const { pomodoro: p, config } = usePomodoro();
  if (!p)
    return (
      <section class="card pomo-panel">
        <h2>Pomodoro</h2>
        <div class="row">
          <button class="primary" onClick={() => startPomodoro()}>
            🍅 Start pomodoro
          </button>
          {config && (
            <span class="muted small">
              {config.work} min work, {config.break} min break, {config.long_break} min long break after {config.rounds} rounds
            </span>
          )}
        </div>
      </section>
    );
  return (
    <section class="card pomo-panel">
      <h2>Pomodoro</h2>
      <div class="pomo-big">
        {icon(p)} {p.waiting ? (p.phase === 'work' ? 'Break time' : 'Back to work') : mmss(p.left)}
      </div>
      <p class="muted small">
        {phaseLabel(p)}, round {p.round} of {p.rounds}
        {p.paused && ' (paused)'}
      </p>
      <Controls p={p} />
    </section>
  );
}

/** The mobile version: one line, tap to start or open. */
export function PomodoroCompact() {
  useEffect(startPomodoroClock, []);
  const { pomodoro: p } = usePomodoro();
  return p ? (
    <div class="row pomo-compact">
      <strong>
        {icon(p)} {p.waiting ? nextLabel(p) : mmss(p.left)}
      </strong>
      <Controls p={p} small />
    </div>
  ) : (
    <button class="primary" onClick={() => startPomodoro()}>
      🍅 Start pomodoro
    </button>
  );
}

const SECTION = 'pomodoro';
const LENGTHS = [25, 50, 90];

/** Settings → Pomodoro: lengths, rounds, breaks pausing the session, the menu bar countdown and the
 *  planned length of a new session; each for this profile or for every profile (D46). */
export function PomodoroSettings() {
  const { states, of } = useScopeStates();
  if (!states) return <Loading />;
  const valueOf = (id: string) => (of(id)?.value as string | null | undefined) ?? null;
  // Settings are not part of undo: a plain message.
  const set = async (key: string, value: string, reset?: () => void) => {
    const v = value || null;
    if (v === valueOf(key)) return;
    try {
      const sent = await scopedChange(SECTION, [key], states, (scope) => put(`/settings/${key}`, { value: v, scope }).then(() => scope));
      if (sent === false) return reset?.();
      version.value++;
      say(sent === 'all' ? 'Saved for every profile' : 'Saved');
    } catch (err) {
      reset?.();
      say(`Not saved: ${(err as Error).message}`, 'error');
    }
  };
  const mark = (id: string) => <OwnValue state={of(id)} section={SECTION} />;
  const number = (key: string, label: string, fallback: string) => {
    const shown = valueOf(key) ?? fallback;
    return (
      <label>
        {label}
        <input
          key={`${key}-${shown}`}
          type="number"
          min={1}
          defaultValue={shown}
          onBlur={(e) => {
            const el = e.target as HTMLInputElement;
            if (el.value !== shown) set(key, el.value, () => (el.value = shown));
          }}
        />
        {mark(key)}
      </label>
    );
  };
  const check = (key: string, label: string, on: boolean) => (
    <label class="inline">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          const el = e.target as HTMLInputElement;
          set(key, el.checked ? 'on' : 'off', () => (el.checked = on));
        }}
      />{' '}
      <span>
        {label}
        {mark(key)}
      </span>
    </label>
  );
  const length = valueOf('session.length') ?? '25';
  return (
    <section class="card">
      <h2>Pomodoro</h2>
      <ScopeChoice section={SECTION} />
      <div class="stack">
        <div class="row pomo-lengths">
          {number('pomodoro.work', 'Work (min)', '25')}
          {number('pomodoro.break', 'Break (min)', '5')}
          {number('pomodoro.long_break', 'Long break (min)', '15')}
          {number('pomodoro.rounds', 'Rounds before a long break', '4')}
        </div>
        {check('pomodoro.breaks_pause_session', 'A break also pauses the session timer (work resumes it)', valueOf('pomodoro.breaks_pause_session') === 'on')}
        {check('swiftbar.show_pomodoro', 'Show the Pomodoro countdown in the Mac menu bar (SwiftBar)', valueOf('swiftbar.show_pomodoro') !== 'off')}
        <label>
          <span>
            A new session is planned for
            {mark('session.length')}
          </span>
          <select
            value={length}
            onChange={(e) => {
              const el = e.target as HTMLSelectElement;
              set('session.length', el.value, () => (el.value = length));
            }}
          >
            {[...new Set([...LENGTHS.map(String), length])]
              .filter((v) => v !== 'none')
              .sort((a, b) => Number(a) - Number(b))
              .map((v) => (
                <option key={v} value={v}>
                  {v} min
                </option>
              ))}
            <option value="none">No limit</option>
          </select>
          <span class="muted small">The last length chosen when starting a session; starting one with another length changes it.</span>
        </label>
      </div>
    </section>
  );
}
