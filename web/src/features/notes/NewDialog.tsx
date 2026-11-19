import { useState } from 'preact/hooks';
import { change, post } from '../../core/api';
import { Dialog, go } from '../../core/ui';
import { KIND_ICON, KIND_LABEL, type Overview } from './model';

export function NewDialog({ onClose }: { onClose: () => void }) {
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
