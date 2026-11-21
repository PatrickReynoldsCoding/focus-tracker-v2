// Project labels: a small label with the project's name on files, panels and Today's to-dos and
// cards that belong to a project (browser only: web/src/features/project-labels/). The names come
// from the projects list the app already has; this module only declares the flag. Claude sees
// the same in list_files (project_name) and get_today.

import type { Module } from '../core/registry';

export const projectLabelsModule: Module = {
  id: 'project-labels',
  description: 'Labels with the project’s name on files, panels and Today’s to-dos (browser only; no routes or tools).',
  features: [
    {
      id: 'project-labels',
      label: 'Project labels',
      description:
        'A small coloured label with the project’s name on files (Files, Add file), on notes, lists and whiteboards on Today and on their own pages, and on Today’s to-dos and cards that come from a project. Tap it to open the project. Off: no labels.',
      default: true,
    },
  ],
};
