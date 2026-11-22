// Manage tags: every tag of the profile with how many files carry it. Tap one to rename it, give
// it a colour, merge it into another or delete it (it comes off every file; Undo brings it back).
import { useState } from 'preact/hooks';
import { del, newId, optimistic, patch, post } from '../../core/api';
import { AddInput, ColorPicker, Dialog } from '../../core/ui';
import { TagChip } from './Chips';
import { byName, cleanName, patchTags, sameName, useOwnTags, type Tag } from './store';

const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

export function ManageTags({ onClose }: { onClose: () => void }) {
  const tags = useOwnTags();
  const [open, setOpen] = useState<string | null>(null);
  const make = (raw: string) => {
    const name = cleanName(raw);
    if (!name || tags?.some((t) => sameName(t.name, name))) return;
    const id = newId();
    optimistic(
      () => (patchTags((l) => [...l, { id, name, color: null, count: 0 }].sort(byName)), () => patchTags((l) => l.filter((t) => t.id !== id))),
      () => post('/tags', { id, name }),
    );
  };
  return (
    <Dialog title="Manage tags" onClose={onClose}>
      <div class="stack manage-tags">
        <AddInput placeholder="New tag" onAdd={make} />
        {!tags ? (
          <p class="muted">Loading…</p>
        ) : !tags.length ? (
          <p class="muted small">No tags yet. Add one here, or from a file’s ⋯ menu → Tags….</p>
        ) : (
          <ul class="manage-tags-list">
            {tags.map((t) => (
              <TagRow key={t.id} tag={t} others={tags.filter((o) => o.id !== t.id)} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

function TagRow({ tag, others, open, onToggle }: { tag: Tag; others: Tag[]; open: boolean; onToggle: () => void }) {
  const [name, setName] = useState(tag.name);
  const [into, setInto] = useState('');
  const before = () => {
    const keep = tag;
    return () => patchTags((l) => l.map((t) => (t.id === keep.id ? keep : t)));
  };
  const save = (p: Partial<Tag>, done?: string) =>
    optimistic(
      () => {
        const back = before();
        patchTags((l) => l.map((t) => (t.id === tag.id ? { ...t, ...p } : t)).sort(byName));
        return back;
      },
      () => patch(`/tags/${tag.id}`, p),
      done,
    );
  const rename = () => {
    const n = cleanName(name);
    if (!n || n === tag.name) return setName(tag.name);
    if (others.some((o) => sameName(o.name, n))) {
      setName(tag.name);
      return alert(`There is a tag “${n}” already. Use Merge to put them together.`);
    }
    save({ name: n });
  };
  const remove = () => {
    if (tag.count && !confirm(`Delete #${tag.name}? It comes off ${files(tag.count)} (the files stay). Undo brings it back.`)) return;
    const keep = tag;
    optimistic(
      () => (patchTags((l) => l.filter((t) => t.id !== keep.id)), () => patchTags((l) => [...l, keep].sort(byName))),
      () => del(`/tags/${tag.id}`),
      `Deleted #${tag.name}`,
    );
  };
  const merge = () => {
    const target = others.find((o) => o.id === into);
    if (!target) return;
    const keep = tag;
    optimistic(
      () => {
        patchTags((l) => l.filter((t) => t.id !== keep.id).map((t) => (t.id === target.id ? { ...t, count: t.count + keep.count } : t)));
        return () => patchTags((l) => [...l.map((t) => (t.id === target.id ? target : t)), keep].sort(byName));
      },
      () => post(`/tags/${tag.id}/merge`, { into: target.id }),
      `Merged #${keep.name} into #${target.name}`,
    );
  };
  return (
    <li class={`manage-tag ${open ? 'open' : ''}`}>
      <button type="button" class="manage-tag-head" aria-expanded={open} onClick={onToggle}>
        <TagChip tag={tag} />
        <span class="muted small">{files(tag.count)}</span>
        <span class="manage-tag-caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div class="manage-tag-body stack">
          <form
            class="tag-editor-add"
            onSubmit={(e) => {
              e.preventDefault();
              rename();
            }}
          >
            <input value={name} maxLength={40} aria-label={`Name of #${tag.name}`} onInput={(e) => setName((e.target as HTMLInputElement).value.replace(/,/g, ''))} onBlur={rename} />
            <button type="submit">Rename</button>
          </form>
          <ColorPicker value={tag.color} onPick={(color) => save({ color })} />
          {others.length > 0 && (
            <div class="tag-editor-add">
              <select value={into} aria-label={`Merge #${tag.name} into`} onChange={(e) => setInto((e.target as HTMLSelectElement).value)}>
                <option value="">Merge into…</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    #{o.name}
                  </option>
                ))}
              </select>
              <button type="button" disabled={!into} onClick={merge}>
                Merge
              </button>
            </div>
          )}
          <button type="button" class="danger ghost small manage-tag-delete" onClick={remove}>
            Delete tag
          </button>
        </div>
      )}
    </li>
  );
}
