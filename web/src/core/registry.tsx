// The web app's plug-in points. A feature lives in web/src/features/<name>/ and registers
// what it adds here (tabs, Today panels, project panels, card-dialog sections, settings
// sections); web/src/features/index.ts imports each feature once. Nothing outside a
// feature's folder needs to change to add, remove or flag it.
//
// Every entry may name a `feature` flag (server-declared, src/core/features.ts): while
// the flag is off the entry is not shown.

import type { ComponentChildren, ComponentType, VNode } from 'preact';
import { Adaptive } from './adaptive';
import { useFlags } from './features';
import { signal } from './signal';

type Render<P> = (props: P) => VNode | null;

export interface TabDef {
  id: string;
  /** Route prefix, e.g. '/today'. The tab is active for '/today' and '/today/...'. */
  path: string;
  label: string;
  icon: string;
  order: number;
  feature?: string;
  /** Hidden while this flag is on (a tab that another feature's tab takes over from, such as Log → Insights). */
  hideWith?: string;
  /** Tabs this one takes the place of while it is shown: they are hidden, and pages that belong to
   *  them (RouteDef.tab) highlight this tab instead (Files replaces Notes and Whiteboards). */
  replaces?: string[];
  /** Shown in the phone's bottom bar (max 5); the rest only in the side bar. */
  phone?: boolean;
  /** Where the tab's link goes, given the current route (default: `path`). */
  href?: (currentRoute: string) => string;
  render: Render<{ route: string; params: string[] }>;
}

/** An extra route that is not a tab, such as '/p/<id>' (project page). `tab` is the tab it highlights. */
export interface RouteDef {
  id: string;
  prefix: string;
  tab: string;
  feature?: string;
  render: Render<{ route: string; params: string[] }>;
}

export interface PanelDef<P> {
  id: string;
  title?: string;
  order: number;
  feature?: string;
  /** Wider panels span the row on wide screens. */
  wide?: boolean;
  /** Replaces another feature's panel with the same id, whichever is registered first. */
  override?: boolean;
  render: Render<P>;
  /** One line about what it shows, for Add panel and Today settings. */
  description?: string;
  /** A small icon (an emoji or symbol) for Add panel's list. */
  icon?: string;
  /** Cannot be removed from its page (the focus card, a project's board). */
  alwaysShown?: boolean;
  /** Not part of the layout: always drawn above ('top') or below ('bottom') the panels that move,
   *  never moved, removed or popped out (reminder banners, the sticky-note layer, Delete project). */
  fixed?: 'top' | 'bottom';
  /** Drawn in another panel's place, straight after it (a switch that belongs under the notes). */
  attachTo?: string;
  /** What it is, for grouping in pickers: 'list', 'todo', 'note', 'whiteboard'; none = a panel. */
  kind?: string;
  /** For a panel a source made (a list on Today): what Remove does instead of hiding it. */
  onRemove?: () => void;
  /** A short count for Today's pills (to-dos open, habits done of all); nothing = no count. */
  count?: (props: P) => string | number | null | undefined;
  /** A short version, for the top of Today above the pills (the focus card). */
  compact?: Render<P>;
  /** The small ("mobile") version: shown while the panel is narrow (a phone, a small panel), and what an Android widget of the panel shows. */
  small?: Render<P>;
  /** What it edits that may be on screen only once (a note: 'note:project:<id>'); while it is in a
   *  window, every other panel with the same key shows a placeholder. */
  oneCopy?: (props: P) => string | null;
  /** Panels this one takes the place of (old ids): while this one is shown they are hidden, and a
   *  saved pill, grid place or window that names one of them shows this panel there instead. */
  replaces?: string[];
  /** Panels whose content this one also shows: Today's usual pills leave them out while this one
   *  is there. They can still be added by hand. */
  covers?: string[];
  /** More things to do with the panel, for its ⋯ menu on a computer (added by a layout step: the
   *  pop-out windows add “Pop out”). */
  menu?: (props: P) => PanelAction[];
  /** For a Settings section: whom its settings apply to, shown as a tag on the section.
   *  'profile' = the profile that is open (kept on the server per profile), 'all' = every profile
   *  (the time zone, devices, Claude), 'device' = this device only (kept in the browser). */
  scope?: SettingsScope;
}

