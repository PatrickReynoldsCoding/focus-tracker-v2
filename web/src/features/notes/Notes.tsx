// A note's, list's or to-do's own page (#/n/<id>, which the Files tab opens). A list and a to-do
// are the to-do screen (features/board, D41): a to-do with its Board and List views, a plain list
// as its board with Convert to to-do.
import { change, del, patch, post, put } from '../../core/api';
import { useFlag } from '../../core/features';
import { FileHeaderAddons, Panels, ProjectLabel } from '../../core/registry';
import { columnsOfList, TodoBoard } from '../board';
import { useEffect } from 'preact/hooks';
import { ColorPicker, go, InlineEdit, Loading, MarkdownEditor, replaceRoute, useData } from '../../core/ui';
import { KIND_LABEL, type FullList } from './model';
import { Notes } from './NotesTab';

export function ListPage({ id }: { id: string }) {
  const { data: l, error, setData } = useData<FullList>(`/lists/${id}/full`);
  // With the Files tab, "back" is the folder the list is in.
  const files = useFlag('files-tab');
  if (!l) return <Loading error={error} />;
  const home = files ? `/files${l.folder_id ? `/${l.folder_id}` : ''}` : '/notes';
  const save = (f: Partial<FullList>) => {
    setData((d) => ({ ...d, ...f }));
    change(() => patch(`/lists/${l.id}`, f));
  };
  return (
    <div class="stack">
      <div class="page-head">
        <a href={`#${home}`} class="muted back">
          ← {files ? 'Files' : 'Notes'}
        </a>
        <h1>
          <InlineEdit value={l.name} onSave={(name) => name && save({ name })} />
        </h1>
        <div class="meta">
          <span class="tag">{KIND_LABEL[l.kind]}</span>
          <ProjectLabel projectId={l.project_id} />
          <FileHeaderAddons file={{ type: l.kind, id: l.id, name: l.name }} />
          <ColorPicker value={l.color} onPick={(color) => save({ color })} />
        </div>
      </div>
      <Panels place="list" props={{ list: l, setList: setData }} />
      {l.kind === 'note' && (
        <section class="card">
          <MarkdownEditor value={l.body ?? ''} note={{ kind: 'list', id: l.id }} always rows={14} placeholder="Write…" onSave={(body) => change(() => put(`/notes/of/list/${l.id}`, { body }))} />
        </section>
      )}
      {l.kind !== 'note' && (
        <TodoBoard
          key={l.kind}
          kind={l.kind}
          owner={{ list_id: l.id }}
          name={l.name}
          columns={columnsOfList(l)}
          onColumns={(columns) => setData((d) => ({ ...d, columns }))}
          onConvert={() => change(() => post<FullList>(`/lists/${l.id}/convert`), `${l.name} is a to-do now`).then((t) => t && setData(() => t))}
        />
      )}
      <div class="row">
        <button
          class="danger ghost"
          onClick={async () => {
            if (!confirm(`Delete ${l.name}? Undo brings it back.`)) return;
            await change(() => del(`/lists/${l.id}`), 'Deleted');
            go(home);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function ToListPage({ id }: { id: string }) {
  useEffect(() => replaceRoute(`/n/${id}`), [id]);
  return null;
}

import { registerRoute, registerTab } from '../../core/registry';
registerTab({ id: 'notes', path: '/notes', label: 'Notes', icon: '✎', order: 30, phone: true, render: () => <Notes /> });
registerRoute({ id: 'list', prefix: '/n', tab: 'notes', render: ({ params }) => <ListPage id={params[0]} /> });
// #/l/<id>: a short address for a list or to-do, the same page.
registerRoute({ id: 'list-short', prefix: '/l', tab: 'notes', render: ({ params }) => <ToListPage id={params[0]} /> });
