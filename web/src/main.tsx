import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { checkSignedIn, get, localStorageSet, login, mode, redo, saving, signedIn, toast, undo, version } from './core/api';
import { loadFeatures } from './core/features';
import { useRoutes, useTabs } from './core/registry';
import { useSignal } from './core/signal';
import { go, route } from './core/ui';
import './features';
import './styles.css';

/** Which tab or route a hash like '/p/abc' belongs to, and its parameters. */
function useCurrent() {
  const r = useSignal(route);
  const tabs = useTabs();
  const routes = useRoutes();
  const [, head, ...params] = r.split('/');
  const extra = routes.find((x) => x.prefix === `/${head}`);
  if (extra) return { r, params, tabId: extra.tab, render: () => extra.render({ route: r, params }) };
  const tab = tabs.find((t) => t.path === `/${head}`) ?? tabs[0];
  return { r, params, tabId: tab?.id, render: () => (tab ? tab.render({ route: r, params }) : null) };
}

function Page() {
  return useCurrent().render();
}

function ModeSwitch() {
  const m = useSignal(mode);
  const v = useSignal(version);
  const [modes, setModes] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    get('/modes').then(setModes).catch(() => {});
  }, [v]);
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

function SavingDot() {
  const s = useSignal(saving);
  const text = s.pending > 0 ? 'Saving…' : s.last === 'error' ? 'Not saved' : s.last === 'saved' ? 'Saved' : '';
  const state = s.pending > 0 ? 'busy' : s.last;
  return (
    <span class={`saving ${state}`} role="status" aria-live="polite">
      {text && <i aria-hidden="true" />}
      {text}
    </span>
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
  const tabs = useTabs();
  const { tabId, r: current } = useCurrent();
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem('ft.wide') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (ok) loadFeatures();
  }, [ok]);
  useEffect(() => {
    checkSignedIn();
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA/.test(t.tagName) || t.isContentEditable) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.ctrlKey && k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  if (ok === null) return <p class="empty">Loading…</p>;
  if (!ok) return <Login />;
  return (
    <div class={`shell ${wide ? 'wide' : ''}`}>
      <nav class="side" aria-label="Main">
        <div class="brand">Focus</div>
        {tabs.map((t) => (
          <a key={t.id} href={`#${t.href?.(current) ?? t.path}`} class={tabId === t.id ? 'on' : ''} aria-current={tabId === t.id ? 'page' : undefined}>
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
          <SavingDot />
          <button class="ghost undo" onClick={undo} title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          <button class="ghost redo" onClick={redo} title="Redo (Ctrl+Shift+Z)">
            ↷ Redo
          </button>
        </header>
        <main class="content">
          <Page />
        </main>
      </div>
      <nav class="tabs" aria-label="Main">
        {tabs.filter((t) => t.phone).slice(0, 5).map((t) => (
          <a key={t.id} href={`#${t.href?.(current) ?? t.path}`} class={tabId === t.id ? 'on' : ''} aria-current={tabId === t.id ? 'page' : undefined}>
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
