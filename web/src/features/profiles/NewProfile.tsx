// New profile: a name, a colour, and what it starts with (default settings, or a copy of
// another profile's settings). Data is never copied.

import { useState } from 'preact/hooks';
import { HttpError, mode, post, say, version } from '../../core/api';
import { loadProfiles, profiles, switchProfile, type Profile } from '../../core/profiles';
import { useSignal } from '../../core/signal';
import { Dialog } from '../../core/ui';
import { ColourChoice } from './ColourChoice';
import { PROFILE_COLOURS } from './colours';

export function NewProfileDialog({ onClose }: { onClose: () => void }) {
  const list = useSignal(profiles);
  const m = useSignal(mode);
  const others = list?.profiles ?? [];
  const used = new Set(others.map((p) => p.color));
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(PROFILE_COLOURS.find((c) => !used.has(c)) ?? PROFILE_COLOURS[1]);
  const [start, setStart] = useState<'defaults' | 'copy'>('defaults');
  const [from, setFrom] = useState(others.some((p) => p.id === m) ? m : (others[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = label.trim();

  async function make(e: Event) {
    e.preventDefault();
    if (!name || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ profile: Profile }>('/profiles', { label: name, color, copy_from: start === 'copy' ? from : undefined });
      await loadProfiles();
      await switchProfile(r.profile.id);
      version.value++;
      say(`Now in ${r.profile.label}`);
      onClose();
    } catch (x) {
      setErr(x instanceof HttpError ? x.message : 'Not made: try again');
      setBusy(false);
    }
  }

  return (
    <Dialog title="New profile" onClose={onClose}>
      <form class="stack profile-form" onSubmit={make}>
        <label>
          Name
          <input value={label} maxLength={40} placeholder="Side projects" autoFocus onInput={(e) => setLabel((e.target as HTMLInputElement).value)} />
        </label>
        <fieldset class="plain-fieldset">
          <legend>Colour theme</legend>
          <ColourChoice value={color} onPick={setColor} label="Colour of the new profile" />
        </fieldset>
        <fieldset class="plain-fieldset">
          <legend>Start with</legend>
          <label class="inline">
            <input type="radio" name="start" checked={start === 'defaults'} onChange={() => setStart('defaults')} /> Default settings
          </label>
          {others.length > 0 && (
            <label class="inline profile-copy">
              <input type="radio" name="start" checked={start === 'copy'} onChange={() => setStart('copy')} /> Copy settings from
              <select aria-label="Profile to copy settings from" value={from} onChange={(e) => (setFrom((e.target as HTMLSelectElement).value), setStart('copy'))}>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p class="muted small">
            Settings are the switches in Features, notifications, Today’s pills and layouts, the Pomodoro and the like. Projects, notes, habits and everything else you made are never copied: a new profile starts empty.
          </p>
        </fieldset>
        {err && <p class="error">{err}</p>}
        <div class="row end">
          <button type="button" class="ghost" onClick={onClose}>
            Cancel
          </button>
          <button class="primary" disabled={!name || busy}>
            {busy ? 'Making…' : 'Make profile'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
