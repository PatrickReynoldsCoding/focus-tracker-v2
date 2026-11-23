// Settings for Focus Tracker Desktop: the window's position (left, middle, right, custom), Move and
// resize, width, height in the middle, and opening it at login.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class FocusTrackerDesktopPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({ title: 'Focus Tracker Desktop', description: 'The window of Focus Tracker’s Desktop page, on the left of the screen behind your other windows.' });
    page.add(group);

    const width = new Adw.SpinRow({
      title: 'Width',
      subtitle: 'In pixels, as in the display settings',
      adjustment: new Gtk.Adjustment({ lower: 240, upper: 2000, step_increment: 20, page_increment: 100 }),
    });
    settings.bind('width', width, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(width);

    const places = ['left', 'center', 'right', 'custom'];
    const position = new Adw.ComboRow({ title: 'Position', subtitle: 'Left and right fill the height; Custom is where you move it', model: Gtk.StringList.new(['Left', 'Middle', 'Right', 'Custom']) });
    position.selected = Math.max(0, places.indexOf(settings.get_string('position')));
    position.connect('notify::selected', () => settings.set_string('position', places[position.selected]));
    settings.connect('changed::position', () => (position.selected = Math.max(0, places.indexOf(settings.get_string('position')))));
    group.add(position);

    const arrange = new Adw.ActionRow({ title: 'Move and resize', subtitle: 'Drag the window anywhere and resize it from its corner, then press Done in it' });
    const go = new Gtk.Button({ label: 'Move and resize', valign: Gtk.Align.CENTER });
    go.connect('clicked', () => settings.set_boolean('arranging', true));
    arrange.add_suffix(go);
    group.add(arrange);

    const height = new Adw.SpinRow({
      title: 'Height in the middle',
      subtitle: 'In pixels; 0 fills the height. Only used in the middle',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 4000, step_increment: 20, page_increment: 100 }),
    });
    settings.bind('height', height, 'value', Gio.SettingsBindFlags.DEFAULT);
    const showHeight = () => {
      const p = settings.get_string('position');
      height.sensitive = p === 'center';
      width.sensitive = p !== 'custom';
    };
    settings.connect('changed::position', showHeight);
    showHeight();
    group.add(height);

    const login = new Adw.SwitchRow({ title: 'Open at login', subtitle: 'Opens the window when you log in, if it is not open' });
    settings.bind('open-at-login', login, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(login);

    window.add(page);
  }
}
