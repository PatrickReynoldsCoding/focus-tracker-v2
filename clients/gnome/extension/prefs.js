// Settings for Focus Tracker Desktop: the window's width and opening it at login.
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

    const login = new Adw.SwitchRow({ title: 'Open at login', subtitle: 'Opens the window when you log in, if it is not open' });
    settings.bind('open-at-login', login, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(login);

    window.add(page);
  }
}
