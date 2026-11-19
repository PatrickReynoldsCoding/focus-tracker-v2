import Sortable from 'sortablejs';
import { useEffect, useRef, useState } from 'preact/hooks';
import { optimistic, patch, post } from '../../core/api';
import { DriveDialog } from './DriveDialog';
import { KindIcon } from './icons';
import { copyText, groupItems, hrefOf, kindLabel, kindOf, ownerKey, subtitle, type Owner, type Resource } from './model';
import { ResourceDialog } from './ResourceDialog';

type SetItems = (fn: (items: Resource[]) => Resource[]) => void;

function Row({ r, onEdit }: { r: Resource; onEdit: () => void }) {
  const href = hrefOf(r);
  const copyable = r.type === 'phone' || r.type === 'email' || r.type === 'text';
  const external = r.type === 'link' || r.type === 'drive';
  return (
    <li class="res-row" data-id={r.id}>
      <span class="res-drag" aria-hidden="true" title="Drag to reorder">
        ⋮⋮
      </span>
      <KindIcon kind={kindOf(r)} size={26} />
      <div class="res-main">
        {href ? (
          <a class="res-title" href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {r.title}
          </a>
        ) : (
          <span class="res-title">{r.title}</span>
        )}
        <span class="res-sub muted small" title={kindLabel(r)}>
          {r.type === 'text' ? <span class="res-text">{r.value}</span> : subtitle(r)}
          {r.note ? ` · ${r.note}` : ''}
        </span>
      </div>
      {copyable && (
        <button class="ghost small" aria-label={`Copy ${r.title}`} onClick={() => copyText(r.value, r.type === 'phone' ? 'Copied number' : r.type === 'email' ? 'Copied email' : 'Copied')}>
          Copy
        </button>
      )}
      <button class="icon small" aria-label={`Edit ${r.title}`} onClick={onEdit}>
        ✎
      </button>
    </li>
  );
}

function GroupList({ name, items, owner, onEdit, onDrop }: { name: string; items: Resource[]; owner: Owner; onEdit: (r: Resource) => void; onDrop: (id: string, toGroup: string, prevId?: string, nextId?: string) => void }) {
  const ref = useRef<HTMLUListElement>(null);
  const drop = useRef(onDrop);
  drop.current = onDrop;
  useEffect(() => {
    const s = Sortable.create(ref.current!, {
      group: `res-${ownerKey(owner)}`,
      handle: '.res-drag',
      animation: 150,
      delay: 150,
      delayOnTouchOnly: true,
      ghostClass: 'drag-ghost',
      onEnd: (evt) => {
        const id = evt.item.dataset.id!;
        const to = evt.to as HTMLElement;
        const kids = [...to.children] as HTMLElement[];
        const at = kids.indexOf(evt.item);
        const prevId = kids[at - 1]?.dataset.id;
        const nextId = kids[at + 1]?.dataset.id;
        // Put the DOM back; Preact draws the new order from state.
        const fromKids = [...evt.from.children].filter((c) => c !== evt.item);
        evt.from.insertBefore(evt.item, fromKids[evt.oldIndex ?? 0] ?? null);
        if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
        drop.current(id, to.dataset.group ?? '', prevId, nextId);
      },
    });
    return () => s.destroy();
  }, []);
  return (
    <ul class="plain res-list" ref={ref} data-group={name}>
      {items.map((r) => (
        <Row key={r.id} r={r} onEdit={() => onEdit(r)} />
      ))}
    </ul>
  );
}

/**
 * The list of resources of one owner with its buttons: groups as small headings (ungrouped
 * first), drag to reorder (also between groups), edit, copy, Add and Add from Drive.
 */
export function ResourceBlock({ items, setItems, owner, empty }: { items: Resource[]; setItems: SetItems; owner: Owner; empty?: string }) {
  const [editing, setEditing] = useState<Resource | 'new' | null>(null);
  const [drive, setDrive] = useState(false);
  const groups = groupItems(items);
  const groupNames = groups.map((g) => g.name).filter(Boolean);

  function onDrop(id: string, toGroup: string, prevId?: string, nextId?: string) {
    const moved = items.find((x) => x.id === id);
    if (!moved) return;
    const before = items;
    const grp = toGroup || null;
    optimistic(
      () => {
        setItems((xs) => {
          const rest = xs.filter((x) => x.id !== id);
          const i = prevId ? rest.findIndex((x) => x.id === prevId) + 1 : nextId ? rest.findIndex((x) => x.id === nextId) : rest.length;
          return [...rest.slice(0, i), { ...moved, grp }, ...rest.slice(i)];
        });
        return () => setItems(() => before);
      },
      async () => {
        if ((moved.grp ?? '') !== toGroup) await patch(`/resources/${id}`, { grp });
        if (prevId) await post(`/resources/${id}/move`, { after_id: prevId });
        else if (nextId) await post(`/resources/${id}/move`, { before_id: nextId });
      },
    );
  }

  return (
    <div class="res-block">
      <div class="res-buttons">
        <button class="ghost small" onClick={() => setEditing('new')}>
          + Add
        </button>
        <button class="ghost small" onClick={() => setDrive(true)}>
          Add from Drive
        </button>
      </div>
      {groups.map((g) => (
        <div key={g.name} class="res-group">
          {g.name && <h3 class="res-group-name">{g.name}</h3>}
          <GroupList name={g.name} items={g.items} owner={owner} onEdit={setEditing} onDrop={onDrop} />
        </div>
      ))}
      {!items.length && <p class="muted small">{empty ?? 'Nothing here yet.'}</p>}
      {editing && <ResourceDialog initial={editing === 'new' ? undefined : editing} owner={owner} groups={groupNames} setItems={setItems} onClose={() => setEditing(null)} />}
      {drive && <DriveDialog owner={owner} existing={items} groups={groupNames} onClose={() => setDrive(false)} />}
    </div>
  );
}
