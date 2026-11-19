// Shape the pages (V1-GAPS 39–41): the desktop grid of Today and the project page (flag
// `movable-panels`). Works on any panel registered for those places, and on the panels their
// sources add (each note, list and whiteboard on Today), so a feature added later is movable too.
// Layout data: GET/PUT /api/layout/<place> (src/modules/layout.ts), per mode, for every device.

import { registerHeaderItem, registerPanelLayout } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { route } from '../../core/ui';
import { editing, GridLayout, gridOn } from './grid';
import './layout.css';

function EditLayoutButton() {
  const place = useSignal(gridOn);
  const ed = useSignal(editing);
  if (!place) return null;
  const on = ed === place;
  return (
    <button class={`ghost lg-edit-btn ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => (editing.value = on ? null : place)} title="Move, resize, remove and add panels on this page">
      {on ? '✓ Done' : '⊞ Edit layout'}
    </button>
  );
}

// Another page ends Edit layout.
route.subscribe(() => (editing.value = null));

registerPanelLayout({ id: 'grid', order: 30, feature: 'movable-panels', places: ['today', 'project'], component: GridLayout });
registerHeaderItem({ id: 'edit-layout', order: 20, feature: 'movable-panels', render: () => <EditLayoutButton /> });