export type SettingsScope = 'profile' | 'all' | 'device';

/** One line of a panel's ⋯ menu. */
export interface PanelAction {
  label: string;
  icon?: string;
  run: () => void;
}

/** A page whose panels can be drawn away from it (a pop-out window): how to load the props its
 *  panels get, from a key (a project's id; '' for Today). */
export interface PlaceDef<P = any> {
  place: string;
  /** A hook: the props for this key, null while loading. */
  useProps: (key: string) => { props: P | null; error?: string | null };
  keyOf: (props: P) => string;
  /** The page's name for people ('Today', the project's name). */
  label: (props: P) => string;
}
const placeDefs = new Map<string, PlaceDef>();
export function registerPlace<P>(p: PlaceDef<P>) {
  placeDefs.set(p.place, p as PlaceDef);
}
export const placeDef = (place: string): PlaceDef | undefined => placeDefs.get(place);

export interface TodayPanelProps {
  /** GET /api/today, shared by every Today panel; panels with other data fetch it themselves. */
  today: any;
  setToday: (fn: (d: any) => any) => void;
}
export interface ProjectPanelProps {
  /** GET /api/projects/:id/full */
  project: any;
  setProject: (fn: (p: any) => any) => void;
}
export interface ProjectsPanelProps {
  /** The category chosen in the Projects tab's filter ('' = all categories). */
  category: string;
}
export interface CardSectionProps {
  card: any;
  columns: { id: string; name: string; is_done?: boolean }[];
  /** Change the card on screen and save the fields (PATCH /api/tasks/:id). */
  save: (fields: Record<string, unknown>) => void;
  /** Change the card on screen only (after a section saved some other way). null = it was deleted. */
  update: (fields: Record<string, unknown> | null) => void;
  close: () => void;
}
/** A small mark on a card of a board (keep it to an icon or a short tag). */
export interface CardTileProps {
  card: any;
}
export interface SettingsSectionProps {}
/** A section at the top of the Habits tab, under its heading (Plan my week puts its week there). */
export interface HabitsSectionProps {}

/** Something drawn over every page once signed in (a corner timer, a background job with no UI). */
export interface OverlayDef {
  id: string;
  order: number;
  feature?: string;
  render: Render<{ route: string }>;
}
/** Something in the header, at its left edge (the Back button). Draw nothing (return null) when it has nothing to show. */
export interface HeaderItemDef {
  id: string;
  order: number;
  feature?: string;
  render: Render<{ route: string }>;
}
/** A small count shown beside a tab's name (side bar and phone bar): set `tabBadges.value = { ...tabBadges.value, today: 2 }`. 0 or missing = none. */
export const tabBadges = signal<Record<string, number>>({});

/** Panels that come from data (each note or list on Today is its own panel). `Provide` works them out,
 *  loading what it needs, and returns `children(panels)` (an empty list while loading). */
export interface PanelSourceDef<P> {
  id: string;
  order: number;
  feature?: string;
  Provide: ComponentType<{ props: P; children: (panels: PanelDef<P>[]) => VNode | null }>;
  /** One of this source's panels by id, drawn anywhere (a pill of Today, a window), loading its own
   *  data; also for something not on the page now. null when the id is not this source's. */
  resolve?: (id: string) => PanelDef<any> | null;
  /** What could be put on the page (not on it now), for "+ Add feature" and the pills. */
  addable?: () => Promise<Addable[]>;
}
export interface Addable {
  /** The panel id it will have once added (also what a pill stores). */
  id: string;
  title: string;
  description?: string;
  kind?: string;
  /** Put it on the page. */
  add: () => unknown;
}

/** Arranges a place's panels (the desktop grid, Today's pills, pop-out windows). Layouts
 *  are chained by `order`: each gets the panels and calls `next(panels)` for the rest of the chain,
 *  so one can change what the next one draws (a placeholder, a filter) or draw everything itself. */
export interface PanelLayoutProps<P = any> {
  place: string;
  props: P;
  panels: PanelDef<P>[];
  next: (panels: PanelDef<P>[]) => VNode;
}
export interface PanelLayoutDef {
  id: string;
  order: number;
  feature?: string;
  /** The places it arranges, e.g. ['today', 'project']. */
  places: string[];
  component: ComponentType<PanelLayoutProps>;
}

