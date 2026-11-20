// A project's "Done when" checklist: tick, edit text in place, drag to reorder, hide the ticked ones.

import Sortable from 'sortablejs';
import { useEffect, useRef, useState } from 'preact/hooks';
import { change, del, localStorageSet, newId, optimistic, patch, post } from '../../core/api';
import { registerPanel } from '../../core/registry';
import { AddInput, InlineEdit } from '../../core/ui';
import './criteria.css';

type Criterion = { id: string; text: string; done: boolean };
type Proj = { id: string; criteria: Criterion[] };

const hideKey = (projectId: string) => `ft.hideChecked.${projectId}`;
function loadHide(projectId: string): boolean {
  try {
    return localStorage.getItem(hideKey(projectId)) === '1';
  } catch {
    return false;
  }
}

function Criteria({ p, setData }: { p: Proj; setData: (fn: (d: any) => any) => void }) {
  const [hide, setHide] = useState(() => loadHide(p.id));
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useRef<Criterion[]>([]);
  const all = useRef(p.criteria);
  all.current = p.criteria;
  const done = p.criteria.filter((c) => c.done).length;
  const rows = hide ? p.criteria.filter((c) => !c.done) : p.criteria;
  shown.current = rows;
  const setCriteria = (fn: (c: Criterion[]) => Criterion[]) => setData((d: Proj) => ({ ...d, criteria: fn(d.criteria) }));

  useEffect(() => {
    const s = Sortable.create(listRef.current!, {
      animation: 150,
      handle: '.grip',
      ghostClass: 'drag-ghost',
      delay: 120,
      delayOnTouchOnly: true,
      onEnd: (evt) => {
        const from = evt.oldIndex ?? 0;
        const to = evt.newIndex ?? 0;
        // Put the DOM back; Preact draws the new order from state.
        evt.from.insertBefore(evt.item, evt.from.children[from] ?? null);
        if (from === to) return;
        const moved = shown.current[from];
        const target = shown.current[to];
        const before = all.current;
        optimistic(
          () => {
            setCriteria((cs) => {
              const rest = cs.filter((c) => c.id !== moved.id);
              const at = rest.findIndex((c) => c.id === target.id);
              rest.splice(from < to ? at + 1 : at, 0, moved);
              return rest;
            });
            return () => setCriteria(() => before);
          },
          () => post(`/criteria/${moved.id}/move`, from < to ? { after_id: target.id } : { before_id: target.id }),
        );
      },
    });
    return () => s.destroy();
  }, []);

  const tick = (c: Criterion) =>
    optimistic(
      () => {
        setCriteria((cs) => cs.map((x) => (x.id === c.id ? { ...x, done: !c.done } : x)));
        return () => setCriteria((cs) => cs.map((x) => (x.id === c.id ? c : x)));
      },
      () => patch(`/criteria/${c.id}`, { done: !c.done }),
    );

  return (
    <section class="card criteria">
      <div class="card-head">
        <h2>Done when</h2>
        <span class="row tight">
          <span class="muted">
            {done}/{p.criteria.length}
          </span>
          {done > 0 && (
            <button
              class="ghost small"
              aria-pressed={hide}
              onClick={() => {
                setHide(!hide);
                localStorageSet(hideKey(p.id), hide ? '0' : '1');
              }}
            >
              {hide ? `Show checked (${done})` : 'Hide checked'}
            </button>
          )}
        </span>
      </div>
      <ul class="checks" ref={listRef}>
        {rows.map((c) => (
          <li key={c.id} data-id={c.id} class={c.done ? 'done' : ''}>
            <span class="grip" aria-label="Drag to reorder" title="Drag to reorder">
              ⋮⋮
            </span>
            <input type="checkbox" checked={c.done} aria-label={`Done: ${c.text}`} onChange={() => tick(c)} />
            <span class="crit-text">
              <InlineEdit
                value={c.text}
                onSave={(text) => {
                  if (!text) return;
                  setCriteria((cs) => cs.map((x) => (x.id === c.id ? { ...x, text } : x)));
                  change(() => patch(`/criteria/${c.id}`, { text }));
                }}
              />
            </span>
            <button class="icon small" aria-label="Delete" onClick={() => change(() => del(`/criteria/${c.id}`))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <AddInput
        placeholder="Add a done criterion"
        onAdd={(text) => {
          const id = newId();
          optimistic(
            () => {
              setCriteria((cs) => [...cs, { id, text, done: false }]);
              return () => setCriteria((cs) => cs.filter((x) => x.id !== id));
            },
            () => post('/criteria', { id, project_id: p.id, text }),
          );
        }}
      />
    </section>
  );
}

registerPanel('project', { id: 'criteria', icon: '🏁', title: 'Done when', description: 'What has to be true for the project to be done.', order: 30, render: ({ project, setProject }) => <Criteria p={project} setData={setProject} /> });
