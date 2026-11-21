import type { Column } from '../projects/Board';

export type Overview = { id: string; name: string; folder_id?: string | null; project_id?: string | null; kind: 'list' | 'todo' | 'note'; color: string | null; show_today: boolean; preview?: string; items?: { id?: string; title: string; done?: string | null }[]; open?: number; done_today?: number; count?: number };
export type Todo = { id: string; title: string; day: string | null; done: string | null; group_id: string };
export type FullList = Overview & { body?: string; columns?: Column[]; groups?: { id: string; name: string; todos: Todo[] }[] };

export const KIND_LABEL = { list: 'List', todo: 'To-do list', note: 'Note' };
export const KIND_ICON = { list: '≡', todo: '☐', note: '✎' };