const tabs: TabDef[] = [];
const routes: RouteDef[] = [];
const panels: Record<string, PanelDef<any>[]> = {};
const overlays: OverlayDef[] = [];
const headerItems: HeaderItemDef[] = [];
const sources: Record<string, PanelSourceDef<any>[]> = {};
const layouts: PanelLayoutDef[] = [];

const add = <T extends { id: string; override?: boolean }>(list: T[], item: T) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0 && list[i].override && !item.override) return; // an override stays, whatever the import order
  if (i >= 0) list[i] = item; // re-registering replaces (hot reload, or a feature overriding a default)
  else list.push(item);
};

export const registerTab = (t: TabDef) => add(tabs, t);
export const registerRoute = (r: RouteDef) => add(routes, r);
export const registerOverlay = (o: OverlayDef) => add(overlays, o);
export const registerHeaderItem = (h: HeaderItemDef) => add(headerItems, h);
export const registerPanelLayout = (l: PanelLayoutDef) => add(layouts, l);
export function registerPanelSource(place: 'today', s: PanelSourceDef<TodayPanelProps>): void;
export function registerPanelSource(place: 'project', s: PanelSourceDef<ProjectPanelProps>): void;
export function registerPanelSource(place: string, s: PanelSourceDef<any>): void;
export function registerPanelSource(place: string, s: PanelSourceDef<any>) {
  add((sources[place] ??= []), s);
}

/** What `MarkdownEditor` (core/ui.tsx) takes. Features may pass the optional ones. */
export interface MarkdownEditorProps {
  value: string;
  /** Called with the new text (by the plain editor, and by the rich one when no `note` is given). May return a promise. */
  onSave: (v: string) => unknown;
  placeholder?: string;
  rows?: number;
  /** The note this text is (PUT /api/notes/of/:kind/:id). The rich editor then saves it itself, with conflict protection. */
  note?: { kind: 'project' | 'list'; id: string };
  /** Keep a draft on this device under this key (made from `note` when not given). */
  draftKey?: string;
  /** Advanced: how to read and write the text (see features/editor/targets.ts). */
  target?: unknown;
}
/** The editor `MarkdownEditor` uses. The first registered one whose flag is on wins; none: the plain text box. */
export interface EditorDef {
  id: string;
  feature?: string;
  component: ComponentType<MarkdownEditorProps>;
}
const editors: EditorDef[] = [];
export const registerMarkdownEditor = (e: EditorDef) => add(editors, e);
export const useMarkdownEditor = (): EditorDef | undefined => visible(editors, useFlags())[0];

/** Panels by place: 'today', 'project', 'projects' (the Projects tab), 'card' (sections of the card dialog), 'card-tile' (marks on a board card), 'settings', 'habits' (top of the Habits tab). */
export function registerPanel(place: 'today', p: PanelDef<TodayPanelProps>): void;
export function registerPanel(place: 'project', p: PanelDef<ProjectPanelProps>): void;
export function registerPanel(place: 'projects', p: PanelDef<ProjectsPanelProps>): void;
export function registerPanel(place: 'card', p: PanelDef<CardSectionProps>): void;
export function registerPanel(place: 'card-tile', p: PanelDef<CardTileProps>): void;
export function registerPanel(place: 'settings', p: PanelDef<SettingsSectionProps>): void;
export function registerPanel(place: 'habits', p: PanelDef<HabitsSectionProps>): void;
export function registerPanel(place: string, p: PanelDef<any>): void;
export function registerPanel(place: string, p: PanelDef<any>) {
  add((panels[place] ??= []), withSmallVersion(p));
}

/** A panel with a `small` version draws it while narrow (core/adaptive.tsx). A panel that draws nothing still draws nothing. */
export function withSmallVersion<P>(p: PanelDef<P>): PanelDef<P> {
  const small = p.small;
  if (!small) return p;
  return {
    ...p,
    render: (props) => {
      const full = p.render(props);
      return full ? <Adaptive small={() => small(props)}>{full}</Adaptive> : null;
    },
  };
}

