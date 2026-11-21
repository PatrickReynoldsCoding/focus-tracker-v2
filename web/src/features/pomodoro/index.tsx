// The Pomodoro, on its own (not part of a work session): a floating timer on every page, a Today panel
// (with a small version for phones and widgets) and its settings. Server: src/modules/pomodoro.ts.
import { registerOverlay, registerPanel } from '../../core/registry';
import { FloatingPomodoro, PomodoroCompact, PomodoroPanel, PomodoroSettings } from './Pomodoro';
import './pomodoro.css';

registerOverlay({ id: 'pomodoro-float', order: 5, render: () => <FloatingPomodoro /> });
registerPanel('today', {
  id: 'pomodoro',
  icon: '🍅',
  title: 'Pomodoro',
  description: 'Work periods and breaks. Start, skip and stop; a long break after a few rounds.',
  order: 15,
  render: () => <PomodoroPanel />,
  compact: () => <PomodoroCompact />,
});
registerPanel('settings', { id: 'pomodoro', order: 16, render: () => <PomodoroSettings /> });
