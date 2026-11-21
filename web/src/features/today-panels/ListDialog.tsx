// A list's settings in a dialog, opened by clicking the list's title (on Today, a project's page or the
// list's own page): how it shows on Today (the full list, or one item at a time as a quote card, like v1),
// how long each item stays, its colour and the project it is linked to.

import { useState } from 'preact/hooks';
import { change, patch, say } from '../../core/api';
import { useFlag } from '../../core/features';
import { Dialog, useData } from '../../core/ui';

export type ListSettingsProps = { id: string; name: string; kind: string; color: string | null; display: 'full' | 'one'; seconds: number; project_id: string | null };
const COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'];
const MIN_SECONDS = 5;
const MAX_SECONDS = 3600;

export function ListSettingsDialog({ list, setList, onClose }: { list: ListSettingsProps; setList: (fn: (l: any) => any) => void; onClose: () => void }) {
  const oneFlag = useFlag('list-one-at-a-time') && list.kind !== 'note';
  const { data: projects } = useData<{ id: string; name: string; status: string }[]>('/projects');
  const [secs, setSecs] = useState<string | null>(null);
  const save = (f: Partial<ListSettingsProps>) => {
    setList((d) => ({ ...d, ...f }));
    change(() => patch(`/lists/${list.id}`, f));
  };
  const commitSeconds = () => {
    const n = Number(secs);
    setSecs(null);
    if (!Number.isInteger(n) || n < MIN_SECONDS || n > MAX_SECONDS) return say(`Seconds must be a whole number from ${MIN_SECONDS} to ${MAX_SECONDS}`, 'error');
    if (n !== list.seconds) save({ seconds: n });
  };
  return (
    <Dialog title={list.name} onClose={onClose}>
      <div class="stack">
        {oneFlag && (
          <div class="seg-radio" role="radiogroup" aria-label="Display on Today">
            <strong>Display on Today</strong>
            <label class={list.display !== 'one' ? 'on' : ''}>
              <input type="radio" name="list-display" checked={list.display !== 'one'} onChange={() => save({ display: 'full' })} /> Full list
              <small class="muted">All the items.</small>
            </label>
            <label class={list.display === 'one' ? 'on' : ''}>
              <input type="radio" name="list-display" checked={list.display === 'one'} onChange={() => save({ display: 'one' })} /> One at a time
              <small class="muted">A random item as a quote, changing by itself.</small>
            </label>
          </div>
        )}
        {oneFlag && list.display === 'one' && (
          <label>
            Show each item for (seconds)
            <input
              type="number"
              min={MIN_SECONDS}
              max={MAX_SECONDS}
              inputMode="numeric"
              value={secs ?? String(list.seconds)}
              onInput={(e) => setSecs((e.target as HTMLInputElement).value)}
              onBlur={() => secs !== null && commitSeconds()}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
        )}
        <div>
          <strong>Colour</strong>
          <div class="swatches" role="radiogroup" aria-label="List colour">
            <button type="button" class={`swatch c-none${!list.color ? ' on' : ''}`} aria-label="No colour" onClick={() => save({ color: null })} />
            {COLOURS.map((c) => (
              <button key={c} type="button" class={`swatch c-${c}${list.color === c ? ' on' : ''}`} aria-label={c} onClick={() => save({ color: c })} />
            ))}
          </div>
        </div>
        <label>
          Linked project
          <select value={list.project_id ?? ''} onChange={(e) => save({ project_id: (e.target as HTMLSelectElement).value || null })}>
            <option value="">None</option>
            {(projects ?? [])
              .filter((p) => p.status === 'active' || p.id === list.project_id)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <div class="row">
          <a class="button" href={`#/n/${list.id}`} onClick={onClose}>
            Open the list
          </a>
          <button class="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** The list's title as a button that opens its settings. */
export function ListTitle({ list, setList, prefix, quote }: { list: ListSettingsProps; setList: (fn: (l: any) => any) => void; prefix?: string; quote?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class={`link-btn list-title${quote ? ' quote' : ''}`} title="List settings: show all or one at a time, colour, linked project" onClick={() => setOpen(true)}>
        {prefix}
        {list.name} <span aria-hidden="true" class="muted small">⚙</span>
      </button>
      {open && <ListSettingsDialog list={list} setList={setList} onClose={() => setOpen(false)} />}
    </>
  );
}
