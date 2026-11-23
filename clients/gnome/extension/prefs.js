// Settings for Focus Tracker Desktop: the window's width, position (left, middle, right), height in
// the middle, and opening it at login.
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

    const places = ['left', 'center', 'right'];
    const position = new Adw.ComboRow({ title: 'Position', subtitle: 'On the left or right it fills the height', model: Gtk.StringList.new(['Left', 'Middle', 'Right']) });
    position.selected = Math.max(0, places.indexOf(settings.get_string('position')));
    position.connect('notify::selected', () => settings.set_string('position', places[position.selected]));
    group.add(position);

    const height = new Adw.SpinRow({
      title: 'Height in the middle',
      subtitle: 'In pixels; 0 fills the height. Only used in the middle',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 4000, step_increment: 20, page_increment: 100 }),
    });
    settings.bind('height', height, 'value', Gio.SettingsBindFlags.DEFAULT);
    const showHeight = () => (height.sensitive = settings.get_string('position') === 'center');
    settings.connect('changed::position', showHeight);
    showHeight();
    group.add(height);

    const login = new Adw.SwitchRow({ title: 'Open at login', subtitle: 'Opens the window when you log in, if it is not open' });
    settings.bind('open-at-login', login, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(login);

    window.add(page);
  }
}
