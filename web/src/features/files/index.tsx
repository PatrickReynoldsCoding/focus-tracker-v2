// Files (DECISIONS D31): one tab, like Google Drive, for every note, list, to-do list, whiteboard
// and link, in folders; each project has its own folder. It takes the place of the Notes and
// Whiteboards tabs (flag 'files-tab'; off: those tabs come back). Old addresses (#/notes,
// #/whiteboards) send you to the matching place here. The kinds of files come from the features
// (registerFileType); this feature only knows folders.
import { useEffect } from 'preact/hooks';
import { registerRoute, registerTab } from '../../core/registry';
import { replaceRoute } from '../../core/ui';
import { FilesPage } from './FilesPage';
import { FLAG } from './model';

function Redirect({ to }: { to: string }) {
  useEffect(() => replaceRoute(to), [to]);
  return null;
}

registerTab({
  id: 'files',
  path: '/files',
  label: 'Files',
  icon: '❏',
  order: 30,
  phone: true,
  feature: FLAG,
  replaces: ['notes', 'whiteboards'],
  render: ({ route, params }) => <FilesPage route={route} params={params} />,
});
registerRoute({ id: 'files-from-notes', prefix: '/notes', tab: 'files', feature: FLAG, render: () => <Redirect to="/files" /> });
registerRoute({ id: 'files-from-whiteboards', prefix: '/whiteboards', tab: 'files', feature: FLAG, render: () => <Redirect to="/files?type=whiteboards" /> });
