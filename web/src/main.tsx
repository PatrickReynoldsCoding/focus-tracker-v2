import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { change, checkSignedIn, get, localStorageSet, login, mode, post, put, redo, saving, signedIn, toast, undo, version } from './core/api';
import { loadFeatures } from './core/features';
import { HeaderItems, Overlays, routeTab, tabBadges, useRoutes, useTabs } from './core/registry';
import { useSignal } from './core/signal';
import { Dialog, go, route } from './core/ui';
import './features';
import './styles.css';

/** Which tab or route a hash like '/p/abc' belongs to, and its parameters. */
function useCurrent() {
  const r = useSignal(route);
  const { tab, extra, params } = routeTab(r, useTabs(), useRoutes());
  if (extra) return { r, params, tabId: tab?.id ?? extra.tab, render: () => extra.render({ route: r, params }) };
  return { r, params, tabId: tab?.id, render: () => (tab ? tab.render({ route: r, params }) : null) };
}

function Page() {
  return useCurrent().render();
}

const NEW_PROFILE = '__new__';
/** Pages that belong to one profile's data: switching profile leaves them for Today (the other profile has no such page). */
const PROFILE_PAGE = /^\/(p|list|whiteboard|note)\//;

/** Flip to a profile at once. The server remembers it, so the Mac menu bar and the Android widgets follow. */
function switchProfile(id: string) {
  mode.value = id;
  localStorageSet('ft.mode', id);
  if (PROFILE_PAGE.test(route.value)) go('/today');
  void put('/settings/default_mode', { value: id, global: true }).catch(() => {});
}

function ModeSwitch() {
  const m = useSignal(mode);
  const v = useSignal(version);
  const [modes, setModes] = useState<{ id: string; label: string }[]>([]);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    get('/modes').then(setModes).catch(() => {});
  }, [v]);
  return (
    <>
      <select
        class="profile-switch"
        aria-label="Profile"
        value={m}
        onChange={(e) => {
          const id = (e.target as HTMLSelectElement).value;
          if (id === NEW_PROFILE) {
            (e.target as HTMLSelectElement).value = m;
            setAdding(true);
          } else switchProfile(id);
        }}
      >
        {modes.length === 0 && <option value={m}>{m}</option>}
        {modes.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
        <option value={NEW_PROFILE}>＋ New profile…</option>
      </select>
      {adding && <NewProfile onClose={() => setAdding(false)} onCreated={(id) => (setAdding(false), switchProfile(id))} />}
    </>
  );
}

/** Make a profile: a name and its own colour theme (the colour tints the app while it is open). */
function NewProfile({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#2f5d50');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="New profile" onClose={onClose}>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const made = await change(() => post<{ id: string }>('/modes', { label: label.trim(), color }), 'Profile made');
          setBusy(false);
          if (made) onCreated(made.id);
        }}
      >
        <label>
          Name
          <input value={label} placeholder="Side projects" onInput={(e) => setLabel((e.target as HTMLInputElement).value)} autoFocus />
        </label>
        <label>
          Colour theme
          <input type="color" value={color} onInput={(e) => setColor((e.target as HTMLInputElement).value)} />
        </label>
        <p class="muted small">A profile has its own projects, notes, habits and settings. Its colour tints the app while it is open.</p>
        <button class="primary" disabled={busy || label.trim().length < 2}>
          Make profile
        </button>
      </form>
    </Dialog>
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

