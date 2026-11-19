// Links (web addresses and Google Drive items) as files on the Files tab, with their kind's icon,
// and "Add link" in a folder. Phone numbers, emails and text stay on project pages, and resources a
// category shares stay on the Projects tab (the server leaves them out).
import { useState } from 'preact/hooks';
import { change, del, patch, post } from '../../core/api';
import { registerFileType, type FileItem } from '../../core/registry';
import { Dialog } from '../../core/ui';
import { asUrl, detectResource, guessTitle, KIND_LABELS, type ResourceKind } from '../../../../src/core/resource-kinds';
import { KindIcon } from './icons';
import { RULE } from './model';

const kindOf = (f: FileItem): ResourceKind => (f.kind as ResourceKind) || detectResource(f.url ?? '').kind;

function AddLinkDialog({ folderId, onClose }: { folderId: string | null; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [title, setTitle] = useState('');
  const v = value.trim();
  const d = v ? detectResource(v) : null;
  const web = !!d && (d.type === 'link' || d.type === 'drive');
  return (
    <Dialog title="Add link" onClose={onClose}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!d || !web) return;
          onClose();
          change(() => post('/resources', { title: title.trim() || guessTitle(v, d.kind), value: d.value, type: d.type, folder_id: folderId }), 'Link added');
        }}
      >
        <label>
          Address
          <input type="url" inputMode="url" placeholder="https://… or a Google Docs, Sheets or Drive address" value={value} autoFocus onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
        </label>
        {d && (
          <p class="muted small row">
            {web ? (
              <>
                <KindIcon kind={d.kind} size={20} /> {KIND_LABELS[d.kind]}
              </>
            ) : (
              'This is not a web address. Phone numbers, emails and text go on a project’s Resources.'
            )}
          </p>
        )}
        <label>
          Title (optional)
          <input value={title} placeholder={d && web ? guessTitle(v, d.kind) : 'Title'} maxLength={200} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        </label>
        <p class="muted small">{RULE}</p>
        <button class="primary" disabled={!web}>
          Add link
        </button>
      </form>
    </Dialog>
  );
}

registerFileType({
  type: 'link',
  group: { id: 'links', label: 'Links', order: 40 },
  label: 'Link',
  order: 40,
  icon: (f, size = 24) => <KindIcon kind={kindOf(f)} size={size} />,
  href: (f) => asUrl(f.url ?? '')?.toString() ?? '#/files',
  external: true,
  detail: (f) => {
    const u = asUrl(f.url ?? '');
    const k = kindOf(f);
    return k === 'link' ? (u?.hostname.replace(/^www\./, '') ?? null) : KIND_LABELS[k];
  },
  rename: (f, name) => patch(`/resources/${f.id}`, { title: name }),
  remove: (f) => del(`/resources/${f.id}`),
  create: [{ id: 'link', label: 'Link', icon: <KindIcon kind="link" size={20} />, order: 40, dialog: AddLinkDialog }],
});
