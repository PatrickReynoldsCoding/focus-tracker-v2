// Today panels: reminder banners (with a count on the Today tab), notes and lists as full
// panels on Today (replacing the link chips), one-at-a-time lists, a list's settings (display
// and linked project) and each linked list as a panel on a project's page.
// The import first makes sure the panels this feature replaces are registered before ours.
import '../today/Today';
import { registerPanel, registerPanelSource } from '../../core/registry';
import { Banners, BannersSmall, startBanners } from './banners';
import { LinkedListSource, ListSettings, resolveLinkedList } from './ListSettings';
import { AddToToday, addableOnToday, OnTodaySource, resolveOnToday } from './OnToday';
import './today-panels.css';

startBanners();

registerPanel('today', { id: 'banners', title: 'Reminders', fixed: 'top', order: 5, wide: true, render: (p) => <Banners {...p} />, small: () => <BannersSmall /> });
// Same id as the chip version in today/Today.tsx: this one replaces it with "+ Add to Today", and
// each note and list on Today is its own panel (a source, so it can be moved, put in a pill or popped out).
registerPanel('today', { id: 'on-today', title: 'Add to Today button', fixed: 'bottom', order: 60, render: () => <AddToToday /> });
registerPanelSource('today', { id: 'on-today', order: 60, Provide: OnTodaySource, resolve: resolveOnToday, addable: addableOnToday });

// The list page (features/notes/Notes.tsx draws registerPanel('list', …) panels under its heading).
registerPanel('list', { id: 'list-settings', order: 10, render: ({ list, setList }) => <ListSettings list={list} setList={setList} /> });

registerPanelSource('project', { id: 'linked-lists', order: 60, Provide: LinkedListSource, resolve: resolveLinkedList });
