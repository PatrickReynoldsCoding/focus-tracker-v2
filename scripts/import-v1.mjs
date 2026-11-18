#!/usr/bin/env node
// Import a Focus Tracker v1 spreadsheet into v2.
//
//   1. In Google Sheets, open the mode's spreadsheet: File → Download → Microsoft Excel (.xlsx).
//   2. Optional: put the notes Docs in a folder (--docs): <doc id>.md / .txt / .html / .docx, or a file named after
//      its owner, "<project or note list name> notes.docx" (also .md). Without a file a note gets v1's preview.
//   3. Optional: Excalidraw scenes (--whiteboards): <slug>-<whiteboard id>.excalidraw.json (or <id>.json).
//   4. node scripts/import-v1.mjs --url https://your-tracker --token ft_... --mode personal --xlsx Personal.xlsx [--docs notes/] [--whiteboards boards/] [--dry-run]
//
// Rows keep their v1 ids, so running it again skips what is already there.

import ExcelJS from 'exceljs';
import { parseArgs } from 'node:util';
import { readDocs, readScenes } from './v1-files.mjs';
import { mapV1, ORDER } from './v1-map.mjs';

const { values: a } = parseArgs({
  options: {
    url: { type: 'string' },
    token: { type: 'string', default: process.env.FT_TOKEN },
    mode: { type: 'string', default: 'personal' },
    xlsx: { type: 'string' },
    docs: { type: 'string' },
    whiteboards: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!a.xlsx || (!a['dry-run'] && (!a.url || !a.token))) {
  console.error('Usage: import-v1.mjs --url URL --token ft_... --mode personal --xlsx file.xlsx [--docs dir] [--whiteboards dir] [--dry-run]');
  process.exit(2);
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return String(v.text);
    if ('richText' in v) return v.richText.map((p) => p.text).join('');
    if ('hyperlink' in v) return String(v.hyperlink);
  }
  return v;
}

export async function readTabs(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const tabs = {};
  wb.eachSheet((sheet) => {
    const rows = [];
    let headers = [];
    sheet.eachRow({ includeEmpty: false }, (row, n) => {
      const vals = row.values.slice(1).map(cellValue);
      if (n === 1) headers = vals.map((h) => String(h).trim());
      else rows.push(Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ''])));
    });
    tabs[sheet.name] = rows;
  });
  return tabs;
}

async function send(method, path, body) {
  const res = await fetch(`${a.url.replace(/\/$/, '')}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${a.token}`, 'X-Mode': a.mode, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${data.error ?? ''}`);
  return data;
}

const tabs = await readTabs(a.xlsx);
const files = await readDocs(a.docs);
const scenes = await readScenes(a.whiteboards);
const { rows, settings, warnings, unmatched } = mapV1(tabs, files.docs, { named: files.named, scenes });
console.log(`Read ${Object.keys(tabs).length} tabs from ${a.xlsx}`);
for (const k of ORDER) if (rows[k].length) console.log(`  ${k}: ${rows[k].length}`);
for (const w of warnings) console.log(`  note: ${w}`);
if (files.skipped.length) console.log(`  skipped ${files.skipped.length} conflict copies`);
for (const f of unmatched.docs) console.log(`  unmatched notes file: ${f}`);
for (const id of unmatched.scenes) console.log(`  unmatched whiteboard file: id ${id} (no Whiteboards row)`);
if (a['dry-run']) process.exit(0);

let problems = 0;
for (const kind of ORDER) {
  for (let i = 0; i < rows[kind].length; i += 200) {
    const r = await send('POST', `/import/${kind}`, { rows: rows[kind].slice(i, i + 200) });
    console.log(`${kind}: ${r.created} added, ${r.skipped} already there${r.errors.length ? `, ${r.errors.length} refused` : ''}`);
    for (const e of r.errors) console.log(`  ${e.id}: ${e.error}`);
    problems += r.errors.length;
  }
}
// A whiteboard that was imported earlier without its drawing gets the drawing now.
for (const w of rows.whiteboards.filter((x) => x.scene)) {
  const cur = await send('GET', `/whiteboards/${w.id}`);
  if (!cur.scene) {
    await send('PATCH', `/whiteboards/${w.id}`, { scene: w.scene });
    console.log(`whiteboards: drawing added to ${w.id}`);
  }
}
if (Object.keys(settings).length) {
  await send('PUT', '/import/settings', { values: settings });
  console.log(`settings: ${Object.keys(settings).length} rotation values`);
}
console.log(problems ? `Done with ${problems} refused rows (see above).` : 'Done.');
