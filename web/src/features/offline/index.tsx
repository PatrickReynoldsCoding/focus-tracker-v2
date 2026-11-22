// Offline use, what you see of it (the work is in core/offline.ts and public/sw.js): the header's
// "Offline · 2 waiting" / "Updating…" and a Settings section with the waiting changes and any
// that could not be applied. Flag 'offline'.
import { useState } from 'preact/hooks';
import { say } from '../../core/api';
import { flags } from '../../core/features';
import * as offline from '../../core/offline';
import { registerHeaderItem, registerPanel } from '../../core/registry';
import { useSignal } from '../../core/signal';
import './offline.css';

// Keep the core in step with the flag (remembered on the device, so it holds before the flags load).
flags.subscribe((f) => {
  if ('offline' in f) offline.setEnabled(f.offline);
});

function clock(ms: number): string {
  const d = new Date(ms);
  const t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${t}`;
}

function NetBadge() {
  const s = useSignal(offline.status);
  let text: string | null = null;
  if (!s.online) text = ['Offline', s.waiting ? `${s.waiting} waiting` : '', s.copyAt ? `showing saved copy from ${clock(s.copyAt)}` : ''].filter(Boolean).join(' · ');
  else if (s.sending) text = `Sending ${s.waiting}…`;
  else if (s.waiting) text = `${s.waiting} waiting`;
  else if (s.updating) text = 'Updating…';
  if (!text) return null;
  return (
    <span role="status" aria-live="polite" class="net-wrap">
      <a class={`net ${s.online ? 'busy' : 'off'}`} href="#/settings" title={`${text} (Settings → Offline)`}>
        <i aria-hidden="true" />
        <span class="net-long">{text}</span>
      </a>
    </span>
  );
}

registerHeaderItem({ id: 'offline', order: 20, feature: 'offline', render: () => <NetBadge /> });

function OfflineSettings() {
  const s = useSignal(offline.status);
  const problems = useSignal(offline.problems);
  const [sure, setSure] = useState(false);
  const list = offline.pending();
  return (
    <section class="card offline-settings">
      <h2>Offline</h2>
      <p class="muted small">
        Pages you have opened are kept on this device and shown at once, also with no signal. Changes to cards, to-dos, notes, checklists, sticky notes and habits made
        offline wait here and are sent when you are back online. Sessions, the focus project, settings and new projects need a connection.
      </p>
      <p>
        {s.online ? 'Online.' : 'Offline.'} {s.waiting ? `${s.waiting} change${s.waiting === 1 ? '' : 's'} waiting.` : 'Nothing waiting.'}
      </p>
      {list.length > 0 && (
        <>
          <ul class="offline-list">
            {list.map((e) => (
              <li key={e.id}>
                <span class="muted">{clock(e.at)}</span> {e.label}
              </li>
            ))}
          </ul>
          <div class="row">
            <button class="small" disabled={s.sending} onClick={() => offline.flush()}>
              Send now
            </button>
            {!sure ? (
              <button class="small ghost danger" onClick={() => setSure(true)}>
                Discard waiting changes…
              </button>
            ) : (
              <button
                class="small danger"
                onClick={async () => {
                  await offline.discardQueue();
                  setSure(false);
                  say('Waiting changes discarded');
                }}
              >
                Discard {list.length}: they will not be sent
              </button>
            )}
          </div>
        </>
      )}
      {problems.length > 0 && (
        <>
          <h3>Not applied</h3>
          <ul class="offline-list">
            {problems.map((p, i) => (
              <li key={i}>
                <span class="muted">{clock(p.at)}</span> {p.text}
              </li>
            ))}
          </ul>
          <button class="small ghost" onClick={() => offline.clearProblems()}>
            Clear this list
          </button>
        </>
      )}
    </section>
  );
}

registerPanel('settings', { id: 'offline', order: 45, scope: 'device', feature: 'offline', icon: '📴', summary: () => 'Using the app with no signal', render: () => <OfflineSettings /> });
