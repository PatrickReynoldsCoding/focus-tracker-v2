// The Tags row of the Files tab: a chip per tag (choose several: files with all of them), No tag,
// and Manage tags. Its value is GET /api/files's `tag`: tag ids with commas, or "none". After the
// owner's tags come the projects' automatic tags (D53, "● name"), finished projects' only when chosen.
import { useState } from 'preact/hooks';
import { ManageTags } from './ManageTags';
import { useTags } from './store';

const NONE = 'none';
const FINISHED = ['done', 'dropped'];

export function TagFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tags = useTags();
  const [managing, setManaging] = useState(false);
  const chosen = value ? value.split(',').filter(Boolean) : [];
  if (!tags?.length && !value) return null;
  const own = (tags ?? []).filter((t) => !t.auto);
  const auto = (tags ?? []).filter((t) => t.auto && (!FINISHED.includes(t.status ?? '') || chosen.includes(t.id)));
  const toggle = (id: string) => {
    if (id === NONE) return onChange(chosen.includes(NONE) ? '' : NONE);
    const rest = chosen.filter((x) => x !== NONE);
    onChange((rest.includes(id) ? rest.filter((x) => x !== id) : [...rest, id]).join(','));
  };
  return (
    <div class="tag-filter">
      <span class="tag-filter-label" aria-hidden="true">
        Tags
      </span>
      <div class="chips tag-filter-chips" role="group" aria-label="Tags">
        {own.map((t) => {
          const on = chosen.includes(t.id);
          return (
            <button key={t.id} class={`chip tag-filter-chip ${on ? 'on' : ''}`} aria-pressed={on} data-tint={t.color ?? undefined} data-pat={t.color ?? undefined} onClick={() => toggle(t.id)}>
              {on && <span aria-hidden="true">✓ </span>}#{t.name}
            </button>
          );
        })}
        {auto.map((t) => {
          const on = chosen.includes(t.id);
          return (
            <button key={t.id} class={`chip tag-filter-chip tag-auto ${on ? 'on' : ''}`} aria-pressed={on} title={`Project tag: ${t.name}`} onClick={() => toggle(t.id)}>
              {on ? <span aria-hidden="true">✓ </span> : <span class="tag-auto-dot" aria-hidden="true">● </span>}
              {t.name}
            </button>
          );
        })}
        <button class={`chip tag-filter-chip ${chosen.includes(NONE) ? 'on' : ''}`} aria-pressed={chosen.includes(NONE)} onClick={() => toggle(NONE)}>
          {chosen.includes(NONE) && <span aria-hidden="true">✓ </span>}No tag
        </button>
        {chosen.length > 0 && (
          <button class="chip tag-filter-clear" onClick={() => onChange('')}>
            Clear
          </button>
        )}
      </div>
      <button class="icon small tag-filter-manage" aria-label="Manage tags" title="Manage tags" onClick={() => setManaging(true)}>
        ⚙
      </button>
      {managing && <ManageTags onClose={() => setManaging(false)} />}
    </div>
  );
}
