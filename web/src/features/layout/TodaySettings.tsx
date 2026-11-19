// Today settings (the ⚙ at the end of the pill row, on every screen): the pills (add, rename,
// reorder, delete, choose their panels), the focus card's size and the pill row's switches. The
// pill sheet (PillSheet) is also opened straight from the row on a wide screen (✎ Edit pill,
// + New pill). Every change shows at once and is saved behind; pill changes can be undone.

import { useState } from 'preact/hooks';
import { del, undo } from '../../core/api';
import { useFlags } from '../../core/features';
import { lookupPanel, standIn, type PanelDef } from '../../core/registry';
import { Dialog } from '../../core/ui';
import { groupByKind, useAddable } from './AddFeature';
import { readingOrder } from './grid';
import { layoutNow, MAX_PILLS, newPill, PILL_ICONS, PILL_NAME_MAX, PINNED, saveLayout, savePillGrid, savePills, saveView, titleOf, type Pill, type View } from './store';

type Option = { id: string; title: string; kind?: string; description?: string };

/** Everything a pill can hold: Today's panels (not the pinned focus card), then what could go on Today. */
function usePillOptions(place: string, panels: PanelDef<any>[]) {
  const flags = useFlags();
  const offered = useAddable(place);
  const options: Option[] = [
    ...panels.filter((p) => !p.fixed && p.id !== PINNED).map((p) => ({ id: p.id, title: titleOf(p), kind: p.kind, description: p.description })),
    ...(offered ?? []).filter((a) => !panels.some((p) => p.id === a.id)),
  ];
  const nameOf = (id: string) => options.find((o) => o.id === id)?.title ?? lookupPanel(place, id, flags)?.title ?? 'Panel';
  return { options, nameOf, loading: offered === null };
}

/** Save a pill made or changed in the sheet. When the pill has its own grid, the sheet's order
 *  becomes the grid's order too (so ▲ ▼ mean the same on the phone and the computer). */
async function savePill(place: string, pills: Pill[], p: Pill, isNew: boolean): Promise<boolean> {
  const ok = await savePills(place, isNew ? [...pills, p] : pills.map((x) => (x.id === p.id ? p : x)));
  const grid = layoutNow(place).grids[p.id];
  if (ok && grid && readingOrder(p.panels, grid).join() !== p.panels.join()) {
    const items: typeof grid.items = {};
    p.panels.forEach((id, i) => grid.items[id] && (items[id] = { ...grid.items[id], y: i * 10 }));
    await savePillGrid(place, p.id, { items, removed: [] });
  }
  return ok;
}

/** The sheet that makes or changes one pill, on its own (from the pill row) or over Today settings. */
export function PillSheet({
  place,
  panels,
  pills,
  start,
  isNew,
  onClose,
  onDone,
}: {
  place: string;
  panels: PanelDef<any>[];
  pills: Pill[];
  start: Pill;
  isNew: boolean;
  onClose: () => void;
  /** After a save or delete: what can be undone, and the pill to show (a new one). */
  onDone: (undoable: string | null, show?: string) => void;
}) {
  const { options, nameOf, loading } = usePillOptions(place, panels);
  const grid = layoutNow(place).grids[start.id];
  const ordered = grid ? readingOrder(start.panels, grid) : start.panels;
  // An old id a newer panel replaces (PanelDef.replaces) is edited as that panel.
  const ids = ordered.map((id) => standIn(panels, id)?.id ?? id).filter((id, i, all) => all.indexOf(id) === i);
  const first = { ...start, panels: ids };
  return (
    <PillEditor
      start={first}
      isNew={isNew}
      options={options}
      loading={loading}
      nameOf={nameOf}
      onClose={onClose}
      onSave={async (p) => {
        onDone(null, isNew ? p.id : undefined);
        await savePill(place, pills, p, isNew);
      }}
      onDelete={
        isNew
          ? undefined
          : async () => {
              const ok = await savePills(place, pills.filter((x) => x.id !== start.id));
              onDone(ok ? `Pill “${start.name}” deleted` : null);
            }
      }
    />
  );
}

