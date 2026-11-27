// The focus queue in the browser (D67, flag `focus-queue`; the server is src/modules/focus-queue.ts).
// Cards and to-dos queued in order, the first being Now:
// - the focus card on Today shows only Now (today.focus_now): a tick, its title (opens its project
//   or list) and a project label; nothing at all while the queue is empty. Its ⋯ opens the queue.
// - the queue's own page, #/queue: drag to reorder, tick, ◎ Now (to first), ✕ (off the queue).
// - the card dialog adds a card or to-do (◎ Focus on this now / ＋ Add to queue), or takes it off.
// - a Now / Queued chip on board cards and list rows.
// The queue is loaded once into a shared signal (again after each change and on a profile change),
// never a request per card.

import './focus-queue.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { del, get, mode, newId, optimistic, post, say, undo, version } from '../../core/api';
import { useFlag } from '../../core/features';
import { Menu, MenuItem } from '../../core/menu';
import * as offline from '../../core/offline';
import { ProjectLabel, registerPanel, registerRoute, type CardSectionProps, type CardTileProps, type FocusBarProps } from '../../core/registry';
import { signal, useSignal } from '../../core/signal';
import { go, Linkify, Loading } from '../../core/ui';
import { isPlainItem } from '../board/CardDialog';
import { justDragged, useCardDrag } from '../board/drag';

const FLAG = 'focus-queue';
const PATH = '/focus-queue';

export type FocusItem = {
  id: string;
  task_id: string;
  title: string;
  done: string | null;
  project_id: string | null;
  project_name: string | null;
  list_id: string | null;
  list_name: string | null;
  ord: number;
};

// ---------- the shared queue ----------

const queue = signal<{ mode: string; items: FocusItem[] } | null>(null);
let loadedFor = '';

function load(m: string, v: number) {
  const key = `${m}|${v}`;
  if (loadedFor === key) return;
  loadedFor = key;
  get<FocusItem[]>(PATH)
    .then((items) => loadedFor === key && m === mode.value && (queue.value = { mode: m, items }))
    .catch(() => {
      // Try again with the next change; keep what is on screen.
      if (loadedFor === key) loadedFor = '';
    });
}

/** Load it again now (a page that shows it opened: it may have changed elsewhere, by Claude or on another device). */
const refresh = () => {
  loadedFor = '';
  load(mode.value, version.value);
};

/** The queue in order (null while loading, or while the flag is off). */
function useQueue(): FocusItem[] | null {
  const on = useFlag(FLAG);
  const m = useSignal(mode);
  const v = useSignal(version);
  const q = useSignal(queue);
  useEffect(() => {
    if (on) load(m, v);
  }, [on, m, v]);
  return on && q?.mode === m ? q.items : null;
}

/** Change the queue on screen (and in this device's saved copy, for offline). Returns how to put it back. */
function setQueue(fn: (items: FocusItem[]) => FocusItem[]): () => void {
  const before = queue.value;
  const m = mode.value;
  const items = fn(before?.mode === m ? before.items : []);
  queue.value = { mode: m, items };
  if (offline.enabled()) offline.saveCopy(m, PATH, items);
  return () => {
    queue.value = before;
    if (before && offline.enabled()) offline.saveCopy(before.mode, PATH, before.items);
  };
}

const items = () => (queue.value?.mode === mode.value ? queue.value.items : []);
const answered = (out: unknown): out is FocusItem[] => Array.isArray(out);

/** Where an item opens: a to-do its list, a project's card its project. */
const hrefOf = (i: Pick<FocusItem, 'list_id' | 'project_id'>) => (i.list_id ? `#/n/${i.list_id}` : i.project_id ? `#/p/${i.project_id}` : null);

// ---------- changes ----------

type CardLike = { id: string; title: string; project_id?: string | null; list_id?: string | null };

