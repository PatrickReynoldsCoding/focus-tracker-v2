// Fills in the service worker (web/public/sw.js) at build time: a build id, the files to keep
// on the device at install (the app shell: the entry, its CSS and the chunks it may load, such as
// the note editor) and every file of this build (so older ones can be cleared). Whiteboards'
// Excalidraw chunks are left out of the install: the service worker keeps them on first use.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Chunks loaded on demand that are not fetched at install (too big for a phone's first visit). */
const ON_FIRST_USE = /\/features\/whiteboards\//;

export function serviceWorker(): Plugin {
  let outDir = '';
  let precache: string[] = [];
  let assets: string[] = [];
  return {
    name: 'ft-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir.startsWith('/') ? c.build.outDir : join(c.root, c.build.outDir);
    },
    generateBundle(_opts, bundle) {
      const keep = new Set<string>();
      const addChunk = (name: string, followDynamic: boolean) => {
        const c = bundle[name];
        if (!c || keep.has(name)) return;
        keep.add(name);
        if (c.type !== 'chunk') return;
        for (const css of (c as any).viteMetadata?.importedCss ?? []) keep.add(css);
        for (const i of c.imports) addChunk(i, followDynamic);
        if (!followDynamic) return;
        for (const d of c.dynamicImports) {
          const dc = bundle[d];
          if (dc?.type === 'chunk' && dc.facadeModuleId && ON_FIRST_USE.test(dc.facadeModuleId)) continue;
          addChunk(d, false);
        }
      };
      for (const [name, c] of Object.entries(bundle)) if (c.type === 'chunk' && c.isEntry) addChunk(name, true);
      precache = [...keep].map((f) => `/${f}`).sort();
      assets = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/'))
        .map((f) => `/${f}`)
        .sort();
    },
    closeBundle() {
      const file = join(outDir, 'sw.js');
      let src: string;
      try {
        src = readFileSync(file, 'utf8');
      } catch {
        return; // no service worker in this build
      }
      const build = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);
      src = src
        .replace("'__FT_BUILD__'", JSON.stringify(build))
        .replace('/*__FT_PRECACHE__*/', precache.map((f) => JSON.stringify(f)).join(','))
        .replace('/*__FT_ASSETS__*/', assets.map((f) => JSON.stringify(f)).join(','));
      writeFileSync(file, src);
    },
  };
}
