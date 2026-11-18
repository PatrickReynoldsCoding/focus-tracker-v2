// The session controls shared by the focus card on Today and the session panel
// on the focus project's page: start (length, pomodoro), the timer, Pause /
// Resume, the pomodoro's "Start break" / "Start work", "Time is up" with
// Finish or Keep going, and the shutdown note.

import { useState } from 'preact/hooks';
import { change, post } from '../../core/api';
import { Dialog } from '../../core/ui';
import { clock, keepGoing, nextPeriod, pause, resume, setPomodoro, start, useSession, type Defaults, type Live } from './session';
import { setCornerHidden, useCornerHidden } from './CornerTimer';
import { useFlag } from '../../core/features';

const MAX = 600;

/** "for 25 min" picker: 25, 50, 90, No limit, Custom… */
function LengthPicker({ value, lengths, onChange }: { value: number | null; lengths: number[]; onChange: (v: number | null) => void }) {
  const [custom, setCustom] = useState(value !== null && !lengths.includes(value));
  const [text, setText] = useState(value !== null && !lengths.includes(value) ? String(value) : '');
  const sel = custom ? 'custom' : value === null ? 'none' : String(value);
  return (
    <span class="length-pick">
      <select
        aria-label="Planned length"
        value={sel}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v === 'custom') {
            setCustom(true);
            setText(value ? String(value) : '');
          } else {
            setCustom(false);
            onChange(v === 'none' ? null : Number(v));
          }
        }}
      >
        {lengths.map((n) => (
          <option key={n} value={String(n)}>
            for {n} min
          </option>
        ))}
        <option value="none">No limit</option>
        <option value="custom">Custom…</option>
      </select>
      {custom && (
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX}
          step={1}
          aria-label="Minutes (1 to 600)"
          placeholder="min"
          value={text}
          onInput={(e) => {
            const t = (e.target as HTMLInputElement).value;
            setText(t);
            const n = Number(t);
            if (Number.isInteger(n) && n >= 1 && n <= MAX) onChange(n);
          }}
        />
      )}
    </span>
  );
}

export function StartControls({ defaults, extra }: { defaults: Defaults | undefined; extra?: preact.ComponentChildren }) {
  const d = defaults ?? { pomodoro: true, work: 25, break: 5, planned_min: 25, lengths: [25, 50, 90] };
  const [length, setLength] = useState<number | null>(d.planned_min);
  const [pomodoro, setPomo] = useState(d.pomodoro);
  const [busy, setBusy] = useState(false);
  return (
    <div class="start-controls">
      <div class="row">
        <button
          class="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await start({ planned_min: length, pomodoro });
            setBusy(false);
          }}
        >
          Start session
        </button>
        <LengthPicker value={length} lengths={d.lengths} onChange={setLength} />
        {extra}
      </div>
      <label class="inline small">
        <input type="checkbox" checked={pomodoro} onChange={(e) => setPomo((e.target as HTMLInputElement).checked)} /> Pomodoro ({d.work} min work, {d.break} min break)
      </label>
    </div>
  );
}

function Timer({ l }: { l: Live }) {
  const p = l.pomodoro;
  let big: string, label: string, cls: string;
  if (p) {
    big = clock(p.left);
    label = p.waiting ? (p.phase === 'work' ? 'Work period over' : 'Break over') : `${p.phase === 'work' ? 'Work' : 'Break'} · round ${p.round}`;
    cls = p.phase;
  } else if (l.planned) {
    big = clock(l.planned.left);
    label = 'left';
    cls = 'work';
  } else {
    big = clock(l.worked);
    label = 'worked';
    cls = 'work';
  }
  const rest: string[] = [];
  if (p || l.planned) rest.push(`Worked ${clock(l.worked)}`);
  if (l.planned && p) rest.push(`Planned ${l.planned.minutes} min · ${clock(l.planned.left)} left`);
  else if (l.planned) rest.push(`Planned ${l.planned.minutes} min`);
  return (
    <div class={`timer ${l.paused ? 'paused' : ''}`} role="timer" aria-live="off">
      <div class={`pomo ${cls}`}>
        <span class="big">{big}</span>
        <span class="muted">{l.paused ? 'Paused' : label}</span>
      </div>
      {rest.length > 0 && <span class="muted small">{rest.join(' · ')}</span>}
    </div>
  );
}

