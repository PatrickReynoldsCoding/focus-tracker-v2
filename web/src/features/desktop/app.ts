// The Desktop page inside the Focus Tracker Desktop app (clients/gnome/app: a small GNOME window
// showing #/desktop in WebKit, with a ⚙ menu instead of a title bar). The app adds
// "FocusTrackerDesktop" to the user agent and listens to messages on `webkit.messageHandlers.ft`.
// The app's window stays on the Desktop page: a link to any other page opens it in the full app.

/** True inside the app. */
export const inApp = /FocusTrackerDesktop/.test(navigator.userAgent);

type Handler = { postMessage(message: unknown): void };
const handler = (): Handler | undefined => (window as unknown as { webkit?: { messageHandlers?: { ft?: Handler } } }).webkit?.messageHandlers?.ft;

/** Tell the app something ({ open: '/p/<id>' } opens that page in the full app). */
export const tellApp = (message: unknown) => handler()?.postMessage(message);

/** What the app's ⚙ menu calls (window.ftDesktop), set while the Desktop page is drawn. */
export interface DesktopControls {
  add(): void;
  panels(): { id: string; title: string }[];
  remove(id: string): void;
}
export function setControls(c: DesktopControls | null) {
  const w = window as unknown as { ftDesktop?: DesktopControls };
  if (c) w.ftDesktop = c;
  else delete w.ftDesktop;
}

/** Another page asked for inside the app opens in the full app; the window goes back to the Desktop. */
export function keepOnDesktop() {
  if (!inApp) return;
  window.addEventListener('hashchange', () => {
    const r = location.hash.slice(1);
    if (!r || r.startsWith('/desktop')) return;
    tellApp({ open: r });
    location.replace('#/desktop');
  });
}
