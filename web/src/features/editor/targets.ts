// Where an edited text is read from and saved to. Each save sends the version the edit was
// based on; a target throws Conflict when the text changed somewhere else since.
import { mode, signedIn } from '../../core/api';

export interface Target {
  /** For drafts and remembered heights: 'note:project:<id>', 'card:<id>' … */
  key?: string;
  /** Kind of place, for the remembered height. */
  place: string;
  read(): Promise<{ text: string; version: string | null }>;
  /** Save `text` over `base` (the version it started from). `keepalive` when the page is closing. */
  write(text: string, base: string | null, keepalive?: boolean): Promise<{ version: string | null }>;
  /** Whether a conflict can be noticed at all (not for a plain onSave). */
  versioned: boolean;
}

export class Conflict extends Error {
  constructor(
    public text: string,
    public version: string | null,
  ) {
    super('Changed somewhere else');
  }
}

async function send(method: string, path: string, body?: unknown, keepalive = false): Promise<{ status: number; data: any }> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'X-FT-Client': 'web', 'X-Mode': mode.value, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    keepalive,
  });
  if (res.status === 401) signedIn.value = false;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok && res.status !== 409) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return { status: res.status, data };
}

/** A project's notes or a note list's text, with server-side conflict checks (409). */
export function noteTarget(kind: 'project' | 'list', id: string): Target {
  const path = `/notes/of/${kind}/${id}`;
  return {
    key: `note:${kind}:${id}`,
    place: kind,
    versioned: true,
    async read() {
      const { data } = await send('GET', path);
      return { text: String(data.body ?? ''), version: data.updated_at ?? null };
    },
    async write(text, base, keepalive) {
      const { status, data } = await send('PUT', path, { body: text, base }, keepalive);
      if (status === 409) throw new Conflict(String(data.current?.body ?? ''), data.current?.updated_at ?? null);
      return { version: data.updated_at ?? null };
    },
  };
}

/** A card's note (tasks.note). The check is made here: read, compare, then write. */
export function cardTarget(id: string, onSaved: (note: string) => void): Target {
  const path = `/tasks/${id}`;
  return {
    key: `card:${id}`,
    place: 'card',
    versioned: true,
    async read() {
      const { data } = await send('GET', path);
      return { text: String(data.note ?? ''), version: data.updated_at ?? null };
    },
    async write(text, base, keepalive) {
      if (!keepalive) {
        const { data: now } = await send('GET', path);
        if (base !== null && now.updated_at !== base && String(now.note ?? '') !== text) throw new Conflict(String(now.note ?? ''), now.updated_at ?? null);
      }
      const { data } = await send('PATCH', path, { note: text }, keepalive);
      onSaved(text);
      return { version: data?.updated_at ?? null };
    },
  };
}

/** Anything else: just the caller's onSave, no conflict check. */
export function plainTarget(value: () => string, onSave: (v: string) => unknown, key?: string): Target {
  return {
    key,
    place: 'other',
    versioned: false,
    read: async () => ({ text: value(), version: null }),
    async write(text) {
      await onSave(text);
      return { version: null };
    },
  };
}
