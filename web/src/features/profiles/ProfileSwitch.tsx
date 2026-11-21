// The profile dropdown in the header: every profile, then New profile… and Manage profiles….
// Choosing a profile flips the app to it at once (core/profiles.ts).

import { useState } from 'preact/hooks';
import { mode } from '../../core/api';
import { profiles, switchProfile } from '../../core/profiles';
import { useSignal } from '../../core/signal';
import { ManageProfilesDialog } from './ManageProfiles';
import { NewProfileDialog } from './NewProfile';

const NEW = '__new__';
const MANAGE = '__manage__';

export function ProfileSwitch() {
  const list = useSignal(profiles);
  const m = useSignal(mode);
  const [dialog, setDialog] = useState<'new' | 'manage' | null>(null);
  const all = list?.profiles ?? [];
  return (
    <>
      <select
        class="profile-switch"
        aria-label="Profile"
        value={m}
        onChange={(e) => {
          const el = e.target as HTMLSelectElement;
          const id = el.value;
          if (id === NEW || id === MANAGE) {
            el.value = m;
            setDialog(id === NEW ? 'new' : 'manage');
          } else void switchProfile(id);
        }}
      >
        {!all.some((p) => p.id === m) && <option value={m}>{m}</option>}
        {all.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option disabled>──────────</option>
        <option value={NEW}>＋ New profile…</option>
        <option value={MANAGE}>⚙ Manage profiles…</option>
      </select>
      {dialog === 'new' && <NewProfileDialog onClose={() => setDialog(null)} />}
      {dialog === 'manage' && <ManageProfilesDialog onClose={() => setDialog(null)} />}
    </>
  );
}
