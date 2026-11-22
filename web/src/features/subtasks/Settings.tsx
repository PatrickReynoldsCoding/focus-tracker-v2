// Settings → Subtasks: "Subtasks open by default", for this profile or for every profile (D46).
import { put, say, version } from '../../core/api';
import { OwnValue, scopedChange, ScopeChoice, useScopeStates } from '../../core/scope';
import { Loading } from '../../core/ui';
import { OPEN_SETTING, reloadOpenDefault } from './state';

const SECTION = 'subtasks';

export function SubtasksSettings() {
  const { states, of } = useScopeStates();
  if (!states) return <Loading />;
  const on = ((of(OPEN_SETTING)?.value as string | null | undefined) ?? 'on') !== 'off';
  const set = async (value: boolean, reset: () => void) => {
    try {
      const sent = await scopedChange(SECTION, [OPEN_SETTING], states, (scope) => put(`/settings/${OPEN_SETTING}`, { value: value ? 'on' : 'off', scope }).then(() => scope));
      if (sent === false) return reset();
      version.value++;
      reloadOpenDefault();
      say(sent === 'all' ? 'Saved for every profile' : 'Saved');
    } catch (err) {
      reset();
      say(`Not saved: ${(err as Error).message}`, 'error');
    }
  };
  return (
    <section class="card">
      <h2>Subtasks</h2>
      <ScopeChoice section={SECTION} />
      <label class="inline">
        <input type="checkbox" checked={on} onChange={(e) => { const el = e.target as HTMLInputElement; set(el.checked, () => (el.checked = on)); }} />{' '}
        <span>
          Subtasks open by default
          <OwnValue state={of(OPEN_SETTING)} section={SECTION} />
        </span>
      </label>
      <p class="muted small">Open: subtasks show under each to-do and on each card. Closed: only the count shows, and a tap opens them. A card you have opened or closed on this device keeps what you chose.</p>
    </section>
  );
}
