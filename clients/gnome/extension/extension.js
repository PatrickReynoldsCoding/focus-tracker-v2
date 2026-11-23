// Focus Tracker Desktop (desktop widget part 3, docs/desktop-widget-spec.md): pins the window of
// Focus Tracker's Desktop page (#/desktop, D64) like a desktop widget. Wayland does not let a window
// place itself or stay below others, so the shell does it here.
//
// The window is the Focus Tracker Desktop app's (clients/gnome/app, app id dev.focustracker.Desktop),
// or any window titled exactly "Focus Tracker Desktop" (a Chrome app window on #/desktop; a browser
// tab's title has " - Google Chrome" after it, so it never matches). Once found, it:
//   - becomes a desktop-type window: drawn in the desktop layer (below every normal window, above
//     the desktop icons), and left out of the dock, Alt+Tab and the overview (skip taskbar);
//   - shows on every workspace;
//   - sits on the primary screen's free area where the settings say: against the left (the default)
//     or right edge at full height; in the middle at the height set there (0 = full height); or
//     where you left it (custom); at the width set (default 600 px); and goes back there when moved,
//     resized, maximised or minimised;
//   - takes clicks and typing as usual.
// Move and resize (the app's ⚙ menu sets `arranging`): the position becomes custom, starting where the
// window is. Pressing one of the app's handles sets `drag` (move or resize): the window, or its bottom
// right corner, then follows the pointer until the button is let go, and its place is saved in
// `custom-rect`. The window stays pinned the whole time: changing a window's type back and forth
// while it is on every workspace made GNOME Shell crash when the window later closed.
// At login it opens the window if it is not open (the launcher from clients/gnome/install.sh).
// Disabling the extension gives the window back as a normal window.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GioUnix from 'gi://GioUnix';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const LAUNCHER = 'focus-tracker-desktop.desktop';
const APP_ID = 'dev.focustracker.Desktop';
/** How long after login to wait for a window that is opening anyway before opening one. */
const OPEN_DELAY_S = 8;
/** Moves and resizes come in bursts; put the window back once they settle. */
const SETTLE_MS = 150;
/** The smallest custom size. */
const MIN_W = 240;
const MIN_H = 160;
/** How often a drag follows the pointer, and the longest a drag may last. */
const DRAG_MS = 16;
const DRAG_MAX_MS = 120000;
/** False once the extension has been on in this shell (so only login opens the window). */
let firstEnable = true;

export default class FocusTrackerDesktop extends Extension {
  enable() {
    this._settings = this.getSettings();
    // Left over from a session that ended while moving the window: it stays put.
    if (this._settings.get_boolean('arranging')) this._settings.set_boolean('arranging', false);
    if (this._settings.get_string('drag')) this._settings.set_string('drag', '');
    /** Pinned windows: MetaWindow → { ids: signal ids, timer }. */
    this._pinned = new Map();
    /** Windows whose title is watched until it matches: MetaWindow → [signal ids]. */
    this._watched = new Map();
    this._ids = [];
    const on = (obj, signal, fn) => this._ids.push([obj, obj.connect(signal, fn)]);
    on(global.display, 'window-created', (_d, w) => this._watch(w));
    on(global.display, 'workareas-changed', () => this._placeAll());
    on(Main.layoutManager, 'monitors-changed', () => this._placeAll());
    for (const key of ['width', 'height', 'position', 'custom-rect']) on(this._settings, `changed::${key}`, () => this._placeAll());
    on(this._settings, 'changed::arranging', () => this._arranging());
    on(this._settings, 'changed::drag', () => this._drag());
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
    this._endDrag();
    if (this._openTimer) GLib.source_remove(this._openTimer);
    this._openTimer = 0;
    for (const [obj, id] of this._ids) obj.disconnect(id);
    this._ids = [];
    for (const w of [...this._watched.keys()]) this._unwatch(w);
    for (const w of [...this._pinned.keys()]) this._unpin(w);
    this._settings = null;
  }

  _open() {
    const app = GioUnix.DesktopAppInfo.new(LAUNCHER);
    if (!app) return console.warn(`Focus Tracker Desktop: ${LAUNCHER} is not installed (run clients/gnome/install.sh)`);
    try {
      app.launch([], global.create_app_launch_context(0, -1));
    } catch (e) {
      console.warn(`Focus Tracker Desktop: could not open the window: ${e.message}`);
    }
  }

