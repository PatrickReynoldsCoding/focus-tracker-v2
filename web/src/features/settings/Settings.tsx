import { useState } from 'preact/hooks';
import { change, del, logout, mode, patch, post, put, say } from '../../core/api';
import { featureList, setFeature } from '../../core/features';
import { Panels, registerPanel, registerTab } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { AddInput, ColorPicker, InlineEdit, Loading, useData } from '../../core/ui';

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
          Time zone
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
  return (
    <section class="card">
      <h2>Features</h2>
      <p class="muted small">Turn parts of the tracker on or off. Applies to every device and to Claude.</p>
      {list.length ? (
        <ul class="plain">
          {list.map((f) => (
            <li key={f.id}>
              <label class="inline feature-row">
                <input type="checkbox" checked={f.enabled} onChange={(e) => setFeature(f.id, (e.target as HTMLInputElement).checked).catch((err) => say(err.message, 'error'))} />
                <span>
                  <strong>{f.label}</strong> {f.experimental && <span class="tag">Experimental</span>}
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

export function Settings() {
  const m = useSignal(mode);
  return (
    <div class="stack">
      <div class="page-head row">
        <h1>Settings</h1>
        <span class="tag">{m}</span>
      </div>
      <div class="grid two">
        <Panels place="settings" props={{}} />
      </div>
      <div class="row">
        <button class="ghost" onClick={logout}>
          Sign out
        </button>
      </div>
    </div>
  );
}

registerTab({ id: 'settings', path: '/settings', label: 'Settings', icon: '⚙', order: 90, phone: true, render: () => <Settings /> });
registerPanel('settings', { id: 'general', order: 10, render: () => <General /> });
registerPanel('settings', { id: 'rotation', order: 20, render: () => <Rotation /> });
registerPanel('settings', { id: 'categories', order: 30, render: () => <Categories /> });
registerPanel('settings', { id: 'features', order: 40, render: () => <Features /> });
registerPanel('settings', { id: 'tokens', order: 50, render: () => <Tokens /> });
registerPanel('settings', { id: 'connections', order: 60, render: () => <Connections /> });
