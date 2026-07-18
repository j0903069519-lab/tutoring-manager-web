const CACHE_NAME = "tutoring-manager-web-v16-week-timeline";
const ASSETS = [
  "./",
  "index.html",
  "styles.css?v=20260718-week-timeline",
  "app.js?v=20260718-week-timeline",
  "manifest.webmanifest",
  "data/encrypted-data.json",
  "data/Lessons.json",
  "data/StudentDefaults.json",
  "data/ExternalIncome.json"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
