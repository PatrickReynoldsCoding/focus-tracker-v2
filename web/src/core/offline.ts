// Offline use (V1-GAPS item 45, DECISIONS D27). api.ts calls in here, so features need not know:
// - Saved copies: every GET answer a screen uses is kept on this device (IndexedDB, else memory),
//   per mode, and shown at once next time (useData in ui.tsx), also with no signal.
// - The queue: a change that is safe to send later (see QUEUE_RULES) and is made while offline, or
//   fails with a network error, waits here (it survives a reload) and is sent in order when the
//   connection returns. A PATCH carries the updated_at it was based on (base_updated_at); the
//   server answers 409 when the same fields changed since, and the newer version stays.
// Everything else says plainly that it needs a connection. Flag: 'offline' (features/offline).

import { signal } from './signal';

// ---------- switched by the 'offline' flag (features/offline keeps this in step) ----------

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

let on = lsGet('ft.offline') !== '0';
export const enabled = () => on;
export function setEnabled(v: boolean) {
  if (v === on) return;
  on = v;
  lsSet('ft.offline', v ? null : '0');
  if (!v) clearCopies();
}

// ---------- storage: IndexedDB, else memory ----------

/** Bump when the shape of saved copies or of the queue changes: older ones are dropped. */
const SCHEMA = 1;
const STORE = 'kv';
const memory = new Map<string, unknown>();
let dbp: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  return (dbp ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const r = indexedDB.open('focus-tracker', 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then(async (d) => {
    if (d && (await idb(d, 'readonly', (s) => s.get('schema'))) !== SCHEMA) {
      await idb(d, 'readwrite', (s) => s.clear());
      await idb(d, 'readwrite', (s) => s.put(SCHEMA, 'schema'));
    }
    return d;
  }));
}

function idb<T>(d: IDBDatabase, how: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const r = op(d.transaction(STORE, how).objectStore(STORE));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return d ? idb<T>(d, 'readonly', (s) => s.get(key)) : (memory.get(key) as T | undefined);
}
async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  if (!d) memory.set(key, value);
  else if ((await idb(d, 'readwrite', (s) => s.put(value, key))) === undefined) memory.set(key, value); // full or refused
}
async function kvDelPrefix(prefix: string): Promise<void> {
  for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k);
  const d = await db();
  if (d) await idb(d, 'readwrite', (s) => s.delete(IDBKeyRange.bound(prefix, prefix + '￿')));
}

// ---------- status (the header's "Offline · 2 waiting") ----------

export interface NetStatus {
  /** The last request reached the server. */
  online: boolean;
  /** Changes waiting to be sent. */
  waiting: number;
  sending: boolean;
  /** The oldest saved copy shown while offline (ms), or null. */
  copyAt: number | null;
  /** Screens showing a saved copy while the fresh one loads. */
  updating: number;
}
export const status = signal<NetStatus>({ online: typeof navigator === 'undefined' || navigator.onLine !== false, waiting: 0, sending: false, copyAt: null, updating: 0 });
const set = (p: Partial<NetStatus>) => {
  const next = { ...status.value, ...p };
  if ((Object.keys(p) as (keyof NetStatus)[]).some((k) => next[k] !== status.value[k])) status.value = next;
};

export function wentOffline() {
  set({ online: false });
}
export function cameOnline() {
  const was = status.value.online;
  set({ online: true, copyAt: null });
  if (!was && queue.length) flushSoon(0);
}
/** A saved copy was shown because there is no connection. */
export function servedCopy(at: number) {
  set({ online: false, copyAt: Math.min(status.value.copyAt ?? at, at) });
}
export function updating(delta: 1 | -1) {
  set({ updating: Math.max(0, status.value.updating + delta) });
}
/** Whether the browser itself says there is no connection. */
export const browserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// ---------- saved copies of GET answers ----------

export interface Copy {
  data: unknown;
  /** When it came from the server (ms). */
  at: number;
}

/** Answers that are not worth keeping: live state (a stale timer would mislead), secrets' lists, searches. */
const NO_COPY = /^\/(session|status|notifications|today-panels\/banners|swiftbar|tokens|connections|search|links\/search|resources\/picker|schema|undo|redo)(\/|\?|$)/;
export const savable = (path: string) => on && !NO_COPY.test(path) && !/^\/files\?.*\bq=/.test(path);