/** The running session: timer, alerts and buttons. */
export function SessionBox({ l, onFinish }: { l: Live; onFinish: () => void }) {
  const cornerOn = useFlag('corner-timer');
  const hidden = useCornerHidden();
  const p = l.pomodoro;
  return (
    <div class="session-box">
      <Timer l={l} />
      {l.planned?.timeUp ? (
        <div class="callout up" role="alert">
          <strong>Time is up.</strong> <span class="muted">{l.planned.minutes} min planned.</span>
          <div class="row">
            <button class="primary" onClick={onFinish}>
              Finish
            </button>
            <span class="muted small">Keep going:</span>
            <button class="small" onClick={() => keepGoing(10)}>
              +10 min
            </button>
            <button class="small" onClick={() => keepGoing(25)}>
              +25 min
            </button>
            <button class="small ghost" onClick={() => keepGoing(null)}>
              No limit
            </button>
          </div>
        </div>
      ) : null}
      {p?.waiting && (
        <div class={`callout ${p.phase === 'work' ? 'brk' : 'wrk'}`} role="alert">
          <strong>{p.phase === 'work' ? 'Time for a break.' : 'Break over.'}</strong>{' '}
          <span class="muted">{p.phase === 'work' ? `${p.break} minutes. Stand up and stretch.` : `Round ${p.round + 1} next.`}</span>
          <div class="row">
            <button class="primary" onClick={() => nextPeriod()}>
              {p.phase === 'work' ? 'Start break' : 'Start work'}
            </button>
          </div>
        </div>
      )}
      <div class="row">
        {l.paused ? (
          <button class="primary" onClick={() => resume()}>
            ▶ Resume
          </button>
        ) : (
          <button onClick={() => pause()}>❚❚ Pause</button>
        )}
        <button class={l.planned?.timeUp ? '' : 'primary'} onClick={onFinish}>
          Finish
        </button>
        {p && !p.waiting && (
          <button class="ghost small" onClick={() => nextPeriod()} title={p.phase === 'work' ? 'Start the break now' : 'Start work now'}>
            {p.phase === 'work' ? 'Break now' : 'Work now'}
          </button>
        )}
        <label class="inline small pomo-switch">
          <input type="checkbox" checked={!!p} onChange={(e) => setPomodoro((e.target as HTMLInputElement).checked)} /> Pomodoro
        </label>
        {cornerOn && hidden && (
          <button
            class="ghost small"
            onClick={() => setCornerHidden(false)}
          >
            Show timer
          </button>
        )}
      </div>
    </div>
  );
}

export function ShutdownDialog({ onClose }: { onClose: () => void }) {
  const [where, setWhere] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  return (
    <Dialog title="Finish session" onClose={onClose}>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          onClose();
          await change(() => post('/session/stop', { where_stopped: where || undefined }), 'Session logged');
        }}
      >
        <label>
          Where did you stop?
          <textarea rows={3} value={where} onInput={(e) => setWhere((e.target as HTMLTextAreaElement).value)} autoFocus />
        </label>
        {confirmDiscard ? (
          <div class="callout up">
            <span>Delete this session? No log line and no minutes. This cannot be undone.</span>
            <div class="row">
              <button
                type="button"
                class="danger"
                onClick={async () => {
                  onClose();
                  await change(() => post('/session/stop', { discard: true }), 'Session deleted');
                }}
              >
                Delete
              </button>
              <button type="button" class="ghost" onClick={() => setConfirmDiscard(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div class="row spread">
            <button type="button" class="ghost small danger" onClick={() => setConfirmDiscard(true)}>
              Delete this session
            </button>
            <button class="primary">Log session</button>
          </div>
        )}
      </form>
    </Dialog>
  );
}

/** Session controls for a project: running timer, or Start when it is today's focus. */
export function SessionArea({ projectId, showStart }: { projectId: string | null; showStart: boolean }) {
  const { data, live: l } = useSession();
  const [finishing, setFinishing] = useState(false);
  const own = l && (!projectId || l.session.project_id === projectId);
  return (
    <>
      {own ? <SessionBox l={l!} onFinish={() => setFinishing(true)} /> : l ? null : showStart && <StartControls key={`${data?.defaults.planned_min}:${data?.defaults.pomodoro}`} defaults={data?.defaults} />}
      {finishing && <ShutdownDialog onClose={() => setFinishing(false)} />}
    </>
  );
}
