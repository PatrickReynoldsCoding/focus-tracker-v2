// Feature flags in the browser: loaded once from GET /api/features, changed in Settings → Features.
import { api } from './api';
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

export async function loadFeatures(): Promise<void> {
  try {
    apply(await api<FeatureInfo[]>('GET', '/features'));
  } catch {
    /* signed out or offline: everything flagged stays hidden */
  }
}

export async function setFeature(id: string, enabled: boolean): Promise<void> {
  apply(await api<FeatureInfo[]>('PUT', `/features/${id}`, { enabled }));
}

export const useFlags = () => useSignal(flags);
export const useFlag = (id: string) => !!useSignal(flags)[id];
