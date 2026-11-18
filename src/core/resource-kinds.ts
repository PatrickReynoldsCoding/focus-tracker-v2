// What a resource is, worked out from its address. Pure functions with no imports, so the
// Worker (which stores the kind) and the web app (which draws the icon and previews the kind
// in the add dialogs) use the same code. Tested in test/resource-kinds.test.ts.

export const RESOURCE_TYPES = ['link', 'drive', 'phone', 'email', 'text'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_KINDS = ['doc', 'sheet', 'slides', 'form', 'drawing', 'folder', 'file', 'pdf', 'image', 'link', 'phone', 'email', 'text'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const KIND_LABELS: Record<ResourceKind, string> = {
  doc: 'Google Doc',
  sheet: 'Google Sheet',
  slides: 'Google Slides',
  form: 'Google Form',
  drawing: 'Google Drawing',
  folder: 'Drive folder',
  file: 'Drive file',
  pdf: 'PDF',
  image: 'Image',
  link: 'Link',
  phone: 'Phone',
  email: 'Email',
  text: 'Text',
};

/** Kinds that are certain from a Google address; a hint from the Picker never overrides them. */
const GOOGLE_KINDS = new Set<ResourceKind>(['doc', 'sheet', 'slides', 'form', 'drawing', 'folder']);

export interface Detected {
  type: ResourceType;
  kind: ResourceKind;
  /** The address with https:// added when it was left off; other values unchanged (trimmed). */
  value: string;
  /** True for any address on a Google Docs / Drive host. */
  google: boolean;
  /** The Drive file id, when the address has one. Used to spot the same file twice. */
  driveId?: string;
}

const SCHEMELESS = /^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#:]|$)/i;

/** Make `docs.google.com/...` into `https://docs.google.com/...`. Returns null when the text is not a web address. */
export function asUrl(raw: string): URL | null {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : SCHEMELESS.test(v) && !v.includes('@') ? `https://${v}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes('.') ? u : null;
  } catch {
    return null;
  }
}

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|heic|bmp|avif)$/i;

/** Detect the kind of a web address that is not necessarily Google's. */
function kindOfUrl(u: URL): { kind: ResourceKind; google: boolean; driveId?: string } {
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  // Strip account selectors: /u/1/..., /a/example.com/..., /drive/u/1/...
  const path = u.pathname.replace(/^\/a\/[^/]+(?=\/)/, '').replace(/\/u\/\d+(?=\/|$)/, '');
  const lp = path.toLowerCase();
  const idIn = (re: RegExp) => path.match(re)?.[1];
  const queryId = u.searchParams.get('id') ?? undefined;

  if (host === 'docs.google.com') {
    const m = lp.match(/^\/(document|spreadsheets|presentation|forms|drawings)(?:\/|$)/);
    if (m) {
      const kind = ({ document: 'doc', spreadsheets: 'sheet', presentation: 'slides', forms: 'form', drawings: 'drawing' } as const)[m[1] as 'document'];
      return { kind, google: true, driveId: idIn(/\/d\/(?:e\/)?([\w-]{10,})/) };
    }
    if (/^\/file\/d\//.test(lp)) return { kind: 'file', google: true, driveId: idIn(/\/d\/([\w-]{10,})/) };
    if (/^\/(open|viewer)(?:\/|$)/.test(lp)) return { kind: 'file', google: true, driveId: queryId };
    return { kind: 'link', google: true };
  }
  if (host === 'forms.gle' || (host === 'goo.gl' && /^\/forms\//.test(lp))) return { kind: 'form', google: true };
  if (host === 'drive.google.com' || host === 'drive.usercontent.google.com') {
    if (/^\/drive\/(?:mobile\/)?folders\//.test(lp)) return { kind: 'folder', google: true, driveId: idIn(/\/folders\/([\w-]{10,})/) };
    if (/^\/folderview/.test(lp)) return { kind: 'folder', google: true, driveId: queryId };
    if (/^\/(?:drive\/)?(?:my-drive|shared-with-me|recent|starred|trash|computers|shared-drives|drives|search)(?:\/|$)/.test(lp) || /^\/drive\/?$/.test(lp)) return { kind: 'folder', google: true };
    if (/^\/file\/d\//.test(lp)) return { kind: 'file', google: true, driveId: idIn(/\/d\/([\w-]{10,})/) };
    if (/^\/(?:open|uc|thumbnail|viewerng|download)(?:\/|$)/.test(lp)) return { kind: 'file', google: true, driveId: queryId };
    if (/^\/drive\//.test(lp)) return { kind: 'folder', google: true };
    return { kind: 'file', google: true };
  }
  if (host.endsWith('.google.com') || host === 'google.com') return { kind: /\.pdf$/i.test(u.pathname) ? 'pdf' : 'link', google: false };
  if (/\.pdf$/i.test(u.pathname)) return { kind: 'pdf', google: false };
  if (IMAGE_EXT.test(u.pathname)) return { kind: 'image', google: false };
  return { kind: 'link', google: false };
}

/**
 * Work out the type and kind of a resource.
 * `type` is what the owner (or Claude) chose; without one it is guessed from the value.
 * `hint` is a kind from somewhere else (the Google Picker knows a file's MIME type): it only
 * decides between file / pdf / image / folder, never over a Google Docs address.
 */
export function detectResource(value: string, type?: string | null, hint?: string | null): Detected {
  const v = value.trim();
  if (type === 'phone' || type === 'email' || type === 'text') return { type, kind: type, value: v, google: false };
  const u = asUrl(v);
  if (!u) {
    if (type === 'link' || type === 'drive') return { type, kind: 'link', value: v, google: false };
    if (/^(?:mailto:)?[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { type: 'email', kind: 'email', value: v.replace(/^mailto:/, ''), google: false };
    if (/^(?:tel:)?\+?[\d][\d\s().-]{5,}$/.test(v)) return { type: 'phone', kind: 'phone', value: v.replace(/^tel:/, ''), google: false };
    return { type: 'text', kind: 'text', value: v, google: false };
  }
  const found = kindOfUrl(u);
  let kind = found.kind;
  if (hint && (RESOURCE_KINDS as readonly string[]).includes(hint) && !GOOGLE_KINDS.has(kind) && ['file', 'pdf', 'image', 'folder'].includes(hint) && found.google) kind = hint as ResourceKind;
  const normalised = /^https?:\/\//i.test(v) ? v : u.toString().replace(/\/$/, v.endsWith('/') ? '/' : '');
  return {
    type: found.google ? 'drive' : type === 'drive' ? 'drive' : 'link',
    kind,
    value: normalised,
    google: found.google,
    driveId: found.driveId,
  };
}

/** A short title guessed from the address alone, such as "Google Sheet" or "github.com/owner/repo". */
export function guessTitle(value: string, kind?: ResourceKind): string {
  const d = detectResource(value);
  const k = kind ?? d.kind;
  if (d.google && k !== 'link') return KIND_LABELS[k];
  const u = asUrl(value);
  if (!u) return value.trim().slice(0, 60);
  const host = u.hostname.replace(/^www\./, '');
  const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
  if ((k === 'pdf' || k === 'image') && last) return last;
  const path = u.pathname.replace(/\/$/, '');
  const short = host + (path.length > 1 ? path : '');
  return short.length > 50 ? short.slice(0, 49) + '…' : short;
}

/** Two resources are the same when they point at the same Drive file, or have the same address. */
export function sameKey(value: string): string {
  const d = detectResource(value);
  return d.driveId ? `drive:${d.driveId}` : d.value.toLowerCase().replace(/\/$/, '');
}

export interface ParsedLine {
  value: string;
  title: string;
  /** The title was guessed from the address, not written next to it. */
  guessed: boolean;
  type: ResourceType;
  kind: ResourceKind;
}

const URL_IN_TEXT = /(?:https?:\/\/|(?<![\w@./-])(?:docs|drive|forms|sheets|script|sites)\.google\.com\/|(?<![\w@./-])forms\.gle\/)[^\s<>"'`)\]]+/gi;

