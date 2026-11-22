import { defineTheme } from './define';

// The light look the app always had.
export default {
  ...defineTheme({ id: 'paper', label: 'Paper', kind: 'light', bg: '#f6f5f1', panel: '#ffffff', ink: '#1e1f1c', mute: '#686962', acc: '#2f5d50', line: '#e1dfd7',
    over: { '--surface-2': '#efede7', '--accent-fg': '#ffffff', '--accent-soft': '#dfe9e4' } }),
  profileAccent: true,
};
