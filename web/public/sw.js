// Focus Tracker's service worker: the app opens with no signal (DECISIONS D27).
// - The page (index.html): network first, the saved copy after 4 seconds or when offline, so a new
//   deploy shows on the next open.
// - Hashed files (/assets/…, Excalidraw's fonts): cache first; their names change when they change.
//   The app shell is fetched at install; other chunks (whiteboards) are kept on first use.
// - Icons and the manifest: the saved copy, refreshed behind.
// - The API is never cached here: the web app keeps its own saved copies (web/src/core/offline.ts).
// The lists below are filled in at build time (web/sw-plugin.ts); this file changes with every
// build, so the browser installs the new version and the old files are cleared a build later.

const BUILD = '__FT_BUILD__';
const PRECACHE = [/*__FT_PRECACHE__*/];
const ASSETS = [/*__FT_ASSETS__*/];
const PUBLIC = ['/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

const SHELL = 'ft-shell'; // the page and the public files
const STATIC = 'ft-static'; // hashed files
const META = 'ft-meta'; // which files the last builds had
const KEEP_BUILDS = 2; // an open page of the previous build can still load its chunks
const BYPASS = /^\/(api|auth|mcp|authorize|oauth|register|\.well-known|health)(\/|$)/;
const PAGE_WAIT = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      const page = await fetch('/', { cache: 'no-store' });
      if (!page.ok) throw new Error(`index.html: ${page.status}`);
      await shell.put('/', page);
      await Promise.all(PUBLIC.map((u) => fetch(u).then((r) => (r.ok ? shell.put(u, r) : undefined)).catch(() => {})));
      const st = await caches.open(STATIC);
      for (const u of PRECACHE) {
        if (await st.match(u)) continue;
        const r = await fetch(u);
        if (!r.ok) throw new Error(`${u}: ${r.status}`);
        await st.put(u, r);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (![SHELL, STATIC, META].includes(k)) await caches.delete(k);
      // Remember this build's files; clear files that no kept build has.
      const meta = await caches.open(META);
      const old = await meta.match('/__builds').then((r) => (r ? r.json() : [])).catch(() => []);
      const builds = [{ build: BUILD, assets: ASSETS }, ...old.filter((b) => b.build !== BUILD)].slice(0, KEEP_BUILDS);
      await meta.put('/__builds', new Response(JSON.stringify(builds), { headers: { 'Content-Type': 'application/json' } }));
      const wanted = new Set(builds.flatMap((b) => b.assets));
      const st = await caches.open(STATIC);
      for (const req of await st.keys()) {
        const path = new URL(req.url).pathname;
        if (path.startsWith('/assets/') && !wanted.has(path)) await st.delete(req);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'build') e.source?.postMessage({ build: BUILD });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || BYPASS.test(url.pathname)) return;
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') e.respondWith(page(e));
  else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/excalidraw/')) e.respondWith(hashed(req, url.pathname));
  else e.respondWith(saved(e, req));
});

/** The page: from the network when it answers within a few seconds, else the saved copy. */
async function page(e) {
  const shell = await caches.open(SHELL);
  const net = fetch(e.request, { cache: 'no-store' }).then(async (res) => {
    if (res.ok && (res.headers.get('Content-Type') ?? '').includes('text/html')) await shell.put('/', res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const copy = await shell.match('/');
  if (!copy) return net;
  const late = new Promise((r) => setTimeout(() => r(copy), PAGE_WAIT));
  return Promise.race([net.catch(() => copy), late]);
}

/** A hashed file: the saved one, or fetch and keep it. */
async function hashed(req, path) {
  const st = await caches.open(STATIC);
  const hit = await st.match(path);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await st.put(path, res.clone());
  return res;
}

/** Icons and the manifest: the saved copy at once, refreshed behind. */
async function saved(e, req) {
  const shell = await caches.open(SHELL);
  const hit = await shell.match(req);
  const net = fetch(req).then(async (res) => {
    if (res.ok) await shell.put(req, res.clone());
    return res;
  });
  if (hit) {
    e.waitUntil(net.catch(() => {}));
    return hit;
  }
  return net;
}