const visible = <T extends { feature?: string }>(items: T[], flags: Record<string, boolean>) => items.filter((x) => !x.feature || flags[x.feature]);
/** The panels whose flag is on, without those another shown panel replaces (PanelDef.replaces). */
function shownPanels<P>(items: PanelDef<P>[], flags: Record<string, boolean>): PanelDef<P>[] {
  const on = visible(items, flags);
  const gone = new Set(on.flatMap((p) => p.replaces ?? []));
  return gone.size ? on.filter((p) => !gone.has(p.id)) : on;
}
/** The shown panel that stands for an id: the panel itself, or the one that replaces it. */
export function standIn<P>(list: PanelDef<P>[], id: string): PanelDef<P> | undefined {
  return list.find((p) => p.id === id) ?? list.find((p) => p.replaces?.includes(id));
}

export function useTabs(): TabDef[] {
  const flags = useFlags();
  const on = visible(tabs, flags).filter((t) => !t.hideWith || !flags[t.hideWith]);
  const gone = new Set(on.flatMap((t) => t.replaces ?? []));
  return on.filter((t) => !gone.has(t.id)).sort((a, b) => a.order - b.order);
}

/** Which tab a route belongs to, among the tabs shown (useTabs), and the extra route that draws it
 *  (a page that is not a tab). A query (`/files?type=notes`) does not count. */
export function routeTab(route: string, shown: TabDef[], extras: RouteDef[]): { tab?: TabDef; extra?: RouteDef; params: string[] } {
  const [, head, ...params] = route.split('?')[0].split('/');
  const extra = extras.find((x) => x.prefix === `/${head}`);
  if (extra) return { extra, params, tab: shown.find((t) => t.id === extra.tab) ?? shown.find((t) => t.replaces?.includes(extra.tab)) };
  return { params, tab: shown.find((t) => t.path === `/${head}`) ?? shown[0] };
}

// ---------- files (the Files tab) ----------

/** One file as GET /api/files lists it (src/core/files.ts). */
export interface FileItem {
  type: string;
  id: string;
  name: string;
  folder_id: string | null;
  project_id: string | null;
  updated_at: string;
  created: string;
  show_today?: boolean;
  preview?: string | null;
  kind?: string | null;
  url?: string | null;
  count?: number | null;
  thumbnail?: boolean;
  /** Where it is (folder names), in a search or a type filter. */
  location?: string | null;
}
/** One entry of the Files tab's New menu: its dialog makes the file in the folder on screen. */
export interface FileCreateDef {
  id: string;
  label: string;
  icon: ComponentChildren;
  order: number;
  dialog: ComponentType<{ folderId: string | null; onClose: () => void }>;
  /** Make it at once from a name, without opening it (Add panel's file picker: “New note” there). */
  make?: (name: string, folderId: string | null) => Promise<FileItem | undefined>;
}
/** A kind of file the Files tab shows (the server lists it, src/core/files.ts). Each feature
 *  registers its own: how it looks, opens, is renamed, deleted and made. Pickers (Add file) and
 *  project labels can read the same list. */
export interface FileTypeDef {
  /** The server's type: 'note', 'todo', 'list', 'whiteboard', 'link', 'project-note'. */
  type: string;
  /** The filter chip it belongs to. */
  group: { id: string; label: string; order: number };
  /** 'Note', 'To-do list' ... */
  label: string;
  order: number;
  feature?: string;
  /** Its icon, `size` px square (24 in lists, bigger in the grid). */
  icon: (f: FileItem, size?: number) => VNode;
  /** Where it opens: an app page ('#/n/<id>') or an address (external). */
  href: (f: FileItem) => string;
  external?: boolean;
  /** Open it another way than following href (a whiteboard remembers where it was opened from). */
  open?: (f: FileItem) => void;
  /** A bigger view for the grid (a board's preview, a note's first lines). */
  preview?: (f: FileItem) => VNode | null;
  /** One short line about it ('3 open', 'Google Doc'). */
  detail?: (f: FileItem) => string | null;
  /** It stays where it is (a project's notes). */
  fixed?: boolean;
  rename?: (f: FileItem, name: string) => Promise<unknown>;
  remove?: (f: FileItem) => Promise<unknown>;
  create?: FileCreateDef[];
  /** Its panel id on Today ('list-<id>'): the file can be a panel (Add panel's Add file). The
   *  server's FileSource.today uses the same id. None: it cannot be a panel (a link). */
  panel?: (f: FileItem) => string;
}
const fileTypes: (FileTypeDef & { id: string })[] = [];
export const registerFileType = (t: FileTypeDef) => add(fileTypes, { ...t, id: t.type });
/** The file types whose flag is on, in order. */
export function useFileTypes(): FileTypeDef[] {
  return visible(fileTypes, useFlags()).sort((a, b) => a.order - b.order);
}

