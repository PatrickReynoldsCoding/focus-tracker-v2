// Test only (clients/gnome/test/run.sh): every 400 ms writes the windows (title, type, places,
// stacking, focus), the Alt+Tab list and the overview's windows to $FT_PROBE_DIR/state.json, and runs
// the commands written to $FT_PROBE_DIR/cmd, one per line: newws, ws|<n>, raise|<title>,
// move|<title>, close|<title>, maximize|<title>, minimize|<title>, overview, overview-off, enable|<uuid>,
// disable|<uuid>, shot (screenshot to shot.png), click|<x>,<y>, drag|<x1>,<y1>,<x2>,<y2>, type|<text>, enter, rects|<title>
// (rects.json).
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const dir = GLib.getenv('FT_PROBE_DIR');
const TYPES = ['NORMAL', 'DESKTOP', 'DOCK', 'DIALOG', 'MODAL_DIALOG', 'TOOLBAR', 'MENU', 'UTILITY', 'SPLASHSCREEN'];
const find = (title) => global.display.list_all_windows().find((w) => (w.get_title() ?? '').trim() === title);
const us = () => GLib.get_monotonic_time();

export default class Probe extends Extension {
  enable() {
    this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
      try {
        this._commands();
        this._report();
      } catch (e) {
        GLib.file_set_contents(`${dir}/error.txt`, `${e}\n${e.stack}`);
      }
      return GLib.SOURCE_CONTINUE;
    });
  }

  disable() {
    GLib.source_remove(this._timer);
  }

  _commands() {
    const path = `${dir}/cmd`;
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return;
    const [, bytes] = GLib.file_get_contents(path);
    GLib.unlink(path);
    for (const line of new TextDecoder().decode(bytes).split('\n').filter(Boolean)) {
      const [c, arg] = line.split('|');
      const ws = global.workspace_manager;
      if (c === 'newws') ws.append_new_workspace(false, 0);
      if (c === 'ws') ws.get_workspace_by_index(+arg).activate(global.get_current_time());
      if (c === 'raise') Main.activateWindow(find(arg));
      if (c === 'close') find(arg).delete(global.get_current_time());
      if (c === 'move') find(arg).move_frame(true, 700, 300);
      if (c === 'maximize') find(arg).maximize();
      if (c === 'minimize') find(arg).minimize();
      if (c === 'overview') Main.overview.show();
      if (c === 'overview-off') Main.overview.hide();
      if (c === 'enable') Main.extensionManager.enableExtension(arg);
      if (c === 'disable') Main.extensionManager.disableExtension(arg);
      if (c === 'shot') {
        const file = Gio.File.new_for_path(`${dir}/shot.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        new Shell.Screenshot().screenshot(false, stream, () => stream.close(null));
      }
      if (c === 'click') {
        const [x, y] = arg.split(',').map(Number);
        const seat = global.stage.context.get_backend().get_default_seat();
        this._pointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this._pointer.notify_absolute_motion(us(), x, y);
        this._pointer.notify_button(us(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        this._pointer.notify_button(us() + 30000, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
      }
      if (c === 'drag') {
        const [x1, y1, x2, y2] = arg.split(',').map(Number);
        const seat = global.stage.context.get_backend().get_default_seat();
        this._pointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const p = this._pointer;
        p.notify_absolute_motion(us(), x1, y1);
        p.notify_button(us(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        let step = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
          step++;
          p.notify_absolute_motion(us(), x1 + ((x2 - x1) * step) / 20, y1 + ((y2 - y1) * step) / 20);
          if (step < 20) return GLib.SOURCE_CONTINUE;
          p.notify_button(us(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
          return GLib.SOURCE_REMOVE;
        });
      }
      if (c === 'type' || c === 'enter') {
        const seat = global.stage.context.get_backend().get_default_seat();
        this._keys ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const keys = c === 'enter' ? [Clutter.KEY_Return] : [...arg].map((ch) => Clutter.unicode_to_keysym(ch.codePointAt(0)));
        let t = us();
        for (const k of keys) {
          this._keys.notify_keyval(t, k, Clutter.KeyState.PRESSED);
          this._keys.notify_keyval((t += 20000), k, Clutter.KeyState.RELEASED);
          t += 20000;
        }
      }
      if (c === 'rects') {
        const w = find(arg);
        const b = w.get_buffer_rect();
        const f = w.get_frame_rect();
        GLib.file_set_contents(`${dir}/rects.json`, JSON.stringify({ buffer: [b.x, b.y, b.width, b.height], frame: [f.x, f.y, f.width, f.height] }));
      }
    }
  }

  _report() {
    const all = global.display.list_all_windows();
    const stack = global.display.sort_windows_by_stacking(all);
    const wins = all.map((w) => {
      const r = w.get_frame_rect();
      return { title: w.get_title(), type: TYPES[w.get_window_type()] ?? w.get_window_type(), skip: w.is_skip_taskbar(), all: w.is_on_all_workspaces(), x: r.x, y: r.y, w: r.width, h: r.height, stack: stack.indexOf(w), min: w.minimized, focus: w.has_focus() };
    });
    const tab = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).map((w) => w.get_title());
    const overview = Main.overview.visible ? global.get_window_actors().filter((a) => !a.meta_window.skip_taskbar).map((a) => a.meta_window.get_title()) : null;
    const a = Main.layoutManager.getWorkAreaForMonitor(global.display.get_primary_monitor());
    const out = { activeWs: global.workspace_manager.get_active_workspace_index(), area: { x: a.x, y: a.y, w: a.width, h: a.height }, wins, tab, overview, prefs: GLib.file_test(`${dir}/prefs-opened`, GLib.FileTest.EXISTS) };
    GLib.file_set_contents(`${dir}/state.json`, JSON.stringify(out));
  }
}
