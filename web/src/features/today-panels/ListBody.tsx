// The inside of a list panel (on Today and on a project's page): a plain list's items with an
// add box, or a to-do list's open to-dos with tick and add. Works on GET /api/lists/:id/full.

import { change, del, newId, optimistic, post } from '../../core/api';
import { AddInput, fmtDay, todayLocal } from '../../core/ui';
import { useFlag } from '../../core/features';
import { ListTitle } from './ListDialog';
import { OneAtATime, type QuoteItem } from './OneAtATime';

export type Card = { id: string; title: string; note: string | null };
export type Todo = { id: string; title: string; day: string | null; done: string | null; note?: string | null; group_id: string };
export type FullList = {
  id: string;
  name: string;
  kind: 'list' | 'todo';
  color: string | null;
  display: 'full' | 'one';
  seconds: number;
  project_id: string | null;
  columns?: { id: string; name: string; cards: Card[] }[];
  groups?: { id: string; name: string; todos: Todo[] }[];
};
export type SetList = (fn: (l: FullList) => FullList) => void;

export const cardsOf = (l: FullList): Card[] => (l.columns ?? []).flatMap((c) => c.cards);
export const todosOf = (l: FullList): Todo[] => (l.groups ?? []).flatMap((g) => g.todos);

function PlainItems({ l, setList }: { l: FullList; setList: SetList }) {
  const cards = cardsOf(l);
  return (
    <>
      {cards.length > 0 && (
        <ul class="plain tp-items">
          {cards.map((c) => (
            <li key={c.id}>
              <span>{c.title}</span>
              {c.note && <span class="muted small tp-note-hint"> · {c.note.split('\n')[0]}</span>}
            </li>
          ))}
        </ul>
      )}
      <AddInput
        placeholder="Add an item"
        onAdd={(title) => {
          const id = newId();
          optimistic(
            () => {
              setList((d) => ({ ...d, columns: d.columns!.map((c, i) => (i === 0 ? { ...c, cards: [...c.cards, { id, title, note: null }] } : c)) }));
              return () => setList((d) => ({ ...d, columns: d.columns!.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== id) })) }));
            },
            () => post('/tasks', { id, title, list_id: l.id }),
          );
        }}
      />
    </>
  );
}

function TodoItems({ l, setList }: { l: FullList; setList: SetList }) {
  const today = todayLocal();
  const map = (fn: (t: Todo) => Todo | null) => (d: FullList) => ({ ...d, groups: d.groups!.map((g) => ({ ...g, todos: g.todos.map(fn).filter(Boolean) as Todo[] })) });
  // Open to-dos, and those done today (so a tick does not make them vanish at once).
  const shown = todosOf(l)
    .filter((t) => !t.done || t.done === today)
    .sort((a, b) => Number(!!a.done) - Number(!!b.done));
  return (
    <>
      <ul class="checks">
        {shown.map((t) => (
          <li key={t.id} class={t.done ? 'done' : ''}>
            <label>
              <input
                type="checkbox"
                checked={!!t.done}
                onChange={() =>
                  optimistic(
                    () => {
                      setList(map((x) => (x.id === t.id ? { ...x, done: t.done ? null : today } : x)));
                      return () => setList(map((x) => (x.id === t.id ? t : x)));
                    },
                    () => post(`/todos/${t.id}/tick`, { done: !t.done }),
                  )
                }
              />
              <span>{t.title}</span>
              {t.day && <span class={`tag ${t.day < today && !t.done ? 'late' : ''}`}>{fmtDay(t.day)}</span>}
            </label>
            <button class="icon small" aria-label={`Delete ${t.title}`} onClick={() => change(() => del(`/todos/${t.id}`))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <AddInput
        placeholder="Add a to-do"
        onAdd={(title) => {
          const id = newId();
          const group = l.groups![0];
          optimistic(
            () => {
              setList((d) => ({ ...d, groups: d.groups!.map((g, i) => (i === 0 ? { ...g, todos: [...g.todos, { id, title, day: null, done: null, group_id: g.id }] } : g)) }));
              return () => setList(map((x) => (x.id === id ? null : x)));
            },
            () => post('/todos', { id, title, list_id: l.id, group_id: group?.id }),
          );
        }}
      />
    </>
  );
}

/** A list as a panel: head with the name (a link to its page), then the items. */
export function ListPanel({ l, setList, onRemove }: { l: FullList; setList: SetList; onRemove?: () => void }) {
  const oneFlag = useFlag('list-one-at-a-time');
  if (oneFlag && l.display === 'one') {
    const items: QuoteItem[] = l.kind === 'todo' ? todosOf(l).filter((t) => !t.done).map((t) => ({ id: t.id, title: t.title, note: t.note })) : cardsOf(l).map((c) => ({ id: c.id, title: c.title, note: c.note }));
    return <OneAtATime list={l} setList={setList} items={items} onRemove={onRemove} />;
  }
  const count = l.kind === 'todo' ? todosOf(l).filter((t) => !t.done).length : cardsOf(l).length;
  return (
    <section class="card tp-list" data-pat-top={l.color || undefined} style={l.color ? { borderTop: `4px solid var(--c-${l.color})` } : undefined}>
      <div class="card-head">
        <h2>
          <ListTitle list={l} setList={setList as (fn: (l: any) => any) => void} prefix={l.kind === 'todo' ? '☐ ' : '≡ '} />
        </h2>
        <span class="row tight">
          <span class="muted">{count}</span>
          {onRemove && (
            <button class="icon small" aria-label={`Remove ${l.name} from Today`} title="Remove from Today" onClick={onRemove}>
              ✕
            </button>
          )}
        </span>
      </div>
      {l.kind === 'todo' ? <TodoItems l={l} setList={setList} /> : <PlainItems l={l} setList={setList} />}
    </section>
  );
}
