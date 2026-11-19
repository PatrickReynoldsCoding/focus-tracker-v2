// Notes and lists on Today, each its own panel (a panel source), in the order they were added,
// and the "+ Add to Today" picker. Replaces the link chips of the first Today.

import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { change, get, optimistic, put } from '../../core/api';
import type { Addable, PanelDef, TodayPanelProps } from '../../core/registry';
import { Dialog, Loading, MarkdownEditor, useData } from '../../core/ui';
import { ListPanel, type FullList, type SetList } from './ListBody';

type NoteItem = { type: 'note'; key: string; name: string; kind: 'note' | 'project'; id?: string; project_id?: string; color: string | null; body: string };
type ListItem = FullList & { type: 'list'; key: string };
type Item = NoteItem | ListItem;
type Option = { key: string; list_id: string | null; project_id: string | null; name: string; kind: string; color: string | null };

/** The body of PUT /today-panels/show for an item or option (its key is 'list:<id>' or 'project:<id>'). */
const target = (i: { key: string }) => (i.key.startsWith('project:') ? { project_id: i.key.slice(8) } : { list_id: i.key.slice(5) });
const ICON: Record<string, string> = { note: '✎', project: '✎', todo: '☐', list: '≡' };

function NotePanel({ n, setBody, onRemove }: { n: NoteItem; setBody: (body: string) => void; onRemove?: () => void }) {
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
        {onRemove && (
          <button class="icon small" aria-label={`Remove ${n.name} from Today`} title="Remove from Today" onClick={onRemove}>
            ✕
          </button>
        )}
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

/** A panel id for an item key: 'list:<id>' → 'list-<id>', 'project:<id>' → 'pnote-<id>'. */
export const panelIdOf = (key: string) => (key.startsWith('project:') ? `pnote-${key.slice(8)}` : `list-${key.slice(5)}`);
const KIND_NAME: Record<string, string> = { project: 'Project notes', note: 'Note', todo: 'To-do list', list: 'List' };

function itemPanel(i: Item, data: Item[], setData: (fn: (d: Item[]) => Item[]) => void): PanelDef<TodayPanelProps> {
  const patchItem = (fn: (i: Item) => Item) => setData((d) => d.map((x) => (x.key === i.key ? fn(x) : x)));
  const remove = () =>
    optimistic(
      () => {
        const before = data;
        setData((d) => d.filter((x) => x.key !== i.key));
        return () => setData(() => before);
      },
      () => put('/today-panels/show', { ...target(i), on: false }),
      `${i.name} is off Today`,
    );
  const kind = i.type === 'note' ? 'note' : (i as ListItem).kind;
  return {
    id: panelIdOf(i.key),
    title: i.type === 'note' && i.kind === 'project' ? `${i.name} · notes` : i.name,
    description: KIND_NAME[i.type === 'note' ? i.kind : kind],
    kind,
    order: 0,
    onRemove: remove,
    render: () =>
      i.type === 'note' ? (
        <NotePanel n={i} setBody={(body) => patchItem((x) => ({ ...x, body }) as Item)} onRemove={remove} />
      ) : (
        <ListPanel l={i} setList={((fn) => patchItem((x) => ({ ...fn(x as ListItem), type: 'list', key: i.key }) as Item)) as SetList} onRemove={remove} />
      ),
  };
}

/** Each note and list on Today as its own panel (registerPanelSource), in the order they were added. */
export function OnTodaySource({ children }: { props: TodayPanelProps; children: (panels: PanelDef<TodayPanelProps>[]) => VNode | null }) {
  const { data, setData } = useData<Item[]>('/today-panels');
  return children((data ?? []).map((i) => itemPanel(i, data!, setData)));
}

/** A note or list drawn on its own, off Today's page (a phone pill, a window): it loads itself. */
function LoadedList({ id }: { id: string }) {
  const { data, setData, error } = useData<FullList & { body?: string }>(`/lists/${id}/full`);
  if (!data) return <Loading error={error} />;
  if ((data.kind as string) === 'note')
    return (
      <NotePanel
        n={{ type: 'note', key: `list:${id}`, name: data.name, kind: 'note', color: data.color, body: data.body ?? '' }}
        setBody={(body) => setData((d) => ({ ...d, body }))}
      />
    );
  return <ListPanel l={data} setList={setData as SetList} />;
}
function LoadedProjectNotes({ id }: { id: string }) {
  const { data, setData, error } = useData<{ id: string; name: string; notes: string }>(`/projects/${id}/full`);
  if (!data) return <Loading error={error} />;
  return (
    <NotePanel
      n={{ type: 'note', key: `project:${id}`, name: data.name, kind: 'project', project_id: id, color: null, body: data.notes }}
      setBody={(notes) => setData((d) => ({ ...d, notes }))}
    />
  );
}

export function resolveOnToday(id: string): PanelDef<any> | null {
  const m = /^(list|pnote)-([A-Za-z0-9_-]+)$/.exec(id);
  if (!m) return null;
  return {
    id,
    title: m[1] === 'list' ? 'List' : 'Project notes',
    order: 0,
    kind: m[1] === 'list' ? 'list' : 'note',
    render: () => (m[1] === 'list' ? <LoadedList key={id} id={m[2]} /> : <LoadedProjectNotes key={id} id={m[2]} />),
  };
}

/** Notes and lists that could go on Today, for "+ Add feature" and the pills. */
export async function addableOnToday(): Promise<Addable[]> {
  const list = await get<Option[]>('/today-panels/available');
  return list.map((o) => ({
    id: panelIdOf(o.key),
    title: o.name,
    description: KIND_NAME[o.kind] ?? 'List',
    kind: o.kind === 'project' ? 'note' : o.kind,
    add: () => change(() => put('/today-panels/show', { ...target(o), on: true }), `${o.name} is on Today`),
  }));
}

/** "+ Add to Today", under Today's panels. */
export function AddToToday() {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <div class="tp-add">
        <button class="ghost" onClick={() => setPicking(true)}>
          + Add to Today
        </button>
      </div>
      {picking && <Picker onClose={() => setPicking(false)} />}
    </>
  );
}
