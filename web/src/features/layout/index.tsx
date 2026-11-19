// Shape the pages (V1-GAPS 39–41): panels on Today and the project page move and resize straight on
// the page (flag `movable-panels`): on a computer the grid (drag by the title, resize from the
// corner, ⋯ for Remove, Auto height, Pop out), on a phone a long press arranges the stack. Today's
// pills (tabs on every screen, each with its own layout) and Today settings (flag `today-pills`), and
// pop-out windows on a wide screen (flag `popout-windows`). Works on any panel registered for those
// places, and on the panels their sources add (each note, list and whiteboard on Today), so a
// feature added later is movable too.
// Layout data: GET/PUT /api/layout/<place> (src/modules/layout.ts), per mode, for every device.

import { registerOverlay, registerPanelLayout } from '../../core/registry';
import { GridLayout } from './grid';
import { PillsLayout } from './pills';
import { PopoutLayout, PopoutWindows } from './popout';
import './layout.css';

// Pop-out windows first: they turn a popped-out panel into a placeholder for the layouts after them.
registerPanelLayout({ id: 'popout', order: 10, feature: 'popout-windows', places: ['today', 'project'], component: PopoutLayout });
registerOverlay({ id: 'popout-windows', order: 50, feature: 'popout-windows', render: () => <PopoutWindows /> });
// Today's pills come before the grid in the chain: they choose the panels, the grid (or a phone's stack) draws them.
registerPanelLayout({ id: 'pills', order: 20, feature: 'today-pills', places: ['today'], component: PillsLayout });
registerPanelLayout({ id: 'grid', order: 30, feature: 'movable-panels', places: ['today', 'project'], component: GridLayout });
