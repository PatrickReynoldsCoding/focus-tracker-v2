// The Android app's home-screen widgets show the same data; tell the app when a change was saved so it redraws them.

const WAIT_MS = 1500;

type WidgetBridge = { refreshWidgets?: () => void };

let timer: number | undefined;

/** Ask the Android app (if this is it) to redraw its widgets once changes have stopped for a moment. */
export function widgetsChanged() {
  const bridge = (window as unknown as { FocusTrackerAndroid?: WidgetBridge }).FocusTrackerAndroid;
  if (!bridge?.refreshWidgets) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => bridge.refreshWidgets?.(), WAIT_MS);
}
