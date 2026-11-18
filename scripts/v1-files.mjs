// Read the optional folders of the v1 importer: notes Docs (.docx, .md, .txt, .html) and Excalidraw scenes.
import mammoth from 'mammoth';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { htmlToMarkdown } from './v1-map.mjs';

/** Notes files: by Doc id (`docs`) and by file name (`named`). Conflict copies are skipped and counted. */
export async function readDocs(dir) {
  const out = { docs: {}, named: {}, skipped: [], ignored: [] };
  if (!dir) return out;
  for (const f of (await readdir(dir)).sort()) {
    const ext = extname(f).toLowerCase();
    if (!['.md', '.txt', '.html', '.docx'].includes(ext)) continue;
    const base = f.slice(0, -ext.length);
    if (/conflict/i.test(f)) {
      out.skipped.push(f);
      continue;
    }
    let text;
    if (ext === '.docx') text = htmlToMarkdown((await mammoth.convertToHtml({ path: join(dir, f) })).value);
    else {
      const raw = await readFile(join(dir, f), 'utf8');
      text = ext === '.html' ? htmlToMarkdown(raw) : raw.trim();
    }
    out.docs[base] = text;
    out.named[base] = text;
  }
  return out;
}

/** Whiteboard scenes by id: the last "-xxxxxxxx" of `<slug>-<id>.excalidraw.json`, or the whole name. */
export async function readScenes(dir) {
  const scenes = {};
  if (!dir) return scenes;
  for (const f of (await readdir(dir)).sort()) {
    if (!f.endsWith('.json')) continue;
    const base = f.replace(/\.excalidraw\.json$|\.json$/, '');
    const id = base.match(/-([0-9a-f]{8})$/)?.[1] ?? base;
    try {
      scenes[id] = JSON.parse(await readFile(join(dir, f), 'utf8'));
    } catch (e) {
      console.log(`  note: whiteboard file ${f} is not valid JSON, skipped`);
    }
  }
  return scenes;
}
