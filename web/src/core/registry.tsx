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
}

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

/** Something drawn over every page once signed in (a corner timer, a background job with no UI). */
export interface OverlayDef {
  id: string;
  order: number;
  feature?: string;
  render: Render<{ route: string }>;
}
/** A small count shown beside a tab's name (side bar and phone bar): set `tabBadges.value = { ...tabBadges.value, today: 2 }`. 0 or missing = none. */
export const tabBadges = signal<Record<string, number>>({});

const tabs: TabDef[] = [];
const routes: RouteDef[] = [];
const panels: Record<string, PanelDef<any>[]> = {};
const overlays: OverlayDef[] = [];

const add = <T extends { id: string; override?: boolean }>(list: T[], item: T) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0 && list[i].override && !item.override) return; // an override stays, whatever the import order
  if (i >= 0) list[i] = item; // re-registering replaces (hot reload, or a feature overriding a default)
  else list.push(item);
};

export const registerTab = (t: TabDef) => add(tabs, t);
export const registerRoute = (r: RouteDef) => add(routes, r);
export const registerOverlay = (o: OverlayDef) => add(overlays, o);

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

/** Panels by place: 'today', 'project', 'projects' (the Projects tab), 'card' (sections of the card dialog), 'card-tile' (marks on a board card), 'settings'. */
export function registerPanel(place: 'today', p: PanelDef<TodayPanelProps>): void;
export function registerPanel(place: 'project', p: PanelDef<ProjectPanelProps>): void;
export function registerPanel(place: 'projects', p: PanelDef<ProjectsPanelProps>): void;
export function registerPanel(place: 'card', p: PanelDef<CardSectionProps>): void;
export function registerPanel(place: 'card-tile', p: PanelDef<CardTileProps>): void;
export function registerPanel(place: 'settings', p: PanelDef<SettingsSectionProps>): void;
export function registerPanel(place: string, p: PanelDef<any>): void;
export function registerPanel(place: string, p: PanelDef<any>) {
  add((panels[place] ??= []), p);
}

const visible = <T extends { feature?: string }>(items: T[], flags: Record<string, boolean>) => items.filter((x) => !x.feature || flags[x.feature]);

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
  return visible(panels[place] ?? [], flags).sort((a, b) => a.order - b.order) as PanelDef<P>[];
}

/** Draw every overlay (main.tsx puts this in the signed-in shell). */
export function Overlays({ route }: { route: string }) {
  const list = visible(overlays, useFlags()).sort((a, b) => a.order - b.order);
  return <>{list.map((o) => <OverlaySlot key={o.id} render={() => o.render({ route })} />)}</>;
}
function OverlaySlot({ render }: { render: () => VNode | null }) {
  return render();
}

/** Draw every panel registered for a place, in order. */
export function Panels<P extends object>({ place, props, wrap }: { place: string; props: P; wrap?: (p: PanelDef<P>, node: VNode) => ComponentChildren }) {
  const list = usePanels<P>(place);
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
