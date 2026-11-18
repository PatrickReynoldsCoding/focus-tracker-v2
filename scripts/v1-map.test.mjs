import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToMarkdown, mapV1 } from './v1-map.mjs';

test('rich text becomes Markdown', () => {
  assert.equal(htmlToMarkdown('<p>Make it <b>sticky</b></p><ul><li>a</li><li>b</li></ul>'), 'Make it **sticky**\n\n- a\n- b');
  assert.equal(htmlToMarkdown('<h2>Plan</h2><ol><li>one</li><li>two</li></ol>'), '## Plan\n\n1. one\n2. two');
  assert.equal(htmlToMarkdown('<a href="https://x.y">link</a> &amp; <i>it</i><br>next'), '[link](https://x.y) & *it*\nnext');
  assert.equal(htmlToMarkdown(''), '');
});

test('maps tabs, moves list ids out of project_id, keeps rotation only', () => {
  const { rows, settings, warnings } = mapV1(
    {
      Lists: [{ id: 'l1', name: 'L', kind: '' }],
      Columns: [{ id: 'c1', project_id: 'l1', name: 'Items' }],
      Projects: [{ id: 'p1', name: 'P', status: 'weird' }],
      Notes: [{ id: 'today' }, { id: 'n1', project_id: 'p1', doc_id: 'D1', preview: 'pre' }],
      Settings: [{ key: 'rotation.monday', value: 'c' }, { key: 'layout.today', value: '{}' }],
    },
    {},
  );
  assert.deepEqual(rows.columns[0], { id: 'c1', name: 'Items', list_id: 'l1' });
  assert.equal(rows.lists[0].kind, 'list');
  assert.equal(rows.projects[0].status, 'active');
  assert.equal(rows.notes.length, 1);
  assert.equal(rows.notes[0].body, 'pre');
  assert.match(warnings[0], /D1/);
  assert.deepEqual(settings, { 'rotation.monday': 'c' });
});
