// What a resource looks like in the browser, and small helpers shared by the resources components.
import { say } from '../../core/api';
import { asUrl, detectResource, KIND_LABELS, type ResourceKind } from '../../../../src/core/resource-kinds';

export type Resource = {
  id: string;
  title: string;
  type: string;
  kind?: string | null;
  value: string;
  grp: string | null;
  note: string | null;
  project_id?: string | null;
  category_id?: string | null;
  ord?: number;
};

/** Who owns the resources shown: one project, or a category (shared by its projects). */
export type Owner = { project_id: string } | { category_id: string };
export const ownerKey = (o: Owner) => ('project_id' in o ? `p-${o.project_id}` : `c-${o.category_id}`);

/** The stored kind, or one worked out from the value (rows saved before the kind column existed). */
export const kindOf = (r: Pick<Resource, 'kind' | 'type' | 'value'>): ResourceKind => (r.kind as ResourceKind) || detectResource(r.value, r.type).kind;
export const kindLabel = (r: Pick<Resource, 'kind' | 'type' | 'value'>) => KIND_LABELS[kindOf(r)];

export function hrefOf(r: Pick<Resource, 'type' | 'value'>): string | undefined {
  if (r.type === 'email') return `mailto:${r.value}`;
  if (r.type === 'phone') return `tel:${r.value.replace(/[^\d+]/g, '')}`;
  if (r.type === 'link' || r.type === 'drive') return asUrl(r.value)?.toString() ?? undefined;
  return undefined;
}

/** What to show under the title: the host for web addresses, otherwise the value. */
export function subtitle(r: Resource): string {
  if (r.type === 'link' || r.type === 'drive') {
    const u = asUrl(r.value);
    return u ? u.hostname.replace(/^www\./, '') : r.value;
  }
  return r.value;
}

/** Ungrouped first (no heading), then each group in the order its first item appears. */
export function groupItems(items: Resource[]): { name: string; items: Resource[] }[] {
  const out: { name: string; items: Resource[] }[] = [];
  for (const r of items) {
    const name = (r.grp ?? '').trim();
    let g = out.find((x) => x.name === name);
    if (!g) out.push((g = { name, items: [] }));
    g.items.push(r);
  }
  return out.sort((a, b) => (a.name === '' ? -1 : b.name === '' ? 1 : 0));
}

export async function copyText(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    say(`${what}: ${text.length > 40 ? text.slice(0, 39) + '…' : text}`);
  } catch {
    say('Could not copy. Select the text and copy it by hand.', 'error');
  }
}

export const RULE = 'Never add bank details, passwords or ID numbers.';
