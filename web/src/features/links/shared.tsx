// Shared bits of issue links: item icons, which items are blocked now, and opening a linked item.
import { useEffect, useState } from 'preact/hooks';
import { get, mode, version } from '../../core/api';
import { useFlag } from '../../core/features';
import { signal, useSignal } from '../../core/signal';
import { go, useData } from '../../core/ui';
import { CardDialog, type Card, type Column } from '../board';

export const FLAG = 'issue-links';

export type Item = {
  kind: string;
  id: string;
  title: string;
  status: 'open' | 'done' | null;
  context: string | null;
  project_id: string | null;
  list_id: string | null;
  sub: string | null;
};
export type LinkView = { id: string; type: string; direction: 'outward' | 'inward'; phrase: string; note: string | null; item: Item };
export type Relations = { item: Item; links: LinkView[]; blocked_by: Item[] };
export type LinkType = { id: string; outward: string; inward: string; custom?: boolean };

const KIND: Record<string, { icon: string; label: string }> = {
  projects: { icon: '▤', label: 'Project' },
  tasks: { icon: '▭', label: 'Card' },
  todos: { icon: '☐', label: 'To-do' },
  backlog: { icon: '◇', label: 'Backlog item' },
  lists: { icon: '≡', label: 'List' },
};
const LIST_ICON: Record<string, string> = { note: '✎', todo: '☑', list: '≡' };

export const kindIcon = (i: Pick<Item, 'kind' | 'sub'>) => (i.kind === 'lists' && i.sub ? LIST_ICON[i.sub] : undefined) ?? KIND[i.kind]?.icon ?? '•';
export const kindLabel = (kind: string) => KIND[kind]?.label ?? kind;

// ---------- what is blocked now (one request per change, shared by every board card) ----------

type Blocked = Record<string, Record<string, Item[]>>;
const blocked = signal<Blocked | null>(null);
let loadedFor = '';

/**
 * Items blocked by an unfinished item: { projects: { id: [blockers] }, tasks: {…} }.
 * null until first loaded; empty while the feature is off.
 */
export function useBlocked(): Blocked | null {
  const on = useFlag(FLAG);
  const v = useSignal(version);
  const m = useSignal(mode);
  const map = useSignal(blocked);
  useEffect(() => {
    const k = `${m}:${v}`;
    if (!on || k === loadedFor) return;
    loadedFor = k;
    get<Blocked>('/links/blocked')
      .then((b) => loadedFor === k && (blocked.value = b))
      .catch(() => (blocked.value = blocked.value ?? {})); // never leave a list waiting
  }, [on, v, m]);
  return on ? map : {};
}

// ---------- opening a linked item ----------

/** A card opened from a link: its own card dialog on top of the page or dialog. */
function LinkedCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: card, error, setData } = useData<Card & { project_id: string | null; list_id: string | null }>(`/tasks/${id}`);
  const owner = card ? (card.project_id ? `project_id=${card.project_id}` : `list_id=${card.list_id}`) : null;
  const { data: columns } = useData<Column[]>(owner ? `/columns?${owner}` : null);
  useEffect(() => {
    if (error) onClose();
  }, [error]);
  if (!card || !columns) return null;
  return <CardDialog card={card} columns={columns} onClose={onClose} onChange={(p) => (p === null ? onClose() : setData((c) => ({ ...c, ...p })))} />;
}

/** open(item) goes to the item's page, or opens a card's dialog; render `node` somewhere. */
export function useOpener(beforeLeave?: () => void) {
  const [card, setCard] = useState<string | null>(null);
  const open = (i: Item) => {
    if (i.kind === 'tasks') return setCard(i.id);
    const path = i.kind === 'projects' ? `/p/${i.id}` : i.kind === 'lists' ? `/n/${i.id}` : i.kind === 'todos' ? `/n/${i.list_id}` : '/projects';
    beforeLeave?.();
    go(path);
  };
  return { open, node: card ? <LinkedCard id={card} onClose={() => setCard(null)} /> : null };
}

/** "Blocked by A, B" with each blocker opening on a tap. */
export function BlockedBy({ items, open }: { items: Item[]; open: (i: Item) => void }) {
  return (
    <p class="blocked-by">
      <span aria-hidden="true">⛔</span> Blocked by{' '}
      {items.map((b, n) => (
        <>
          {n > 0 && ', '}
          <button class="link-btn" onClick={() => open(b)}>
            {b.title}
          </button>
        </>
      ))}
    </p>
  );
}
