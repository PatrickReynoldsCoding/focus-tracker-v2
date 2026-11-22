import { useEffect, useRef, useState } from 'preact/hooks';
import { change, del, logout, mode, patch, post, put, say } from '../../core/api';
import { featureList, loadFeatures, setFeature } from '../../core/features';
import { OwnValue, scopedChange, ScopeChoice, useScopeStates } from '../../core/scope';
import { profileOf, profiles } from '../../core/profiles';
import { Panels, registerPanel, registerTab, usePanels, type PanelDef, type SettingsScope, type SettingsSectionProps } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { AddInput, ColorPicker, go, InlineEdit, Loading, useData } from '../../core/ui';
import { countLine, plural } from './summaries';
import './settings.css';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function Rotation() {
  const { data } = useData<{ usual: Record<string, string>; this_week: Record<string, string> }>('/rotation');
  const { data: cats } = useData<{ id: string; label: string }[]>('/categories');
  if (!data || !cats) return <Loading />;
  const opts = [
    ['any', 'Any project'],
    ['away', 'Away'],
    ...cats.map((c) => [c.id, c.label]),
  ];
  return (
    <section class="card">
      <h2>Weekly rotation</h2>
      <p class="muted small">Which kind of project each day is for. Today suggests projects from it; it never picks one for you.</p>
      <table class="table compact">
        <thead>
          <tr>
            <th>Day</th>
            <th>Usual</th>
            <th>This week</th>
          </tr>
        </thead>
        <tbody>
          {DAYS.map((d) => (
            <tr key={d}>
              <td class="cap">{d.slice(0, 3)}</td>
              <td>
                <select value={data.usual[d]} onChange={(e) => change(() => put('/rotation', { usual: { [d]: (e.target as HTMLSelectElement).value } }))}>
                  {opts.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select value={data.this_week[d] ?? ''} onChange={(e) => change(() => put('/rotation', { this_week: { [d]: (e.target as HTMLSelectElement).value || null } }))}>
                  <option value="">(usual)</option>
                  {opts.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Categories() {
  const { data } = useData<{ id: string; label: string; color: string | null }[]>('/categories');
  if (!data) return <Loading />;
  return (
    <section class="card">
      <h2>Categories</h2>
      <ul class="plain">
        {data.map((c) => (
          <li key={c.id} class="cat-row">
            <InlineEdit value={c.label} onSave={(label) => label && change(() => patch(`/categories/${c.id}`, { label }))} />
            <ColorPicker value={c.color} onPick={(color) => change(() => patch(`/categories/${c.id}`, { color }))} />
            <button class="icon small" aria-label={`Delete ${c.label}`} onClick={() => confirm(`Delete ${c.label}?`) && change(() => del(`/categories/${c.id}`), 'Deleted')}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <AddInput placeholder="Add a category" onAdd={(label) => change(() => post('/categories', { label }))} />
    </section>
  );
}

function Tokens() {
  const { data } = useData<{ id: string; name: string; created: string; last_used: string | null }[]>('/tokens');
  const [fresh, setFresh] = useState<string | null>(null);
  return (
    <section class="card">
      <h2>Devices and API tokens</h2>
      <p class="muted small">For the Android app, the Mac menu bar plugin, Claude Code or scripts. A token is shown once.</p>
      {fresh && (
        <div class="token">
          <code>{fresh}</code>
          <button class="ghost small" onClick={() => navigator.clipboard?.writeText(fresh)}>
            Copy
          </button>
        </div>
      )}
      <ul class="plain">
        {data?.map((t) => (
          <li key={t.id} class="row spread">
            <span>
              {t.name} <span class="muted small">{t.last_used ? `used ${t.last_used.slice(0, 10)}` : 'never used'}</span>
            </span>
            <button class="ghost small danger" onClick={() => confirm(`Revoke ${t.name}?`) && change(() => del(`/tokens/${t.id}`), 'Revoked')}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <AddInput
        placeholder="New token name, e.g. Android phone"
        onAdd={async (name) => {
          const t = await change(() => post<{ token: string }>('/tokens', { name }));
          if (t) setFresh(t.token);
        }}
      />
    </section>
  );
}

function Connections() {
  const { data } = useData<{ id: string; client: string; created: string; redirect: string | null }[]>('/connections');
  return (
    <section class="card">
      <h2>Claude and other connected apps</h2>
      <p class="small">
        In Claude, add a custom connector with this address: <code>{location.origin}/mcp</code>. Claude opens a page here; type your password and press Allow.
      </p>
      <ul class="plain">
        {data?.map((g) => (
          <li key={g.id} class="row spread">
            <span>
              {g.client} <span class="muted small">since {g.created.slice(0, 10)}</span>
            </span>
            <button class="ghost small danger" onClick={() => confirm(`Disconnect ${g.client}?`) && change(() => del(`/connections/${g.id}`), 'Disconnected')}>
              Disconnect
            </button>
          </li>
        ))}
      </ul>
      {data && !data.length && <p class="muted small">Nothing connected yet.</p>}
    </section>
  );
}

function General() {
  const { data } = useData<{ global: Record<string, string>; mode: Record<string, string> }>('/settings');
  if (!data) return <Loading />;
  const set = (key: string, value: string, global = false) => change(() => put(`/settings/${key}`, { value: value || null, global }), 'Saved');
  return (
    <section class="card">
      <h2>General</h2>
      <div class="stack">
        <label>
          Time zone (every profile)
          <input defaultValue={data.global.timezone ?? 'Europe/London'} onBlur={(e) => set('timezone', (e.target as HTMLInputElement).value, true)} />
        </label>
        {/* The Pomodoro's settings are in features/pomodoro (its own section). */}
        {/* The nudge's controls (hour, days untouched) moved to the Notifications section. */}
      </div>
    </section>
  );
}

function Features() {
  const list = useSignal(featureList);
  const { states, of, reload } = useScopeStates();
  const flip = async (id: string, enabled: boolean, box: HTMLInputElement) => {
    const done = await scopedChange('features', [`features.${id}`], states, (scope) => setFeature(id, enabled, scope).then(() => scope)).catch((err) => {
      say(err.message, 'error');
      return false as const;
    });
    if (done === false) box.checked = !enabled;
    else reload();
    if (done === 'all') say(`${enabled ? 'On' : 'Off'} in every profile`);
  };
  return (
    <section class="card">
      <h2>Features</h2>
      <p class="muted small">Turn parts of the tracker on or off, on every device and for Claude. Each profile has its own switches; choose All profiles to change a switch in every profile at once.</p>
      <ScopeChoice section="features" />
      {list.length ? (
        <ul class="plain">
          {list.map((f) => (
            <li key={f.id}>
              <label class="inline feature-row">
                <input type="checkbox" checked={f.enabled} onChange={(e) => flip(f.id, (e.target as HTMLInputElement).checked, e.target as HTMLInputElement)} />
                <span>
                  <strong>{f.label}</strong> {f.experimental && <span class="tag">Experimental</span>}
                  <OwnValue state={of(`features.${f.id}`)} section="features" onDone={() => void loadFeatures()} />
                  <span class="muted small" style="display:block">{f.description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted small">No switchable features yet.</p>
      )}
    </section>
  );
}

type SectionLink = { id: string; title: string };

const humanise = (id: string) => id.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The sections on the page (each panel's heading, or its name until it has loaded), kept up to date as panels load. */
function useSections(root: { current: HTMLElement | null }): SectionLink[] {
  const [sections, setSections] = useState<SectionLink[]>([]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      const found = [...el.querySelectorAll<HTMLElement>('.settings-section')].filter((s) => [...s.children].some((c) => !c.classList.contains('scope-tag'))).map((s) => ({ id: s.id, title: s.querySelector('h2')?.textContent?.trim() || humanise(s.dataset.panel ?? '') }));
      setSections((old) => (JSON.stringify(old) === JSON.stringify(found) ? old : found));
    };
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    const watch = new MutationObserver(soon);
    watch.observe(el, { childList: true, subtree: true, characterData: true });
    read();
    return () => (watch.disconnect(), cancelAnimationFrame(frame));
  }, []);
  return sections;
}

const SCOPES: Record<SettingsScope, { text: string; hint: (profile: string) => string }> = {
  profile: { text: 'This profile', hint: (p) => `Kept for ${p}: each profile has its own. Where a section has “All profiles”, a change can go to every profile.` },
  all: { text: 'Every profile', hint: () => 'The same in every profile' },
  device: { text: 'This device', hint: () => 'Kept in this browser or app only' },
};

/** Whom a section applies to, as a tag in its corner (PanelDef.scope). */
function ScopeTag({ scope, profile }: { scope: SettingsScope; profile: string }) {
  return (
    <span class={`scope-tag scope-${scope}`} title={SCOPES[scope].hint(profile)}>
      {SCOPES[scope].text}
    </span>
  );
}

const PHONE = '(max-width: 899.98px)';

/** True on a phone-sized screen, where Settings is a list of sections and one section at a time (D60). */
function usePhone(): boolean {
  const q = typeof matchMedia === 'function' ? matchMedia(PHONE) : null;
  const [phone, setPhone] = useState(!!q?.matches);
  useEffect(() => {
    if (!q) return;
    const on = () => setPhone(q.matches);
    on();
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return phone;
}

/** The line under a section's name on the phone's list: its own summary, else its description, else whom it is for. */
function SectionRow({ def, title, onOpen }: { def: PanelDef<SettingsSectionProps>; title: string; onOpen: () => void }) {
  const line = def.summary?.() || def.description || (def.scope ? SCOPES[def.scope].text : '');
  return (
    <li>
      <button class="settings-row" onClick={onOpen}>
        <span class="ic" aria-hidden="true">{def.icon ?? '⚙'}</span>
        <span class="tx">
          <span class="nm">{title}</span>
          {line && <span class="sm">{line}</span>}
        </span>
        <span class="go" aria-hidden="true">›</span>
      </button>
    </li>
  );
}

/** True once the person opened a section from the list in this visit, so ‹ can use the browser's Back. */
let fromList = false;

export function Settings({ section }: { section?: string }) {
  const m = useSignal(mode);
  const name = profileOf(useSignal(profiles), m)?.label ?? m;
  const body = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const phone = usePhone();
  const defs = usePanels<SettingsSectionProps>('settings');
  const sections = useSections(body);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const every = section === 'all'; // #/settings/all: every section on one page, also on a phone
  const opened = phone && !query && !every ? sections.find((s) => s.id === `set-${section}`) : undefined;
  const listScreen = phone && !query && !every && !opened;
  // Search hides the sections whose text (headings, labels, descriptions) does not contain the words typed.
  // On a phone with no search, only the open section shows (none on the list).
  useEffect(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hidden: string[] = [];
    body.current?.querySelectorAll<HTMLElement>('.settings-section').forEach((s) => {
      const text = (s.textContent ?? '').toLowerCase();
      s.hidden = phone && !query && !every ? s.id !== opened?.id : !words.every((w) => text.includes(w));
      if (s.hidden) hidden.push(s.id);
    });
    setHiddenIds((old) => (old.join() === hidden.join() ? old : hidden));
  }, [query, sections, phone, opened?.id, every]);
  // A wide screen with an address for a section (#/settings/<id>) scrolls to it.
  useEffect(() => {
    if (!phone && section && sections.some((s) => s.id === `set-${section}`)) document.getElementById(`set-${section}`)?.scrollIntoView({ block: 'start' });
  }, [phone, section, sections.length > 0]);
  const shown = (id: string) => !hiddenIds.includes(id);
  const openSection = (id: string) => {
    fromList = true;
    go(`/settings/${id.replace(/^set-/, '')}`);
  };
  const back = () => {
    if (fromList && history.length > 1) history.back();
    else go('/settings');
  };
  useEffect(() => {
    if (!opened && !listScreen) return;
    window.scrollTo(0, 0);
  }, [opened?.id, listScreen]);
  const openDef = opened ? defs.find((d) => `set-${d.id}` === opened.id) : undefined;
  return (
    <div class={`stack settings-page ${phone ? 'is-phone' : ''} ${opened ? 'is-open' : ''}`}>
      {opened ? (
        <div class="page-head settings-open-head">
          <div class="row">
            <button class="ghost settings-back" aria-label="Back to Settings" onClick={back}>
              ‹
            </button>
            <h1>{opened.title}</h1>
            {openDef?.scope && <ScopeTag scope={openDef.scope} profile={name} />}
          </div>
        </div>
      ) : (
        <div class="page-head">
          <div class="row">
            <h1>Settings</h1>
            <span class="tag">{name}</span>
          </div>
          <p class="muted small settings-intro">Each section says whom it is for: this profile ({name}; other profiles have their own), every profile, or this device only. In a section with “{name} only | All profiles”, choose where your next changes go.</p>
        </div>
      )}
      <div class="settings-layout">
        {!opened && (
          <nav class="settings-nav" aria-label="Settings sections">
            <input type="search" placeholder="Search settings" aria-label="Search settings" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
            {listScreen ? (
              <ul class="settings-rows">
                {sections.map((s) => {
                  const def = defs.find((d) => `set-${d.id}` === s.id);
                  return def ? <SectionRow key={s.id} def={def} title={s.title} onOpen={() => openSection(s.id)} /> : null;
                })}
              </ul>
            ) : (
              <ul>
                {sections
                  .filter((s) => shown(s.id))
                  .map((s) => (
                    <li key={s.id}>
                      <button onClick={() => (phone ? openSection(s.id) : document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))}>{s.title}</button>
                    </li>
                  ))}
              </ul>
            )}
            {query && sections.every((s) => !shown(s.id)) && <p class="muted small">Nothing matches “{query}”.</p>}
          </nav>
        )}
        <div class="settings-sections" ref={body}>
          <Panels
            place="settings"
            props={{}}
            wrap={(p, node) => (
              <div class="settings-section" id={`set-${p.id}`} data-panel={p.id} data-scope={p.scope} key={p.id}>
                {p.scope && !opened && <ScopeTag scope={p.scope} profile={name} />}
                {node}
              </div>
            )}
          />
        </div>
      </div>
      {!opened && (
        <div class="row">
          <button class="ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

registerTab({ id: 'settings', path: '/settings', label: 'Settings', icon: '⚙', order: 90, phone: true, render: ({ params }) => <Settings section={params[0]} /> });
const Cats = () => {
  const { data } = useData<unknown[]>('/categories');
  return data ? plural(data.length, 'category', 'categories') : null;
};
const TokensLine = () => {
  const { data } = useData<unknown[]>('/tokens');
  return data ? plural(data.length, 'device or token') : null;
};
const ConnectionsLine = () => {
  const { data } = useData<unknown[]>('/connections');
  return data ? (data.length ? `${data.length} connected` : 'Nothing connected yet') : null;
};

registerPanel('settings', { id: 'general', order: 10, scope: 'all', icon: '⚙', summary: () => `Time zone ${useData<{ global: Record<string, string> }>('/settings').data?.global.timezone ?? 'Europe/London'}`, render: () => <General /> });
registerPanel('settings', { id: 'rotation', order: 20, scope: 'profile', icon: '📅', summary: () => 'Which kind of project each day is for', render: () => <Rotation /> });
registerPanel('settings', { id: 'categories', order: 30, scope: 'profile', icon: '🏷', summary: () => Cats(), render: () => <Categories /> });
registerPanel('settings', {
  id: 'features',
  order: 40,
  scope: 'profile',
  icon: '🎛',
  summary: () => {
    const list = useSignal(featureList);
    return list.length ? countLine(list.filter((f) => f.enabled).length, list.length) : null;
  },
  render: () => <Features />,
});
registerPanel('settings', { id: 'tokens', order: 50, scope: 'all', icon: '🔑', summary: () => TokensLine(), render: () => <Tokens /> });
registerPanel('settings', { id: 'connections', order: 60, scope: 'all', icon: '🤖', summary: () => ConnectionsLine(), render: () => <Connections /> });
