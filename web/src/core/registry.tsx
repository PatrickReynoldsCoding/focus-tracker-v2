// The web app's plug-in points. A feature lives in web/src/features/<name>/ and registers
// what it adds here (tabs, Today panels, project panels, card-dialog sections, settings
// sections); web/src/features/index.ts imports each feature once. Nothing outside a
// feature's folder needs to change to add, remove or flag it.
//
// Every entry may name a `feature` flag (server-declared, src/core/features.ts): while
// the flag is off the entry is not shown.

import type { ComponentChildren, VNode } from 'preact';
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
  /** Shown in the phone's bottom bar (max 5); the rest only in the side bar. */
  phone?: boolean;
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
export interface CardSectionProps {
  card: any;
  columns: { id: string; name: string }[];
  /** Change the card on screen and save the fields (PATCH /api/tasks/:id). */
  save: (fields: Record<string, unknown>) => void;
  /** Change the card on screen only (after a section saved some other way). null = it was deleted. */
  update: (fields: Record<string, unknown> | null) => void;
  close: () => void;
}
export interface SettingsSectionProps {}

/** A small count shown beside a tab's name (side bar and phone bar): set `tabBadges.value = { ...tabBadges.value, today: 2 }`. 0 or missing = none. */
export const tabBadges = signal<Record<string, number>>({});

const tabs: TabDef[] = [];
const routes: RouteDef[] = [];
const panels: Record<string, PanelDef<any>[]> = {};

const add = <T extends { id: string }>(list: T[], item: T) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; // re-registering replaces (hot reload, or a feature overriding a default)
  else list.push(item);
};

export const registerTab = (t: TabDef) => add(tabs, t);
export const registerRoute = (r: RouteDef) => add(routes, r);

/** Panels by place: 'today', 'project', 'card' (sections of the card dialog), 'settings'. */
export function registerPanel(place: 'today', p: PanelDef<TodayPanelProps>): void;
export function registerPanel(place: 'project', p: PanelDef<ProjectPanelProps>): void;
export function registerPanel(place: 'card', p: PanelDef<CardSectionProps>): void;
export function registerPanel(place: 'settings', p: PanelDef<SettingsSectionProps>): void;
export function registerPanel(place: string, p: PanelDef<any>): void;
export function registerPanel(place: string, p: PanelDef<any>) {
  add((panels[place] ??= []), p);
}

const visible = <T extends { feature?: string }>(items: T[], flags: Record<string, boolean>) => items.filter((x) => !x.feature || flags[x.feature]);

export function useTabs(): TabDef[] {
  const flags = useFlags();
  return visible(tabs, flags).sort((a, b) => a.order - b.order);
}
export function useRoutes(): RouteDef[] {
  return visible(routes, useFlags());
}
export function usePanels<P>(place: string): PanelDef<P>[] {
  const flags = useFlags();
  return visible(panels[place] ?? [], flags).sort((a, b) => a.order - b.order) as PanelDef<P>[];
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
