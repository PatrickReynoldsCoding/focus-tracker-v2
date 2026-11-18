import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [preact()],
  build: { outDir: '../public', emptyOutDir: true, target: 'es2022', sourcemap: false },
  server: { proxy: { '/api': 'http://localhost:8787', '/auth': 'http://localhost:8787' } },
});
