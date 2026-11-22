// The folder icon; a project's folder carries a small mark, a category's folder (D52) takes the
// category's colour (a palette name, or #rrggbb as --kb) and Projects a stack mark. Colours come
// from the theme's tokens; E-ink draws them all black.

const PALETTE = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'];
const HEX = /^#[0-9a-f]{6}$/i;

export function FolderIcon({ project, size = 24, virtual, color }: { project?: boolean; size?: number; virtual?: 'projects' | 'category'; color?: string | null }) {
  const named = color && PALETTE.includes(color) ? color : undefined;
  const hex = color && HEX.test(color) ? color : undefined;
  return (
    <svg
      class={`folder-icon ${project ? 'is-project' : ''} ${virtual ? `is-${virtual}` : ''}`}
      data-color={virtual === 'category' ? (named ?? (hex ? 'custom' : 'none')) : undefined}
      style={hex ? { '--kb': hex } : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" class="folder-shape" />
      {project && <path d="M8.5 11.5h7M8.5 14.5h4.5" class="folder-mark" />}
      {virtual === 'projects' && <path d="M8 11h8M8 13.5h8M8 16h8" class="folder-mark" />}
    </svg>
  );
}