const copies = new Map<string, Copy>();
const ckey = (mode: string, path: string) => `copy:${mode}:${path}`;
const writes = new Map<string, number>();

export async function readCopy(mode: string, path: string): Promise<Copy | null> {
  if (!savable(path)) return null;
  const k = ckey(mode, path);
  let c = copies.get(k);
  if (!c) {
    c = await kvGet<Copy>(k);
    if (!c || typeof c.at !== 'number') return null;
    if (!copies.has(k)) copies.set(k, c);
    c = copies.get(k)!;
    learn(c.data);
  }
  return c;
}

/** Keep `data` as the copy of `path` (from the server: at = now; from the screen: keeps the copy's time). */
export function saveCopy(mode: string, path: string, data: unknown, at?: number) {
  if (!savable(path) || data === undefined) return;
  const k = ckey(mode, path);
  const c = { data, at: at ?? copies.get(k)?.at ?? Date.now() };
  copies.set(k, c);
  clearTimeout(writes.get(k));
  writes.set(
    k,
    window.setTimeout(() => {
      writes.delete(k);
      kvSet(k, copies.get(k));
    }, 250),
  );
}

export function clearCopies() {
  copies.clear();
  for (const t of writes.values()) clearTimeout(t);
  writes.clear();
  kvDelPrefix('copy:');
}

// ---------- what rows looked like (for base_updated_at and for messages) ----------

const versions = new Map<string, { at?: string; name?: string }>();

/** Note the updated_at and name of every row in an answer. */
export function learn(data: unknown, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 6) return;
  if (Array.isArray(data)) {
    for (const x of data) learn(x, depth + 1);
    return;
  }
  const o = data as Record<string, unknown>;
  if (typeof o.id === 'string') {
    const v = versions.get(o.id) ?? {};
    if (typeof o.updated_at === 'string' && (!v.at || o.updated_at > v.at)) v.at = o.updated_at;
    const name = [o.title, o.name, o.label, o.text].find((x) => typeof x === 'string' && x.trim());
    if (name) v.name = String(name).trim().slice(0, 60);
    versions.set(o.id, v);
  }
  for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && k !== 'scene') learn(v, depth + 1);
}

// ---------- which changes may wait ----------

/** Kinds whose rows can be changed offline with the generic routes. */
const KINDS = 'tasks|todos|columns|lists|criteria|stickies|habits|resources|projects|whiteboards|categories|backlog|log|links|folders';
const QUEUE_RULES: [method: string, path: RegExp][] = [
  // field edits (sent with base_updated_at)
  ['PATCH', new RegExp(`^/(${KINDS})/[\\w-]+$`)],
  // moves, ticks and habit check-ins
  ['POST', new RegExp(`^/(${KINDS})/[\\w-]+/move$`)],
  ['POST', /^\/(todos|tasks)\/[\w-]+\/tick$/],
  ['POST', /^\/habits\/[\w-]+\/(check|not-today)$/],
  // moving files between folders (Files tab)
  ['POST', /^\/files\/move$/],
  // note saves (the editor sends its base)
  ['PUT', /^\/notes\/of\/(project|list)\/[\w-]+$/],
  // page layouts (the whole layout each time, so the last one wins)
  ['PUT', /^\/layout\/[\w-]+\/(grid|pills|view|grids\/[\w-]+)$/],
  // deletes of small rows (not projects, lists, columns, boards or habits: big cascades)
  ['DELETE', /^\/(tasks|todos|criteria|stickies|resources|links|log|backlog)\/[\w-]+$/],
];
const CREATE = new RegExp(`^/(${KINDS})$`);

/** Whether a change can wait in the queue. A create needs the id made on this device. */
export function queueable(method: string, path: string, body: unknown): boolean {
  if (method === 'POST' && CREATE.test(path)) return typeof (body as { id?: unknown } | undefined)?.id === 'string';
  return QUEUE_RULES.some(([m, re]) => m === method && re.test(path));
}

