import preact from '@preact/preset-vite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Excalidraw's fonts, served from our own site (features/whiteboards sets EXCALIDRAW_ASSET_PATH),
 *  so a board draws its hand-written text without a CDN. Xiaolai (Chinese, 13 MB) is left out:
 *  Excalidraw falls back to its CDN for it, only when such text is drawn. */
function excalidrawFonts(): Plugin {
  const root = join(__dirname, '../node_modules/@excalidraw/excalidraw/dist/prod/fonts');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: 'excalidraw-fonts',
    apply: 'build',
    generateBundle() {
      for (const file of walk(root)) {
        const rel = relative(root, file);
        if (rel.startsWith('Xiaolai')) continue;
        this.emitFile({ type: 'asset', fileName: `excalidraw/fonts/${rel}`, source: readFileSync(file) });
      }
    },
  };
}

export default defineConfig({
  root: __dirname,
  // No react → preact/compat aliases: Excalidraw (features/whiteboards) runs on real React in its
  // own lazily loaded chunk; the rest of the app is Preact.
  plugins: [preact({ reactAliasesEnabled: false }), excalidrawFonts()],
  build: { outDir: '../public', emptyOutDir: true, target: 'es2022', sourcemap: false },
  server: { proxy: { '/api': 'http://localhost:8787', '/auth': 'http://localhost:8787' } },
});
