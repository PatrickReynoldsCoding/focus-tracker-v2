// Resources: links and contact details kept with a project, or shared by a category.
// Google Docs, Sheets and other Drive items are linked here (type "drive"); the tracker never
// reads them, so no Google sign-in is needed (DECISIONS D11). Each resource gets a `kind`
// (doc, sheet, slides ... see src/core/resource-kinds.ts) that drives its icon.
// The optional Google Picker ("choose from Drive") sits behind the `google-picker` flag.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import type { FileItem } from '../core/files';
import type { Module } from '../core/registry';
import { detectResource, guessTitle, parseResourceText, RESOURCE_KINDS, RESOURCE_TYPES, sameKey } from '../core/resource-kinds';
import { create, list } from '../core/store';

/**
 * Set type, kind and a tidy value from what was given. A "link" that is not a web address is
 * really an email, a phone number or text (the column default is "link", so Claude need not say).
 */
function settle(row: Record<string, unknown>) {
  const value = String(row.value ?? '').trim();
  if (!value) return;
  const type = String(row.type ?? 'link');
  const d = detectResource(value, type === 'link' ? undefined : type, typeof row.kind === 'string' ? row.kind : null);
  row.type = d.type;
  row.kind = d.kind;
  row.value = d.value;
}

export const resourcesEntity: Entity = {
  name: 'resources',
  table: 'resources',
  singular: 'resource',
  desc: 'Links and contact details kept with a project, or shared by a category. Google Docs, Sheets, Slides and Drive files or folders are links (type drive); the kind is worked out from the address. Never store anything sensitive (bank details, passwords, ID numbers).',
  modeScoped: true,
  orderGroup: ['project_id', 'category_id'],
  filters: ['project_id', 'category_id', 'type', 'kind', 'grp', 'folder_id'],
  fields: {
    title: { type: 'text', required: true },
    type: { type: 'text', enum: RESOURCE_TYPES, default: 'link' },
    kind: { type: 'text', enum: RESOURCE_KINDS, desc: 'Worked out from the address (doc, sheet, slides, form, drawing, folder, file, pdf, image, link ...); it sets the icon. A given kind only counts as a hint for Drive files (file, pdf, image, folder).' },
    value: { type: 'text', required: true, desc: 'The address, number or text' },
    grp: { type: 'text', desc: 'Free-text group such as "Code" or "Suppliers"' },
    note: { type: 'text' },
    project_id: { type: 'text', ref: 'projects', cascade: true, desc: 'Empty means shared by the category' },
    category_id: { type: 'text', ref: 'categories', cascade: true },
    folder_id: { type: 'text', ref: 'folders', desc: 'The Files folder of a link (empty: top level, or the project’s folder). A project’s folder makes it that project’s link' },
  },
  beforeCreate(_ctx, row) {
    if (!row.project_id && !row.category_id && !('folder_id' in row)) throw bad('A resource needs project_id, category_id or folder_id (null for the top level of Files)');
    settle(row);
  },
  beforeUpdate(_ctx, before, patch) {
    if (!('value' in patch) && !('type' in patch) && !('kind' in patch)) return;
    const row: Record<string, unknown> = { value: before.value, type: before.type, kind: before.kind, ...patch };
    // A new address is detected afresh; only a kind given with it counts as a hint.
    if ('value' in patch && !('kind' in patch)) row.kind = null;
    settle(row);
    patch.type = row.type;
    patch.kind = row.kind;
    patch.value = row.value;
  },
};

const itemInput = z.object({
  value: z.string().min(1).describe('A web address (Google Docs, Sheets, Drive ...), email, phone number or text'),
  title: z.string().optional().describe('Defaults to a guess from the address, such as "Google Sheet"'),
  type: z.enum(RESOURCE_TYPES).optional().describe('Guessed from the value when left out'),
  kind: z.enum(RESOURCE_KINDS).optional().describe('Only a hint for Drive files: file, pdf, image or folder'),
  group: z.string().optional(),
  note: z.string().optional(),
});
type Item = z.infer<typeof itemInput>;
type Owner = { project_id?: string; category_id?: string };

/** Add several resources to one owner in one step (one undo). Skips addresses the owner already has. */
export async function addResources(ctx: Ctx, owner: Owner, items: Item[], defaultGroup?: string) {
  if (!owner.project_id && !owner.category_id) throw bad('Give project_id or category_id');
  const where = owner.project_id ? { project_id: owner.project_id } : { category_id: owner.category_id, project_id: null };
  const existing = await list(ctx, resourcesEntity, { where, limit: 2000 });
  const have = new Set(existing.filter((r) => r.type === 'link' || r.type === 'drive').map((r) => sameKey(String(r.value))));
  const created: Row[] = [];
  const skipped: { value: string; reason: string }[] = [];
  for (const it of items) {
    const value = it.value.trim();
    const d = detectResource(value, it.type === 'link' ? undefined : it.type);
    if (d.type === 'link' || d.type === 'drive') {
      const key = sameKey(value);
      if (have.has(key)) {
        skipped.push({ value, reason: 'already added' });
        continue;
      }
      have.add(key);
    }
    created.push(
      await create(ctx, resourcesEntity, {
        project_id: owner.project_id ?? null,
        category_id: owner.category_id ?? null,
        title: it.title?.trim() || guessTitle(value, d.kind),
        value,
        type: d.type,
        kind: it.kind,
        grp: it.group ?? defaultGroup ?? null,
        note: it.note ?? null,
      }),
    );
  }
  return { created, skipped };
}

