// Manage categories (D48): every category of the profile with an editable name, a colour (the
// strong button colours or a #rrggbb of your own), ▲▼ to reorder, delete with what it affects,
// and + New category. Changes show at once on the buttons (the Projects tab owns the list and
// hands it in), are sent like other edits (queued while offline) and each can be undone.
import { useState } from 'preact/hooks';
import { newId, optimistic, patch, post, undo } from '../../core/api';
import { AddInput, Dialog, useData } from '../../core/ui';
import { HEX, inkFor, PALETTE, type Cat } from './CategoryButtons';
import './manage-categories.css';

type Usage = Record<string, Record<string, number>>;
const NOUN: Record<string, [string, string]> = { projects: ['project', 'projects'], backlog: ['backlog item', 'backlog items'], habits: ['habit', 'habits'], resources: ['resource', 'resources'] };
export const describeUse = (u: Record<string, number> | undefined) =>
  Object.entries(u ?? {})
    .map(([k, n]) => `${n} ${NOUN[k]?.[n === 1 ? 0 : 1] ?? k}`)
    .join(', ');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ManageCategories({ cats, setCats, onClose }: { cats: Cat[]; setCats: (fn: (l: Cat[]) => Cat[]) => void; onClose: () => void }) {
  const { data: usage, reload } = useData<Usage>('/categories/usage');
  const [confirming, setConfirming] = useState<string | null>(null);
  // The toast's Undo is under the dialog, so the dialog keeps the last change with its own Undo.
  const [last, setLast] = useState<string | null>(null);
  const sent = <T,>(p: Promise<T | undefined>, text: string) => p.then((r) => r !== undefined && setLast(text));

  const make = (raw: string) => {
    const label = raw.trim();
    if (!label) return;
    const id = newId();
    sent(
      optimistic(
        () => (setCats((l) => [...l, { id, label, color: null }]), () => setCats((l) => l.filter((c) => c.id !== id))),
        () => post('/categories', { id, label }),
        `Added the category ${label}`,
      ),
      `Added ${label}`,
    );
  };
  const save = (c: Cat, p: Partial<Cat>) =>
    sent(
      optimistic(
        () => (setCats((l) => l.map((x) => (x.id === c.id ? { ...x, ...p } : x))), () => setCats((l) => l.map((x) => (x.id === c.id ? c : x)))),
        () => patch(`/categories/${c.id}`, p),
      ),
      p.label ? `Renamed ${c.label} to ${p.label}` : `Changed the colour of ${c.label}`,
    );
  const shift = (i: number, by: -1 | 1) => {
    const a = cats[i];
    const b = cats[i + by];
    if (!a || !b) return;
    const before = cats;
    const next = [...cats];
    next[i] = b;
    next[i + by] = a;
    sent(
      optimistic(
        () => (setCats(() => next), () => setCats(() => before)),
        () => post(`/categories/${a.id}/move`, by < 0 ? { before_id: b.id } : { after_id: b.id }),
      ),
      `Moved ${a.label} ${by < 0 ? 'up' : 'down'}`,
    );
  };
  const remove = (c: Cat) => {
    setConfirming(null);
    const at = cats.findIndex((x) => x.id === c.id);
    sent(
      optimistic(
        () => (setCats((l) => l.filter((x) => x.id !== c.id)), () => setCats((l) => [...l.slice(0, at), c, ...l.slice(at)])),
        async () => {
          const out = await post(`/categories/${c.id}/delete`, {});
          reload();
          return out;
        },
      ),
      `Deleted ${c.label}`,
    );
  };

  return (
    <Dialog title="Manage categories" onClose={onClose}>
      <div class="stack manage-cats">
        <AddInput placeholder="+ New category" onAdd={make} />
        {last && (
          <p class="mc-last small" role="status">
            {last}.{' '}
            <button
              type="button"
              class="ghost small mc-undo"
              onClick={async () => {
                setLast(null);
                await undo();
                reload();
              }}
            >
              Undo
            </button>
          </p>
        )}
        {!cats.length ? (
          <p class="muted small">No categories yet. Add one above.</p>
        ) : (
          <ul class="mc-list">
            {cats.map((c, i) => (
              <Row key={c.id} cat={c} first={i === 0} last={i === cats.length - 1} uses={usage?.[c.id]} confirming={confirming === c.id} onSave={(p) => save(c, p)} onShift={(by) => shift(i, by)} onAsk={() => setConfirming(c.id)} onCancel={() => setConfirming(null)} onDelete={() => remove(c)} />
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

function Row({ cat, first, last, uses, confirming, onSave, onShift, onAsk, onCancel, onDelete }: { cat: Cat; first: boolean; last: boolean; uses: Record<string, number> | undefined; confirming: boolean; onSave: (p: Partial<Cat>) => void; onShift: (by: -1 | 1) => void; onAsk: () => void; onCancel: () => void; onDelete: () => void }) {
  const [name, setName] = useState(cat.label);
  const [hex, setHex] = useState(cat.color && HEX.test(cat.color) ? cat.color : '');
  const custom = !!cat.color && HEX.test(cat.color);
  const colourName = custom ? cat.color! : cat.color && PALETTE.includes(cat.color) ? cat.color : 'none';
  const rename = () => {
    const n = name.trim();
    if (!n) return setName(cat.label);
    if (n !== cat.label) onSave({ label: n });
  };
  const pick = (color: string | null) => {
    if ((color ?? null) !== (cat.color ?? null)) onSave({ color });
  };
  const used = describeUse(uses);
  return (
    <li class="mc-row" data-cat={cat.label}>
      <div class="mc-head">
        <form
          class="mc-name"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <input value={name} maxLength={60} aria-label={`Name of ${cat.label}`} onInput={(e) => setName((e.target as HTMLInputElement).value)} onBlur={rename} />
        </form>
        <div class="mc-move">
          <button type="button" class="icon" aria-label={`Move ${cat.label} up`} disabled={first} onClick={() => onShift(-1)}>
            ▲
          </button>
          <button type="button" class="icon" aria-label={`Move ${cat.label} down`} disabled={last} onClick={() => onShift(1)}>
            ▼
          </button>
        </div>
      </div>
      <div class="mc-preview">
        <span class="cat-btn mc-sample" data-color={custom ? 'custom' : colourName} style={custom ? { '--kb': cat.color!, '--kb-fg': inkFor(cat.color!) } : undefined}>
          <span class="cat-btn-name">{cat.label}</span>
          <span class="cat-btn-n">{uses?.projects ?? 0}</span>
        </span>
        <span class="mc-text" aria-hidden="true">
          Aa sample text
        </span>
        <span class="mc-colour-name muted small">Colour: {colourName}</span>
      </div>
      <div class="mc-swatches" role="radiogroup" aria-label={`Colour of ${cat.label}`}>
        {PALETTE.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={cat.color === p} aria-label={p} title={cap(p)} class={`mc-swatch ${cat.color === p ? 'on' : ''}`} data-color={p} data-abbr={p === 'grey' ? 'Gy' : cap(p.slice(0, 2))} onClick={() => pick(p)}>
            {cat.color === p ? '✓' : ''}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={!cat.color} aria-label="No colour" title="No colour" class={`mc-swatch mc-none ${!cat.color ? 'on' : ''}`} onClick={() => pick(null)}>
          {!cat.color ? '✓' : '∅'}
        </button>
      </div>
      <form
        class="mc-custom"
        onSubmit={(e) => {
          e.preventDefault();
          const v = hex.trim().toLowerCase();
          if (HEX.test(v)) pick(v);
        }}
      >
        <label class="small muted" for={`mc-hex-${cat.id}`}>
          Own colour
        </label>
        <input type="color" aria-label={`Pick an own colour for ${cat.label}`} value={custom ? cat.color! : '#3366cc'} onChange={(e) => (setHex((e.target as HTMLInputElement).value), pick((e.target as HTMLInputElement).value))} />
        <input id={`mc-hex-${cat.id}`} class="mc-hex" value={hex} placeholder="#3366cc" maxLength={7} aria-invalid={!!hex && !HEX.test(hex)} onInput={(e) => setHex((e.target as HTMLInputElement).value)} />
        <button type="submit" disabled={!HEX.test(hex.trim())}>
          Use
        </button>
      </form>
      {confirming ? (
        <div class="mc-confirm callout" role="alertdialog" aria-label={`Delete ${cat.label}`}>
          <p>
            Delete <b>{cat.label}</b>? {used ? `${cap(used)} use it. They stay, with no category.` : 'Nothing uses it.'} Undo brings it back.
          </p>
          <div class="row tight">
            <button type="button" class="danger small mc-delete-yes" onClick={onDelete}>
              Delete category
            </button>
            <button type="button" class="ghost small" onClick={onCancel}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div class="mc-foot">
          <span class="muted small">{used || 'Not used yet'}</span>
          <button type="button" class="danger ghost small" onClick={onAsk}>
            Delete…
          </button>
        </div>
      )}
    </li>
  );
}