// ---------- project labels ----------

/** Where a project label is drawn. `link`: tapping it opens the project (off inside a button,
 *  such as a row of the Add file picker). */
export interface ProjectLabelProps {
  projectId: string | null | undefined;
  link?: boolean;
  class?: string;
}
/** The small label with a project's name on files, panels and Today's to-dos (features/project-labels). */
export interface ProjectLabelDef {
  id: string;
  order: number;
  feature?: string;
  component: ComponentType<ProjectLabelProps>;
}
const projectLabels: ProjectLabelDef[] = [];
export const registerProjectLabel = (d: ProjectLabelDef) => add(projectLabels, d);
/** The project's label, where a feature registered one and its flag is on; nothing for no project. */
export function ProjectLabel(props: ProjectLabelProps) {
  const def = visible(projectLabels, useFlags()).sort((a, b) => a.order - b.order)[0];
  if (!def || !props.projectId) return null;
  return <def.component {...props} />;
}

// ---------- Add panel (the "+ Add panel" button) ----------

/** Where Add panel puts things, worked out by the page's layout (a pill of Today, Today, project pages). */
export interface PanelAdderTarget {
  /** For people: 'the pill “Home”', 'Today', 'project pages'. */
  where: string;
  /** Panels registered for the page that are not shown there now. */
  panels: PanelDef<any>[];
  addPanel: (p: PanelDef<any>) => Promise<unknown>;
  /** Files (Add file), or null when the page takes none. */
  files: null | {
    /** The file types that can be chosen. */
    accepts: (t: FileTypeDef) => boolean;
    /** Already there (shown ticked). `panel` is FileTypeDef.panel's id, when the type has one. */
    has: (f: FileItem, panel: string | null) => boolean;
    add: (f: FileItem, panel: string | null) => Promise<unknown>;
    /** What choosing a file does, one short sentence. */
    hint: string;
  };
}
export interface PanelAdderProps extends PanelAdderTarget {
  place: string;
  onClose: () => void;
}
/** The sheet "+ Add panel" opens (features/add-panel). None registered (or its flag off): the layout's older "Add panels…" list. */
export interface PanelAdderDef {
  id: string;
  order: number;
  feature?: string;
  component: ComponentType<PanelAdderProps>;
}
const adders: PanelAdderDef[] = [];
export const registerPanelAdder = (a: PanelAdderDef) => add(adders, a);
export function usePanelAdder(): PanelAdderDef | undefined {
  return visible(adders, useFlags()).sort((a, b) => a.order - b.order)[0];
}

export function useRoutes(): RouteDef[] {
  return visible(routes, useFlags());
}
export function usePanels<P>(place: string): PanelDef<P>[] {
  const flags = useFlags();
  return shownPanels(panels[place] ?? [], flags).sort((a, b) => a.order - b.order) as PanelDef<P>[];
}
/** The sources of a place whose flag is on (for "+ Add feature" and the pills). */
export function useSources(place: string): PanelSourceDef<any>[] {
  return visible(sources[place] ?? [], useFlags()).sort((a, b) => a.order - b.order);
}
/** A panel of a place by id, outside its page: a registered one, else one a source can draw. */
export function lookupPanel(place: string, id: string, flags: Record<string, boolean>): PanelDef<any> | null {
  const all = shownPanels(panels[place] ?? [], flags);
  const own = standIn(all.filter((p) => !p.attachTo), id);
  if (own) return withAttached(own, all);
  for (const s of visible(sources[place] ?? [], flags)) {
    const p = s.resolve?.(id);
    if (p) return p;
  }
  return null;
}

