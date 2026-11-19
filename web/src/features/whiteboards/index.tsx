// Whiteboards (V1-GAPS 37): the Whiteboards tab (side bar), a board open full screen (/w/<id>),
// a project's boards, boards on Today, a link on the Projects tab for phones, and the favourite
// tool in Settings. Flag 'whiteboards'. The editor (Excalidraw on React) is a separate chunk
// loaded only when a board opens; see ./Editor.tsx and ./host.ts.
import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { change, get, optimistic, patch } from '../../core/api';
import { registerPanel, registerPanelSource, registerRoute, registerTab, type Addable, type PanelDef, type TodayPanelProps } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { Loading, useData } from '../../core/ui';
import { BoardGrid, NewBoardDialog, Preview } from './Boards';
import { BoardEditor } from './Editor';
import { favouriteTool, openBoard, setFavouriteTool, TOOLS, type Board } from './model';
import './whiteboards.css';

type Project = { id: string; name: string; status?: string };
const FLAG = 'whiteboards';
const FILTER_KEY = 'ft.whiteboards.filter';

/** Change one board in a list on screen (null removes it; a whole board not in the list comes back, for a rollback). */
const changeIn = (list: Board[], id: string, f: Partial<Board> | null): Board[] =>
  !f ? list.filter((b) => b.id !== id) : list.some((b) => b.id === id) ? list.map((b) => (b.id === id ? { ...b, ...f } : b)) : [...list, f as Board];

