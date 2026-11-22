// Feature flags in the browser: loaded from GET /api/features, changed in Settings → Features.
// Each profile has its own flags (D35), so they load again when the profile changes.
import { api, mode, signedIn } from './api';
import { signal, useSignal } from './signal';

export interface FeatureInfo {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  experimental?: boolean;
}

export const featureList = signal<FeatureInfo[]>([]);
export const flags = signal<Record<string, boolean>>({});

function apply(list: FeatureInfo[]) {
  featureList.value = list;
  flags.value = Object.fromEntries(list.map((f) => [f.id, f.enabled]));
}

/** Load the flags of the open profile, or of another one about to be opened (so the screens of
 *  the new profile never draw with the old profile's flags). */
export async function loadFeatures(forMode?: string): Promise<void> {
  try {
    apply(await api<FeatureInfo[]>('GET', '/features', undefined, { mode: forMode }));
  } catch {
    /* signed out or offline: everything flagged stays hidden */
  }
}

/** Switch a flag in the open profile, or in every profile with scope 'all' (D46). */
export async function setFeature(id: string, enabled: boolean, scope: 'profile' | 'all' = 'profile'): Promise<void> {
  apply(await api<FeatureInfo[]>('PUT', `/features/${id}`, { enabled, scope }));
}

mode.subscribe(() => {
  if (signedIn.value) void loadFeatures();
});

export const useFlags = () => useSignal(flags);
export const useFlag = (id: string) => !!useSignal(flags)[id];
