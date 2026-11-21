// The profiles (called modes on the server, `mode` in api.ts): the list, the default one, and
// switching. In core because the shell and several features show which profile is open.
import { get, localStorageSet, mode, post, signedIn, version } from './api';
import { loadFeatures } from './features';
import { signal } from './signal';
import { go, route } from './ui';

export type Profile = { id: string; label: string; color: string | null; ord: number };
export type DeletedProfile = { id: string; label: string; color: string | null; deleted_at: string; restore_until: string };
export type ProfileList = { default: string; follow_open: boolean; profiles: Profile[]; deleted: DeletedProfile[] };

export const profiles = signal<ProfileList | null>(null);

export async function loadProfiles(): Promise<void> {
  if (!signedIn.value) return;
  try {
    profiles.value = await get<ProfileList>('/profiles');
  } catch {
    /* offline with no saved copy: keep what we have */
  }
}
version.subscribe(() => void loadProfiles());
signedIn.subscribe(() => void loadProfiles());

/** Pages that belong to one profile's data: switching profile leaves them for Today (the other profile has no such page). */
const PROFILE_PAGE = /^\/(p|pn|n|w|list|note|whiteboard|files)\/./;

/** Open another profile at once: its feature switches first (so its screens never draw with the
 *  old profile's), then the screens follow `mode`. The server is told, so the Mac menu bar and the
 *  Android widgets follow while "follow the open profile" is on. */
export async function switchProfile(id: string): Promise<void> {
  await loadFeatures(id);
  mode.value = id;
  localStorageSet('ft.mode', id);
  if (PROFILE_PAGE.test(route.value)) go('/today');
  void post('/profiles/opened', { id })
    .then(() => loadProfiles())
    .catch(() => {});
}

export const profileOf = (list: ProfileList | null, id: string): Profile | undefined => list?.profiles.find((p) => p.id === id);