  _matches(w) {
    if (![Meta.WindowType.NORMAL, Meta.WindowType.DESKTOP].includes(w.get_window_type())) return false;
    if (w.get_gtk_application_id() === APP_ID || w.get_wm_class() === APP_ID) return true;
    const t = w.get_title();
    return !!t && t.trim() === this._settings.get_string('title');
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
    const later = () => {
      if (this._dragTimer) return;
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
      // Let go as soon as GNOME starts closing it: putting it back on every workspace while it is
      // being taken off them made GNOME Shell crash (meta_window_unmanage).
      ['unmanaging', () => this._forget(w)],
      ['unmanaged', () => this._forget(w)],
    ])
      state.ids.push(w.connect(signal, fn));
    // A desktop-type window first, then on every workspace (once the overview leaves it out).
    w.set_type(Meta.WindowType.DESKTOP);
    if (!w.is_on_all_workspaces()) w.stick();
    this._place(w);
    console.log(`Focus Tracker Desktop: pinned “${w.get_title()}”`);
  }

  /** Move and resize starts: the custom position, from where the window is now. */
  _arranging() {
    if (!this._settings.get_boolean('arranging')) return;
    const w = this._pinned.keys().next().value;
    if (!w) return;
    const r = w.get_frame_rect();
    this._settings.set_value('custom-rect', new GLib.Variant('ai', [r.x, r.y, r.width, r.height]));
    this._settings.set_string('position', 'custom');
  }

  /** A handle in the app was pressed: follow the pointer until the button is let go. */
  _drag() {
    const kind = this._settings.get_string('drag');
    const w = this._pinned.keys().next().value;
    if (!kind || this._dragTimer) return;
    if (!w) return this._settings.set_string('drag', '');
    const [px, py] = global.get_pointer();
    const r = w.get_frame_rect();
    const area = Main.layoutManager.getWorkAreaForMonitor(global.display.get_primary_monitor());
    const started = GLib.get_monotonic_time();
    this._dragWindow = w;
    this._dragTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DRAG_MS, () => {
      const [x, y, mods] = global.get_pointer();
      const dx = x - px;
      const dy = y - py;
      if (kind === 'move') w.move_frame(false, r.x + dx, Math.max(area.y, r.y + dy));
      else w.move_resize_frame(false, r.x, r.y, Math.max(MIN_W, r.width + dx), Math.max(MIN_H, r.height + dy));
      const held = (mods & Clutter.ModifierType.BUTTON1_MASK) !== 0;
      if (held && GLib.get_monotonic_time() - started < DRAG_MAX_MS * 1000) return GLib.SOURCE_CONTINUE;
      this._dragTimer = 0;
      this._endDrag();
      return GLib.SOURCE_REMOVE;
    });
  }

  /** The drag is over: where the window is now is the custom place. */
  _endDrag() {
    if (this._dragTimer) GLib.source_remove(this._dragTimer);
    this._dragTimer = 0;
    const w = this._dragWindow;
    this._dragWindow = null;
    if (w && this._pinned.has(w)) {
      const r = w.get_frame_rect();
      this._settings.set_value('custom-rect', new GLib.Variant('ai', [r.x, r.y, r.width, r.height]));
      this._settings.set_string('position', 'custom');
    }
    // Always cleared, so the next press starts a drag again.
    this._settings?.set_string('drag', '');
  }

  /** Back to a normal window (the extension is off, or the title setting changed). */
  _unpin(w) {
    this._forget(w);
    // Off every workspace first, while the overview still leaves it out, then a normal window again.
    if (w.is_on_all_workspaces()) w.unstick();
    w.set_type(Meta.WindowType.NORMAL);
  }

  _forget(w) {
    if (this._dragWindow === w) this._endDrag();
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
    const area = Main.layoutManager.getWorkAreaForMonitor(global.display.get_primary_monitor());
    const position = this._settings.get_string('position');
    const r = w.get_frame_rect();
    let x, y, width, height;
    if (position === 'custom') {
      // Where it was left, kept inside the free area (a screen may have changed since).
      const [cx, cy, cw, ch] = this._settings.get_value('custom-rect').deepUnpack();
      const c = cw ? { x: cx, y: cy, w: cw, h: ch } : { x: r.x, y: r.y, w: r.width, h: r.height };
      width = Math.max(MIN_W, Math.min(c.w, area.width));
      height = Math.max(MIN_H, Math.min(c.h, area.height));
      x = Math.max(area.x, Math.min(c.x, area.x + area.width - width));
      y = Math.max(area.y, Math.min(c.y, area.y + area.height - height));
    } else {
      width = Math.min(this._settings.get_int('width'), area.width);
      const tall = this._settings.get_int('height');
      // At an edge it is always full height; in the middle it takes the height set (0 = full).
      height = position === 'center' && tall > 0 ? Math.min(tall, area.height) : area.height;
      x = position === 'right' ? area.x + area.width - width : position === 'center' ? area.x + Math.floor((area.width - width) / 2) : area.x;
      y = area.y + Math.floor((area.height - height) / 2);
    }
    if (w.is_maximized?.()) w.unmaximize?.();
    if (r.x === x && r.y === y && r.width === width && r.height === height) return;
    w.move_resize_frame(false, x, y, width, height);
  }
}
