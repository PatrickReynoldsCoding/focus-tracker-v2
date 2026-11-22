// A file's tags in its own page's header (a note's, list's or project's notes page): its chips
// (each opens Files with that tag) and a button that opens the tag editor.
import { useState } from 'preact/hooks';
import { useFlag } from '../../core/features';
import type { FileRef } from '../../core/registry';
import { useData } from '../../core/ui';
import { TagChip } from './Chips';
import { TagEditor } from './TagEditor';
import type { TagOnFile } from './store';

export function TagsHeader({ file }: { file: FileRef }) {
  const { data, setData } = useData<TagOnFile[]>(`/tags/of/${file.type}/${file.id}`);
  const [editing, setEditing] = useState(false);
  // The project's automatic tag is left out while project labels are on (the page's label names the project).
  const labels = useFlag('project-labels');
  const tags = (data ?? []).filter((t) => !(t.auto && labels));
  return (
    <span class="tags-header">
      {tags.map((t) => (
        <TagChip key={t.id} tag={t} link />
      ))}
      <button type="button" class="ghost small tags-header-edit" aria-label={tags.length ? 'Edit tags' : 'Add a tag'} onClick={() => setEditing(true)}>
        {tags.length ? '✎ Tags' : '+ Tag'}
      </button>
      {editing && <TagEditor file={file} initial={data} onChange={(next) => setData(() => next)} onClose={() => setEditing(false)} />}
    </span>
  );
}
