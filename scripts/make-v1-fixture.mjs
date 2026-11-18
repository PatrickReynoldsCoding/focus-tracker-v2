// Writes a small spreadsheet shaped like a v1 (layout v6) Personal sheet, for testing the importer.
import ExcelJS from 'exceljs';
const out = process.argv[2] ?? 'v1-fixture.xlsx';
const wb = new ExcelJS.Workbook();
const tab = (name, headers, rows) => {
  const s = wb.addWorksheet(name);
  s.addRow(headers);
  for (const r of rows) s.addRow(headers.map((h) => r[h] ?? ''));
};
tab('Start here', ['text'], [{ text: 'guide' }]);
tab('Categories', ['label', 'color', 'id', 'order'], [{ label: 'Coding', color: 'blue', id: 'cat00001', order: 1 }]);
tab('Projects', ['name', 'category', 'status', 'next_action', 'locked_until', 'last_touched', 'notes', 'problem', 'id', 'created', 'updated_at', 'show_next_action'], [
  { name: 'Website', category: 'cat00001', status: 'active', next_action: 'Fix header', last_touched: '2026-10-01', id: 'prj00001', created: '2026-09-01T10:00:00.000Z', show_next_action: 'on' },
  { name: 'Old thing', status: 'done', id: 'prj00002', created: '2026-01-01T10:00:00.000Z' },
]);
tab('Backlog', ['title', 'category', 'note', 'problem', 'id', 'order', 'created', 'updated_at'], [{ title: 'Learn Go', id: 'bkl00001', order: 1 }]);
tab('Tasks', ['title', 'column', 'project', 'list', 'note', 'color', 'problem', 'id', 'project_id', 'list_id', 'column_id', 'order', 'note_html', 'created', 'updated_at'], [
  { title: 'Header', id: 'tsk00001', project_id: 'prj00001', column_id: 'col00001', order: 1, note: 'plain', note_html: '<p>Make it <b>sticky</b></p><ul><li>mobile</li><li>desktop</li></ul>' },
  { title: 'A book', id: 'tsk00002', list_id: 'lst00001', column_id: 'col00004', order: 1 },
]);
tab('Lists', ['name', 'kind', 'project', 'show_today', 'display', 'seconds', 'color', 'problem', 'id', 'project_id', 'order', 'created'], [
  { name: 'Read', kind: '', id: 'lst00001', order: 1 },
  { name: 'To-dos', kind: 'todo', show_today: 'yes', id: 'lst00002', order: 2 },
  { name: 'Ideas', kind: 'note', id: 'lst00003', order: 3 },
]);
tab('Resources', ['title', 'type', 'value', 'group', 'project', 'category', 'note', 'problem', 'id', 'project_id', 'added'], [{ title: 'Repo', type: 'link', value: 'https://github.com/x/y', group: 'Code', id: 'res00001', project_id: 'prj00001' }]);
tab('Habits', ['name', 'intention', 'sessions', 'per', 'size', 'small_version', 'goal', 'step_up_every', 'prompts', 'category', 'description', 'status', 'problem', 'id', 'next_prompt', 'started', 'order', 'updated_at'], [{ name: 'Run', sessions: 3, per: 'week', status: 'active', id: 'hab00001', order: 1 }]);
tab('To-dos', ['title', 'list', 'group', 'day', 'done', 'project', 'note', 'color', 'problem', 'id', 'list_id', 'group_id', 'project_id', 'order', 'note_html', 'created', 'updated_at'], [
  { title: 'Call bank', day: '2026-11-20', id: 'tod00001', list_id: 'lst00002', group_id: 'col00005', order: 1 },
  { title: 'Done one', done: '2026-11-01', id: 'tod00002', list_id: 'lst00002', group_id: 'col00005', order: 2 },
]);
tab('Whiteboards', ['name', 'project', 'show_today', 'file', 'updated', 'problem', 'id', 'project_id', 'file_id', 'created'], [{ name: 'Plan', id: 'wbd00001', project_id: 'prj00001' }]);
tab('Links', ['from', 'type', 'to', 'note', 'problem', 'id', 'from_id', 'to_id', 'created'], [{ type: 'blocks', id: 'lnk00001', from_id: 'prj00002', to_id: 'prj00001' }]);
tab('Criteria', ['text', 'done', 'project', 'problem', 'id', 'project_id', 'order', 'created', 'updated_at'], [{ text: 'Fast', done: 'yes', id: 'crt00001', project_id: 'prj00001', order: 1 }]);
tab('Log', ['date', 'project', 'where_stopped', 'next_action', 'minutes', 'id', 'project_id'], [{ date: new Date('2026-10-01T00:00:00Z'), where_stopped: 'nav', minutes: 45, id: 'log00001', project_id: 'prj00001' }]);
tab('Columns', ['id', 'project_id', 'list_id', 'name', 'order'], [
  { id: 'col00001', project_id: 'prj00001', name: 'To do', order: 1 },
  { id: 'col00002', project_id: 'prj00001', name: 'Done', order: 2 },
  { id: 'col00004', project_id: 'lst00001', name: 'Items', order: 1 }, // old layout: list id in project_id
  { id: 'col00005', list_id: 'lst00002', name: 'General', order: 1 },
]);
tab('Habit log', ['id', 'habit_id', 'habit', 'day', 'kind', 'count', 'value', 'updated_at'], [{ id: 'hlg00001', habit_id: 'hab00001', day: '2026-11-17', kind: 'done', count: 1 }]);
tab('Notes', ['id', 'project_id', 'list_id', 'doc_id', 'updated', 'written', 'show_today', 'preview'], [
  { id: 'not00001', project_id: 'prj00001', doc_id: 'DOC_A', preview: 'preview only' },
  { id: 'not00002', list_id: 'lst00003', doc_id: 'DOC_B', preview: 'idea preview' },
]);
tab('Stickies', ['id', 'project_id', 'text', 'color', 'opacity', 'x', 'y', 'w', 'h', 'created'], [{ id: 'stk00001', project_id: 'prj00001', text: 'hi', x: 1, y: 2, w: 3, h: 4 }]);
tab('Skips', ['id', 'project_id', 'to_project_id', 'date'], [{ id: 'skp00001', project_id: 'prj00002', to_project_id: 'prj00001', date: '2026-10-02' }]);
tab('Reminders', ['id', 'project_id', 'due', 'created', 'done'], [{ id: 'rem00001', project_id: 'prj00002', due: '2026-10-03', created: '2026-10-02T09:00:00Z' }]);
tab('Settings', ['key', 'value'], [{ key: 'rotation.monday', value: 'cat00001' }, { key: 'rotation.saturday', value: 'away' }, { key: 'layout.today', value: '{}' }]);
await wb.xlsx.writeFile(out);
console.log(`wrote ${out}`);
