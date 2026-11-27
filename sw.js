// Intervia – service worker
// L'app si scarica sempre dalla rete scavalcando la cache del browser (cache: 'no-store');
// la copia salvata serve solo senza connessione. I dati dei servizi esterni non passano di qui.
const VERSION = '2.6.1';
const CACHE = 'intervia-' + VERSION;
const FILES = ['./', './index.html', './manifest.webmanifest', './icons/intervia-icona.svg'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: 'reload'})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  // si salvano solo i file dell'app senza parametri: version.json?t=… e simili non riempiono la cache
  const keep = !u.search && !u.pathname.endsWith('version.json');
  e.respondWith(fetch(e.request, {cache: 'no-store'}).then(r => {
    if (r.ok && keep){ const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('./index.html'))));
});
