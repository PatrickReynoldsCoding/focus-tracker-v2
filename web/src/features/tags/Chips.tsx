// A tag as a small chip: "#name", tinted with the tag's colour token, always with an outline (E-ink:
// white with a black outline and the colour's pattern in a dot, never colour alone). On Files it is a link that filters Files by the tag.
import type { FileItem } from '../../core/registry';
import type { TagOnFile } from './store';

/** How many chips a card or row shows before "+n". */
const SHOWN = 2;

export function TagChip({ tag, link, onRemove }: { tag: TagOnFile; link?: boolean; onRemove?: () => void }) {
  const common = { class: 'tag-chip', 'data-tint': tag.color ?? undefined, 'data-pat': tag.color ?? undefined, title: `Tag: ${tag.name}` };
  const text = <span class="tag-chip-name">#{tag.name}</span>;
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

/** A file's tags on its card or row: the first two, then "+n". */
export function FileTagChips({ file, link = true }: { file: FileItem; link?: boolean }) {
  const tags = file.tags ?? [];
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
