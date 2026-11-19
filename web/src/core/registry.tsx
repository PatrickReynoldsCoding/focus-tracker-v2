// The web app's plug-in points. A feature lives in web/src/features/<name>/ and registers
// what it adds here (tabs, Today panels, project panels, card-dialog sections, settings
// sections); web/src/features/index.ts imports each feature once. Nothing outside a
// feature's folder needs to change to add, remove or flag it.
//
// Every entry may name a `feature` flag (server-declared, src/core/features.ts): while
// the flag is off the entry is not shown.

import type { ComponentChildren, ComponentType, VNode } from 'preact';
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
  /** One line about what it shows, for "+ Add feature" and Today settings. */
  description?: string;
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
  /** What it edits that may be on screen only once (a note: 'note:project:<id>'); while it is in a
   *  window, every other panel with the same key shows a placeholder. */
  oneCopy?: (props: P) => string | null;
  /** Panels this one takes the place of (old ids): while this one is shown they are hidden, and a
   *  saved pill, grid place or window that names one of them shows this panel there instead. */
  replaces?: string[];
  /** Panels whose content this one also shows: Today's usual pills leave them out while this one
   *  is there. They can still be added by hand. */
  covers?: string[];
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
  columns: { id: string; name: string }[];
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
  add((panels[place] ??= []), p);
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
  return visible(tabs, flags)
    .filter((t) => !t.hideWith || !flags[t.hideWith])
    .sort((a, b) => a.order - b.order);
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
