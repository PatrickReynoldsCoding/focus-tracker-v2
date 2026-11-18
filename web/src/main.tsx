import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { checkSignedIn, get, localStorageSet, login, mode, signedIn, toast, undo } from './api';
import { useSignal } from './signal';
import './styles.css';
import { go, route } from './ui';
import { Habits } from './views/Habits';
import { Log } from './views/Log';
import { ListPage, Notes } from './views/Notes';
import { ProjectPage } from './views/Project';
import { Projects } from './views/Projects';
import { Settings } from './views/Settings';
import { Today } from './views/Today';

const TABS = [
  { path: '/today', label: 'Today', icon: '◎' },
  { path: '/projects', label: 'Projects', icon: '▤' },
  { path: '/notes', label: 'Notes', icon: '✎' },
  { path: '/habits', label: 'Habits', icon: '✓' },
  { path: '/log', label: 'Log', icon: '⏱' },
  { path: '/settings', label: 'Settings', icon: '⚙' },
];

function Page() {
  const r = useSignal(route);
  const [, kind, id] = r.split('/');
  if (kind === 'p' && id) return <ProjectPage id={id} />;
  if (kind === 'n' && id) return <ListPage id={id} />;
  switch (kind) {
    case 'projects':
      return <Projects />;
    case 'notes':
      return <Notes />;
    case 'habits':
      return <Habits />;
    case 'log':
      return <Log />;
    case 'settings':
      return <Settings />;
    default:
      return <Today />;
  }
}

function ModeSwitch() {
  const m = useSignal(mode);
  const [modes, setModes] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    get('/modes').then(setModes).catch(() => {});
  }, []);
  if (modes.length < 2) return null;
  return (
    <div class="mode-switch" role="tablist" aria-label="Mode">
      {modes.map((x) => (
        <button
          key={x.id}
          role="tab"
          aria-selected={m === x.id}
          class={m === x.id ? 'on' : ''}
          onClick={() => {
            mode.value = x.id;
            localStorageSet('ft.mode', x.id);
          }}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

function Toast() {
  const t = useSignal(toast);
  if (!t) return null;
  return (
    <div class={`toast ${t.kind}`} role="status">
      <span>{t.text}</span>
      {t.action && (
        <button
          onClick={() => {
            t.action!.run();
            toast.value = null;
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}

function Login() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main class="login">
      <form
        class="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(await login(pw));
          setBusy(false);
        }}
      >
        <h1>Focus Tracker</h1>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} autoFocus />
        </label>
        {err && <p class="error">{err}</p>}
        <button class="primary" disabled={busy || !pw}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

function App() {
  const ok = useSignal(signedIn);
  const r = useSignal(route);
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem('ft.wide') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    checkSignedIn();
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/INPUT|TEXTAREA/.test(t.tagName)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  if (ok === null) return <p class="empty">Loading…</p>;
  if (!ok) return <Login />;
  const active = '/' + (r.split('/')[1] === 'p' ? 'projects' : r.split('/')[1] === 'n' ? 'notes' : r.split('/')[1]);
  return (
    <div class={`shell ${wide ? 'wide' : ''}`}>
      <nav class="side" aria-label="Main">
        <div class="brand">Focus</div>
        {TABS.map((t) => (
          <a key={t.path} href={`#${t.path}`} class={active === t.path ? 'on' : ''} aria-current={active === t.path ? 'page' : undefined}>
            <span class="ico" aria-hidden="true">
              {t.icon}
            </span>
            {t.label}
          </a>
        ))}
        <div class="side-foot">
          <button
            class="ghost"
            onClick={() => {
              setWide(!wide);
              localStorageSet('ft.wide', wide ? '0' : '1');
            }}
          >
            {wide ? '⇤ Narrow' : '⇔ Full width'}
          </button>
        </div>
      </nav>
      <div class="main">
        <header class="top">
          <ModeSwitch />
          <button class="ghost undo" onClick={undo} title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
        </header>
        <main class="content">
          <Page />
        </main>
      </div>
      <nav class="tabs" aria-label="Main">
        {TABS.filter((t) => t.path !== '/log').map((t) => (
          <a key={t.path} href={`#${t.path}`} class={active === t.path ? 'on' : ''} aria-current={active === t.path ? 'page' : undefined}>
            <span class="ico" aria-hidden="true">
              {t.icon}
            </span>
            <span>{t.label}</span>
          </a>
        ))}
      </nav>
      <Toast />
    </div>
  );
}

if (!location.hash) go('/today');
render(<App />, document.getElementById('app')!);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
