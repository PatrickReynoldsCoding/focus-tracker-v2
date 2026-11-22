import { defineTheme } from './define';

// The dark look the app always had.
export default {
  ...defineTheme({ id: 'midnight', label: 'Midnight', kind: 'dark', bg: '#151514', panel: '#1f1f1d', ink: '#ebeae5', mute: '#9d9d95', acc: '#7fb8a5', line: '#34342f',
    over: { '--surface-2': '#2a2a27', '--accent-fg': '#0f1a16', '--accent-soft': '#23352f' } }),
  profileAccent: true,
};
