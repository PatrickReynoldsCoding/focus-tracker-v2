// Focus Tracker Desktop: a small GNOME app that shows Focus Tracker's Desktop page (#/desktop, D64)
// in a window with no title bar, the way the Android app shows the web app: every panel is the web
// app's own. A ⚙ in the top right opens a menu: Add panel, Remove panel, Position (left, middle,
// right, custom), Move and resize, More settings, Open full app, Reload, Close.
// The GNOME Shell extension (../extension) pins the window behind the others; the position settings
// are the extension's, so the app and the extension's settings window change the same thing.
//
// Run: gjs -m main.js. install.sh installs it with a launcher. Reads ~/.config/focus-tracker-desktop/
// config.json ({ "url": …, "chromeProfile": … }); FT_URL overrides the address. Its web data (the
// sign-in) is kept in ~/.local/share/focus-tracker-desktop/web: sign in once in the window.

import Gdk from 'gi://Gdk?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=3.0';
import WebKit2 from 'gi://WebKit2?version=4.1';
import System from 'system';

const APP_ID = 'dev.focustracker.Desktop';
const TITLE = 'Focus Tracker Desktop';
const UUID = 'focus-tracker-desktop@focus-tracker';
const SCHEMA = 'org.gnome.shell.extensions.focus-tracker-desktop';
const POSITIONS = [
  ['left', 'Left'],
  ['center', 'Middle'],
  ['right', 'Right'],
  ['custom', 'Custom'],
];

function readConfig() {
  const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'focus-tracker-desktop', 'config.json']);
  let config = {};
  try {
    const [, bytes] = GLib.file_get_contents(path);
    config = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // No config: the defaults.
  }
  const url = (GLib.getenv('FT_URL') || config.url || 'https://focus-tracker.focus-tracker.workers.dev').replace(/\/+$/, '');
  return { url, chromeProfile: config.chromeProfile ?? null };
}

/** The extension's settings (position, size, arranging), or null when it is not installed. */
function extensionSettings() {
  const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', UUID, 'schemas']);
  try {
    const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
    const schema = source.lookup(SCHEMA, false);
    return schema ? new Gio.Settings({ settings_schema: schema }) : null;
  } catch {
    return null;
  }
}

function run(argv) {
  try {
    Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
  } catch (e) {
    console.warn(`Focus Tracker Desktop: could not run ${argv[0]}: ${e.message}`);
  }
}

const CSS = `
.ft-gear { min-width: 30px; min-height: 30px; padding: 0; border-radius: 15px; border: none; box-shadow: none;
  background: alpha(@theme_bg_color, 0.55); color: alpha(@theme_fg_color, 0.7); }
.ft-gear:hover, .ft-gear:checked { background: alpha(@theme_bg_color, 0.95); color: @theme_fg_color; }
.ft-arrange { background: alpha(@theme_selected_bg_color, 0.92); color: @theme_selected_fg_color; padding: 6px 10px; }
.ft-arrange button { min-height: 26px; padding: 0 12px; }
.ft-grip { background: alpha(@theme_selected_bg_color, 0.92); color: @theme_selected_fg_color; border-radius: 6px 0 0 0;
  min-width: 28px; min-height: 28px; font-size: 18px; }
`;

class DesktopWindow {
  constructor(app) {
    this.config = readConfig();
    this.settings = extensionSettings();
    this.window = new Gtk.ApplicationWindow({ application: app, title: TITLE, decorated: false, default_width: 600, default_height: 900 });
    this.window.set_icon_name('focus-tracker-desktop');

    const css = new Gtk.CssProvider();
    css.load_from_data(CSS);
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    this.web = this._webView();
    const overlay = new Gtk.Overlay();
    overlay.add(this.web);
    overlay.add_overlay(this._gear());
    this.arrangeBar = this._arrangeBar();
    this.grip = this._grip();
    overlay.add_overlay(this.arrangeBar);
    overlay.add_overlay(this.grip);
    this.window.add(overlay);
    this.window.show_all();
    this._showArranging();
    this.settings?.connect('changed::arranging', () => this._showArranging());
    this.web.load_uri(`${this.config.url}/#/desktop`);
  }