/** The phone's bottom bar: the first four phone tabs, then More with every other tab (Settings, Insights, Whiteboards ...). */
function PhoneTabs({ tabs, tabId, current, badges }: { tabs: ReturnType<typeof useTabs>; tabId?: string; current: string; badges: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const first = tabs.filter((t) => t.phone).slice(0, 4);
  const rest = tabs.filter((t) => !first.includes(t));
  const inMore = rest.some((t) => t.id === tabId);
  const moreBadge = rest.reduce((n, t) => n + (badges[t.id] ?? 0), 0);
  const link = (t: (typeof tabs)[number], onClick?: () => void) => (
    <a key={t.id} href={`#${t.href?.(current) ?? t.path}`} class={tabId === t.id ? 'on' : ''} aria-current={tabId === t.id ? 'page' : undefined} onClick={onClick}>
      <span class="ico" aria-hidden="true">
        {t.icon}
        {badges[t.id] > 0 && <span class="badge" aria-label={`${badges[t.id]} waiting`}>{badges[t.id]}</span>}
      </span>
      <span>{t.label}</span>
    </a>
  );
  return (
    <>
      <nav class="tabs" aria-label="Main">
        {first.map((t) => link(t))}
        {rest.length > 0 && (
          <button class={`more-tab ${inMore ? 'on' : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
            <span class="ico" aria-hidden="true">
              ⋯{moreBadge > 0 && <span class="badge">{moreBadge}</span>}
            </span>
            <span>More</span>
          </button>
        )}
      </nav>
      {open && (
        <div class="more-sheet-backdrop" onClick={() => setOpen(false)}>
          <nav class="more-sheet" aria-label="More" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
            {rest.map((t) => link(t, () => setOpen(false)))}
          </nav>
        </div>
      )}
    </>
  );
}

function App() {
  const ok = useSignal(signedIn);
  const tabs = useTabs();
  const badges = useSignal(tabBadges);
  const { tabId, r: current } = useCurrent();
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem('ft.wide') === '1';
    } catch {
      return false;
    }
  });
  const [sideHidden, setSideHidden] = useState(() => {
    try {
      return localStorage.getItem('ft.side') === 'hidden';
    } catch {
      return false;
    }
  });
  const toggleSide = () => {
    setSideHidden(!sideHidden);
    localStorageSet('ft.side', sideHidden ? 'shown' : 'hidden');
  };
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
    <div class={`shell ${wide ? 'wide' : ''}${sideHidden ? ' no-side' : ''}`}>
      <nav class="side" aria-label="Main">
        <div class="brand">Focus</div>
        {tabs.map((t) => (
          <a key={t.id} href={`#${t.href?.(current) ?? t.path}`} class={tabId === t.id ? 'on' : ''} aria-current={tabId === t.id ? 'page' : undefined}>
            <span class="ico" aria-hidden="true">
              {t.icon}
            </span>
            {t.label}
            {badges[t.id] > 0 && <span class="badge" aria-label={`${badges[t.id]} waiting`}>{badges[t.id]}</span>}
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
          <button class="ghost side-toggle" aria-label={sideHidden ? 'Show the sidebar' : 'Hide the sidebar'} aria-pressed={!sideHidden} title={sideHidden ? 'Show the sidebar' : 'Hide the sidebar'} onClick={toggleSide}>
            {sideHidden ? '☰' : '⇤'}
          </button>
          <HeaderItems route={current} />
          <ModeSwitch />
          <SavingDot />
          <button class="ghost undo" aria-label="Undo" onClick={undo} title="Undo (Ctrl+Z)">
            ↶<span class="lbl"> Undo</span>
          </button>
          <button class="ghost redo" aria-label="Redo" onClick={redo} title="Redo (Ctrl+Shift+Z)">
            ↷<span class="lbl"> Redo</span>
          </button>
        </header>
        <main class="content">
          <Page />
        </main>
      </div>
      <PhoneTabs tabs={tabs} tabId={tabId} current={current} badges={badges} />
      <Toast />
      <Overlays route={current} />
    </div>
  );
}

if (!location.hash) go('/today');
render(<App />, document.getElementById('app')!);
// The service worker keeps the app on this device, so it opens with no signal (public/sw.js).
// Not under `vite` dev, where files have no hashes.
if ('serviceWorker' in navigator && window.isSecureContext && !(import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  // A new deploy's service worker takes over: load the new app at once, or a page left open
  // (the Android app stays in memory for days) keeps running the old one. Safe to reload:
  // queued changes and note drafts are kept on the device. Not when the first worker takes over.
  let hadWorker = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker) return void (hadWorker = true);
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      // An app left open for days (the Android app) looks for a new deploy when it comes back to the front.
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && navigator.onLine && reg.update().catch(() => {}));
    })
    .catch(() => {});
}
