// Focus Tracker Desktop (desktop widget part 3, docs/desktop-widget-spec.md): pins the window of
// Focus Tracker's Desktop page (#/desktop, D64) like a desktop widget. Wayland does not let a window
// place itself or stay below others, so the shell does it here.
//
// The window is found by its exact title (the page sets "Focus Tracker Desktop"; a browser tab's
// title has " - Google Chrome" after it, so only the app window matches). Once found, it:
//   - becomes a desktop-type window: drawn in the desktop layer (below every normal window, above
//     the desktop icons), and left out of the dock, Alt+Tab and the overview (skip taskbar);
//   - shows on every workspace;
//   - sits on the primary screen's free area where the settings say: against the left (the default)
//     or right edge at full height, or in the middle at the height set there (0 = full height); at
//     the width set (default 600 px); and goes back there when moved, resized, maximised or minimised;
//   - takes clicks and typing as usual.
// At login it opens the window if it is not open (the launcher from clients/gnome/install.sh).
// Disabling the extension gives the window back as a normal window.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const LAUNCHER = 'focus-tracker-desktop.desktop';
/** How long after login to wait for a window left open by Chrome before opening one. */
const OPEN_DELAY_S = 8;
/** Moves and resizes come in bursts; put the window back once they settle. */
const SETTLE_MS = 150;
/** False once the extension has been on in this shell (so only login opens the window). */
let firstEnable = true;

export default class FocusTrackerDesktop extends Extension {
  enable() {
    this._settings = this.getSettings();
    /** Pinned windows: MetaWindow → { ids: signal ids, timer }. */
    this._pinned = new Map();
    /** Windows whose title is watched until it matches: MetaWindow → [signal ids]. */
    this._watched = new Map();
    this._ids = [];
    const on = (obj, signal, fn) => this._ids.push([obj, obj.connect(signal, fn)]);
    on(global.display, 'window-created', (_d, w) => this._watch(w));
    on(global.display, 'workareas-changed', () => this._placeAll());
    on(Main.layoutManager, 'monitors-changed', () => this._placeAll());
    for (const key of ['width', 'height', 'position']) on(this._settings, `changed::${key}`, () => this._placeAll());
    on(this._settings, 'changed::title', () => {
      for (const w of [...this._pinned.keys()]) if (!this._matches(w)) this._unpin(w);
      for (const w of global.display.list_all_windows()) this._watch(w);
    });
    for (const w of global.display.list_all_windows()) this._watch(w);

    // At login: the first time this shell turns the extension on (it stays on while the screen is
    // locked, so unlocking does not count). GNOME may turn it on before or after its start-up ends.
    if (firstEnable && this._settings.get_boolean('open-at-login')) {
      const wait = () => {
        this._openTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, OPEN_DELAY_S, () => {
          this._openTimer = 0;
          if (!this._pinned.size) this._open();
          return GLib.SOURCE_REMOVE;
        });
      };
      if (Main.layoutManager._startingUp) on(Main.layoutManager, 'startup-complete', wait);
      else wait();
    }
    firstEnable = false;
  }

  disable() {
    if (this._openTimer) GLib.source_remove(this._openTimer);
    this._openTimer = 0;
    for (const [obj, id] of this._ids) obj.disconnect(id);
    this._ids = [];
    for (const w of [...this._watched.keys()]) this._unwatch(w);
    for (const w of [...this._pinned.keys()]) this._unpin(w);
    this._settings = null;
  }

  _open() {
    const app = Gio.DesktopAppInfo.new(LAUNCHER);
    if (!app) return console.warn(`Focus Tracker Desktop: ${LAUNCHER} is not installed (run clients/gnome/install.sh)`);
    try {
      app.launch([], global.create_app_launch_context(0, -1));
    } catch (e) {
      console.warn(`Focus Tracker Desktop: could not open the window: ${e.message}`);
    }
  }

  _matches(w) {
    const t = w.get_title();
    return !!t && t.trim() === this._settings.get_string('title') && [Meta.WindowType.NORMAL, Meta.WindowType.DESKTOP].includes(w.get_window_type());
  }

  /** Pin the window now if it matches, else wait for its title (a page sets it once it loads). */
  _watch(w) {
    if (this._pinned.has(w) || this._watched.has(w)) return;
    if (this._matches(w)) return this._pin(w);
    if (w.get_window_type() !== Meta.WindowType.NORMAL) return;
    const ids = [
      w.connect('notify::title', () => {
        if (!this._matches(w)) return;
        this._unwatch(w);
        this._pin(w);
      }),
      w.connect('unmanaged', () => this._unwatch(w)),
    ];
    this._watched.set(w, ids);
  }

  _unwatch(w) {
    for (const id of this._watched.get(w) ?? []) w.disconnect(id);
    this._watched.delete(w);
  }

  _pin(w) {
    if (this._pinned.has(w)) return;
    const state = { ids: [], timer: 0 };
    this._pinned.set(w, state);
    w.set_type(Meta.WindowType.DESKTOP);
    if (!w.is_on_all_workspaces()) w.stick();
    const later = () => {
      if (state.timer) GLib.source_remove(state.timer);
      state.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
        state.timer = 0;
        this._place(w);
        return GLib.SOURCE_REMOVE;
      });
    };
    for (const [signal, fn] of [
      ['position-changed', later],
      ['size-changed', later],
      ['notify::maximized-horizontally', later],
      ['notify::maximized-vertically', later],
      ['notify::fullscreen', () => w.is_fullscreen() && w.unmake_fullscreen()],
      ['notify::minimized', () => w.minimized && w.unminimize()],
      ['notify::above', () => w.above && w.unmake_above()],
      ['notify::on-all-workspaces', () => !w.is_on_all_workspaces() && w.stick()],
      ['unmanaged', () => this._forget(w)],
    ])
      state.ids.push(w.connect(signal, fn));
    this._place(w);
    console.log(`Focus Tracker Desktop: pinned “${w.get_title()}”`);
  }

  /** Back to a normal window (the extension is off, or the title setting changed). */
  _unpin(w) {
    this._forget(w);
    // Off every workspace first, while the overview still leaves it out, then a normal window again.
    if (w.is_on_all_workspaces()) w.unstick();
    w.set_type(Meta.WindowType.NORMAL);
  }

  _forget(w) {
    const state = this._pinned.get(w);
    if (!state) return;
    if (state.timer) GLib.source_remove(state.timer);
    for (const id of state.ids) w.disconnect(id);
    this._pinned.delete(w);
  }

  _placeAll() {
    for (const w of this._pinned.keys()) this._place(w);
  }

  /** Where the settings say on the primary screen's free area. Only moves when it is elsewhere. */
  _place(w) {
    const monitor = global.display.get_primary_monitor();
    const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
    const width = Math.min(this._settings.get_int('width'), area.width);
    const position = this._settings.get_string('position');
    const tall = this._settings.get_int('height');
    // At an edge it is always full height; in the middle it takes the height set (0 = full).
    const height = position === 'center' && tall > 0 ? Math.min(tall, area.height) : area.height;
    const x = position === 'right' ? area.x + area.width - width : position === 'center' ? area.x + Math.floor((area.width - width) / 2) : area.x;
    const y = area.y + Math.floor((area.height - height) / 2);
    if (w.is_maximized?.()) w.unmaximize?.();
    const r = w.get_frame_rect();
    if (r.x === x && r.y === y && r.width === width && r.height === height) return;
    w.move_resize_frame(false, x, y, width, height);
  }
}