/** A panel with the panels attached to it drawn straight after it. */
function withAttached<P>(host: PanelDef<P>, all: PanelDef<P>[]): PanelDef<P> {
  const att = all.filter((p) => p.attachTo === host.id);
  if (!att.length) return host;
  return {
    ...host,
    render: (props) => {
      const node = host.render(props);
      if (!node) return null;
      return (
        <>
          {node}
          {att.map((a) => (
            <PanelSlot key={a.id}>{a.render(props)}</PanelSlot>
          ))}
        </>
      );
    },
  };
}

/** Draw every overlay (main.tsx puts this in the signed-in shell). */
export function Overlays({ route }: { route: string }) {
  const list = visible(overlays, useFlags()).sort((a, b) => a.order - b.order);
  return <>{list.map((o) => <OverlaySlot key={o.id} render={() => o.render({ route })} />)}</>;
}
/** Draw the header items registered with registerHeaderItem (main.tsx puts this first in the header). */
export function HeaderItems({ route }: { route: string }) {
  const list = visible(headerItems, useFlags()).sort((a, b) => a.order - b.order);
  return <>{list.map((h) => <OverlaySlot key={h.id} render={() => h.render({ route })} />)}</>;
}
function OverlaySlot({ render }: { render: () => VNode | null }) {
  return render();
}

type Wrap<P> = (p: PanelDef<P>, node: VNode) => ComponentChildren;

/** Draw every panel registered for a place, in order, with the panels its sources add; a place
 *  that has layouts (registerPanelLayout) is arranged by them. */
export function Panels<P extends object>({ place, props, wrap }: { place: string; props: P; wrap?: Wrap<P> }) {
  const flags = useFlags();
  const list = shownPanels(panels[place] ?? [], flags).sort((a, b) => a.order - b.order) as PanelDef<P>[];
  const srcs = visible(sources[place] ?? [], flags).sort((a, b) => a.order - b.order);
  const lays = visible(layouts, flags)
    .filter((l) => l.places.includes(place))
    .sort((a, b) => a.order - b.order);
  if (!srcs.length && !lays.length) return <PlainPanels list={list} props={props} wrap={wrap} />;
  return (
    <Collect sources={srcs} i={0} props={props} found={[]}>
      {(more) => <Chain place={place} props={props} panels={merge(list, more as PanelDef<P>[])} layouts={lays} i={0} wrap={wrap} />}
    </Collect>
  );
}

/** Registered panels and the sources' panels in order, each attached panel folded into its host. */
function merge<P>(list: PanelDef<P>[], more: PanelDef<P>[]): PanelDef<P>[] {
  const all = [...list, ...more].sort((a, b) => a.order - b.order);
  return all.filter((p) => !p.attachTo || !all.some((h) => h.id === p.attachTo)).map((p) => withAttached(p, all));
}

/** Ask each source in turn for its panels (each is a component, so it may load data). */
function Collect({ sources: srcs, i, props, found, children }: { sources: PanelSourceDef<any>[]; i: number; props: any; found: PanelDef<any>[]; children: (more: PanelDef<any>[]) => VNode }) {
  if (i >= srcs.length) return children(found);
  const S = srcs[i];
  return (
    <S.Provide props={props}>
      {(ps) => (
        <Collect sources={srcs} i={i + 1} props={props} found={[...found, ...ps.map((p, k) => ({ ...p, order: S.order + k / 1000 }))]}>
          {children}
        </Collect>
      )}
    </S.Provide>
  );
}

function Chain<P>({ place, props, panels: list, layouts: lays, i, wrap }: { place: string; props: P; panels: PanelDef<P>[]; layouts: PanelLayoutDef[]; i: number; wrap?: Wrap<P> }) {
  if (i >= lays.length) return <PlainPanels list={list} props={props} wrap={wrap} />;
  const L = lays[i].component;
  return <L place={place} props={props} panels={list} next={(ps) => <Chain place={place} props={props} panels={ps as PanelDef<P>[]} layouts={lays} i={i + 1} wrap={wrap} />} />;
}

function PlainPanels<P>({ list, props, wrap }: { list: PanelDef<P>[]; props: P; wrap?: Wrap<P> }) {
  return (
    <>
      {list.map((p) => {
        const node = p.render(props);
        if (!node) return null;
        return <PanelSlot key={p.id}>{wrap ? wrap(p, node) : node}</PanelSlot>;
      })}
    </>
  );
}

function PanelSlot({ children }: { children: ComponentChildren }) {
  return <>{children}</>;
}
