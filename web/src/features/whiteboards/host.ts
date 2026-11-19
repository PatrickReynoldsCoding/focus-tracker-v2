// Excalidraw in its own React root. This file is the only one that imports React; it is loaded
// with import() when a board opens, so React and Excalidraw stay out of the app's first load.
// The rest of the app is Preact and talks to the board through the small `Board` interface.
import {
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  getSceneVersion,
  MainMenu,
  serializeAsJSON,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

type AnyScene = { elements?: any[]; appState?: Record<string, any>; files?: Record<string, any> } | null;

export interface Board {
  /** What onChange reports, now. */
  key(): { content: number; view: string };
  /** The drawing as it would be saved, and whether anything is drawn. */
  scene(): { scene: Record<string, unknown>; empty: boolean };
  /** A small WebP (or JPEG) preview as a data: URL under `maxChars`, or null when nothing is drawn. */
  thumbnail(maxChars?: number): Promise<string | null>;
  /** Put a saved drawing back on the canvas (Close without saving after an autosave). */
  load(scene: AnyScene): void;
  destroy(): void;
}

export interface MountOptions {
  scene: AnyScene;
  /** The tool to pick once the board is ready ('' = Excalidraw's default). */
  tool: string;
  /** Called on every change with a key that differs when the drawing (`content`) or the view (`view`) changed. */
  onChange(key: { content: number; view: string }): void;
}

/** Elements Claude wrote with only the basics (no version or seed) are filled in by Excalidraw.
 *  `size` is the canvas now: a view saved on a screen of another size keeps its centre. */
function prepare(scene: AnyScene, size?: { width: number; height: number }) {
  const elements = scene?.elements ?? [];
  const skeleton = elements.some((e) => e && (e.version == null || e.seed == null));
  const ready = skeleton ? convertToExcalidrawElements(elements as any, { regenerateIds: false }) : elements;
  const a = { ...(scene?.appState ?? {}) };
  const zoom = a.zoom?.value || 1;
  if (size?.width && typeof a.scrollX === 'number' && typeof a.viewWidth === 'number' && a.viewWidth !== size.width) a.scrollX += (size.width - a.viewWidth) / 2 / zoom;
  if (size?.height && typeof a.scrollY === 'number' && typeof a.viewHeight === 'number' && a.viewHeight !== size.height) a.scrollY += (size.height - a.viewHeight) / 2 / zoom;
  return {
    elements: ready,
    files: scene?.files ?? {},
    appState: {
      viewBackgroundColor: a.viewBackgroundColor ?? '#ffffff',
      ...(typeof a.scrollX === 'number' ? { scrollX: a.scrollX } : {}),
      ...(typeof a.scrollY === 'number' ? { scrollY: a.scrollY } : {}),
      ...(a.zoom?.value ? { zoom: { value: a.zoom.value } } : {}),
      ...(a.gridModeEnabled != null ? { gridModeEnabled: a.gridModeEnabled } : {}),
      ...(a.gridSize ? { gridSize: a.gridSize } : {}),
      currentItemFontFamily: a.currentItemFontFamily,
    },
    // A board Claude drew has never been viewed: show all of it.
    scrollToContent: skeleton || typeof a.scrollX !== 'number',
  };
}

/** The view part of the change key: where the board is scrolled to and its zoom. */
export const viewKey = (a: any) => `${Math.round(a.scrollX)},${Math.round(a.scrollY)},${a.zoom?.value ?? 1}`;

async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

export function mount(el: HTMLElement, opts: MountOptions): Promise<Board> {
  const root = createRoot(el);
  return new Promise((resolve) => {
    let api: any = null;
    const initialData = prepare(opts.scene, { width: el.clientWidth, height: el.clientHeight });
    const onApi = (a: any) => {
      if (!a || api) return;
      api = a;
      // Wait one frame so Excalidraw has its state before the tool is picked.
      requestAnimationFrame(() => {
        if (opts.tool) {
          try {
            api.setActiveTool({ type: opts.tool });
          } catch {
            /* an unknown tool name: keep the default */
          }
        }
        resolve(board);
      });
    };
    const menu = h(
      MainMenu,
      null,
      h(MainMenu.DefaultItems.SaveAsImage),
      h(MainMenu.DefaultItems.Export),
      h(MainMenu.DefaultItems.SearchMenu),
      h(MainMenu.DefaultItems.ClearCanvas),
      h(MainMenu.Separator),
      h(MainMenu.DefaultItems.ChangeCanvasBackground),
      h(MainMenu.DefaultItems.Help),
    );
    root.render(
      h(
        StrictMode,
        null,
        h(
          Excalidraw,
          {
            initialData,
            excalidrawAPI: onApi,
            theme: 'light',
            langCode: 'en',
            autoFocus: true,
            UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, export: { saveFileToDisk: true } } },
            onChange: (elements: readonly any[], appState: any) => opts.onChange({ content: getSceneVersion(elements), view: viewKey(appState) }),
          },
          menu,
        ),
      ),
    );

    const board: Board = {
      key() {
        return { content: getSceneVersion(api.getSceneElementsIncludingDeleted()), view: viewKey(api.getAppState()) };
      },
      scene() {
        const elements = api.getSceneElements();
        const appState = api.getAppState();
        // serializeAsJSON drops deleted elements and files no element uses; add where the view was.
        const data = JSON.parse(serializeAsJSON(elements, appState, api.getFiles(), 'local'));
        // viewWidth and viewHeight: the canvas size, so another screen can keep the same centre.
        data.appState = { ...data.appState, scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: { value: appState.zoom.value }, viewWidth: appState.width, viewHeight: appState.height };
        return { scene: data, empty: !data.elements.length };
      },
      async thumbnail(maxChars = 45_000) {
        const elements = api.getSceneElements();
        if (!elements.length) return null;
        const appState = { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false };
        const webp = typeof document !== 'undefined' && document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
        const mimeType = webp ? 'image/webp' : 'image/jpeg';
        for (const [box, quality] of [[320, 0.8], [320, 0.6], [240, 0.6], [200, 0.5], [160, 0.45], [120, 0.4]] as const) {
          const blob = await exportToBlob({
            elements,
            appState,
            files: api.getFiles(),
            mimeType,
            quality,
            exportPadding: 12,
            getDimensions: (w: number, hgt: number) => {
              const scale = Math.min(box / w, (box * 0.75) / hgt, 2);
              return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(hgt * scale)), scale };
            },
          });
          const url = await blobToDataUrl(blob);
          if (url.length <= maxChars) return url;
        }
        return null;
      },
      load(scene) {
        const d = prepare(scene, { width: el.clientWidth, height: el.clientHeight });
        api.updateScene({ elements: d.elements, appState: d.appState });
        if (d.files && Object.keys(d.files).length) api.addFiles(Object.values(d.files));
        api.history?.clear?.();
      },
      destroy() {
        root.unmount();
      },
    };
  });
}