async function addToQueue(card: CardLike, at: 'now' | 'end') {
  const id = items().find((i) => i.task_id === card.id)?.id ?? newId();
  const item: FocusItem = { id, task_id: card.id, title: card.title, done: null, project_id: card.project_id ?? null, project_name: null, list_id: card.list_id ?? null, list_name: null, ord: 0 };
  const out = await optimistic(
    () => setQueue((q) => (at === 'now' ? [item, ...q.filter((i) => i.task_id !== card.id)] : [...q.filter((i) => i.task_id !== card.id), item])),
    () => post<FocusItem[]>(PATH, { task_id: card.id, at, id }),
  );
  if (!answered(out)) return;
  const placed = out.findIndex((i) => i.task_id === card.id);
  const mine = out[placed];
  const done = placed === 0 ? `Now: ${card.title}` : `Queued · #${placed + 1}`;
  // Cards from any project may be queued; say so when it is not today's focus project.
  const focus = await get<{ focus: { id: string; name: string } | null }>('/today')
    .then((t) => t.focus)
    .catch(() => null);
  if (focus && mine && mine.project_id !== focus.id) say(`${done}. It is not in today’s focus project (${focus.name}).`, 'info', { label: 'Undo', run: undo });
  else say(done, 'info', { label: 'Undo', run: undo });
}

const takeOff = (item: FocusItem) =>
  optimistic(
    () => setQueue((q) => q.filter((i) => i.id !== item.id)),
    () => del(`${PATH}/${item.id}`),
    'Taken off the queue',
  );

const moveTo = (item: FocusItem, index: number) =>
  optimistic(
    () =>
      setQueue((q) => {
        const rest = q.filter((i) => i.id !== item.id);
        return [...rest.slice(0, index), item, ...rest.slice(index)];
      }),
    () => post(`${PATH}/${item.id}/move`, { index }),
    index === 0 ? `Now: ${item.title}` : undefined,
  );

/** Tick a queued task done: the server takes it off the queue, so the next one becomes Now. */
function tick(item: { task_id: string; title: string }, bar?: FocusBarProps) {
  return optimistic(
    () => {
      const next = items().filter((i) => i.task_id !== item.task_id)[0] ?? null;
      const back = setQueue((q) => q.filter((i) => i.task_id !== item.task_id));
      const before = bar?.today.focus_now ?? null;
      bar?.setToday((d) => ({ ...d, focus_now: next }));
      return () => {
        back();
        bar?.setToday((d) => ({ ...d, focus_now: before }));
      };
    },
    () => post(`/tasks/${item.task_id}/tick`, { done: true }),
    `Done: ${item.title}`,
  );
}

// ---------- pieces ----------

function Tick({ title, onTick }: { title: string; onTick: () => void }) {
  return (
    <button class="fq-tick" role="checkbox" aria-checked={false} aria-label={`Done: ${title}`} title="Done" onClick={onTick}>
      <span class="fq-circle" aria-hidden="true" />
    </button>
  );
}

/** The Now card on the focus bar: only the first item, nothing when the queue is empty. */
function NowCard(bar: FocusBarProps) {
  const { today } = bar;
  const now: FocusItem | null = today.focus_now ?? null;
  // Today loaded a Now the shared queue does not have first: it changed elsewhere.
  useEffect(() => {
    const first = queue.value?.items[0];
    if (queue.value && (first?.task_id ?? null) !== (now?.task_id ?? null)) refresh();
  }, [now?.task_id]);
  if (!now) return null;
  const href = hrefOf(now);
  return (
    <div class="fq-now">
      <Tick title={now.title} onTick={() => tick(now, bar)} />
      <div class="fq-now-body">
        <span class="fq-k">Now</span>
        {href ? (
          <a class="fq-now-title" href={href}>
            {now.title}
          </a>
        ) : (
          <span class="fq-now-title">{now.title}</span>
        )}
      </div>
      {now.project_id && <ProjectLabel projectId={now.project_id} />}
    </div>
  );
}

/** The focus card's ⋯: Queue, with its count. */
function FocusMenu() {
  const q = useQueue();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button class="icon small fq-menu-btn" aria-label="Focus menu" aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement))}>
        ⋯
      </button>
      {anchor && (
        <Menu anchor={anchor} onClose={() => setAnchor(null)} label="Focus">
          <MenuItem icon="☰" href="#/queue">
            Queue <span class="fq-count">{q ? q.length : ''}</span>
          </MenuItem>
        </Menu>
      )}
    </>
  );
}

