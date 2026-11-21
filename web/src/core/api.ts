// The browser's API client. Every change shows on screen first and is sent
// behind; a refused change is rolled back with a message (see optimistic()).
// Offline (core/offline.ts): GET answers are kept as saved copies and shown when there is no
// connection; a change that can wait is queued and sent when the connection returns.

import * as offline from './offline';
import { signal } from './signal';

export const mode = signal<string>(localStorageGet('ft.mode') ?? 'personal');
export const signedIn = signal<boolean | null>(null);
export const toast = signal<{ text: string; kind: 'info' | 'error'; action?: { label: string; run: () => void } } | null>(null);
/** Bumped after every change, so open views reload what they show. */
export const version = signal(0);

/** Saving indicator: how many changes are in flight, and how the last one ended. */
export const saving = signal<{ pending: number; last: 'none' | 'saved' | 'error' }>({ pending: 0, last: 'none' });
let savedTimer: number | undefined;
function savingStep(delta: 1 | 0, failed = false) {
  const pending = saving.value.pending + (delta === 1 ? 1 : -1);
  const last = delta === 1 ? saving.value.last : failed ? 'error' : saving.value.last === 'error' && pending > 0 ? 'error' : 'saved';
  saving.value = { pending, last };
  clearTimeout(savedTimer);
  if (pending === 0 && last === 'saved') savedTimer = window.setTimeout(() => (saving.value = { pending: 0, last: 'none' }), 3000);
}

function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
export function localStorageSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The server's JSON answer (a 409 carries the current row). */
    public data?: any,
  ) {
    super(message);
  }
}

/** The profile this device had open was deleted (on another device): open the default one. */
let leaving = false;
async function leaveMissingProfile(): Promise<void> {
  if (leaving) return;
  leaving = true;
  try {
    // No X-Mode: the server answers for the default profile.
    const res = await fetch('/api/profiles', { headers: { 'X-FT-Client': 'web' }, credentials: 'same-origin' });
    const data = res.ok ? ((await res.json()) as { default: string; profiles: { id: string; label: string }[] }) : null;
    if (data && !data.profiles.some((p) => p.id === mode.value)) {
      const next = data.profiles.find((p) => p.id === data.default) ?? data.profiles[0];
      if (next) {
        mode.value = next.id;
        localStorageSet('ft.mode', next.id);
        say(`That profile is gone. Now in ${next.label}.`);
      }
    }
  } catch {
    /* offline: try again on the next answer */
  } finally {
    leaving = false;
  }
}

/** One request to the API, as it is: throws only on a network error. */
function send(method: string, path: string, body: unknown, m: string, keepalive = false): Promise<Response> {
  const headers: Record<string, string> = { 'X-FT-Client': 'web', 'X-Mode': m };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', keepalive });
}

async function answer<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    signedOut();
    throw new HttpError(401, 'Signed out');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new HttpError(res.status, 'The server sent something unexpected');
  }
  if (!res.ok) {
    if (data?.code === 'unknown_mode') void leaveMissingProfile();
    throw new HttpError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  }
  offline.learn(data);
  return data as T;
}

/** A GET: from the server, kept as a saved copy; the saved copy when offline or while changes wait to be sent. */
async function read<T>(path: string, m: string = mode.value): Promise<T> {
  const off = offline.enabled();
  if (off && (offline.waiting() > 0 || offline.browserOffline())) {
    // Waiting changes are in the saved copy (the screens keep it up to date), not yet on the server.
    const c = await offline.readCopy(m, path);
    if (c) {
      if (offline.browserOffline()) offline.servedCopy(c.at);
      return c.data as T;
    }
  }
  let res: Response;
  try {
    res = await send('GET', path, undefined, m);
  } catch {
    offline.wentOffline();
    const c = off ? await offline.readCopy(m, path) : null;
    if (c) {
      offline.servedCopy(c.at);
      return c.data as T;
    }
    throw new HttpError(0, off && offline.savable(path) ? 'You are offline, and this page is not saved on this device yet.' : 'You are offline.');
  }
  offline.cameOnline();
  const data = await answer<T>(res);
  if (off) offline.saveCopy(m, path, data, Date.now());
  return data;
}

