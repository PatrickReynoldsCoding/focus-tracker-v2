import { change, del, newId, optimistic, patch, post, put } from '../../core/api';
import { Panels } from '../../core/registry';
import { Board } from '../projects/Board';
import { AddInput, ColorPicker, fmtDay, go, InlineEdit, Loading, MarkdownEditor, todayLocal, useData } from '../../core/ui';
import { KIND_LABEL, type FullList, type Todo } from './model';
import { Notes } from './NotesTab';

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
      <Panels place="list" props={{ list: l, setList: setData }} />
      {l.kind === 'note' && (
        <section class="card">
          <MarkdownEditor value={l.body ?? ''} note={{ kind: 'list', id: l.id }} rows={14} placeholder="Write…" onSave={(body) => change(() => put(`/notes/of/list/${l.id}`, { body }))} />
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
