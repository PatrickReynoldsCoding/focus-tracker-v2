// Where an edited text is read from and saved to. Each save sends the version the edit was
// based on; a target throws Conflict when the text changed somewhere else since.
import { api, HttpError } from '../../core/api';
import { isQueued } from '../../core/offline';

export interface Target {
  /** For drafts and remembered heights: 'note:project:<id>', 'card:<id>' … */
  key?: string;
  /** Kind of place, for the remembered height. */
  place: string;
  read(): Promise<{ text: string; version: string | null }>;
  /** Save `text` over `base` (the version it started from; null: a new text; undefined: unknown, not checked). `keepalive` when the page is closing. */
  write(text: string, base: string | null | undefined, keepalive?: boolean): Promise<{ version: string | null | undefined }>;
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

/** Through the app's API client, so a save made offline waits in the offline queue (core/offline.ts). */
async function send(method: string, path: string, body?: unknown, keepalive = false): Promise<{ status: number; data: any }> {
  try {
    return { status: 200, data: await api(method, path, body, { keepalive }) };
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) return { status: 409, data: e.data };
    throw e;
  }
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
      const { status, data } = await send('PUT', path, base === undefined ? { body: text } : { body: text, base }, keepalive);
      if (status === 409) throw new Conflict(String(data.current?.body ?? ''), data.current?.updated_at ?? null);
      // Waiting offline: still based on the same version (the queue sends that base).
      return { version: isQueued(data) ? base : (data.updated_at ?? null) };
    },
  };
}

/** A card's note (tasks.note). The server checks the version (base_updated_at), also for a save that waited offline. */
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
      const { status, data } = await send('PATCH', path, base == null ? { note: text } : { note: text, base_updated_at: base }, keepalive);
      if (status === 409) throw new Conflict(String(data.current?.note ?? ''), data.current?.updated_at ?? null);
      onSaved(text);
      return { version: isQueued(data) ? base : (data?.updated_at ?? null) };
    },
  };
}

/** A habit's notes (habits.notes, D56). As a card's note: the server checks base_updated_at, also offline. */
export function habitTarget(id: string, onSaved: (notes: string) => void): Target {
  const path = `/habits/${id}`;
  return {
    key: `habit:${id}`,
    place: 'habit',
    versioned: true,
    async read() {
      const { data } = await send('GET', path);
      return { text: String(data.notes ?? ''), version: data.updated_at ?? null };
    },
    async write(text, base, keepalive) {
      const { status, data } = await send('PATCH', path, base == null ? { notes: text } : { notes: text, base_updated_at: base }, keepalive);
      if (status === 409) throw new Conflict(String(data.current?.notes ?? ''), data.current?.updated_at ?? null);
      onSaved(text);
      return { version: isQueued(data) ? base : (data?.updated_at ?? null) };
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