  _webView() {
    const base = GLib.build_filenamev([GLib.get_user_data_dir(), 'focus-tracker-desktop', 'web']);
    const cache = GLib.build_filenamev([GLib.get_user_cache_dir(), 'focus-tracker-desktop']);
    const data = new WebKit2.WebsiteDataManager({ base_data_directory: base, base_cache_directory: cache });
    const context = new WebKit2.WebContext({ website_data_manager: data });
    context.get_cookie_manager().set_persistent_storage(GLib.build_filenamev([base, 'cookies.sqlite']), WebKit2.CookiePersistentStorage.SQLITE);
    const content = new WebKit2.UserContentManager();
    content.register_script_message_handler('ft');
    content.connect('script-message-received::ft', (_m, result) => this._message(result.get_js_value()));
    const web = new WebKit2.WebView({ web_context: context, user_content_manager: content });
    // The page knows it is in the app by this (web/src/features/desktop/app.ts).
    web.get_settings().set_user_agent_with_application_details('FocusTrackerDesktop', '1');
    web.connect('decide-policy', (_v, decision, type) => this._policy(decision, type));
    // The page's own title is not the window's: the extension finds the window by its app id.
    return web;
  }

  /** Links to other sites open in the usual browser; the window stays on the tracker. */
  _policy(decision, type) {
    if (type !== WebKit2.PolicyDecisionType.NAVIGATION_ACTION && type !== WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION) return false;
    const uri = decision.get_navigation_action().get_request().get_uri();
    if (type === WebKit2.PolicyDecisionType.NAVIGATION_ACTION && uri.startsWith(`${this.config.url}/`)) return false;
    if (uri === `${this.config.url}`) return false;
    decision.ignore();
    if (uri.startsWith(`${this.config.url}/`)) this._openFull(uri.slice(this.config.url.length).replace(/^\/#?/, '') || '/today');
    else Gio.AppInfo.launch_default_for_uri(uri, null);
    return true;
  }

  _message(value) {
    let m;
    try {
      m = JSON.parse(value.to_json(0));
    } catch {
      return;
    }
    if (m && typeof m.open === 'string') this._openFull(m.open);
  }

  /** The full app at a page: the Chrome app window when a Chrome profile is set, else the usual browser. */
  _openFull(route) {
    const uri = `${this.config.url}/#${route.startsWith('/') ? route : `/${route}`}`;
    if (this.config.chromeProfile) run(['google-chrome', `--profile-directory=${this.config.chromeProfile}`, `--app=${uri}`]);
    else Gio.AppInfo.launch_default_for_uri(uri, null);
  }

  /** Run something in the page and get its answer (JSON text) back. */
  _ask(script, done) {
    this.web.evaluate_javascript(script, -1, null, null, null, (web, result) => {
      try {
        done(web.evaluate_javascript_finish(result).to_string());
      } catch {
        done(null);
      }
    });
  }

  _gear() {
    const button = new Gtk.MenuButton({ halign: Gtk.Align.END, valign: Gtk.Align.START, margin_top: 6, margin_end: 6, tooltip_text: 'Focus Tracker Desktop' });
    button.get_style_context().add_class('ft-gear');
    button.add(new Gtk.Image({ icon_name: 'emblem-system-symbolic', pixel_size: 16 }));
    const menu = new Gtk.Menu();
    const item = (label, fn) => {
      const i = new Gtk.MenuItem({ label });
      if (fn) i.connect('activate', fn);
      menu.append(i);
      return i;
    };
    item('Add panel…', () => this.web.evaluate_javascript('window.ftDesktop && window.ftDesktop.add()', -1, null, null, null, null));
    const remove = item('Remove panel');
    this.removeMenu = new Gtk.Menu();
    remove.set_submenu(this.removeMenu);
    menu.append(new Gtk.SeparatorMenuItem());

    const position = item('Position');
    const places = new Gtk.Menu();
    position.set_submenu(places);
    this.positionItems = [];
    let group = null;
    for (const [id, label] of POSITIONS) {
      const r = new Gtk.RadioMenuItem({ label });
      if (group) r.join_group(group);
      group = r;
      r.connect('toggled', () => {
        if (!r.active || this._syncing) return;
        if (id === 'custom') this.settings?.set_boolean('arranging', true);
        else this.settings?.set_string('position', id);
      });
      places.append(r);
      this.positionItems.push([id, r]);
    }
    const arrange = item('Move and resize', () => this.settings?.set_boolean('arranging', true));
    item('More settings…', () => run(['gnome-extensions', 'prefs', UUID]));
    for (const i of [position, arrange]) i.sensitive = !!this.settings;
    menu.append(new Gtk.SeparatorMenuItem());
    item('Open full app', () => this._openFull('/today'));
    item('Reload', () => this.web.reload());
    item('Close', () => this.window.close());
    menu.show_all();
    button.set_popup(menu);
    button.connect('toggled', () => button.active && this._refreshMenu());
    return button;
  }

  /** Before the menu shows: the panels on the Desktop now, and the position chosen. */
  _refreshMenu() {
    this._syncing = true;
    const now = this.settings?.get_string('position');
    for (const [id, r] of this.positionItems) r.active = id === now;
    this._syncing = false;
    for (const c of this.removeMenu.get_children()) c.destroy();
    const wait = new Gtk.MenuItem({ label: '…', sensitive: false });
    this.removeMenu.append(wait);
    this.removeMenu.show_all();
    this._ask('JSON.stringify(window.ftDesktop ? window.ftDesktop.panels() : [])', (text) => {
      wait.destroy();
      let list = [];
      try {
        list = JSON.parse(text ?? '[]');
      } catch {
        // The page is not ready: nothing to remove.
      }
      if (!list.length) this.removeMenu.append(new Gtk.MenuItem({ label: 'No panels', sensitive: false }));
      for (const p of list) {
        const i = new Gtk.MenuItem({ label: p.title });
        i.connect('activate', () => this.web.evaluate_javascript(`window.ftDesktop && window.ftDesktop.remove(${JSON.stringify(p.id)})`, -1, null, null, null, null));
        this.removeMenu.append(i);
      }
      this.removeMenu.show_all();
    });
  }

  /** While moving and resizing: a bar to drag the window by, with Done, and a corner to resize it. */
  _arrangeBar() {
    const bar = new Gtk.EventBox({ valign: Gtk.Align.START, halign: Gtk.Align.FILL });
    bar.get_style_context().add_class('ft-arrange');
    const row = new Gtk.Box({ spacing: 8 });
    row.pack_start(new Gtk.Label({ label: '⠿  Drag here to move', xalign: 0 }), true, true, 0);
    const done = new Gtk.Button({ label: 'Done' });
    done.connect('clicked', () => this.settings?.set_boolean('arranging', false));
    row.pack_end(done, false, false, 0);
    // Resize from here too: the bottom corner may be off the screen after a move.
    row.pack_end(this._resizer(new Gtk.Label({ label: '⤡ Drag to resize' }), 'Drag to make the window bigger or smaller'), false, false, 0);
    bar.add(row);
    // The extension moves the window while the button is held (a pinned window cannot be dragged).
    bar.connect('button-press-event', () => {
      this.settings?.set_string('drag', 'move');
      return true;
    });
    return bar;
  }

  _grip() {
    const label = new Gtk.Label({ label: '◢' });
    const grip = this._resizer(label, 'Drag to resize');
    grip.valign = Gtk.Align.END;
    grip.halign = Gtk.Align.END;
    grip.get_style_context().add_class('ft-grip');
    return grip;
  }

  /** Something to drag that moves the window's bottom right corner (wherever it is pressed); the
   *  extension follows the pointer while the button is held. */
  _resizer(child, tip) {
    const box = new Gtk.EventBox({ tooltip_text: tip });
    box.add(child);
    box.connect('realize', () => box.get_window().set_cursor(Gdk.Cursor.new_from_name(box.get_display(), 'se-resize')));
    box.connect('button-press-event', () => {
      this.settings?.set_string('drag', 'resize');
      return true;
    });
    return box;
  }

  _showArranging() {
    const on = !!this.settings?.get_boolean('arranging');
    this.arrangeBar.visible = on;
    this.grip.visible = on;
  }
}

const app = new Gtk.Application({ application_id: APP_ID, flags: Gio.ApplicationFlags.DEFAULT_FLAGS });
let desktop = null;
app.connect('activate', () => {
  if (desktop) return desktop.window.present();
  desktop = new DesktopWindow(app);
});
app.run([System.programInvocationName, ...ARGV]);
