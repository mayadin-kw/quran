const CACHE_NAME = 'ihfad-mushaf-pages-v4';
const STORAGE_PREFIX = 'https://firebasestorage.googleapis.com/v0/b/ihfad-2fecd.firebasestorage.app/o/quran-pages%2F';
const AUDIO_PREFIX = 'https://firebasestorage.googleapis.com/v0/b/ihfad-2fecd.firebasestorage.app/o/audio%2Fhusary-muallim-128%2F';
const COORDINATE_PREFIX = 'https://firebasestorage.googleapis.com/v0/b/ihfad-2fecd.firebasestorage.app/o/ayah-coordinates%2F';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  if (!event.request.url.startsWith(STORAGE_PREFIX) && !event.request.url.startsWith(AUDIO_PREFIX) && !event.request.url.startsWith(COORDINATE_PREFIX)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok || response.type === 'opaque') await cache.put(event.request, response.clone());
    return response;
  })());
});