function QueueRow({ item, first }: { item: FocusItem; first: boolean }) {
  const href = hrefOf(item);
  const open = () => href && !justDragged() && go(href.slice(1));
  return (
    <li class={`fq-item${first ? ' now' : ''}`} data-id={item.id}>
      <span class="fq-grip" aria-hidden="true">
        ⠿
      </span>
      <Tick title={item.title} onTick={() => tick(item)} />
      <div class="fq-body">
        {first && <span class="fq-k">Now</span>}
        <span class="fq-title" role="link" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
          <Linkify text={item.title} />
        </span>
        {item.project_id && <ProjectLabel projectId={item.project_id} />}
      </div>
      {!first && (
        <button class="ghost small fq-now-btn" onClick={() => moveTo(item, 0)} aria-label={`Now: ${item.title}`}>
          ◎ Now
        </button>
      )}
      <button class="icon fq-x" aria-label={`Take ${item.title} off the queue`} title="Take off the queue" onClick={() => takeOff(item)}>
        ✕
      </button>
    </li>
  );
}

function QueuePage() {
  const q = useQueue();
  const list = useRef<HTMLUListElement>(null);
  const has = !!q && q.length > 0;
  useEffect(refresh, []);
  useCardDrag(
    list,
    'focus-queue',
    (id, _col, index) => {
      const item = items().find((i) => i.id === id);
      if (item) moveTo(item, index);
    },
    has,
    'button, a',
  );
  return (
    <div class="stack fq-page">
      <div class="page-head">
        <h1>Queue</h1>
      </div>
      {!q ? (
        <Loading />
      ) : !has ? (
        <p class="muted fq-empty">Nothing queued. Add cards from a card’s dialog.</p>
      ) : (
        <section class="card">
          <ul class="fq-list ub-drag" ref={list}>
            {q.map((i, n) => (
              <QueueRow key={i.id} item={i} first={n === 0} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The card dialog's part: add to the queue, or where it is and Take off queue. */
function QueueSection({ card, columns }: CardSectionProps) {
  const q = useQueue();
  if (!q || isPlainItem(card, columns) || card.done) return null;
  const at = q.findIndex((i) => i.task_id === card.id);
  return (
    <div class="fq-section row">
      {at < 0 ? (
        <>
          <button class="small primary" onClick={() => addToQueue(card, 'now')}>
            ◎ Focus on this now
          </button>
          <button class="small" onClick={() => addToQueue(card, 'end')}>
            ＋ Add to queue
          </button>
        </>
      ) : (
        <>
          <span class="tag fq-mark">{at === 0 ? 'Now' : `Queued · #${at + 1}`}</span>
          <button class="ghost small" onClick={() => takeOff(q[at])}>
            Take off queue
          </button>
        </>
      )}
    </div>
  );
}

function QueueMark({ card }: CardTileProps) {
  const q = useQueue();
  if (!q || card.done) return null;
  const at = q.findIndex((i) => i.task_id === card.id);
  if (at < 0) return null;
  return (
    <span class={`tag fq-mark${at === 0 ? ' now' : ''}`} title={at === 0 ? 'Now in the focus queue' : `In the focus queue, #${at + 1}`}>
      {at === 0 ? '◎ Now' : 'Queued'}
    </span>
  );
}

registerPanel('focus', { id: 'focus-now', order: 10, feature: FLAG, render: (p) => <NowCard {...p} /> });
registerPanel('focus-head', { id: 'focus-menu', order: 10, feature: FLAG, render: () => <FocusMenu /> });
registerRoute({ id: 'focus-queue', prefix: '/queue', tab: 'today', feature: FLAG, render: () => <QueuePage /> });
registerPanel('card', { id: 'focus-queue', order: 5, feature: FLAG, render: (p) => <QueueSection {...p} /> });
registerPanel('card-tile', { id: 'focus-queue', order: 5, feature: FLAG, render: ({ card }) => <QueueMark card={card} /> });
