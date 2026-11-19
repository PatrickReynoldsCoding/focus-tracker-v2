// Notes and lists on Today as full panels, in the order they were added, and the
// "+ Add to Today" picker. Replaces the link chips of the first Today.

import { useState } from 'preact/hooks';
import { change, optimistic, put } from '../../core/api';
import { Dialog, Loading, MarkdownEditor, useData } from '../../core/ui';
import { ListPanel, type FullList, type SetList } from './ListBody';

type NoteItem = { type: 'note'; key: string; name: string; kind: 'note' | 'project'; id?: string; project_id?: string; color: string | null; body: string };
type ListItem = FullList & { type: 'list'; key: string };
type Item = NoteItem | ListItem;
type Option = { key: string; list_id: string | null; project_id: string | null; name: string; kind: string; color: string | null };

/** The body of PUT /today-panels/show for an item or option (its key is 'list:<id>' or 'project:<id>'). */
const target = (i: { key: string }) => (i.key.startsWith('project:') ? { project_id: i.key.slice(8) } : { list_id: i.key.slice(5) });
const ICON: Record<string, string> = { note: '✎', project: '✎', todo: '☐', list: '≡' };

function NotePanel({ n, setBody, onRemove }: { n: NoteItem; setBody: (body: string) => void; onRemove: () => void }) {
  const href = n.kind === 'project' ? `#/p/${n.project_id}` : `#/n/${n.key.slice(5)}`;
  const owner = n.kind === 'project' ? `project/${n.project_id}` : `list/${n.key.slice(5)}`;
  return (
    <section class="card tp-note" data-pat-top={n.color || undefined} style={n.color ? { borderTop: `4px solid var(--c-${n.color})` } : undefined}>
      <div class="card-head">
        <h2>
          <a href={href}>
            ✎ {n.name}
            {n.kind === 'project' ? ' · notes' : ''}
          </a>
        </h2>
        <button class="icon small" aria-label={`Remove ${n.name} from Today`} title="Remove from Today" onClick={onRemove}>
          ✕
        </button>
      </div>
      <MarkdownEditor
        value={n.body}
        note={n.kind === 'project' ? { kind: 'project', id: n.project_id! } : { kind: 'list', id: n.key.slice(5) }}
        rows={6}
        placeholder="Tap to write (Markdown)…"
        onSave={(body) => {
          setBody(body);
          change(() => put(`/notes/of/${owner}`, { body }));
        }}
      />
    </section>
  );
}

function Picker({ onClose }: { onClose: () => void }) {
  const { data } = useData<Option[]>('/today-panels/available');
  return (
    <Dialog title="Add to Today" onClose={onClose}>
      {!data ? (
        <Loading />
      ) : !data.length ? (
        <p class="muted">Everything is on Today already. Make a note or list in the Notes tab.</p>
      ) : (
        <ul class="pick">
          {data.map((o) => (
            <li key={o.key}>
              <button
                onClick={async () => {
                  onClose();
                  await change(() => put('/today-panels/show', { ...target(o), on: true }), `${o.name} is on Today`);
                }}
              >
                <strong>
                  <span aria-hidden="true">{ICON[o.kind] ?? '≡'}</span> {o.name}
                </strong>
                <span class="muted">{o.kind === 'project' ? 'Project notes' : o.kind === 'todo' ? 'To-do list' : o.kind === 'note' ? 'Note' : 'List'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function OnToday() {
  const { data, setData, error } = useData<Item[]>('/today-panels');
  const [picking, setPicking] = useState(false);
  if (!data) return error ? <Loading error={error} /> : null;
  const patchItem = (key: string, fn: (i: Item) => Item) => setData((d) => d.map((i) => (i.key === key ? fn(i) : i)));
  const remove = (i: Item) =>
    optimistic(
      () => {
        const before = data;
        setData((d) => d.filter((x) => x.key !== i.key));
        return () => setData(() => before);
      },
      () => put('/today-panels/show', { ...target(i), on: false }),
      `${i.name} is off Today`,
    );
  return (
    <>
      {data.map((i) =>
        i.type === 'note' ? (
          <NotePanel key={i.key} n={i} setBody={(body) => patchItem(i.key, (x) => ({ ...x, body }) as Item)} onRemove={() => remove(i)} />
        ) : (
          <ListPanel
            key={i.key}
            l={i}
            setList={((fn) => patchItem(i.key, (x) => ({ ...fn(x as ListItem), type: 'list', key: i.key }) as Item)) as SetList}
            onRemove={() => remove(i)}
          />
        ),
      )}
      <div class="tp-add">
        <button class="ghost" onClick={() => setPicking(true)}>
          + Add to Today
        </button>
      </div>
      {picking && <Picker onClose={() => setPicking(false)} />}
    </>
  );
}
