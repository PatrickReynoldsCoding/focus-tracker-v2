// A tag as a small chip: "#name", tinted with the tag's colour token, always with an outline (E-ink:
// white with a black outline and the colour's pattern in a dot, never colour alone). On Files it is a link that filters Files by the tag.
// A project's automatic tag (D53) is "● name" with a dashed outline and, where tags are edited, a
// lock in place of ✕: it comes from the project and cannot be taken off.
import { useFlag } from '../../core/features';
import type { FileItem } from '../../core/registry';
import type { TagOnFile } from './store';

/** How many chips a card or row shows before "+n". */
const SHOWN = 2;

export function TagChip({ tag, link, onRemove }: { tag: TagOnFile; link?: boolean; onRemove?: () => void }) {
  const title = tag.auto ? `Project tag: ${tag.name} (automatic, from the project)` : `Tag: ${tag.name}`;
  const common = { class: `tag-chip${tag.auto ? ' tag-auto' : ''}`, 'data-tint': tag.color ?? undefined, 'data-pat': tag.color ?? undefined, title };
  const text = tag.auto ? (
    <span class="tag-chip-name">
      <span class="tag-auto-dot" aria-hidden="true">
        ●{' '}
      </span>
      {tag.name}
    </span>
  ) : (
    <span class="tag-chip-name">#{tag.name}</span>
  );
  if (onRemove && tag.auto)
    return (
      <span {...common}>
        {text}
        <span class="tag-chip-lock" role="img" aria-label="Automatic: it follows the project, it cannot be taken off">
          🔒
        </span>
      </span>
    );
  if (onRemove)
    return (
      <span {...common}>
        {text}
        <button type="button" class="tag-chip-x" aria-label={`Remove tag ${tag.name}`} onClick={onRemove}>
          ✕
        </button>
      </span>
    );
  if (!link) return <span {...common}>{text}</span>;
  return (
    <a
      {...common}
      href={`#/files?tag=${encodeURIComponent(tag.id)}`}
      aria-label={`Tag: ${tag.name}. Show files with this tag`}
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {text}
    </a>
  );
}

/** A file's tags on its card or row: the first two, then "+n". The project's automatic tag is left
 *  out while project labels are on (the label already names the project there). */
export function FileTagChips({ file, link = true }: { file: FileItem; link?: boolean }) {
  const labels = useFlag('project-labels');
  const tags = (file.tags ?? []).filter((t: TagOnFile) => !(t.auto && labels));
  if (!tags.length) return null;
  const rest = tags.length - SHOWN;
  return (
    <span class="tag-chips" title={tags.map((t) => `#${t.name}`).join(' ')}>
      {tags.slice(0, SHOWN).map((t) => (
        <TagChip key={t.id} tag={t} link={link} />
      ))}
      {rest > 0 && (
        <span class="tag-chip tag-more" aria-label={`${rest} more tag${rest === 1 ? '' : 's'}`}>
          +{rest}
        </span>
      )}
    </span>
  );
}
