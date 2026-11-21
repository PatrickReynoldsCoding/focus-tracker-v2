// Session plug-ins: the background runtime and corner timer (overlays), the
// session panel at the top of the focus project's page, and the per-device
// session settings (where the app opens, sounds, corner timer).

import { useEffect, useState } from 'preact/hooks';
import { useFlag } from '../../core/features';
import { registerOverlay, registerPanel } from '../../core/registry';
import { CornerTimer, setCornerHidden, useCornerHidden } from './CornerTimer';
import { openOn, setOpenOn, type OpenOn } from './openOn';
import { useSession, startRuntime } from './session';
import { SessionArea } from './SessionControls';
import { play, setSoundOn, soundOn } from './sounds';
import './session.css';

function Runtime() {
  useEffect(() => startRuntime(), []);
  return null;
}

function ProjectSession({ projectId }: { projectId: string }) {
  const { data, live } = useSession();
  const isFocus = data?.focus?.id === projectId;
  const running = live?.session.project_id === projectId;
  if (!running && !(isFocus && !live)) return null;
  return (
    <section class="card session-panel">
      <div class="card-head">
        <h2>{running ? 'Session' : 'Today’s focus'}</h2>
      </div>
      <SessionArea projectId={projectId} showStart={isFocus} />
    </section>
  );
}

function SessionSettings() {
  const [open, setOpen] = useState<OpenOn>(openOn());
  const [sound, setSound] = useState(soundOn());
  const hidden = useCornerHidden();
  const corner = useFlag('corner-timer');
  return (
    <section class="card">
      <h2>Sessions on this device</h2>
      <div class="stack">
        <label>
          When the app opens
          <select
            value={open}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value as OpenOn;
              setOpen(v);
              setOpenOn(v);
            }}
          >
            <option value="today">Today (the focus project during a session)</option>
            <option value="last">The page I was on</option>
          </select>
        </label>
        <label class="inline">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              setSound(on);
              setSoundOn(on);
            }}
          />
          Sound when a pomodoro period or the planned time ends
        </label>
        <div class="row">
          <button class="small" onClick={() => play('work-ends', true)}>
            ▶ Try “work ends”
          </button>
          <button class="small" onClick={() => play('break-ends', true)}>
            ▶ Try “break ends”
          </button>
        </div>
        {corner && (
          <label class="inline">
            <input type="checkbox" checked={!hidden} onChange={(e) => setCornerHidden(!(e.target as HTMLInputElement).checked)} />
            Corner timer during a session
          </label>
        )}
      </div>
    </section>
  );
}

registerOverlay({ id: 'session-runtime', order: 0, render: () => <Runtime /> });
registerOverlay({ id: 'corner-timer', order: 10, feature: 'corner-timer', render: ({ route }) => <CornerTimer route={route} /> });
registerPanel('project', { id: 'session', icon: '▶', title: 'Session', description: 'Start a session on this project, or the one running.', order: 1, wide: true, render: ({ project }) => <ProjectSession projectId={project.id} /> });
registerPanel('settings', { id: 'sessions', order: 15, scope: 'device', render: () => <SessionSettings /> });
