// Keeps a copy of the app on the phone so it opens with no internet.
// Bump VERSION whenever any file changes, so phones pick up the new copy.
const VERSION = 'me-1';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'rules.js', 'seed.js', 'manifest.json',
  'icons/icon32.png', 'icons/icon192.png', 'icons/icon512.png', 'icons/maskable512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Use the saved copy first; the app never asks the internet for anything else.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((w) => (w[0] ? w[0].focus() : self.clients.openWindow('./'))));
});
