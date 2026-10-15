#!/usr/bin/env node
'use strict';
// Synthetic fixtures only. Never loads app.js, seed data, a saved browser profile,
// owner credentials, or the live API. --browser enables real service workers on
// three ephemeral loopback origins; the normal run has no network dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const API_ORIGIN = 'https://gkotvodoqwdhmdeigrra.supabase.co';
const CURRENT_CACHE = /const CACHE = '([^']+)'/.exec(source)?.[1];
assert(CURRENT_CACHE && CURRENT_CACHE !== 'roger-care-v63', 'Worker cache version advanced');

// Frozen verbatim from origin/main:sw.js at commit
// 32a1e2fb55f60e0b67f0cd2f84307f3084199a4b. Do not resolve origin/main at
// runtime: CI tests the new main, so a moving reference would hide regressions.
const OLD_WORKER = `const CACHE = 'roger-care-v63';
const CORE = ['./','./index.html','./styles.css?v=45','./import-analysis.js?v=2','./app.js?v=63','./manifest.webmanifest?v=27','./data/seed.json','./icons/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const isAppShell =
    event.request.mode === 'navigate' ||
    event.request.url.includes('/app.js') ||
    event.request.url.includes('/styles.css') ||
    event.request.url.includes('/manifest.webmanifest') ||
    event.request.url.includes('/data/seed.json');

  if (isAppShell) {
    event.respondWith(
      fetch(event.request, {cache:'no-store'})
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});
`;
assert.equal(createHash('sha256').update(OLD_WORKER).digest('hex'),
  'df77f98773d82bdef92183a14b23e7856b951a53efc24c0ce9ed58268620e422',
  'Upgrade fixture remains the exact original v63 worker');

const queryPaths = [
  '/rest/v1/roger_shared_record?select=record%2Crevision%2Cupdated_at&id=eq.roger',
  '/rest/v1/roger_shared_record?select=revision%2Cupdated_at&id=eq.roger',
];
function fixture(revision, metadata = false) {
  const value = { revision, updated_at: `2026-01-01T00:00:${String(revision - 60).padStart(2, '0')}Z` };
  if (!metadata) value.record = { profile: { name: 'Synthetic patient' }, labs: [{ id: `synthetic-${revision}` }] };
  return value;
}

