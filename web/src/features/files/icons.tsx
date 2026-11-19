// The folder icon; a project's folder carries a small mark. Colours come from the theme's tokens.

export function FolderIcon({ project, size = 24 }: { project?: boolean; size?: number }) {
  return (
    <svg class={`folder-icon ${project ? 'is-project' : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" class="folder-shape" />
      {project && <path d="M8.5 11.5h7M8.5 14.5h4.5" class="folder-mark" />}
    </svg>
  );
}