export function TodaySettings({ place, panels, pills, saved, view, onClose }: { place: string; panels: PanelDef<any>[]; pills: Pill[]; saved: boolean; view: View; onClose: () => void }) {
  const [editing, setEditing] = useState<{ pill: Pill; isNew: boolean } | null>(null);
  const { nameOf } = usePillOptions(place, panels);

  // The sheet sits above the page's messages, so what can be undone is said here, with its Undo.
  const [notice, setNotice] = useState<string | null>(null);
  const save = (list: Pill[], done?: string) => savePills(place, list).then((ok) => setNotice(ok && done ? done : null));
  const reset = () => saveLayout(place, { pills: null }, () => del(`/layout/${place}/pills`)).then((ok) => setNotice(ok ? 'Pills are back to the usual ones.' : null));
  const moveBy = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= pills.length) return;
    const list = [...pills];
    [list[i], list[j]] = [list[j], list[i]];
    save(list);
  };
  const full = pills.length >= MAX_PILLS;
  const card = view.focusCard ?? 'compact';
  const sw = (key: 'pillCounts' | 'pillSwipe' | 'pillLast' | 'pillAll', label: string, hint: string) => {
    const on = view[key] !== false;
    return (
      <label class="pl-switch">
        <span>
          {label}
          <span class="muted small"> {hint}</span>
        </span>
        <input type="checkbox" role="switch" checked={on} onChange={() => saveView(place, { [key]: !on })} />
      </label>
    );
  };

  return (
    <Dialog title="Today settings" onClose={onClose} wide>
      <div class="pl-settings">
        <section>
          <h3>Pills</h3>
          <p class="muted small">Each pill is a tab of Today with the panels you put in it, the same on every device. On a computer each pill has its own layout; on a phone its panels stack, and a swipe on them goes to the next pill.</p>
          <ul class="pl-cards">
            {pills.map((pill, i) => (
              <li key={pill.id} class="pl-card">
                <div class="pl-card-main">
                  <strong>
                    {pill.icon && <span aria-hidden="true">{pill.icon} </span>}
                    {pill.name}
                  </strong>
                  <div class="pl-tags">
                    {pill.panels.length ? (
                      pill.panels.map((id) => (
                        <span key={id} class="tag">
                          {nameOf(id)}
                        </span>
                      ))
                    ) : (
                      <span class="muted small">No panels</span>
                    )}
                  </div>
                </div>
                <div class="pl-card-acts">
                  <button class="icon" aria-label={`Move ${pill.name} up`} disabled={i === 0} onClick={() => moveBy(i, -1)}>
                    ▲
                  </button>
                  <button class="icon" aria-label={`Move ${pill.name} down`} disabled={i === pills.length - 1} onClick={() => moveBy(i, 1)}>
                    ▼
                  </button>
                  <button class="small" onClick={() => setEditing({ pill, isNew: false })}>
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {notice && (
            <div class="pl-notice" role="status">
              <span>{notice}</span>
              <button
                class="small"
                onClick={() => {
                  setNotice(null);
                  undo();
                }}
              >
                Undo
              </button>
            </div>
          )}
          <div class="row">
            <button class="primary" disabled={full} onClick={() => setEditing({ pill: newPill(), isNew: true })}>
              + New pill
            </button>
            {saved && (
              <button class="ghost" onClick={reset}>
                Back to the usual pills
              </button>
            )}
          </div>
          {full && <span class="muted small">At most {MAX_PILLS} pills.</span>}
          {sw('pillAll', 'Show the All pill', 'at the end: every panel on Today, so nothing is out of reach')}
        </section>

        <section>
          <h3>Focus card</h3>
          <div class="pl-seg" role="radiogroup" aria-label="Focus card">
            {(
              [
                ['compact', 'Compact'],
                ['full', 'Full'],
                ['hidden', 'Hidden'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} role="radio" aria-checked={card === v} class={card === v ? 'on' : ''} onClick={() => saveView(place, { focusCard: v })}>
                {label}
              </button>
            ))}
          </div>
          <p class="muted small">
            Above the pills, on every device.{' '}
            {card === 'compact' ? 'The project and its session; More shows the rest.' : card === 'full' ? 'The whole focus card.' : 'No focus card on Today. The corner timer still shows a running session.'}
          </p>
        </section>

        <section>
          <h3>Pill row</h3>
          {sw('pillCounts', 'Show counts on pills', 'such as to-dos still open')}
          {sw('pillSwipe', 'Swipe between pills', 'on a phone, on the panels; off: a swipe there changes tab')}
          {sw('pillLast', 'Open on the pill I used last', 'off: the first pill')}
        </section>
      </div>
      {editing && (
        <PillSheet
          place={place}
          panels={panels}
          pills={pills}
          start={editing.pill}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onDone={(msg) => {
            setEditing(null);
            setNotice(msg);
          }}
        />
      )}
    </Dialog>
  );
}

function PillEditor({
  start,
  isNew,
  options,
  loading,
  nameOf,
  onClose,
  onSave,
  onDelete,
}: {
  start: Pill;
  isNew: boolean;
  options: Option[];
  loading: boolean;
  nameOf: (id: string) => string;
  onClose: () => void;
  onSave: (p: Pill) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(start.name);
  const [icon, setIcon] = useState<string | null>(start.icon);
  const [list, setList] = useState<string[]>(start.panels);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const l = [...list];
    [l[i], l[j]] = [l[j], l[i]];
    setList(l);
  };
  const free = options.filter((o) => !list.includes(o.id));
  const done = () => {
    const n = name.trim() || (list[0] ? nameOf(list[0]) : 'New pill');
    onSave({ ...start, name: [...n].slice(0, PILL_NAME_MAX).join(''), icon, panels: list });
  };
  return (
    <Dialog title={isNew ? 'New pill' : `Edit “${start.name}”`} onClose={onClose} wide>
      <form
        class="pl-editor"
        onSubmit={(e) => {
          e.preventDefault();
          done();
        }}
      >
        <label>
          Name
          <input value={name} maxLength={PILL_NAME_MAX} placeholder={list[0] ? nameOf(list[0]) : 'New pill'} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <fieldset class="pl-icons">
          <legend>Icon</legend>
          <div role="radiogroup" aria-label="Icon">
            {[null, ...PILL_ICONS].map((ic) => (
              <button type="button" key={ic ?? 'none'} role="radio" aria-checked={icon === ic} aria-label={ic ?? 'No icon'} class={icon === ic ? 'on' : ''} onClick={() => setIcon(ic)}>
                {ic ?? '–'}
              </button>
            ))}
          </div>
        </fieldset>
        <h3>In this pill, top to bottom</h3>
        {list.length ? (
          <ul class="pl-in">
            {list.map((id, i) => (
              <li key={id}>
                <span>{nameOf(id)}</span>
                <span class="row tight">
                  <button type="button" class="icon" aria-label={`Move ${nameOf(id)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    ▲
                  </button>
                  <button type="button" class="icon" aria-label={`Move ${nameOf(id)} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                    ▼
                  </button>
                  <button type="button" class="icon" aria-label={`Take ${nameOf(id)} out`} onClick={() => setList(list.filter((x) => x !== id))}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted small">Nothing yet: add panels below.</p>
        )}
        <h3>Add</h3>
        {groupByKind(free).map(([group, items]) => (
          <div key={group} class="pl-add-group">
            <h4>{group}</h4>
            <div class="chips">
              {items.map((o) => (
                <button type="button" key={o.id} class="chip" title={o.description} onClick={() => setList([...list, o.id])}>
                  + {o.title}
                </button>
              ))}
            </div>
          </div>
        ))}
        {loading && <p class="muted small">Loading notes, lists and whiteboards…</p>}
        <div class="row pl-editor-foot">
          <button class="primary" type="submit">
            {isNew ? 'Add pill' : 'Save'}
          </button>
          <button type="button" class="ghost" onClick={onClose}>
            Cancel
          </button>
          {onDelete && (
            <button type="button" class="ghost danger" onClick={onDelete}>
              Delete pill
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
