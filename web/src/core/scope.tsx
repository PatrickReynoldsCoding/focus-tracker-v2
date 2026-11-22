// Where a setting change applies (D46): this profile only (the usual) or every profile. A Settings
// section that holds such settings draws <ScopeChoice section="…" /> under its heading, marks each
// setting with <OwnValue state={…} />, and sends each change through scopedChange(), which asks
// first when "All profiles" would replace values other profiles set for themselves.
// The server side: src/core/setting-scope.ts and src/modules/setting-scope.ts.

import { del, mode, say, version } from './api';
import { profileOf, profiles } from './profiles';
import { signal, useSignal } from './signal';
import { useData } from './ui';

export type Scope = 'profile' | 'all';

export interface ScopeState {
  id: string;
  label: string;
  section: string;
  /** What this profile uses (text for a whole setting, a JSON value for a part), null for the default. */
  value: unknown;
  own: boolean;
  global: boolean;
  global_value: unknown;
  profiles: string[];
}

/** The choice of each section, for this visit only: a reload or another profile starts at This profile. */
const choices = signal<Record<string, Scope>>({});
mode.subscribe(() => (choices.value = {}));

export const scopeOf = (section: string): Scope => choices.value[section] ?? 'profile';
export const setScope = (section: string, scope: Scope) => (choices.value = { ...choices.value, [section]: scope });

/** Every scoped setting's state (GET /api/setting-scope), reloaded after each change. */
export function useScopeStates(): { states: ScopeState[] | undefined; of: (id: string) => ScopeState | undefined; reload: () => void } {
  const { data, reload } = useData<ScopeState[]>('/setting-scope');
  return { states: data, of: (id) => data?.find((s) => s.id === id), reload };
}

const names = (ids: string[]) => {
  const list = profiles.value;
  const labels = ids.map((id) => profileOf(list, id)?.label ?? id);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : (labels[0] ?? '');
};

/** The question "All profiles" asks when other profiles have their own value (null: nothing to ask). */
export function allProfilesNote(states: ScopeState[] | undefined, ids: string[]): string | null {
  const own = [...new Set((states ?? []).filter((s) => ids.includes(s.id)).flatMap((s) => s.profiles))];
  if (!own.length) return null;
  const total = profiles.value?.profiles.length ?? own.length;
  const what = ids.length === 1 ? `“${states?.find((s) => s.id === ids[0])?.label ?? ids[0]}”` : 'these settings';
  return `Change ${what} for all ${total} profiles?\n\n${own.length} of them ${own.length === 1 ? 'has its' : 'have their'} own value now (${names(own)}). ${own.length === 1 ? 'It' : 'They'} will use this one instead.`;
}

/**
 * Send a change to this profile or, when the section is set to All profiles, to every profile.
 * `ids` are the scoped settings the change touches. Returns false when the owner said no (put the
 * control back), otherwise what send returned.
 */
export async function scopedChange<T>(section: string, ids: string[], states: ScopeState[] | undefined, send: (scope: Scope) => Promise<T>): Promise<T | false> {
  const scope = scopeOf(section);
  if (scope === 'all') {
    const note = allProfilesNote(states, ids);
    if (note && !confirm(note)) return false;
  }
  return send(scope);
}

/** "Change for: This profile | All profiles", under a section's heading. */
export function ScopeChoice({ section, label = 'Changes here apply to' }: { section: string; label?: string }) {
  const scope = useSignal(choices)[section] ?? 'profile';
  const m = useSignal(mode);
  const name = profileOf(useSignal(profiles), m)?.label ?? m;
  return (
    <div class="scope-choice" data-section={section}>
      <span class="small muted" id={`scope-${section}`}>
        {label}
      </span>
      <div class="scope-seg" role="radiogroup" aria-labelledby={`scope-${section}`}>
        {(
          [
            ['profile', `${name} only`],
            ['all', 'All profiles'],
          ] as const
        ).map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={scope === v} class={scope === v ? 'on' : ''} onClick={() => setScope(section, v)}>
            {text}
          </button>
        ))}
      </div>
      {scope === 'all' && <span class="small scope-all-hint">Each change goes to every profile.</span>}
    </div>
  );
}

/** A setting's mark: "Own value" with "Use the global value" while this profile overrides the value
 *  for all profiles; in All profiles mode, how many profiles have their own. */
export function OwnValue({ state, section, onDone }: { state: ScopeState | undefined; section: string; onDone?: () => void }) {
  const scope = useSignal(choices)[section] ?? 'profile';
  if (!state) return null;
  if (scope === 'all') {
    const n = state.profiles.length;
    return n ? (
      <span class="scope-others small" title={`Own value in ${names(state.profiles)}`}>
        {n} with own value
      </span>
    ) : null;
  }
  if (!state.own || !state.global) return null;
  return (
    <span class="scope-own-wrap">
      <span class="scope-own" title="This profile has its own value; other profiles use the global value">
        Own value
      </span>
      <button
        type="button"
        class="link small scope-use-global"
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            await del(`/setting-scope/${state.id}`);
          } catch (err) {
            say(`Not saved: ${(err as Error).message}`, 'error');
            return;
          }
          version.value++;
          onDone?.();
          say(`“${state.label}” now uses the global value`);
        }}
      >
        Use the global value
      </button>
    </span>
  );
}
