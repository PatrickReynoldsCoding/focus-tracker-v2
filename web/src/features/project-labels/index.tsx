// Project labels (flag project-labels): a small coloured label with a project's name on what
// belongs to a project: files on the Files tab and in Add file, notes, lists and whiteboards on
// Today and on their own pages, and to-dos and cards on the Today list. Features draw
// <ProjectLabel projectId=…> (core/registry); this feature says how it looks. Names come from one
// shared list of the profile's projects (names.ts), never a request per label.
import { registerProjectLabel, type ProjectLabelProps } from '../../core/registry';
import { useProjectName } from './names';
import './project-labels.css';

export const FLAG = 'project-labels';
/** Label colours (the shared tint tokens); red is left out, it means late. */
const TINTS = ['blue', 'green', 'purple', 'orange', 'teal', 'pink', 'yellow'];

/** The same colour for a project everywhere, from its id. */
export function tintOf(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

function Label({ projectId, link = true, class: cls }: ProjectLabelProps) {
  const p = useProjectName(projectId!);
  if (!p) return null;
  const common = { class: `project-label ${cls ?? ''}`, 'data-tint': tintOf(p.id), title: `Project: ${p.name}` };
  const text = <span class="project-label-name">{p.name}</span>;
  if (!link) return <span {...common}>{text}</span>;
  return (
    <a
      {...common}
      href={`#/p/${p.id}`}
      aria-label={`Project: ${p.name}. Open the project`}
      draggable={false}
      // Inside a row that opens something else, the label opens the project only.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {text}
    </a>
  );
}

registerProjectLabel({ id: 'project-labels', order: 0, feature: FLAG, component: Label });