function harness(workerSource) {
  const listeners = {}, stores = new Map(), networkCalls = [], cacheCalls = [];
  const origin = 'https://synthetic-app.invalid';
  const key = request => new URL(typeof request === 'string' ? request : request.url, origin + '/').href;
  const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { cacheCalls.push(['delete', name]); return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      return {
        async put(request, value) { cacheCalls.push(['put', key(request)]); stores.get(name).set(key(request), value.clone()); },
        async match(request) { return stores.get(name).get(key(request))?.clone(); },
        async addAll(urls) { for (const url of urls) stores.get(name).set(key(url), new Response('synthetic shell')); },
      };
    },
    async match(request) {
      cacheCalls.push(['match', key(request)]);
      for (const values of stores.values()) if (values.has(key(request))) return values.get(key(request)).clone();
    },
  };
  let revision = 68, status = 200, offline = false, claimed = false;
  const context = vm.createContext({
    URL, Request, Response, caches,
    self: { location: { origin }, addEventListener(name, fn) { listeners[name] = fn; }, skipWaiting() {}, clients: { claim() { claimed = true; } } },
    async fetch(request, options) {
      networkCalls.push({ request, options });
      if (offline) throw new TypeError('Synthetic network offline');
      return new Response(JSON.stringify(status === 200 ? fixture(revision, !request.url.includes('record%2C')) : { error: 'synthetic error' }), {
        status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    },
  });
  vm.runInContext(workerSource, context, { filename: 'sw.js' });
  return {
    caches, stores, networkCalls, cacheCalls, response,
    set(options) { if ('revision' in options) revision = options.revision; if ('status' in options) status = options.status; if ('offline' in options) offline = options.offline; },
    dispatch(request) { let intercepted = false, result; listeners.fetch({ request, respondWith(value) { intercepted = true; result = Promise.resolve(value); } }); return { intercepted, result }; },
    async activate() { let result; listeners.activate({ waitUntil(value) { result = value; } }); await result; assert(claimed, 'Activation claims clients'); },
  };
}

async function vmChecks() {
  const old = harness(OLD_WORKER);
  for (const url of queryPaths.map(p => API_ORIGIN + p)) {
    await (await old.caches.open('roger-care-v63')).put(url, old.response(fixture(67)));
    assert.equal((await (await old.dispatch(new Request(url, { cache: 'no-store' })).result).json()).revision, 67);
  }
  assert.equal(old.networkCalls.length, 0, 'Old worker reproduces stale reads even with request no-store');

  const h = harness(source), urls = queryPaths.map(p => API_ORIGIN + p);
  for (const url of urls) await (await h.caches.open('unrelated-cache')).put(url, h.response(fixture(67)));
  await h.caches.open('roger-care-v63'); await h.caches.open(CURRENT_CACHE);
  await h.activate();
  assert.deepEqual(await h.caches.keys(), ['unrelated-cache', CURRENT_CACHE], 'Only obsolete Roger Care caches removed');
  h.cacheCalls.length = 0;
  for (const revision of [68, 69, 70]) {
    h.set({ revision });
    for (const url of urls) {
      const request = new Request(url, { headers: { authorization: 'Bearer synthetic', apikey: 'synthetic' } });
      const { intercepted, result } = h.dispatch(request);
      assert(intercepted);
      assert.equal((await (await result).json()).revision, revision, 'Same URL always reads current revision');
      const call = h.networkCalls.at(-1);
      assert.equal(call.request, request, 'Original request including headers is preserved');
      assert.equal(call.options.cache, 'no-store');
    }
  }
  for (const status of [401, 403, 500, 503]) {
    h.set({ status });
    for (const url of urls) assert.equal((await h.dispatch(new Request(url)).result).status, status, 'Error remains visible; no stale fallback');
  }
  h.set({ offline: true });
  for (const url of urls) await assert.rejects(h.dispatch(new Request(url)).result, /Synthetic network offline/);
  assert.deepEqual(h.cacheCalls, [], 'API requests never consult or mutate CacheStorage');
  h.set({ offline: false, status: 200 });
  const post = new Request(API_ORIGIN + '/rest/v1/rpc/roger_replace_record', { method: 'POST', body: '{"synthetic":true}' });
  const priorCalls = h.networkCalls.length;
  assert.equal(h.dispatch(post).intercepted, false, 'POST bypasses worker unchanged');
  assert.equal(h.networkCalls.length, priorCalls);
  const authRead = h.dispatch(new Request(API_ORIGIN + '/auth/v1/user'));
  assert(authRead.intercepted); await authRead.result;
  assert.equal(h.networkCalls.at(-1).options.cache, 'no-store', 'Auth GET shares the network-only boundary');
  const cdn = 'https://synthetic-cdn.invalid/pdf.min.js';
  await (await h.caches.open(CURRENT_CACHE)).put(cdn, new Response('synthetic PDF library'));
  await (await h.caches.open(CURRENT_CACHE)).put('./index.html', new Response('synthetic offline app'));
  h.set({ offline: true });
  assert.equal(await (await h.dispatch(new Request(cdn)).result).text(), 'synthetic PDF library');
  const navigate = { url: 'https://synthetic-app.invalid/missing', method: 'GET', mode: 'navigate' };
  assert.equal(await (await h.dispatch(navigate).result).text(), 'synthetic offline app');
  console.log('VM: v63 stale-cache reproduction; fresh viewer/metadata/auth GETs; repeated revisions; errors/offline; untouched POST; scoped cleanup; cached CDN and offline app passed');
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

async function browserChecks() {
  const { chromium } = require('playwright');
  let revision = 67, status = 200, disconnect = false, upgraded = false;
  const requests = [], cdnRequests = [], servers = [];
  let browser;
  const html = '<!doctype html><title>Synthetic Roger Care worker test</title><h1 id="offline-shell">Synthetic app shell</h1>';
  try {
    const api = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') { res.end(); return; }
      if (disconnect) { req.socket.destroy(); return; }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.setHeader('Content-Type', 'application/json');
        // Deliberately cacheable HTTP response: worker no-store must override it.
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.statusCode = status;
        res.end(JSON.stringify(status === 200 ? fixture(revision, !req.url.includes('record%2C')) : { error: 'synthetic error' }));
      });
    });
    servers.push(api); const apiOrigin = await listen(api);
    const cdn = http.createServer((req, res) => {
      cdnRequests.push(req.url); res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Cache-Control', 'no-store');
      res.end('/* synthetic cached PDF/OCR dependency */');
    });
    servers.push(cdn); const cdnOrigin = await listen(cdn);
    assert(source.includes(API_ORIGIN), 'Worker contains the exact API origin to substitute');
    const currentWorker = source.replaceAll(API_ORIGIN, apiOrigin);
    assert(!currentWorker.includes(API_ORIGIN), 'Synthetic worker cannot reach production API');
    const app = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://fixture.invalid').pathname;
      res.setHeader('Cache-Control', 'no-store');
      if (pathname === '/sw.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(upgraded ? currentWorker : OLD_WORKER); }
      else if (pathname === '/' || pathname === '/index.html') { res.setHeader('Content-Type', 'text/html'); res.end(html); }
      else if (pathname === '/data/seed.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture(1).record)); }
      else if (pathname.endsWith('.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end('/* synthetic app dependency */'); }
      else if (pathname.endsWith('.css')) { res.setHeader('Content-Type', 'text/css'); res.end('body { color: black; }'); }
      else if (pathname.endsWith('.webmanifest')) { res.setHeader('Content-Type', 'application/manifest+json'); res.end('{}'); }
      else { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); }
    });
    servers.push(app); const appOrigin = await listen(app);
    const allowed = new Set([appOrigin, apiOrigin, cdnOrigin]);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const unexpected = [];
    // All fixture URLs and worker imports are loopback. Block any accidental
    // non-loopback request as a second guard, including service-worker requests.
    await context.route('**/*', route => {
      if (allowed.has(new URL(route.request().url()).origin)) return route.continue();
      unexpected.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    await page.goto(appOrigin + '/');
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }); await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const urls = queryPaths.map(p => apiOrigin + p);
    const read = (url, options = {}) => page.evaluate(async ({ url, options }) => {
      try {
        const response = await fetch(url, { ...options, headers: { authorization: 'Bearer synthetic-only', apikey: 'synthetic-only', ...options.headers } });
        return { status: response.status, data: await response.json() };
      } catch (error) { return { failed: true, name: error.name }; }
    }, { url, options });
    const apiCount = () => requests.filter(r => r.method === 'GET').length;
    for (const url of urls) assert.equal((await read(url)).data.revision, 67);
    await page.waitForFunction(async urls => (await Promise.all(urls.map(url => caches.match(url)))).every(Boolean), urls);
    revision = 68;
    const oldCount = apiCount();
    for (const url of urls) assert.equal((await read(url, { cache: 'no-store' })).data.revision, 67);
    assert.equal(apiCount(), oldCount, 'Actual old worker returns stale cached responses without a network request');

    // All saved values are new synthetic fixtures in this ephemeral profile.
    await page.evaluate(async ({ urls, old }) => {
      localStorage.setItem('rogerCareState_v1', JSON.stringify({ profile: { name: 'Synthetic owner master', photoDataUrl: 'synthetic-photo' }, labs: [{ id: 'local-only' }] }));
      localStorage.setItem('rogerCarePendingCloud_v1', '1');
      localStorage.setItem('rogerCareBackupStatus_v1', '{"synthetic":true}');
      localStorage.setItem('synthetic-auth-session', '{"access_token":"not-a-real-token"}');
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('rogerCareDocuments_v1', 1);
        request.onupgradeneeded = () => { request.result.createObjectStore('documents', { keyPath: 'id' }); request.result.createObjectStore('recoverySnapshots', { keyPath: 'id' }); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(['documents', 'recoverySnapshots'], 'readwrite');
        transaction.objectStore('documents').put({ id: 'synthetic-document', name: 'synthetic.pdf', blob: new Blob(['synthetic document bytes'], { type: 'application/pdf' }) });
        transaction.objectStore('recoverySnapshots').put({ id: 'synthetic-recovery', state: { profile: { name: 'Synthetic recovery' } } });
        transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      const unrelated = await caches.open('unrelated-cache');
      await unrelated.put('/unrelated-resource', new Response('unrelated cache survives'));
      // These survive scoped activation, so cache deletion cannot accidentally
      // make the new worker pass its network-only test.
      for (const url of urls) await unrelated.put(url, new Response(JSON.stringify(old), { headers: { 'Content-Type': 'application/json' } }));
    }, { urls, old: fixture(67) });
    const snapshot = () => page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('rogerCareDocuments_v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const values = {};
      for (const name of ['documents', 'recoverySnapshots']) values[name] = await new Promise((resolve, reject) => { const request = database.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      for (const doc of values.documents) { doc.bytes = [...new Uint8Array(await doc.blob.arrayBuffer())]; doc.type = doc.blob.type; delete doc.blob; }
      database.close();
      return { storage: Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])), values };
    });
    const before = await snapshot();
    upgraded = true;
    const changed = await page.evaluate(async () => {
      const oldController = navigator.serviceWorker.controller;
      const takeover = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('New worker never took control')), 20000);
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timeout); resolve(navigator.serviceWorker.controller !== oldController); }, { once: true });
      });
      await (await navigator.serviceWorker.getRegistration()).update();
      return takeover;
    });
    assert.equal(changed, true, 'Real controllerchange confirms replacement of old worker');
    assert.deepEqual((await page.evaluate(() => caches.keys())).sort(), [CURRENT_CACHE, 'unrelated-cache'].sort());
    assert.equal(await page.evaluate(async () => await (await (await caches.open('unrelated-cache')).match('/unrelated-resource')).text()), 'unrelated cache survives');
    assert.deepEqual(await snapshot(), before, 'Upgrade preserves local master, pending flag, auth, photo, documents, and recovery copies');
    for (const next of [68, 69, 70]) {
      revision = next;
      for (const url of urls) {
        const count = apiCount(); const result = await read(url);
        assert.equal(result.data.revision, next); assert.equal(apiCount(), count + 1, 'Every same-URL read reaches API');
        assert.equal(requests.at(-1).headers.authorization, 'Bearer synthetic-only');
      }
    }
    const currentKeys = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(r => r.url), CURRENT_CACHE);
    assert(!currentKeys.some(url => new URL(url).origin === apiOrigin), 'No API responses entered current cache');
    for (const next of [401, 403, 500, 503]) {
      status = next;
      for (const url of urls) { const result = await read(url); assert.equal(result.status, next); assert(!('revision' in result.data)); }
    }
    status = 200; disconnect = true;
    for (const url of urls) assert.equal((await read(url)).failed, true, 'Network failure never returns cached API record');
    disconnect = false;
    const postBody = JSON.stringify({ p_record: { profile: { name: 'Synthetic POST only' } } });
    assert.equal((await read(apiOrigin + '/rest/v1/rpc/roger_replace_record', { method: 'POST', body: postBody, headers: { 'Content-Type': 'application/json' } })).status, 200);
    assert.equal(requests.at(-1).method, 'POST'); assert.equal(requests.at(-1).body, postBody);
    assert.equal(requests.at(-1).headers.authorization, 'Bearer synthetic-only');
    const dependencies = ['/pdfjs-dist@3.11.174/build/pdf.min.js', '/tesseract.js@5/dist/tesseract.min.js'].map(p => cdnOrigin + p);
    for (const url of dependencies) assert.equal(await page.evaluate(async url => await (await fetch(url)).text(), url), '/* synthetic cached PDF/OCR dependency */');
    await page.waitForFunction(async urls => (await Promise.all(urls.map(url => caches.match(url)))).every(Boolean), dependencies);
    const cdnCount = cdnRequests.length;
    await context.setOffline(true);
    for (const url of urls) assert.equal((await read(url)).failed, true, 'Actual offline read does not use stale API response');
    for (const url of dependencies) assert.equal(await page.evaluate(async url => await (await fetch(url)).text(), url), '/* synthetic cached PDF/OCR dependency */');
    assert.equal(cdnRequests.length, cdnCount, 'Cached PDF/OCR dependencies work without a CDN request');
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#offline-shell').textContent(), 'Synthetic app shell');
    assert.deepEqual(await snapshot(), before, 'Offline reload and failed requests preserve all local fixtures');
    await context.setOffline(false);
    revision = 71;
    for (const url of urls) assert.equal((await read(url)).data.revision, 71, 'Reconnect resumes current API reads');
    assert.deepEqual(unexpected, [], 'No non-loopback requests');
    await context.close();

    // Clean installation is separately covered, without a pre-existing cache.
    const fresh = await browser.newContext({ serviceWorkers: 'allow' });
    await fresh.route('**/*', route => allowed.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const freshPage = await fresh.newPage();
    await freshPage.goto(appOrigin + '/');
    await freshPage.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await freshPage.waitForFunction(() => !!navigator.serviceWorker.controller);
    for (const next of [72, 73]) {
      revision = next;
      assert.equal(await freshPage.evaluate(async url => (await (await fetch(url)).json()).revision, urls[0]), next);
    }
    await fresh.close();
    console.log('BROWSER: real v63 reproduction and controllerchange upgrade; same-URL fresh reads; errors/offline/reconnect; POST; scoped cleanup; exact localStorage/IndexedDB/document preservation; offline app and cached PDF/OCR; clean installation passed');
  } finally {
    if (browser) await browser.close();
    await Promise.all(servers.map(close));
  }
}

(async () => {
  await vmChecks();
  if (process.argv.includes('--browser')) await browserChecks();
})().catch(error => { console.error(error); process.exitCode = 1; });
