import { useState } from 'preact/hooks';
import { change, post } from '../../core/api';
import { afterDialog, Dialog, go } from '../../core/ui';
import { KIND_ICON, KIND_LABEL, type Overview } from './model';

type Kind = keyof typeof KIND_LABEL;

/** Make a note, to-do list or list. With `kind` it makes that one only; with `folderId` it goes in
 *  that Files folder (null: the top level). */
export function NewDialog({ onClose, kind, folderId }: { onClose: () => void; kind?: Kind; folderId?: string | null }) {
  const [name, setName] = useState('');
  const make = async (k: Kind) => {
    if (!name.trim()) return;
    onClose();
    const l = await change(() => post<Overview>('/lists', { name: name.trim(), kind: k, ...(folderId !== undefined ? { folder_id: folderId } : {}) }));
    if (l) afterDialog(() => go(`/n/${l.id}`));
  };
  return (
    <Dialog title={kind ? `New ${KIND_LABEL[kind].toLowerCase()}` : 'New'} onClose={onClose}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          make(kind ?? 'note');
        }}
      >
        <input placeholder="Name" aria-label="Name" value={name} autoFocus maxLength={200} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        {kind ? (
          <button class="primary" disabled={!name.trim()}>
            Make {KIND_LABEL[kind].toLowerCase()}
          </button>
        ) : (
          <div class="row">
            {(['note', 'todo', 'list'] as const).map((k) => (
              <button key={k} type="button" class="ghost" disabled={!name.trim()} onClick={() => make(k)}>
                {KIND_ICON[k]} {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}
      </form>
    </Dialog>
  );
}
