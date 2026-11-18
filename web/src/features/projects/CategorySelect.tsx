import { useState } from 'preact/hooks';
import { change, newId, post } from '../../core/api';

/** A category select with "+ New category…", which asks for a name in place. */
export function CategorySelect({ value, cats, onPick }: { value: string | null; cats: { id: string; label: string }[] | undefined; onPick: (id: string | null) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  if (adding)
    return (
      <form
        class="row tight"
        onSubmit={async (e) => {
          e.preventDefault();
          const label = name.trim();
          if (!label) return;
          const id = newId();
          const made = await change(() => post('/categories', { id, label }));
          setAdding(false);
          setName('');
          if (made) onPick(id);
        }}
      >
        <input value={name} autoFocus placeholder="New category name" aria-label="New category name" onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
        <button class="primary small" disabled={!name.trim()}>
          Add
        </button>
        <button type="button" class="ghost small" onClick={() => setAdding(false)}>
          Cancel
        </button>
      </form>
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
