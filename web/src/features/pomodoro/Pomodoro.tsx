import { useEffect } from 'preact/hooks';
import { change, put } from '../../core/api';
import { Loading, useData } from '../../core/ui';
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

/** A small timer at the corner of every page, Today and project pages included, while the Pomodoro runs. */
export function FloatingPomodoro() {
  useEffect(startPomodoroClock, []);
  const { pomodoro: p } = usePomodoro();
  if (!p) return null;
  return (
    <div class={`pomo-float${p.waiting ? ' waiting' : ''}`} role="timer" aria-label="Pomodoro">
      <span class="pomo-time">
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

export function PomodoroSettings() {
  const { data } = useData<{ global: Record<string, string>; mode: Record<string, string> }>('/settings');
  if (!data) return <Loading />;
  const set = (key: string, value: string) => change(() => put(`/settings/${key}`, { value: value || null, global: false }), 'Saved');
  const number = (key: string, label: string, fallback: string) => (
    <label>
      {label}
      <input type="number" min={1} defaultValue={data.mode[key] ?? fallback} onBlur={(e) => set(key, (e.target as HTMLInputElement).value)} />
    </label>
  );
  const check = (key: string, label: string, on: boolean) => (
    <label class="inline">
      <input type="checkbox" defaultChecked={on} onChange={(e) => set(key, (e.target as HTMLInputElement).checked ? 'on' : 'off')} /> {label}
    </label>
  );
  return (
    <section class="card">
      <h2>Pomodoro</h2>
      <div class="stack">
        <div class="row">
          {number('pomodoro.work', 'Work (min)', '25')}
          {number('pomodoro.break', 'Break (min)', '5')}
          {number('pomodoro.long_break', 'Long break (min)', '15')}
          {number('pomodoro.rounds', 'Rounds before a long break', '4')}
        </div>
        {check('pomodoro.breaks_pause_session', 'A break also pauses the session timer (work resumes it)', data.mode['pomodoro.breaks_pause_session'] === 'on')}
        {check('swiftbar.show_pomodoro', 'Show the Pomodoro countdown in the Mac menu bar (SwiftBar)', data.mode['swiftbar.show_pomodoro'] !== 'off')}
      </div>
    </section>
  );
}
