import { useState } from 'preact/hooks';
import { del, newId, optimistic, patch, post } from '../../core/api';
import { Dialog } from '../../core/ui';
import { detectResource, guessTitle, KIND_LABELS } from '../../../../src/core/resource-kinds';
import { KindIcon } from './icons';
import { RULE, type Owner, type Resource } from './model';

const TYPES: { id: string; label: string; icon: Parameters<typeof KindIcon>[0]['kind']; hint: string; mode: 'url' | 'tel' | 'email' | 'text' }[] = [
  { id: 'link', label: 'Link', icon: 'link', hint: 'https://…', mode: 'url' },
  { id: 'drive', label: 'Drive', icon: 'doc', hint: 'Paste a Google Docs, Sheets or Drive address', mode: 'url' },
  { id: 'phone', label: 'Phone', icon: 'phone', hint: '+44 7700 900123', mode: 'tel' },
  { id: 'email', label: 'Email', icon: 'email', hint: 'name@example.com', mode: 'email' },
  { id: 'text', label: 'Text', icon: 'text', hint: 'Any text you want to keep and copy', mode: 'text' },
];

type Setter = (fn: (items: Resource[]) => Resource[]) => void;

/** Add or edit one resource. Delete shows an Undo message. */
export function ResourceDialog({ initial, owner, groups, setItems, onClose }: { initial?: Resource; owner: Owner; groups: string[]; setItems: Setter; onClose: () => void }) {
  const [type, setType] = useState(initial?.type ?? 'link');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [value, setValue] = useState(initial?.value ?? '');
  const [grp, setGrp] = useState(initial?.grp ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const t = TYPES.find((x) => x.id === type) ?? TYPES[0];
  const isWeb = type === 'link' || type === 'drive';
  // For web addresses, show what the address turned out to be.
  const detected = isWeb && value.trim() ? detectResource(value, type === 'link' ? undefined : type) : null;
  const shownKind = detected ? detected.kind : type === 'phone' || type === 'email' || type === 'text' ? type : 'link';
  const looksWrong = isWeb && value.trim() && detected && detected.type !== 'drive' && detected.type !== 'link';

  function save(e: Event) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    const d = detectResource(v, type === 'link' ? undefined : type);
    const fields = {
      title: title.trim() || (isWeb ? guessTitle(v, d.kind) : v.slice(0, 60)),
      type: isWeb ? (d.google ? 'drive' : type) : type,
      value: isWeb ? d.value : v,
      grp: grp.trim() || null,
      note: note.trim() || null,
    };
    const kind = isWeb ? d.kind : type;
    if (initial) {
      const before = initial;
      optimistic(
        () => {
          setItems((xs) => xs.map((x) => (x.id === before.id ? { ...x, ...fields, kind } : x)));
          return () => setItems((xs) => xs.map((x) => (x.id === before.id ? before : x)));
        },
        () => patch(`/resources/${before.id}`, fields),
      );
    } else {
      const id = newId();
      optimistic(
        () => {
          setItems((xs) => [...xs, { id, ...fields, kind, ...owner } as Resource]);
          return () => setItems((xs) => xs.filter((x) => x.id !== id));
        },
        () => post('/resources', { id, ...owner, ...fields }),
      );
    }
    onClose();
  }

  function remove() {
    if (!initial) return;
    const gone = initial;
    onClose();
    let index = 0;
    optimistic(
      () => {
        setItems((xs) => {
          index = xs.findIndex((x) => x.id === gone.id);
          return xs.filter((x) => x.id !== gone.id);
        });
        return () => setItems((xs) => [...xs.slice(0, index), gone, ...xs.slice(index)]);
      },
      () => del(`/resources/${gone.id}`),
      `Removed “${gone.title}”`,
    );
  }

  return (
    <Dialog title={initial ? 'Edit resource' : 'Add a resource'} onClose={onClose}>
      <form class="stack res-form" onSubmit={save}>
        <div class="res-types" role="radiogroup" aria-label="Type">
          {TYPES.map((x) => (
            <button type="button" key={x.id} role="radio" aria-checked={type === x.id} class={`chip ${type === x.id ? 'on' : ''}`} onClick={() => setType(x.id)}>
              <KindIcon kind={x.icon} size={16} /> {x.label}
            </button>
          ))}
        </div>
        <label>
          {type === 'text' ? 'Text' : type === 'phone' ? 'Phone number' : type === 'email' ? 'Email address' : 'Address'}
          {type === 'text' ? (
            <textarea rows={3} required autoFocus={!initial} placeholder={t.hint} value={value} onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)} />
          ) : (
            <input
              required
              autoFocus={!initial}
              {...({ type: t.mode === 'tel' ? 'tel' : t.mode === 'email' ? 'email' : 'text', inputMode: t.mode } as any)}
              autocapitalize="off"
              autocomplete="off"
              spellcheck={false}
              placeholder={t.hint}
              value={value}
              onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            />
          )}
        </label>
        {detected && (
          <p class="res-detected">
            <KindIcon kind={shownKind} size={18} /> <span>{KIND_LABELS[shownKind]}</span>
          </p>
        )}
        {looksWrong && <p class="small error">That does not look like a web address. Pick another type, or fix it.</p>}
        <label>
          Title
          <input placeholder={isWeb && value.trim() ? guessTitle(value) : 'A short name'} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          Group (optional)
          <input list="res-groups" placeholder="Such as Code or Suppliers" value={grp} onInput={(e) => setGrp((e.target as HTMLInputElement).value)} />
          <datalist id="res-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>
        <label>
          Note (optional)
          <input value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
        </label>
        <p class="muted small res-rule">{RULE}</p>
        <div class="row res-actions">
          {initial && (
            <button type="button" class="danger ghost" onClick={remove}>
              Delete
            </button>
          )}
          <span class="spacer" />
          <button type="button" class="ghost" onClick={onClose}>
            Cancel
          </button>
          <button class="primary">{initial ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </Dialog>
  );
}