function WhiteboardsTab() {
  const { data, error, setData } = useData<Board[]>('/whiteboards');
  const { data: projects } = useData<Project[]>('/projects');
  const [filter, setFilterState] = useState(() => {
    try {
      return localStorage.getItem(FILTER_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const setFilter = (v: string) => {
    setFilterState(v);
    try {
      localStorage.setItem(FILTER_KEY, v);
    } catch {
      /* private mode */
    }
  };
  const [making, setMaking] = useState(false);
  if (!data) return <Loading error={error} />;
  const live = (projects ?? []).filter((p) => p.status !== 'dropped' || data.some((b) => b.project_id === p.id));
  const withBoards = live.filter((p) => data.some((b) => b.project_id === p.id));
  const shown = filter === '' ? data : filter === 'none' ? data.filter((b) => !b.project_id) : data.filter((b) => b.project_id === filter);
  return (
    <div class="stack">
      <div class="page-head row">
        <h1>Whiteboards</h1>
        <button class="primary" onClick={() => setMaking(true)}>
          + New whiteboard
        </button>
      </div>
      {data.length > 0 && (
        <div class="filters">
          <select value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value)} aria-label="Project">
            <option value="">All projects</option>
            <option value="none">No project</option>
            {withBoards.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {shown.length ? (
        <BoardGrid boards={shown} projects={live} showProject onChange={(id, f) => setData((d) => changeIn(d, id, f))} />
      ) : (
        <p class="empty">{data.length ? 'No whiteboards here.' : 'No whiteboards yet. Make one to sketch an idea.'}</p>
      )}
      {making && <NewBoardDialog projects={live} project={filter && filter !== 'none' ? filter : null} onClose={() => setMaking(false)} />}
    </div>
  );
}

function ProjectBoards({ project, setProject }: { project: any; setProject: (fn: (p: any) => any) => void }) {
  const { data: projects } = useData<Project[]>('/projects');
  const [making, setMaking] = useState(false);
  const boards = [...((project.whiteboards ?? []) as Board[])].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return (
    <section class="card wb-panel">
      <div class="card-head">
        <h2>Whiteboards</h2>
        <div class="row tight">
          <a class="small" href="#/whiteboards">
            All
          </a>
          <button class="ghost small" onClick={() => setMaking(true)}>
            + New
          </button>
        </div>
      </div>
      {boards.length ? (
        <BoardGrid
          boards={boards}
          projects={projects?.filter((p) => p.status !== 'dropped' || p.id === project.id)}
          onChange={(id, f) =>
            // A board moved to another project leaves this list.
            setProject((p) => ({ ...p, whiteboards: changeIn(p.whiteboards, id, f && 'project_id' in f && f.project_id !== p.id ? null : f) }))
          }
        />
      ) : (
        <p class="muted small">No whiteboards for this project.</p>
      )}
      {making && <NewBoardDialog projects={projects} project={project.id} onClose={() => setMaking(false)} />}
    </section>
  );
}

/** One board on Today: its preview, its name and Remove from Today. */
function TodayBoard({ b, onRemove }: { b: Board; onRemove?: () => void }) {
  return (
    <section class="card wb-panel">
      <div class="card-head">
        <h2>
          <button class="wb-name" onClick={() => openBoard(b.id)}>
            ✐ {b.name}
          </button>
        </h2>
        {onRemove && (
          <button class="icon small" aria-label={`Remove ${b.name} from Today`} title="Remove from Today" onClick={onRemove}>
            ✕
          </button>
        )}
      </div>
      <button class="wb-open" onClick={() => openBoard(b.id)} aria-label={`Open ${b.name}`}>
        <Preview board={b} />
      </button>
    </section>
  );
}

function boardPanel(b: Board, setData: (fn: (d: Board[]) => Board[]) => void): PanelDef<TodayPanelProps> {
  const remove = () =>
    optimistic(
      () => {
        setData((d) => d.filter((x) => x.id !== b.id));
        return () => setData((d) => [...d, b]);
      },
      () => patch(`/whiteboards/${b.id}`, { show_today: false }),
      `${b.name} is off Today`,
    );
  return { id: `wb-${b.id}`, title: b.name, description: 'Whiteboard', kind: 'whiteboard', order: 0, onRemove: remove, render: () => <TodayBoard b={b} onRemove={remove} /> };
}

/** Each board shown on Today is its own panel (a panel source). */
function TodayBoardsSource({ children }: { props: TodayPanelProps; children: (panels: PanelDef<TodayPanelProps>[]) => VNode | null }) {
  const { data, setData } = useData<Board[]>('/whiteboards?show_today=true');
  return children((data ?? []).map((b) => boardPanel(b, setData)));
}

/** A board drawn off Today's page (a phone pill, a window): it loads itself. */
function LoadedBoard({ id }: { id: string }) {
  const { data, error } = useData<Board>(`/whiteboards/${id}`);
  if (!data) return <Loading error={error} />;
  return <TodayBoard b={data} />;
}

const resolveBoard = (id: string): PanelDef<any> | null => {
  const m = /^wb-([A-Za-z0-9_-]+)$/.exec(id);
  return m ? { id, title: 'Whiteboard', kind: 'whiteboard', order: 0, render: () => <LoadedBoard key={id} id={m[1]} /> } : null;
};

async function addableBoards(): Promise<Addable[]> {
  const all = await get<Board[]>('/whiteboards');
  return all
    .filter((b) => !b.show_today)
    .map((b) => ({ id: `wb-${b.id}`, title: b.name, description: 'Whiteboard', kind: 'whiteboard', add: () => change(() => patch(`/whiteboards/${b.id}`, { show_today: true }), `${b.name} is on Today`) }));
}

/** On a phone the Whiteboards tab is not in the bottom bar: the Projects tab links to it. */
function ProjectsLink() {
  const { data } = useData<Board[]>('/whiteboards');
  return (
    <a class="card wb-link" href="#/whiteboards">
      <span>
        <strong>Whiteboards</strong>
        <span class="muted small"> · {data ? `${data.length} board${data.length === 1 ? '' : 's'}` : '…'}</span>
      </span>
      <span aria-hidden="true">→</span>
    </a>
  );
}

function Settings() {
  const tool = useSignal(favouriteTool);
  return (
    <section class="card">
      <h2>Whiteboards</h2>
      <label>
        Favourite tool when a board opens (this device)
        <select value={tool} onChange={(e) => setFavouriteTool((e.target as HTMLSelectElement).value)}>
          {TOOLS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

registerTab({ id: 'whiteboards', path: '/whiteboards', label: 'Whiteboards', icon: '✐', order: 45, feature: FLAG, render: () => <WhiteboardsTab /> });
registerRoute({ id: 'whiteboard', prefix: '/w', tab: 'whiteboards', feature: FLAG, render: ({ params }) => <BoardEditor key={params[0]} id={params[0]} /> });
registerPanel('project', { id: 'whiteboards', title: 'Whiteboards', description: 'The project’s whiteboards.', order: 45, feature: FLAG, render: (p) => <ProjectBoards {...p} /> });
registerPanelSource('today', { id: 'whiteboards', order: 65, feature: FLAG, Provide: TodayBoardsSource, resolve: resolveBoard, addable: addableBoards });
registerPanel('projects', { id: 'whiteboards-link', order: 90, feature: FLAG, render: () => <ProjectsLink /> });
registerPanel('settings', { id: 'whiteboards', order: 60, feature: FLAG, render: () => <Settings /> });
