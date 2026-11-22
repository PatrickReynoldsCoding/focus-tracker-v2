// Settings → Android app: the app's version and "Check for updates". Only shown inside the Android app,
// which puts `window.FocusTrackerAndroid` into its WebView (android/.../UpdateBridge.kt). The download,
// the check that the file is this app and signed with the same key, and the install all happen natively.

import './android-app.css';
import { useEffect, useState } from 'preact/hooks';
import { registerPanel } from '../../core/registry';
import { Markdown } from '../../core/ui';

interface Bridge {
  info(): string;
  check(): void;
  install(): void;
  allowInstalls(): void;
}
interface Info {
  version: string;
  versionCode: number;
  state: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'needs-permission' | 'installing' | 'failed';
  latest?: string;
  notes?: string;
  progress?: number;
  message?: string;
  lastCheck: number;
}

const bridge = (): Bridge | undefined => (window as unknown as { FocusTrackerAndroid?: Bridge }).FocusTrackerAndroid;

function read(b: Bridge): Info | null {
  try {
    return JSON.parse(b.info()) as Info;
  } catch {
    return null;
  }
}

function AndroidApp({ b }: { b: Bridge }) {
  const [info, setInfo] = useState<Info | null>(() => read(b));
  // The state changes in the app (a download, the installer); look every second while the page is open.
  useEffect(() => {
    const t = setInterval(() => setInfo(read(b)), 1000);
    return () => clearInterval(t);
  }, [b]);
  if (!info) return null;
  const act = (run: () => void) => {
    run();
    setTimeout(() => setInfo(read(b)), 100);
  };
  const busy = info.state === 'checking' || info.state === 'downloading' || info.state === 'installing';
  const checked = info.lastCheck ? new Date(info.lastCheck).toLocaleString() : 'never';
  return (
    <section class="card aa">
      <h2>Android app</h2>
      <p>
        Focus Tracker for Android <strong>{info.version}</strong> <span class="muted small">(build {info.versionCode})</span>
      </p>
      {info.state === 'up-to-date' && <p class="aa-ok">You have the newest version.</p>}
      {info.state === 'checking' && <p class="muted">Checking…</p>}
      {info.state === 'failed' && <p class="error">{info.message}</p>}
      {(info.state === 'available' || info.state === 'failed') && info.latest && (
        <div class="aa-update">
          <h3>Update to {info.latest}</h3>
          {info.notes && <Markdown text={info.notes} class="aa-notes" />}
          <button class="primary" onClick={() => act(() => b.install())}>
            {info.state === 'failed' ? 'Try again' : 'Update now'}
          </button>
          <p class="muted small">Your sign-in, settings and widgets are kept.</p>
        </div>
      )}
      {info.state === 'downloading' && (
        <div class="aa-update">
          <p>
            Downloading {info.latest}… {Math.round((info.progress ?? 0) * 100)}%
          </p>
          <progress max={1} value={info.progress ?? 0} />
        </div>
      )}
      {info.state === 'needs-permission' && (
        <div class="aa-update">
          <p>Android needs your OK once. Turn on “Allow from this source” for Focus Tracker, then come back.</p>
          <button class="primary" onClick={() => act(() => b.allowInstalls())}>
            Open the setting
          </button>
        </div>
      )}
      {info.state === 'installing' && <p>Installing {info.latest}… The app closes for a moment. Open it again afterwards.</p>}
      <div class="row">
        <button class="ghost" disabled={busy} onClick={() => act(() => b.check())}>
          Check for updates
        </button>
        <span class="muted small">Last checked: {checked}. The app also checks when it opens, every few hours.</span>
      </div>
    </section>
  );
}

registerPanel('settings', {
  id: 'android-app',
  order: 55,
  scope: 'device',
  icon: '📱',
  summary: () => 'Widgets, updates and this app',
  render: () => {
    const b = bridge();
    return b ? <AndroidApp b={b} /> : null;
  },
});
