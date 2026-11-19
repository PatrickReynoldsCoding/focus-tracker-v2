// A board open full screen (route /w/<id>). Excalidraw is loaded on demand (./host). The drawing
// reopens where it was left (the view's scroll and zoom are saved with it). It saves by itself a
// moment after each change, and when you leave; "Close without saving" puts back the drawing as it
// was when the board opened, also when an autosave already wrote it.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, get, HttpError, mode, put, version } from '../../core/api';
import type { Board as Host } from './host';
import { favouriteTool, leaveBoard, MAX_SCENE_BYTES } from './model';

const AUTOSAVE_MS = 1500;
/** Make a new preview at most this often while drawing (and always on Save and close). */
const THUMB_EVERY_MS = 20_000;
/** fetch(..., { keepalive }) bodies must stay under 64 KB. */
const KEEPALIVE_MAX = 60_000;

type Loaded = { id: string; name: string; updated_at: string; scene: any };
type Status = { kind: 'idle' | 'saving' | 'saved' | 'error' | 'too-big'; text?: string };

const bytes = (s: string) => new TextEncoder().encode(s).length;
const mbText = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;
const EMPTY = { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} };

let hostModule: Promise<typeof import('./host')> | null = null;
function loadHost() {
  // Excalidraw's fonts come from this site (copied there at build time, see web/vite.config.ts).
  (window as any).EXCALIDRAW_ASSET_PATH = ['/excalidraw/'];
  hostModule ??= import('./host').catch((e) => {
    hostModule = null;
    throw e;
  });
  return hostModule;
}

