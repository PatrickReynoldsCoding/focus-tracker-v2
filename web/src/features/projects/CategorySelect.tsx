import { useState } from 'preact/hooks';
import { change, newId, post } from '../../core/api';

/** A category select with "+ New category…", which asks for a name in place. */
export function CategorySelect({ value, cats, onPick }: { value: string | null; cats: { id: string; label: string }[] | undefined; onPick: (id: string | null) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const stop = () => {
    setAdding(false);
    setName('');
  };
  const add = async () => {
    const label = name.trim();
    if (!label) return;
    const id = newId();
    const made = await change(async () => {
      await post('/categories', { id, label });
      return true;
    });
    stop();
    if (made) onPick(id);
  };
  // Not a form of its own: the habit dialogs use this inside theirs, so Enter and Escape stop here.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') void add();
    else stop();
  };
  if (adding)
    return (
      <span class="row tight">
        <input value={name} autoFocus placeholder="New category name" aria-label="New category name" onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={onKeyDown} />
        <button type="button" class="primary small" disabled={!name.trim()} onClick={add}>
          Add
        </button>
        <button type="button" class="ghost small" onClick={stop}>
          Cancel
        </button>
      </span>
    );
  return (
    <select
      value={value ?? ''}
      aria-label="Category"
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v === '__new') {
          (e.target as HTMLSelectElement).value = value ?? '';
          setAdding(true);
        } else onPick(v || null);
      }}
    >
      <option value="">No category</option>
      {cats?.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
      <option value="__new">+ New category…</option>
    </select>
  );
}
