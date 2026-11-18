import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { readDocs, readScenes } from './v1-files.mjs';
import { htmlToMarkdown, mapV1 } from './v1-map.mjs';

test('rich text becomes Markdown', () => {
  assert.equal(htmlToMarkdown('<p>Make it <b>sticky</b></p><ul><li>a</li><li>b</li></ul>'), 'Make it **sticky**\n\n- a\n- b');
  assert.equal(htmlToMarkdown('<h2>Plan</h2><ol><li>one</li><li>two</li></ol>'), '## Plan\n\n1. one\n2. two');
  assert.equal(htmlToMarkdown('<a href="https://x.y">link</a> &amp; <i>it</i><br>next'), '[link](https://x.y) & *it*\nnext');
  assert.equal(htmlToMarkdown(''), '');
});

test('nested lists, tables, headings with bold, code and quotes', () => {
  assert.equal(htmlToMarkdown('<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>'), '- a\n  - a1\n  - a2\n- b');
  assert.equal(htmlToMarkdown('<ol><li>one<ol><li>x</li></ol></li><li>two</li></ol>'), '1. one\n  1. x\n2. two');
  assert.equal(htmlToMarkdown('<h3><strong>Issue 1:</strong></h3><p>Go</p>'), '### Issue 1:\n\nGo');
  assert.equal(htmlToMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>x | y</td></tr></table>'), '| A | B |\n| --- | --- |\n| 1 | x \\| y |');
  assert.equal(htmlToMarkdown('<p>Use <code>npm test</code> <strong> now </strong>please</p>'), 'Use `npm test` **now** please');
  assert.equal(htmlToMarkdown('<blockquote><p>wise</p></blockquote>'), '> wise');
  assert.equal(htmlToMarkdown('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>'), '- [x] done\n- [ ] todo');
  assert.equal(htmlToMarkdown('<p>one<p>two'), 'one\n\ntwo');
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

test('notes match by file name, case and punctuation tolerant; unmatched files are reported', () => {
  const tabs = {
    Projects: [{ id: 'p1', name: 'Fan-fix (kitchen)' }],
    Lists: [{ id: 'l1', name: 'Today notes', kind: 'note' }],
    Notes: [
      { id: 'n1', project_id: 'p1', doc_id: 'DOC1', preview: 'pre1' },
      { id: 'n2', list_id: 'l1', doc_id: 'DOC2', preview: 'pre2' },
      { id: 'n3', project_id: 'p1', doc_id: 'DOC3', preview: 'pre3' },
    ],
  };
  const named = { 'fan fix kitchen NOTES': 'by name', 'Today notes': 'list body', 'Stray notes': 'x' };
  const { rows, unmatched, warnings } = mapV1(tabs, { DOC3: 'by id' }, { named });
  assert.equal(rows.notes[0].body, 'by name');
  assert.equal(rows.notes[1].body, 'list body');
  assert.equal(rows.notes[2].body, 'by id');
  assert.deepEqual(unmatched.docs, ['Stray notes']);
  assert.equal(warnings.length, 0);
  const again = mapV1(tabs, {}, {});
  assert.equal(again.rows.notes[0].body, 'pre1');
  assert.equal(again.warnings.length, 3);
});

test('short v1 category ids become valid v2 ids everywhere they are used', () => {
  const { rows } = mapV1({ Categories: [{ id: 'job', label: 'Job' }, { id: 'coding', label: 'C' }], Projects: [{ id: 'p0000001', name: 'P', category: 'job' }, { id: 'p0000002', name: 'Q', category: 'coding' }] });
  assert.equal(rows.categories[0].id, 'cat_job');
  assert.equal(rows.projects[0].category_id, 'cat_job');
  assert.equal(rows.categories[1].id, 'coding');
  assert.equal(rows.projects[1].category_id, 'coding');
});

test('whiteboard scenes attach to matching ids only', () => {
  const tabs = { Whiteboards: [{ id: 'aaaa1111', name: 'W' }, { id: 'bbbb2222', name: 'V' }] };
  const scene = { type: 'excalidraw', elements: [] };
  const { rows, unmatched, warnings } = mapV1(tabs, {}, { scenes: { aaaa1111: scene, cccc3333: scene } });
  assert.deepEqual(rows.whiteboards[0].scene, scene);
  assert.equal(rows.whiteboards[1].scene, undefined);
  assert.deepEqual(unmatched.scenes, ['cccc3333']);
  assert.match(warnings[0], /1 whiteboards/);
});

test('reads a .docx, skips conflict copies, finds scene ids in file names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'v1-test-'));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p></w:body></w:document>');
  await writeFile(join(dir, 'Demo notes.docx'), await zip.generateAsync({ type: 'nodebuffer' }));
  await writeFile(join(dir, 'Demo notes - conflict 1.docx'), 'junk');
  await writeFile(join(dir, 'ABC.md'), ' by id ');
  await writeFile(join(dir, 'demo-12abcdef.excalidraw.json'), '{"elements":[]}');
  const f = await readDocs(dir);
  assert.equal(f.named['Demo notes'], '**Hello** world');
  assert.equal(f.docs.ABC, 'by id');
  assert.deepEqual(f.skipped, ['Demo notes - conflict 1.docx']);
  assert.deepEqual(await readScenes(dir), { '12abcdef': { elements: [] } });
  await rm(dir, { recursive: true });
});
