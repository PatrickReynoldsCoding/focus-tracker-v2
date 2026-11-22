// A file's tags in its own page's header (a note's, list's or project's notes page): its chips
// (each opens Files with that tag) and a button that opens the tag editor.
import { useState } from 'preact/hooks';
import type { FileRef } from '../../core/registry';
import { useData } from '../../core/ui';
import { TagChip } from './Chips';
import { TagEditor } from './TagEditor';
import type { TagOnFile } from './store';

export function TagsHeader({ file }: { file: FileRef }) {
  const { data, setData } = useData<TagOnFile[]>(`/tags/of/${file.type}/${file.id}`);
  const [editing, setEditing] = useState(false);
  const tags = data ?? [];
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
