// Notes, to-do lists and lists as files on the Files tab (registerFileType), and a page of its own
// for a project's notes (/pn/<project id>), which the Files tab opens. The editor is the one the
// project page uses (MarkdownEditor with the project's note).
import { change, del, patch, post, put } from '../../core/api';
import { useFlag } from '../../core/features';
import { FileHeaderAddons, registerFileType, registerRoute, type FileItem } from '../../core/registry';
import { FileGlyph, Loading, MarkdownEditor, useData } from '../../core/ui';
import { KIND_ICON } from './model';
import { NewDialog } from './NewDialog';

const NOTES = { id: 'notes', label: 'Notes', order: 10 };
const TODOS = { id: 'todos', label: 'To-dos', order: 15 };
const LISTS = { id: 'lists', label: 'Lists', order: 20 };
const rename = (f: FileItem, name: string) => patch(`/lists/${f.id}`, { name });
const remove = (f: FileItem) => del(`/lists/${f.id}`);
const asPanel = (f: FileItem) => `list-${f.id}`;
/** Make a note or list at once (Add panel's picker), without opening it. */
const maker = (kind: 'note' | 'todo' | 'list') => async (name: string, folderId: string | null): Promise<FileItem | undefined> => {
  const l = await change(() => post<{ id: string; name: string; folder_id?: string | null; project_id?: string | null; created: string; updated_at: string }>('/lists', { name, kind, folder_id: folderId }));
  return l ? { type: kind, id: l.id, name: l.name, folder_id: l.folder_id ?? null, project_id: l.project_id ?? null, created: l.created, updated_at: l.updated_at } : undefined;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

registerFileType({
  type: 'note',
  group: NOTES,
  label: 'Note',
  order: 10,
  icon: (_f, size) => (
    <FileGlyph tint="yellow" size={size}>
      {KIND_ICON.note}
    </FileGlyph>
  ),
  href: (f) => `#/n/${f.id}`,
  rename,
  remove,
  create: [{ id: 'note', label: 'Note', icon: <FileGlyph tint="yellow" size={20}>{KIND_ICON.note}</FileGlyph>, order: 10, dialog: ({ folderId, onClose }) => <NewDialog kind="note" folderId={folderId} onClose={onClose} />, make: maker('note') }],
  panel: asPanel,
});
registerFileType({
  type: 'project-note',
  group: NOTES,
  label: 'Project notes',
  order: 11,
  icon: (_f, size) => (
    <FileGlyph tint="orange" size={size}>
      {KIND_ICON.note}
    </FileGlyph>
  ),
  href: (f) => `#/pn/${f.id}`,
  panel: (f) => `pnote-${f.id}`,
  detail: () => 'Project notes',
  fixed: true,
});
registerFileType({
  type: 'todo',
  group: TODOS,
  label: 'To-do list',
  order: 20,
  icon: (_f, size) => (
    <FileGlyph tint="green" size={size}>
      {KIND_ICON.todo}
    </FileGlyph>
  ),
  href: (f) => `#/n/${f.id}`,
  detail: (f) => (f.count ? `${f.count} open` : 'All done'),
  rename,
  remove,
  create: [{ id: 'todo', label: 'To-do list', icon: <FileGlyph tint="green" size={20}>{KIND_ICON.todo}</FileGlyph>, order: 20, dialog: ({ folderId, onClose }) => <NewDialog kind="todo" folderId={folderId} onClose={onClose} />, make: maker('todo') }],
  panel: asPanel,
});
registerFileType({
  type: 'list',
  group: LISTS,
  label: 'List',
  order: 21,
  icon: (_f, size) => (
    <FileGlyph tint="blue" size={size}>
      {KIND_ICON.list}
    </FileGlyph>
  ),
  href: (f) => `#/n/${f.id}`,
  detail: (f) => plural(f.count ?? 0, 'item'),
  rename,
  remove,
  create: [{ id: 'list', label: 'List', icon: <FileGlyph tint="blue" size={20}>{KIND_ICON.list}</FileGlyph>, order: 21, dialog: ({ folderId, onClose }) => <NewDialog kind="list" folderId={folderId} onClose={onClose} />, make: maker('list') }],
  panel: asPanel,
});

/** A project's notes on a page of their own (opened from Files). */
function ProjectNotePage({ id }: { id: string }) {
  const { data: p, error } = useData<{ id: string; name: string }>(`/projects/${id}`);
  const { data: note } = useData<{ body: string; updated_at: string | null }>(`/notes/of/project/${id}`);
  const files = useFlag('files-tab');
  if (!p || !note) return <Loading error={error} />;
  return (
    <div class="stack">
      <div class="page-head">
        <a href={files ? `#/files/p/${id}` : `#/p/${id}`} class="muted back">
          ← {files ? p.name : 'Project'}
        </a>
        <h1>{p.name} notes</h1>
        <div class="meta">
          <a href={`#/p/${id}`}>Open the project</a>
          <FileHeaderAddons file={{ type: 'project-note', id, name: `${p.name} notes` }} />
        </div>
      </div>
      <section class="card">
        <MarkdownEditor value={note.body} note={{ kind: 'project', id }} always rows={14} placeholder="Notes for this project…" onSave={(body) => change(() => put(`/notes/of/project/${id}`, { body }))} />
      </section>
    </div>
  );
}

registerRoute({ id: 'project-note', prefix: '/pn', tab: 'notes', render: ({ params }) => <ProjectNotePage key={params[0]} id={params[0]} /> });
