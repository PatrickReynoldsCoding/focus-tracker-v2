// The Notes tab as cards, like Google Keep: one small card per note, list and to-do list
// (drag to reorder, long press on a touch screen), optional cards for project notes,
// and to-dos ticked straight on a to-do list's card.

import Sortable from 'sortablejs';
import { useEffect, useRef, useState } from 'preact/hooks';
import { optimistic, post, put } from '../../core/api';
import { go, Loading, Markdown, plainPreview, useData } from '../../core/ui';
import { NewDialog } from './NewDialog';
import { KIND_ICON, KIND_LABEL, type Overview } from './model';
import './notes.css';

type ProjectNote = { project_id: string; name: string; preview: string; show_today: boolean };
type ProjectNotes = { on: boolean; notes: ProjectNote[] };

const ROW = 8; // px, the grid's row unit; a card spans as many rows as it is tall

/** Masonry with a CSS grid: each card spans the rows it needs, and the order still reads across. */
function useMasonry(ref: { current: HTMLElement | null }, deps: unknown[]) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      for (const c of Array.from(el.children) as HTMLElement[]) {
        c.style.gridRowEnd = 'span 1';
        c.style.gridRowEnd = `span ${Math.ceil((c.getBoundingClientRect().height + 10) / ROW)}`;
      }
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(el);
    addEventListener('resize', fit);
    return () => {
      ro?.disconnect();
      removeEventListener('resize', fit);
    };
  }, deps);
}