export function BoardEditor({ id }: { id: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const canvas = useRef<HTMLDivElement>(null);
  const s = useRef({
    host: null as Host | null,
    opened: null as any, // the drawing as it was when the board opened
    openedContent: -1,
    savedContent: -1, // what is stored now
    savedView: '',
    hadThumb: true,
    openedThumb: undefined as string | null | undefined, // the preview when the board opened
    thumbAt: 0,
    thumbContent: -1, // the content the stored preview shows
    wrote: false, // a save changed the stored drawing since the board opened
    timer: undefined as number | undefined,
    inFlight: null as Promise<boolean> | null,
    closing: false,
    discarded: false,
  }).current;

  // Load the drawing (lists never carry drawings).
  useEffect(() => {
    let live = true;
    get<Loaded>(`/whiteboards/${id}/scene`)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && !(e instanceof HttpError && e.status === 401) && setError(e.message));
    get<{ thumbnail: string | null }>(`/whiteboards/${id}`)
      .then((b) => {
        s.hadThumb = !!b.thumbnail;
        s.openedThumb = b.thumbnail;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);

  // Full screen: the page under the board does not scroll.
  useEffect(() => {
    document.documentElement.classList.add('wb-open');
    return () => document.documentElement.classList.remove('wb-open');
  }, []);

  /** Save what changed. `thumbnail`: also make a preview if the drawing changed since the last one.
   *  Returns false when it could not be saved (too big, refused, offline). */
  async function save(opts: { thumbnail?: boolean; keepalive?: boolean } = {}): Promise<boolean> {
    const host = s.host;
    if (!host || s.discarded) return true;
    clearTimeout(s.timer);
    if (s.inFlight && !opts.keepalive) await s.inFlight;
    const { content, view } = host.key();
    const needThumb = !!opts.thumbnail && !opts.keepalive && (content !== s.thumbContent || !s.hadThumb);
    const sceneChanged = content !== s.savedContent || view !== s.savedView;
    if (!sceneChanged && !needThumb) return true;
    const run = async () => {
      let thumbnail: string | null | undefined;
      const { scene, empty } = host.scene();
      if (needThumb) thumbnail = empty ? null : await host.thumbnail().catch(() => undefined);
      setStatus({ kind: 'saving' });
      try {
        if (!sceneChanged) {
          // Only the preview is missing (a board opened and closed unchanged): it does not count as a change.
          if (thumbnail !== undefined) await api('PUT', `/whiteboards/${id}/thumbnail`, { thumbnail });
        } else {
          const text = JSON.stringify(scene);
          const size = bytes(text);
          if (size > MAX_SCENE_BYTES) {
            setStatus({ kind: 'too-big', text: `Too big to save (${mbText(size)}; the limit is ${mbText(MAX_SCENE_BYTES)}). Remove some images or drawings.` });
            return false;
          }
          const body = { scene, view_only: content === s.savedContent, ...(thumbnail !== undefined ? { thumbnail } : {}) };
          const raw = JSON.stringify(body);
          if (opts.keepalive) {
            // The page is going away: send it without waiting (small drawings only; autosave has the rest).
            if (raw.length < KEEPALIVE_MAX)
              fetch(`/api/whiteboards/${id}/scene`, {
                method: 'PUT',
                keepalive: true,
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-FT-Client': 'web', 'X-Mode': mode.value },
                body: raw,
              }).catch(() => {});
            else void api('PUT', `/whiteboards/${id}/scene`, body).catch(() => {});
          } else await api('PUT', `/whiteboards/${id}/scene`, body);
          s.savedContent = content;
          s.savedView = view;
          s.wrote = true;
        }
        if (thumbnail !== undefined) {
          s.thumbAt = Date.now();
          s.thumbContent = content;
          s.hadThumb = thumbnail !== null;
        }
        setStatus({ kind: 'saved' });
        return true;
      } catch (e) {
        const too = e instanceof HttpError && e.status === 413;
        setStatus({ kind: too ? 'too-big' : 'error', text: too ? (e as Error).message : `Not saved: ${(e as Error).message}` });
        return false;
      }
    };
    const p = run().finally(() => s.inFlight === p && (s.inFlight = null));
    s.inFlight = p;
    return p;
  }

  // Mount Excalidraw once the drawing is here.
  useEffect(() => {
    if (!data || !canvas.current) return;
    let gone = false;
    s.opened = data.scene;
    let viewKey: (a: any) => string = () => '';
    loadHost()
      .then((m) => {
        viewKey = m.viewKey;
        return m.mount(canvas.current!, {
          scene: data.scene,
          tool: favouriteTool.value,
          onChange: () => {
            if (!s.host || s.closing || s.discarded) return;
            const { content, view } = s.host.key();
            if (content === s.savedContent && view === s.savedView) return;
            clearTimeout(s.timer);
            s.timer = window.setTimeout(() => save({ thumbnail: Date.now() - s.thumbAt > THUMB_EVERY_MS }), AUTOSAVE_MS);
          },
        });
      })
      .then((h) => {
        if (gone) return h.destroy();
        const k = h.key();
        s.openedContent = s.savedContent = s.thumbContent = k.content;
        // The stored view, not the one at this moment: Excalidraw may still be moving to it.
        const a = data.scene?.appState;
        const sameSize = a?.viewWidth == null || (a.viewWidth === canvas.current?.clientWidth && a.viewHeight === canvas.current?.clientHeight);
        s.savedView = typeof a?.scrollX === 'number' && typeof a?.scrollY === 'number' && sameSize ? viewKey(a) : k.view;
        s.host = h;
        setReady(true);
      })
      .catch((e: Error) => !gone && setError(`The whiteboard editor did not load (${e.message}). Check the connection and try again.`));
    const hide = () => {
      if (document.visibilityState === 'hidden') save({ keepalive: true });
    };
    const leave = () => save({ keepalive: true });
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      const h = s.host;
      if (!h) return;
      // Leaving by the back button or a link counts as Save and close.
      if (!s.closing && !s.discarded) {
        save({ thumbnail: true }).finally(() => {
          h.destroy();
          version.value++;
        });
      } else h.destroy();
      s.host = null;
    };
  }, [data]);

  async function saveAndClose() {
    if (!s.host) return leaveBoard();
    s.closing = true;
    const ok = await save({ thumbnail: true });
    if (!ok) {
      s.closing = false;
      return;
    }
    s.host?.destroy();
    s.host = null;
    version.value++;
    leaveBoard();
  }

  async function closeWithoutSaving() {
    const changed = !!s.host && s.host.key().content !== s.openedContent;
    if (changed && !confirm('Close without saving? The changes since you opened this board will be lost.')) return;
    s.closing = true;
    clearTimeout(s.timer);
    if (s.inFlight) await s.inFlight;
    s.discarded = true;
    if (s.wrote) {
      try {
        const thumb = s.thumbAt && s.openedThumb !== undefined ? { thumbnail: s.openedThumb } : {};
        await put(`/whiteboards/${id}/scene`, { scene: s.opened ?? EMPTY, view_only: true, ...thumb });
      } catch (e) {
        s.discarded = false;
        s.closing = false;
        setStatus({ kind: 'error', text: `Could not put the board back (${(e as Error).message}). Your changes are still saved.` });
        return;
      }
    }
    s.host?.destroy();
    s.host = null;
    version.value++;
    leaveBoard();
  }

  const statusText = status.kind === 'saving' ? 'Saving…' : status.kind === 'saved' ? 'Saved' : status.kind === 'idle' ? '' : 'Not saved';
  return (
    <div
      class="wb-full"
      role="dialog"
      aria-label={data?.name ?? 'Whiteboard'}
      // Ctrl/⌘+Z and Y belong to the drawing here, not to the app's undo (main.tsx listens on window).
      onKeyDown={(e) => (e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key) && e.stopPropagation()}
    >
      <header class="wb-bar">
        <button class="ghost small wb-back" onClick={saveAndClose} aria-label="Save and close" title="Save and close">
          ←
        </button>
        <strong class="wb-title">{data?.name ?? 'Whiteboard'}</strong>
        <span class={`wb-status ${status.kind}`} role="status" aria-live="polite">
          {statusText}
        </span>
        <button class="ghost small wb-discard" onClick={closeWithoutSaving} disabled={!ready}>
          Close without saving
        </button>
        <button class="primary small wb-done" onClick={saveAndClose}>
          Save and close
        </button>
      </header>
      {(status.kind === 'too-big' || status.kind === 'error') && (
        <p class="wb-alert" role="alert">
          {status.text}
        </p>
      )}
      <div class="wb-canvas">
        {/* React owns this element (and only this one). */}
        <div class="wb-host" ref={canvas} />
        {error ? (
          <div class="wb-msg">
            <p class="error">{error}</p>
            <button class="small" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        ) : (
          !ready && <p class="wb-msg muted">Opening the whiteboard…</p>
        )}
      </div>
    </div>
  );
}
