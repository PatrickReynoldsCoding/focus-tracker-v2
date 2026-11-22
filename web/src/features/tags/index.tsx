// Tags (DECISIONS D43, flag tags): free labels on any file. Chips on Files' cards and rows and in
// Add file, a Tags filter row on Files, a tag editor in a file's ⋯ menu and on its own page,
// Manage tags (from the filter row and Settings). It plugs in through registerFileAddon
// (core/registry); the server side is src/modules/tags.ts.
import { useState } from 'preact/hooks';
import { registerFileAddon, registerPanel } from '../../core/registry';
import { FileTagChips } from './Chips';
import { TagFilter } from './Filter';
import { TagsHeader } from './Header';
import { ManageTags } from './ManageTags';
import { TagEditor } from './TagEditor';
import { FLAG, useOwnTags } from './store';
import './tags.css';

registerFileAddon({
  id: 'tags',
  order: 10,
  feature: FLAG,
  chips: FileTagChips,
  menu: {
    label: 'Tags…',
    icon: '#',
    dialog: ({ file, onClose, onSaved }) => <TagEditor file={file} initial={file.tags ?? []} onChange={(tags) => onSaved({ tags })} onClose={onClose} />,
  },
  header: TagsHeader,
  filter: { param: 'tag', component: TagFilter },
});

function TagsSettings() {
  const tags = useOwnTags();
  const [open, setOpen] = useState(false);
  return (
    <section class="card">
      <h2>Tags</h2>
      <p class="muted small">Free labels on notes, lists, whiteboards and links, to filter Files by. This profile has {tags ? tags.length : '…'} tag{tags?.length === 1 ? '' : 's'}. Every file of a project also has the project’s own tag (● name), made and kept for you.</p>
      <div class="row">
        <button onClick={() => setOpen(true)}>Manage tags…</button>
      </div>
      {open && <ManageTags onClose={() => setOpen(false)} />}
    </section>
  );
}

registerPanel('settings', { id: 'tags', order: 36, scope: 'profile', feature: FLAG, icon: '🔖', summary: () => 'Tags on your files', render: () => <TagsSettings /> });
