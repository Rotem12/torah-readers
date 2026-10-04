/* Manifest version: oTcT6h9I */
self.importScripts('./service-worker-assets.js');

// Each project site owns only its own application files on github.io.
const baseUrl = new URL('./', self.location.href);
const cachePrefix = 'torah-readers-shell|' + baseUrl.pathname + '|';
const cacheName = cachePrefix + self.assetsManifest.version;
// .nojekyll configures Pages, but Pages does not serve that dotfile. A 404
// would reject the entire cache installation, including the offline shell.
const assets = self.assetsManifest.assets.filter(asset =>
    asset.url !== '.nojekyll' &&
    !/^service-worker(?:\.published)?\.js$/.test(asset.url) && !/\.pdb$/.test(asset.url));
const assetUrls = new Set(assets.map(asset => new URL(asset.url, baseUrl).href));

self.addEventListener('install', event => event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(assets.map(asset => new Request(new URL(asset.url, baseUrl),
        { integrity: asset.hash, cache: 'no-cache' })));
    // Install the complete new shell before replacing an older worker. The
    // next refresh can load fixes even while another reader tab remains open.
    await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName)
        .map(name => caches.delete(name)));
    await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) return;
    event.respondWith((async () => {
        const cache = await caches.open(cacheName);
        const request = event.request.mode === 'navigate' && !assetUrls.has(url.href)
            ? new URL('index.html', baseUrl).href : event.request;
        return (await cache.match(request)) || fetch(event.request);
    })());
});
