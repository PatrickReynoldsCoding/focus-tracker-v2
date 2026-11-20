// Add panel (DECISIONS D33, flag `add-panel`): the sheet "+ Add panel" opens on Today (in the pill
// on screen) and on project pages. The layout (features/layout/adding.tsx) says where things go;
// this feature only draws the choice: the panels not there yet, and Add file, a picker built on the
// Files listing and the registered file types. Off: the layout's older "Add panels…" list.
import { registerPanelAdder } from '../../core/registry';
import { AddPanelSheet } from './AddPanelSheet';
import './add-panel.css';

registerPanelAdder({
  id: 'add-panel',
  order: 10,
  feature: 'add-panel',
  component: AddPanelSheet,
});
