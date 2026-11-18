// On a list's page: how it shows on Today (full list, or one at a time) and which project it
// is linked to. On a project's page: the lists linked to it, and a switch to put its notes on Today.

import { useState } from 'preact/hooks';
import { change, patch, put, say } from '../../core/api';
import { useFlag } from '../../core/features';
import { Loading, useData } from '../../core/ui';
import { ListPanel, type FullList, type SetList } from './ListBody';

type ListPage = { id: string; name: string; kind: 'list' | 'todo' | 'note'; project_id: string | null; display: 'full' | 'one'; seconds: number; show_today: boolean };

export function ListSettings({ list, setList }: { list: ListPage; setList: (fn: (l: any) => any) => void }) {
  const oneFlag = useFlag('list-one-at-a-time');
  const { data: projects } = useData<{ id: string; name: string; status: string }[]>('/projects');
  const [secs, setSecs] = useState<string | null>(null);
  const save = (f: Partial<ListPage>) => {
    setList((d) => ({ ...d, ...f }));
    change(() => patch(`/lists/${list.id}`, f));
  };
  const commitSeconds = () => {
    const n = Number(secs);
    setSecs(null);
    if (!Number.isInteger(n) || n < 5 || n > 3600) return say('Seconds must be a whole number from 5 to 3600', 'error');
    if (n !== list.seconds) save({ seconds: n });
  };
  const oneAtATime = oneFlag && list.kind !== 'note';
  const linked = projects?.find((p) => p.id === list.project_id);
  return (
    <details class="card tp-settings">
      <summary>
        List settings <span class="muted small">{[linked && `linked to ${linked.name}`, oneAtATime && list.display === 'one' && 'one at a time'].filter(Boolean).join(' · ')}</span>
      </summary>
      <div class="stack">
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
          <span class="muted small">A linked list also shows on that project’s page.</span>
        </label>
        {oneAtATime && (
          <>
            <label>
              Display on Today
              <select value={list.display} onChange={(e) => save({ display: (e.target as HTMLSelectElement).value as 'full' | 'one' })}>
                <option value="full">Full list</option>
                <option value="one">One at a time</option>
              </select>
            </label>
            {list.display === 'one' && (
              <label>
                Seconds before the next one (5 to 3600)
                <input
                  type="number"
                  min={5}
                  max={3600}
                  step={1}
                  inputMode="numeric"
                  value={secs ?? String(list.seconds)}
                  onInput={(e) => setSecs((e.target as HTMLInputElement).value)}
                  onBlur={() => secs !== null && commitSeconds()}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <span class="muted small">Shows a random item as a quote card, with its note under it. No repeats until all were shown.</span>
              </label>
            )}
          </>
        )}
      </div>
    </details>
  );
}

/** A linked list on its project's page: the same panel as on Today. */
function LinkedList({ id }: { id: string }) {
  const { data, setData } = useData<Omit<FullList, 'kind'> & { kind: string }>(`/lists/${id}/full`);
  if (!data) return null;
  if (data.kind === 'note') {
    return (
      <section class="card">
        <h2>
          <a href={`#/n/${id}`}>✎ {data.name}</a>
        </h2>
        <p class="muted small">A note: open it to read and edit.</p>
      </section>
    );
  }
  return <ListPanel l={data as unknown as FullList} setList={setData as SetList} />;
}

export function LinkedLists({ project }: { project: { lists: { id: string }[] } }) {
  if (!project.lists.length) return null;
  return (
    <>
      {project.lists.map((l) => (
        <LinkedList key={l.id} id={l.id} />
      ))}
    </>
  );
}

/** "Show these notes on Today" under a project's notes. */
export function ProjectNotesToday({ projectId }: { projectId: string }) {
  const { data, setData } = useData<{ id: string; show_today: boolean }[]>(`/notes?project_id=${projectId}`);
  if (!data) return <Loading />;
  const on = !!data[0]?.show_today;
  return (
    <label class="inline tp-note-toggle">
      <input
        type="checkbox"
        checked={on}
        onChange={() => {
          setData(() => [{ id: data[0]?.id ?? '', show_today: !on }]);
          change(() => put('/today-panels/show', { project_id: projectId, on: !on }));
        }}
      />{' '}
      Show these notes on Today
    </label>
  );
}
