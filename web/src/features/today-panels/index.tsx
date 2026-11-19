// Today panels: reminder banners (with a count on the Today tab), notes and lists as full
// panels on Today (replacing the link chips), one-at-a-time lists, a list's settings (display
// and linked project) and linked lists on a project's page.
// The two imports first make sure the panels this feature replaces are registered before ours.
import '../today/Today';
import '../projects/ProjectPage';
import { registerPanel } from '../../core/registry';
import { Banners, startBanners } from './banners';
import { LinkedLists, ListSettings, ProjectNotesToday } from './ListSettings';
import { OnToday } from './OnToday';
import './today-panels.css';

startBanners();

registerPanel('today', { id: 'banners', order: 5, wide: true, render: (p) => <Banners {...p} /> });
// Same id as the chip version in today/Today.tsx: this one replaces it.
registerPanel('today', { id: 'on-today', order: 60, render: () => <OnToday /> });

// The list page (features/notes/Notes.tsx draws registerPanel('list', …) panels under its heading).
registerPanel('list', { id: 'list-settings', order: 10, render: ({ list, setList }) => <ListSettings list={list} setList={setList} /> });

registerPanel('project', { id: 'notes-today', order: 21, render: ({ project }) => <ProjectNotesToday projectId={project.id} /> });
// Same id as the link chips in projects/ProjectPage.tsx: linked lists show in full instead.
registerPanel('project', { id: 'lists', order: 60, render: ({ project }) => <LinkedLists project={project} /> });