/** A change: sent now, or kept in the offline queue when it can wait (offline.queueable). */
async function write<T>(method: string, path: string, body: unknown, keepalive: boolean): Promise<T> {
  const m = mode.value;
  const off = offline.enabled();
  const canWait = off && offline.queueable(method, path, body);
  if (canWait && (offline.waiting() > 0 || offline.browserOffline())) return offline.enqueue(m, method, path, body as Record<string, unknown>) as Promise<T>;
  if (off && offline.browserOffline()) throw new HttpError(0, offline.refusal(path));
  savingStep(1);
  let res: Response;
  try {
    res = await send(method, path, body, m, keepalive);
  } catch {
    savingStep(0, !canWait);
    offline.wentOffline();
    if (canWait) return offline.enqueue(m, method, path, body as Record<string, unknown>) as Promise<T>;
    throw new HttpError(0, off ? offline.refusal(path) : 'You are offline: not saved.');
  }
  offline.cameOnline();
  savingStep(0, !res.ok);
  return answer<T>(res);
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { keepalive?: boolean; mode?: string } = {}): Promise<T> {
  return method === 'GET' ? read<T>(path, opts.mode) : write<T>(method, path, body, !!opts.keepalive);
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const patch = <T = any>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const put = <T = any>(p: string, b: unknown) => api<T>('PUT', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

let toastTimer: number | undefined;
export function say(text: string, kind: 'info' | 'error' = 'info', action?: { label: string; run: () => void }) {
  toast.value = { text, kind, action };
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = null), kind === 'error' ? Math.max(6000, text.length * 60) : 4000);
}

/** Show a change at once, send it, and undo it on screen if the server refuses. */
export async function optimistic<T>(apply: () => () => void, send: () => Promise<T>, done?: string): Promise<T | undefined> {
  const rollback = apply();
  try {
    const out = await send();
    if (offline.isQueued(out)) {
      // Kept on this device: the screen already shows it, and nothing new came from the server.
      if (done) say(`${done}. It will be sent when you are back online.`);
      return out;
    }
    version.value++;
    if (done) say(done, 'info', { label: 'Undo', run: undo });
    return out;
  } catch (err) {
    rollback();
    if (!(err instanceof HttpError && err.status === 401)) say(`Not saved: ${(err as Error).message}`, 'error');
    return undefined;
  }
}

/** Send a change and reload views when it lands. */
export async function change<T>(send: () => Promise<T>, done?: string): Promise<T | undefined> {
  return optimistic(() => () => {}, send, done);
}

export async function undo() {
  try {
    const r = await post<{ label: string | null; changes: number }>('/undo');
    version.value++;
    say(r.changes ? `Undone: ${r.label}` : 'Nothing to undo');
  } catch (err) {
    say((err as Error).message, 'error');
  }
}

export async function redo() {
  try {
    const r = await post<{ label: string | null; changes: number }>('/redo');
    version.value++;
    say(r.changes ? `Redone: ${r.label}` : 'Nothing to redo');
  } catch (err) {
    say((err as Error).message, 'error');
  }
}

/** Signed in on this device (remembered so the app can open offline). */
function signedOut() {
  signedIn.value = false;
  localStorageSet('ft.signed', '');
}
function signedInNow() {
  signedIn.value = true;
  localStorageSet('ft.signed', '1');
  if (offline.waiting()) offline.flushSoon(0);
}

export async function checkSignedIn() {
  let res: Response;
  try {
    res = await fetch('/auth/me');
  } catch {
    // No connection: trust this device's last answer, so the saved copies can show.
    offline.wentOffline();
    signedIn.value = offline.enabled() && localStorageGet('ft.signed') === '1';
    return;
  }
  const r = (await res.json().catch(() => ({ signed_in: false }))) as { signed_in?: boolean };
  if (r.signed_in) signedInNow();
  else signedOut();
}

export async function login(password: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  } catch {
    return 'You are offline. Signing in needs a connection.';
  }
  if (res.ok) {
    signedInNow();
    return null;
  }
  return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Could not sign in';
}

export async function logout() {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  offline.clearCopies(); // the saved copies hold your data: not kept after signing out
  signedOut();
}

// The offline queue sends with the same request, and reports back here.
offline.hooks.send = (method, path, body, m) => send(method, path, body, m);
offline.hooks.signedOut = signedOut;
offline.hooks.done = (sent, problems) => {
  version.value++; // screens load the server's state
  const n = `${sent} change${sent === 1 ? '' : 's'} sent`;
  if (!problems.length) say(`Back online: ${n}.`);
  else say(`${sent ? `Back online: ${n}. ` : ''}${problems[0]}${problems.length > 1 ? ` (${problems.length - 1} more in Settings → Offline.)` : ''}`, 'error');
};

export function newId(): string {
  const a = '0123456789abcdefghjkmnpqrstvwxyz';
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => a[b & 31]).join('');
}