/** What to say when a change cannot wait. */
export function refusal(path: string): string {
  if (/^\/session/.test(path)) return 'You are offline. Sessions need a connection: the timer runs on the server so every device agrees.';
  return 'You are offline, and this change needs a connection. Try again when you are back online.';
}

// ---------- the queue ----------

export interface Entry {
  id: string;
  mode: string;
  method: string;
  path: string;
  body?: Record<string, unknown>;
  /** When it was made (ms). */
  at: number;
  /** "the card “Buy milk”", for messages. */
  label: string;
  tries?: number;
}

let queue: Entry[] = [];
const loaded = kvGet<Entry[]>('queue').then((q) => {
  queue = Array.isArray(q) ? [...q, ...queue] : queue;
  set({ waiting: queue.length });
  if (queue.length) flushSoon(500);
});
const persist = () => kvSet('queue', queue);

export const waiting = () => queue.length;
export const pending = (): readonly Entry[] => queue;

const WORDS: Record<string, string> = {
  tasks: 'card',
  todos: 'to-do',
  columns: 'column',
  lists: 'list',
  criteria: 'checklist item',
  stickies: 'sticky note',
  habits: 'habit',
  resources: 'link',
  projects: 'project',
  whiteboards: 'whiteboard',
  categories: 'category',
  backlog: 'idea',
  log: 'log entry',
  links: 'link',
};

function describe(method: string, path: string, body?: Record<string, unknown>): string {
  const [, kind, id, , owner] = path.split('/');
  if (kind === 'notes') return `the note${versions.get(owner)?.name ? ` of “${versions.get(owner)!.name}”` : ''}`;
  const word = WORDS[kind] ?? 'item';
  const name = (id && versions.get(id)?.name) ?? [body?.title, body?.name, body?.text, body?.label].find((x) => typeof x === 'string' && x.trim());
  const what = name ? `the ${word} “${String(name).trim().slice(0, 60)}”` : `a ${word}`;
  if (method === 'POST' && !id) return `new ${what.replace(/^(the|a) /, '')}`;
  if (method === 'DELETE') return `deleting ${what}`;
  return what;
}

/** Keep a change to send later. The answer stands in for the server's: the body, marked queued. */
export async function enqueue(mode: string, method: string, path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  await loaded;
  let b = body ? { ...body } : undefined;
  const id = path.split('/')[2];
  if (method === 'PATCH' && b && b.base_updated_at === undefined && id) {
    const at = versions.get(id)?.at;
    if (at) b.base_updated_at = at;
  }
  const last = queue[queue.length - 1];
  // Changes to the same row one after another become one (the first one's base is kept).
  if (last && last.mode === mode && last.method === method && last.path === path && (method === 'PATCH' || method === 'PUT') && last.body && b) {
    last.body = method === 'PATCH' ? { ...last.body, ...b, base_updated_at: last.body.base_updated_at } : { ...b, ...('base' in last.body ? { base: last.body.base } : {}) };
    last.at = Date.now();
  } else {
    queue.push({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, mode, method, path, body: b, at: Date.now(), label: describe(method, path, b) });
  }
  set({ waiting: queue.length });
  await persist();
  // A saved copy of the same address (a note, a card) shows the change too.
  if ((method === 'PATCH' || method === 'PUT') && b) {
    const c = await readCopy(mode, path);
    if (c && c.data && typeof c.data === 'object' && !Array.isArray(c.data)) {
      const { base, base_updated_at, ...fields } = b;
      saveCopy(mode, path, { ...(c.data as object), ...fields });
    }
  }
  if (!browserOffline()) flushSoon(5000);
  return { ...(b ?? {}), queued: true };
}

/** The latest waiting body sent to `path` (a note saved offline shows it), or undefined. */
export function queuedBody(mode: string, path: string): Record<string, unknown> | undefined {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].path === path && queue[i].mode === mode && queue[i].body) return queue[i].body;
  return undefined;
}

export const isQueued = (x: unknown): boolean => !!x && typeof x === 'object' && (x as { queued?: unknown }).queued === true;

/** Drop every waiting change (Settings → Offline, when something cannot be sent). */
export async function discardQueue() {
  queue = [];
  set({ waiting: 0 });
  await persist();
}

// ---------- sending ----------

