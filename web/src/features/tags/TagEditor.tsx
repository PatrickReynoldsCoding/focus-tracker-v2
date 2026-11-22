// A file's tags in a dialog: its tags as chips (✕ takes one off) and a box to add one by typing,
// with the profile's tags as suggestions; a name that is not a tag yet makes one. Each change is
// shown at once and sent on its own (POST /api/tags/set), so Undo takes back one at a time.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { get, optimistic, post } from '../../core/api';
import type { FileRef } from '../../core/registry';
import { Dialog } from '../../core/ui';
import { TagChip } from './Chips';
import { ManageTags } from './ManageTags';
import { byName, cleanName, patchTags, sameName, useTags, type TagOnFile } from './store';

const SUGGEST = 10;

export function TagEditor({ file, initial, onChange, onClose }: { file: FileRef; initial?: TagOnFile[]; onChange?: (tags: TagOnFile[]) => void; onClose: () => void }) {
  const all = useTags();
  const [tags, setTags] = useState<TagOnFile[] | null>(initial ?? null);
  const [text, setText] = useState('');
  const [managing, setManaging] = useState(false);
  useEffect(() => {
    if (initial) return;
    get<TagOnFile[]>(`/tags/of/${file.type}/${file.id}`).then(setTags, () => setTags([]));
  }, [file.type, file.id]);

  const show = (next: TagOnFile[]) => {
    const sorted = [...next].sort(byName);
    setTags(sorted);
    onChange?.(sorted);
  };
  const send = (body: { add?: string[]; remove?: string[] }, before: TagOnFile[]) =>
    optimistic(
      () => () => show(before),
      () => post<{ tags: TagOnFile[] }>('/tags/set', { type: file.type, id: file.id, ...body }).then((r) => (r && Array.isArray(r.tags) && show(r.tags), r)),
    );

  const add = (raw: string) => {
    const name = cleanName(raw);
    if (!name || !tags) return;
    setText('');
    if (tags.some((t) => sameName(t.name, name))) return;
    const known = all?.find((t) => sameName(t.name, name));
    const before = tags;
    show([...tags, known ? { id: known.id, name: known.name, color: known.color } : { id: `new:${name}`, name, color: null }]);
    if (known) patchTags((l) => l.map((t) => (t.id === known.id ? { ...t, count: t.count + 1 } : t)));
    send({ add: [known?.id ?? name] }, before);
  };
  const removeTag = (t: TagOnFile) => {
    if (!tags) return;
    const before = tags;
    show(tags.filter((x) => x.id !== t.id));
    send({ remove: [t.id.startsWith('new:') ? t.name : t.id] }, before);
  };

  const q = cleanName(text).toLowerCase();
  const suggestions = useMemo(() => {
    const on = new Set((tags ?? []).map((t) => t.name.toLowerCase()));
    return (all ?? []).filter((t) => !on.has(t.name.toLowerCase()) && (!q || t.name.toLowerCase().includes(q))).slice(0, SUGGEST);
  }, [all, tags, q]);
  const exact = !!q && ((all ?? []).some((t) => t.name.toLowerCase() === q) || (tags ?? []).some((t) => t.name.toLowerCase() === q));

  return (
    <Dialog title={`Tags: ${file.name}`} onClose={onClose}>
      <div class="stack tag-editor">
        {!tags ? (
          <p class="muted">Loading…</p>
        ) : (
          <div class="tag-editor-on" aria-label="Tags on this file">
            {tags.length ? tags.map((t) => <TagChip key={t.id} tag={t} onRemove={() => removeTag(t)} />) : <span class="muted small">No tags yet.</span>}
          </div>
        )}
        <form
          class="tag-editor-add"
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
          }}
        >
          <input
            value={text}
            placeholder="Add a tag"
            aria-label="Add a tag"
            maxLength={40}
            autoFocus
            autoComplete="off"
            onInput={(e) => setText((e.target as HTMLInputElement).value.replace(/,/g, ''))}
          />
          <button type="submit" class="primary" disabled={!q || !tags}>
            Add
          </button>
        </form>
        {(suggestions.length > 0 || (q && !exact)) && (
          <div class="tag-suggest" role="group" aria-label="Suggestions">
            {suggestions.map((t) => (
              <button key={t.id} type="button" class="chip tag-suggestion" data-tint={t.color ?? undefined} data-pat={t.color ?? undefined} onClick={() => add(t.name)}>
                #{t.name}
              </button>
            ))}
            {q && !exact && (
              <button type="button" class="chip tag-make" onClick={() => add(text)}>
                Make “{cleanName(text)}”
              </button>
            )}
          </div>
        )}
        <div class="row tag-editor-foot">
          <button type="button" class="ghost small" onClick={() => setManaging(true)}>
            Manage tags…
          </button>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      {managing && <ManageTags onClose={() => setManaging(false)} />}
    </Dialog>
  );
}