export function Notes() {
  const { data, error, setData } = useData<Overview[]>('/lists/overview');
  const pn = useData<ProjectNotes>('/lists/project-notes');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const projRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const justDragged = useRef(0);
  const canDrag = !kind && !q;
  const canDragRef = useRef(canDrag);
  canDragRef.current = canDrag;

  const matches = (text: string) => !q || text.toLowerCase().includes(q.toLowerCase());
  const shown = (data ?? []).filter((l) => (!kind || l.kind === kind) && matches(`${l.name} ${l.preview ?? ''} ${(l.items ?? []).map((i) => i.title).join(' ')}`));
  const projects = !pn.data?.on || (kind && kind !== 'note') ? [] : pn.data.notes.filter((n) => matches(`${n.name} ${n.preview}`));

  useMasonry(gridRef, [shown.length, q, kind, data]);
  useMasonry(projRef, [projects.length, q, kind, pn.data]);

  // Drag to reorder (long press on a touch screen). Saved with POST /api/lists/:id/move.
  const ready = !!data;
  useEffect(() => {
    if (!ready || !gridRef.current) return;
    const s = Sortable.create(gridRef.current, {
      animation: 150,
      delay: 250,
      delayOnTouchOnly: true,
      touchStartThreshold: 6,
      draggable: '.note-card',
      filter: 'input,label,button',
      preventOnFilter: false,
      ghostClass: 'drag-ghost',
      dataIdAttr: 'data-id',
      onEnd: (evt) => {
        justDragged.current = Date.now();
        const id = evt.item.dataset.id!;
        // Put the DOM back; Preact draws the new order from state.
        evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex ?? 0] ?? null);
        const index = evt.newIndex ?? 0;
        if (!canDragRef.current || evt.oldIndex === evt.newIndex) return;
        const before = dataRef.current!;
        optimistic(
          () => {
            setData((d) => {
              const row = d.find((x) => x.id === id)!;
              const rest = d.filter((x) => x.id !== id);
              return [...rest.slice(0, index), row, ...rest.slice(index)];
            });
            return () => setData(() => before);
          },
          () => post(`/lists/${id}/move`, { index }),
        );
      },
    });
    return () => s.destroy();
  }, [ready]);
  // Dragging is off while a filter or search hides some cards (the positions would be wrong).
  useEffect(() => {
    if (gridRef.current) Sortable.get(gridRef.current)?.option('disabled', !canDrag);
  }, [canDrag, ready]);

  if (!data) return <Loading error={error} />;

  const open = (path: string) => (e: MouseEvent) => {
    if (Date.now() - justDragged.current < 400) return;
    if ((e.target as HTMLElement).closest('input,label,button,a')) return;
    go(path);
  };

  const tick = (l: Overview, itemId: string) => {
    const item = l.items?.find((i) => i.id === itemId);
    if (!item) return;
    const done = !item.done;
    const set = (to: string | null, d: number) =>
      setData((all) => all.map((x) => (x.id === l.id ? { ...x, open: (x.open ?? 0) + d, done_today: (x.done_today ?? 0) - d, items: x.items!.map((i) => (i.id === itemId ? { ...i, done: to } : i)) } : x)));
    optimistic(
      () => {
        set(done ? 'today' : null, done ? -1 : 1);
        return () => set(item.done ?? null, done ? 1 : -1);
      },
      () => post(`/todos/${itemId}/tick`, { done }),
    );
  };

  const setProjectNotes = (on: boolean) =>
    optimistic(
      () => {
        const prev = pn.data;
        pn.setData((d) => ({ ...d, on }));
        return () => pn.setData(() => prev!);
      },
      () => put<ProjectNotes>('/lists/project-notes', { on }),
    );

  return (
    <div class="stack notes-tab">
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
            <button key={k} class={`chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k ? KIND_LABEL[k as keyof typeof KIND_LABEL] : 'All'}
            </button>
          ))}
        </div>
        <label class="inline project-switch">
          <input type="checkbox" checked={!!pn.data?.on} disabled={!pn.data} onChange={(e) => setProjectNotes((e.target as HTMLInputElement).checked)} />
          Project notes
        </label>
      </div>
      <div class="note-grid" ref={gridRef} data-draggable={canDrag ? 'true' : 'false'}>
        {shown.map((l) => {
          const more = l.kind === 'todo' ? (l.open ?? 0) - (l.items ?? []).filter((i) => !i.done).length : (l.count ?? 0) - (l.items?.length ?? 0);
          return (
            <div key={l.id} data-id={l.id} class={`note-card c-${l.color || 'none'} kind-${l.kind}`} onClick={open(`/n/${l.id}`)}>
              <h3>
                <span aria-hidden="true">{KIND_ICON[l.kind]}</span>{' '}
                <a href={`#/n/${l.id}`} class="card-title">
                  {l.name}
                </a>
              </h3>
              {l.kind === 'note' && l.preview && <Markdown text={l.preview} class="preview" />}
              {l.kind === 'todo' && l.items && (
                <ul class="card-todos">
                  {l.items.map((i) => (
                    <li key={i.id} class={i.done ? 'done' : ''}>
                      <label>
                        <input type="checkbox" checked={!!i.done} onChange={() => tick(l, i.id!)} aria-label={`Tick ${i.title}`} />
                        <span>{i.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {l.kind === 'list' && l.items && (
                <ul>
                  {l.items.map((i, n) => (
                    <li key={n}>{i.title}</li>
                  ))}
                </ul>
              )}
              {more > 0 && <span class="muted small">+{more} more</span>}
              {l.kind === 'todo' && !!l.done_today && <span class="muted small">{l.done_today} done today</span>}
              {l.show_today && <span class="tag">Today</span>}
            </div>
          );
        })}
      </div>
      {!shown.length && !projects.length && <p class="empty">{q || kind ? 'Nothing matches.' : 'Nothing here yet.'}</p>}
      {projects.length > 0 && (
        <>
          <h2 class="section-title">Project notes</h2>
          <div class="note-grid" ref={projRef}>
            {projects.map((n) => (
              <div key={n.project_id} class="note-card project-note" onClick={open(`/p/${n.project_id}`)}>
                <h3>
                  <span aria-hidden="true">▤</span>{' '}
                  <a href={`#/p/${n.project_id}`} class="card-title">
                    {n.name}
                  </a>
                </h3>
                <p class="preview muted">{plainPreview(n.preview, 6, 260)}</p>
                <span class="tag">Project notes</span>
                {n.show_today && <span class="tag">Today</span>}
              </div>
            ))}
          </div>
        </>
      )}
      {creating && <NewDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