/** A conflict on a replayed change can be handled by a feature (the note editor offers its choice). Return a message, or null to pass. */
export type ConflictHandler = (entry: Entry, answer: { current?: any; fields?: string[] }) => string | null;
const conflictHandlers: ConflictHandler[] = [];
export const registerConflictHandler = (h: ConflictHandler) => conflictHandlers.push(h);

/** Set by api.ts: how to send, and what to do afterwards. */
export const hooks = {
  send: async (_method: string, _path: string, _body: unknown, _mode: string): Promise<Response> => {
    throw new Error('not ready');
  },
  done: (_sent: number, _problems: string[]) => {},
  signedOut: () => {},
};

/** What went wrong with sent changes, newest first (shown in Settings → Offline). */
export const problems = signal<{ at: number; text: string }[]>([]);
kvGet<{ at: number; text: string }[]>('problems').then((p) => Array.isArray(p) && (problems.value = [...problems.value, ...p].slice(0, 20)));

let flushing = false;
let timer: number | undefined;
export function flushSoon(ms = 0) {
  clearTimeout(timer);
  timer = window.setTimeout(() => flush(), ms);
}

const rowKey = (e: Entry) => {
  const p = e.path.split('/');
  return p[1] === 'notes' ? p.slice(1, 5).join('/') : p.slice(1, 3).join('/');
};

/** Send the waiting changes, oldest first. Stops at the first network error (and tries again later). */
export async function flush(): Promise<void> {
  await loaded;
  if (flushing || !queue.length) return;
  flushing = true;
  set({ sending: true });
  let sent = 0;
  const found: string[] = [];
  // The version each row has after a change sent in this round, so the next change to it builds on it.
  const chain = new Map<string, string>();
  try {
    while (queue.length) {
      const e = queue[0];
      const key = rowKey(e);
      let body = e.body;
      if (body && chain.has(key)) {
        if (typeof body.base_updated_at === 'string') body = { ...body, base_updated_at: chain.get(key) };
        if ('base' in body) body = { ...body, base: chain.get(key) };
      }
      let res: Response;
      try {
        res = await hooks.send(e.method, e.path, body, e.mode);
      } catch {
        wentOffline();
        break;
      }
      cameOnline();
      if (res.status === 401) {
        hooks.signedOut();
        break;
      }
      const data = await res.json().catch(() => null);
      if (res.ok) {
        sent++;
        learn(data);
        const checked = typeof body?.base_updated_at === 'string' || (body && 'base' in body);
        if (checked && typeof data?.updated_at === 'string') chain.set(key, data.updated_at);
      } else if (res.status === 409) {
        const own = conflictHandlers.map((h) => h(e, data ?? {})).find((m) => m);
        found.push(own ?? `Not applied: your change to ${e.label}. It was changed on another device since, so the newer version is kept.`);
      } else if (res.status === 400 && e.method === 'POST' && /already exists/.test(String(data?.error))) {
        sent++; // sent before, but the answer was lost
      } else if (res.status >= 500 && (e.tries ?? 0) < 2) {
        e.tries = (e.tries ?? 0) + 1;
        await persist();
        flushSoon(30_000);
        break;
      } else if (res.status === 404) {
        found.push(`Not saved: ${e.label}. It was deleted on another device.`);
      } else {
        found.push(`Not saved: ${e.label}. ${String(data?.error ?? `The server said ${res.status}`)}`);
      }
      queue.shift();
      set({ waiting: queue.length });
      await persist();
    }
  } finally {
    flushing = false;
    set({ sending: false, waiting: queue.length });
  }
  if (found.length) {
    problems.value = [...found.map((text) => ({ at: Date.now(), text })), ...problems.value].slice(0, 20);
    kvSet('problems', problems.value);
  }
  if (sent || found.length) hooks.done(sent, found);
}

export function clearProblems() {
  problems.value = [];
  kvSet('problems', []);
}

// Try again when the connection returns, when the app comes back to the front, and every 20 s while changes wait.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushSoon(0));
  window.addEventListener('offline', () => wentOffline());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && queue.length && flushSoon(0));
  window.setInterval(() => queue.length && !flushing && !browserOffline() && flush(), 20_000);
}