/** Browser settings for Google's Picker: only when the flag is on and the owner has set up the Google project. */
export async function pickerConfig(ctx: Ctx) {
  const { GOOGLE_PICKER_CLIENT_ID: client_id, GOOGLE_PICKER_API_KEY: api_key, GOOGLE_PICKER_APP_ID: app_id } = ctx.env;
  if (!client_id || !api_key || !(await ctx.feature('google-picker'))) return { enabled: false as const };
  return { enabled: true as const, client_id, api_key, app_id: app_id || null };
}

const bulkBody = z.object({
  project_id: z.string().optional(),
  category_id: z.string().optional(),
  group: z.string().optional(),
  items: z.array(itemInput).min(1).max(200),
});

/** Links (web addresses and Google Drive items) as files, with their kind for the icon. Resources a
 *  category shares with all its projects stay on the Projects tab; phone numbers, emails and text are not files. */
async function linkFiles(ctx: Ctx, like: string | null): Promise<FileItem[]> {
  const search = like ? ` AND (title LIKE ?2 ESCAPE '\\' OR value LIKE ?2 ESCAPE '\\' OR note LIKE ?2 ESCAPE '\\')` : '';
  const rows = await ctx.db
    .prepare(`SELECT id, title, value, type, kind, folder_id, project_id, created, updated_at FROM resources WHERE mode = ?1 AND type IN ('link', 'drive') AND NOT (project_id IS NULL AND category_id IS NOT NULL)${search} LIMIT 2000`)
    .bind(...(like ? [ctx.mode, like] : [ctx.mode]))
    .all<{ id: string; title: string; value: string; type: string; kind: string | null; folder_id: string | null; project_id: string | null; created: string; updated_at: string }>();
  return rows.results.map((r) => ({
    type: 'link',
    id: r.id,
    name: r.title,
    folder_id: r.folder_id,
    project_id: r.project_id,
    created: r.created,
    updated_at: r.updated_at,
    url: r.value,
    kind: r.kind || detectResource(r.value, r.type).kind,
  }));
}

export const resourcesModule: Module = {
  id: 'resources',
  files: [{ type: 'link', group: 'links', label: 'Link', entity: 'resources', list: linkFiles }],
  description: 'Resources: links, Google Drive items, contact details and text kept with a project or shared by a category.',
  entities: [resourcesEntity],
  features: [
    {
      id: 'google-picker',
      label: 'Google Drive picker',
      description: 'Adds “Choose from Google Drive” to the Add from Drive pop-up. Needs a Google Cloud project (docs/google-picker.md). Pasting Drive addresses works without it.',
      default: false,
      experimental: true,
    },
  ],
  routes(api) {
    api.get('/resources/picker', async (c) => c.json(await pickerConfig(c.get('ctx'))));
    api.post('/resources/bulk', async (c) => {
      const b = bulkBody.parse(await c.req.json());
      return c.json(await addResources(c.get('ctx'), { project_id: b.project_id, category_id: b.category_id }, b.items, b.group), 201);
    });
  },
  tools: [
    {
      name: 'add_resource',
      description:
        'Add a resource to a project (or share it with a category): a web address, a Google Doc, Sheet, Slides, Form or Drive file or folder (type and icon are worked out from the address), an email, a phone number or text. Never add bank details, passwords or ID numbers.',
      input: z.object({
        project_id: z.string().optional().describe('The project the resource belongs to'),
        category_id: z.string().optional().describe('Or a category, to share it with all its projects'),
        folder_id: z.string().optional().describe('Or a Files folder (a link only)'),
        ...itemInput.shape,
      }),
      run: async (ctx, { project_id, category_id, folder_id, ...item }) => {
        if (folder_id && !project_id && !category_id) {
          const value = item.value.trim();
          const d = detectResource(value, item.type === 'link' ? undefined : item.type);
          return create(ctx, resourcesEntity, { folder_id, title: item.title?.trim() || guessTitle(value, d.kind), value, type: d.type, kind: item.kind, grp: item.group ?? null, note: item.note ?? null });
        }
        const r = await addResources(ctx, { project_id, category_id }, [item]);
        if (!r.created.length) throw bad(`Not added: ${r.skipped[0].reason}`);
        return r.created[0];
      },
    },
    {
      name: 'add_resources',
      description:
        'Add many resources at once from pasted text: one address per line, "Title - address" lines or Markdown links. Google addresses get their type and icon. Addresses already there are skipped.',
      input: z.object({
        project_id: z.string().optional(),
        category_id: z.string().optional().describe('Share with a category instead of one project'),
        text: z.string().min(1),
        group: z.string().optional(),
      }),
      run: async (ctx, { project_id, category_id, text, group }) => {
        const { items, ignored } = parseResourceText(text);
        if (!items.length) throw bad('No web addresses found in the text');
        const r = await addResources(ctx, { project_id, category_id }, items.map((i) => ({ value: i.value, title: i.title })), group);
        return { ...r, ignored_lines: ignored };
      },
    },
  ],
};
