import { useState } from 'preact/hooks';
import { change, del, newId, optimistic, patch, post, put } from '../../core/api';
import { Board, type Column } from '../projects/Board';
import { AddInput, ColorPicker, Dialog, fmtDay, go, InlineEdit, Loading, Markdown, MarkdownEditor, todayLocal, useData } from '../../core/ui';

type Overview = { id: string; name: string; kind: 'list' | 'todo' | 'note'; color: string | null; show_today: boolean; preview?: string; items?: { title: string }[]; open?: number; count?: number };
type Todo = { id: string; title: string; day: string | null; done: string | null; group_id: string };
type FullList = Overview & { body?: string; columns?: Column[]; groups?: { id: string; name: string; todos: Todo[] }[] };

const KIND_LABEL = { list: 'List', todo: 'To-do list', note: 'Note' };
const KIND_ICON = { list: '≡', todo: '☐', note: '✎' };

function NewDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const make = async (kind: string) => {
    if (!name.trim()) return;
    onClose();
    const l = await change(() => post<Overview>('/lists', { name: name.trim(), kind }));
    if (l) go(`/n/${l.id}`);
  };
  return (
    <Dialog title="New" onClose={onClose}>
      <div class="stack">
        <input placeholder="Name" value={name} autoFocus onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && make('note')} />
        <div class="row">
          {(['note', 'todo', 'list'] as const).map((k) => (
            <button key={k} class="ghost" disabled={!name.trim()} onClick={() => make(k)}>
              {KIND_ICON[k]} {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export function Notes() {
  const { data, error } = useData<Overview[]>('/lists/overview');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>('');
  const [creating, setCreating] = useState(false);
  if (!data) return <Loading error={error} />;
  const shown = data.filter((l) => (!kind || l.kind === kind) && (!q || `${l.name} ${l.preview ?? ''} ${(l.items ?? []).map((i) => i.title).join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div class="stack">
      <div class="page-head row">
        <h1>Notes</h1>
        <button class="primary" onClick={() => setCreating(true)}>
          + New
        </button>
      </div>
      <div class="filters">
        <input type="search" placeholder="Search" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search notes" />
        <div class="chips">
          {['', 'note', 'todo', 'list'].map((k) => (
            <button key={k} class={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
              {k ? KIND_LABEL[k as keyof typeof KIND_LABEL] : 'All'}
            </button>
          ))}
        </div>
      </div>
      <div class="masonry">
        {shown.map((l) => (
          <a key={l.id} href={`#/n/${l.id}`} class={`note-card c-${l.color || 'none'}`}>
            <h3>
              <span aria-hidden="true">{KIND_ICON[l.kind]}</span> {l.name}
            </h3>
            {l.kind === 'note' && l.preview && <Markdown text={l.preview} class="preview" />}
            {l.items && (
              <ul>
                {l.items.map((i, n) => (
                  <li key={n}>{l.kind === 'todo' ? '☐ ' : ''}{i.title}</li>
                ))}
              </ul>
            )}
            {l.show_today && <span class="tag">Today</span>}
          </a>
        ))}
      </div>
      {!shown.length && <p class="empty">Nothing here yet.</p>}
      {creating && <NewDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function TodoList({ l, setData }: { l: FullList; setData: (fn: (d: FullList) => FullList) => void }) {
  const today = todayLocal();
  const mapTodos = (fn: (t: Todo) => Todo | null) => (d: FullList) => ({ ...d, groups: d.groups!.map((g) => ({ ...g, todos: g.todos.map(fn).filter(Boolean) as Todo[] })) });
  return (
    <div class="stack">
      {l.groups!.map((g) => (
        <section class="card" key={g.id}>
          <div class="card-head">
            <h2>
              <InlineEdit value={g.name} onSave={(name) => name && change(() => patch(`/columns/${g.id}`, { name }))} />
            </h2>
            <span class="muted">{g.todos.filter((t) => !t.done).length}</span>
          </div>
          <ul class="checks">
            {g.todos.map((t) => (
              <li key={t.id} class={t.done ? 'done' : ''}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!t.done}
                    onChange={() =>
                      optimistic(
                        () => {
                          setData(mapTodos((x) => (x.id === t.id ? { ...x, done: t.done ? null : today } : x)));
                          return () => setData(mapTodos((x) => (x.id === t.id ? t : x)));
                        },
                        () => post(`/todos/${t.id}/tick`, { done: !t.done }),
                      )
                    }
                  />
                  <span>{t.title}</span>
                  {t.day && <span class={`tag ${t.day < today && !t.done ? 'late' : ''}`}>{fmtDay(t.day)}</span>}
                </label>
                <input
                  type="date"
                  class="day-pick"
                  value={t.day ?? ''}
                  aria-label={`Day for ${t.title}`}
                  onChange={(e) => change(() => patch(`/todos/${t.id}`, { day: (e.target as HTMLInputElement).value || null }))}
                />
                <button class="icon small" aria-label="Delete" onClick={() => change(() => del(`/todos/${t.id}`))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <AddInput
            placeholder="Add a to-do"
            onAdd={(title) => {
              const id = newId();
              optimistic(
                () => {
                  setData((d) => ({ ...d, groups: d.groups!.map((x) => (x.id === g.id ? { ...x, todos: [...x.todos, { id, title, day: null, done: null, group_id: g.id }] } : x)) }));
                  return () => setData(mapTodos((x) => (x.id === id ? null : x)));
                },
                () => post('/todos', { id, title, list_id: l.id, group_id: g.id }),
              );
            }}
          />
        </section>
      ))}
      <AddInput placeholder="Add a group" onAdd={(name) => change(() => post('/columns', { list_id: l.id, name }))} />
    </div>
  );
}

export function ListPage({ id }: { id: string }) {
  const { data: l, error, setData } = useData<FullList>(`/lists/${id}/full`);
  if (!l) return <Loading error={error} />;
  const save = (f: Partial<FullList>) => {
    setData((d) => ({ ...d, ...f }));
    change(() => patch(`/lists/${l.id}`, f));
  };
  return (
    <div class="stack">
      <div class="page-head">
        <a href="#/notes" class="muted back">
          ← Notes
        </a>
        <h1>
          <InlineEdit value={l.name} onSave={(name) => name && save({ name })} />
        </h1>
        <div class="meta">
          <span class="tag">{KIND_LABEL[l.kind]}</span>
          <label class="inline">
            <input type="checkbox" checked={l.show_today} onChange={() => save({ show_today: !l.show_today })} /> On Today
          </label>
          <ColorPicker value={l.color} onPick={(color) => save({ color })} />
        </div>
      </div>
      {l.kind === 'note' && (
        <section class="card">
          <MarkdownEditor value={l.body ?? ''} rows={14} placeholder="Write (Markdown)…" onSave={(body) => change(() => put(`/notes/of/list/${l.id}`, { body }))} />
        </section>
      )}
      {l.kind === 'list' && <Board columns={l.columns!} owner={{ list_id: l.id }} />}
      {l.kind === 'todo' && <TodoList l={l} setData={setData} />}
      <div class="row">
        <button
          class="danger ghost"
          onClick={async () => {
            if (!confirm(`Delete ${l.name}? Undo brings it back.`)) return;
            await change(() => del(`/lists/${l.id}`), 'Deleted');
            go('/notes');
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

import { registerRoute, registerTab } from '../../core/registry';
registerTab({ id: 'notes', path: '/notes', label: 'Notes', icon: '✎', order: 30, phone: true, render: () => <Notes /> });
registerRoute({ id: 'list', prefix: '/n', tab: 'notes', render: ({ params }) => <ListPage id={params[0]} /> });
