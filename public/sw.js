// Sogasho Outdoor — app-shell service worker.
// Caches only static brand assets so the app can be installed and opens quickly.
// It never caches pages, API responses or customer data (D-25: no offline data).
const CACHE = "so-outdoor-shell-v1";
const SHELL = [
  "/brand/logo/so-logo-primary.svg",
  "/brand/logo/so-mark.svg",
  "/brand/icons/so-icon-192.png",
  "/brand/icons/so-icon-512.png",
  "/brand/icons/so-icon-maskable-512.png",
  "/brand/pattern/so-triangle-pattern.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isShellAsset =
    event.request.method === "GET" && url.origin === self.location.origin && SHELL.includes(url.pathname);
  if (!isShellAsset) return; // everything else goes straight to the network
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
