// The browser's API client. Every change shows on screen first and is sent
// behind; a refused change is rolled back with a message (see optimistic()).

import { signal } from './signal';

export const mode = signal<string>(localStorageGet('ft.mode') ?? 'personal');
export const signedIn = signal<boolean | null>(null);
export const toast = signal<{ text: string; kind: 'info' | 'error'; action?: { label: string; run: () => void } } | null>(null);
/** Bumped after every change, so open views reload what they show. */
export const version = signal(0);

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
  ) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-FT-Client': 'web', 'X-Mode': mode.value };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  if (res.status === 401) {
    signedIn.value = false;
    throw new HttpError(401, 'Signed out');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new HttpError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
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
  toastTimer = window.setTimeout(() => (toast.value = null), kind === 'error' ? 6000 : 4000);
}

/** Show a change at once, send it, and undo it on screen if the server refuses. */
export async function optimistic<T>(apply: () => () => void, send: () => Promise<T>, done?: string): Promise<T | undefined> {
  const rollback = apply();
  try {
    const out = await send();
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

export async function checkSignedIn() {
  const r = await fetch('/auth/me').then((x) => x.json()).catch(() => ({ signed_in: false }));
  signedIn.value = !!r.signed_in;
}

export async function login(password: string): Promise<string | null> {
  const res = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  if (res.ok) {
    signedIn.value = true;
    return null;
  }
  return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Could not sign in';
}

export async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  signedIn.value = false;
}

export function newId(): string {
  const a = '0123456789abcdefghjkmnpqrstvwxyz';
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => a[b & 31]).join('');
}
