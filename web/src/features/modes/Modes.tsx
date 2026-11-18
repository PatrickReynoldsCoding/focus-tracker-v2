// Modes (Personal, Work ...): add, rename, choose an accent colour, delete an empty one.
// The accent colour of the open mode is applied to the whole app (CSS variable --accent).

import { change, del, get, localStorageSet, mode, patch, post, signedIn, version } from '../../core/api';
import { registerPanel } from '../../core/registry';
import { AddInput, InlineEdit, Loading, useData } from '../../core/ui';
import './modes.css';

type Mode = { id: string; label: string; color: string | null };

// ---------- applying the accent colour ----------

function readable(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#10170f' : '#ffffff';
}

export function setAccent(color: string | null | undefined) {
  const s = document.documentElement.style;
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    s.setProperty('--accent', color);
    s.setProperty('--accent-fg', readable(color));
    s.setProperty('--accent-soft', `color-mix(in srgb, ${color} 18%, var(--surface))`);
  } else {
    for (const p of ['--accent', '--accent-fg', '--accent-soft']) s.removeProperty(p);
  }
  localStorageSet(`ft.accent.${mode.value}`, color ?? '');
}

try {
  setAccent(localStorage.getItem(`ft.accent.${mode.value}`));
} catch {
  /* no storage */
}

async function refreshAccent() {
  if (!signedIn.value) return;
  try {
    const modes = await get<Mode[]>('/modes');
    setAccent(modes.find((m) => m.id === mode.value)?.color);
  } catch {
    /* keep the colour we have */
  }
}
mode.subscribe(() => {
  try {
    setAccent(localStorage.getItem(`ft.accent.${mode.value}`));
  } catch {
    /* no storage */
  }
  refreshAccent();
});
version.subscribe(refreshAccent);
signedIn.subscribe(refreshAccent);

// ---------- the Settings section ----------

function Modes() {
  const { data } = useData<Mode[]>('/modes');
  if (!data) return <Loading />;
  return (
    <section class="card">
      <h2>Modes</h2>
      <p class="muted small">Separate areas of life, each with its own projects, notes and habits. The colour tints the app while that mode is open.</p>
      <ul class="plain">
        {data.map((m) => (
          <li key={m.id} class="mode-row">
            <InlineEdit value={m.label} onSave={(label) => label && change(() => patch(`/modes/${m.id}`, { label }))} />
            <span class="muted small">{m.id}</span>
            <input
              type="color"
              class="mode-colour"
              aria-label={`Accent colour for ${m.label}`}
              value={m.color ?? '#2f5d50'}
              onChange={(e) => change(() => patch(`/modes/${m.id}`, { color: (e.target as HTMLInputElement).value }))}
            />
            {m.color && (
              <button class="ghost small" onClick={() => change(() => patch(`/modes/${m.id}`, { color: '' }))}>
                Default colour
              </button>
            )}
            <button
              class="icon small"
              aria-label={`Delete ${m.label}`}
              onClick={() => confirm(`Delete the mode ${m.label}? It must have no data.`) && change(() => del(`/modes/${m.id}`), 'Mode deleted')}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <AddInput placeholder="Add a mode, such as Side projects" onAdd={(label) => change(() => post('/modes', { label }))} />
    </section>
  );
}

registerPanel('settings', { id: 'modes', order: 25, render: () => <Modes /> });