/**
 * Read pasted text with one or many addresses: a bare list, "Title - address" lines, Markdown
 * links, a title on one line and its address on the next, or addresses separated by spaces.
 */
export function parseResourceText(text: string): { items: ParsedLine[]; ignored: number } {
  const items: ParsedLine[] = [];
  let ignored = 0;
  let pending = '';
  const clean = (s: string) =>
    s
      .replace(/^\s*(?:[-*•>]+|\d+[.)])\s+/, '')
      .replace(/^[\s\-–—:|,;]+|[\s\-–—:|,;]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      pending = '';
      continue;
    }
    const urls = [...line.matchAll(URL_IN_TEXT)].map((m) => m[0].replace(/[.,;]+$/, ''));
    if (!urls.length) {
      pending = clean(line.replace(/^#+\s*/, ''));
      if (!pending) ignored++;
      continue;
    }
    // Markdown [Title](url): the title is the bracket text.
    let rest = line;
    for (const u of urls) rest = rest.replace(u, ' ');
    rest = rest.replace(/\[([^\]]*)\]\(\s*\)/g, '$1');
    let title = clean(rest.replace(/[()[\]]/g, ' '));
    if (!title && urls.length === 1 && pending) title = pending;
    pending = '';
    for (const u of urls) {
      const d = detectResource(u, 'link');
      items.push({ value: d.value, title: urls.length === 1 ? title : '', guessed: !(urls.length === 1 && title), type: d.type, kind: d.kind });
    }
  }
  // Fill in guessed titles; the second "Google Doc" becomes "Google Doc 2".
  const seen = new Map<string, number>();
  for (const it of items) {
    if (!it.title) it.title = guessTitle(it.value, it.kind);
    if (it.guessed) {
      const n = (seen.get(it.title) ?? 0) + 1;
      seen.set(it.title, n);
      if (n > 1) it.title = `${it.title} ${n}`;
    }
  }
  return { items, ignored };
}
