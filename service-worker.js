const CACHE_NAME = "rb-revision-v10";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/assets/styles.css",
  "/assets/fonts/dm-sans-latin.woff2",
  "/assets/fonts/sora-latin.woff2",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/data/caia.json",
  "/data/caia_flashcards.json",
  "/data/gmat.json",
  "/data/energy.json",
  "/data/pe.json",
  "/js/app.js",
  "/js/router.js",
  "/js/quiz.js",
  "/js/ai.js",
  "/js/progress.js",
  "/js/config.js",
  "/js/supabase.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    if (request.method === "GET") {
      fetch(request).then((response) => {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
      }).catch(() => {
      });
    }
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok && request.method === "GET") {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put("/index.html", response.clone());
      cache.put("/", response.clone());
    }
    return response;
  } catch {
    const directMatch = await cache.match(request);
    if (directMatch) {
      return directMatch;
    }

    const cachedIndex = await cache.match("/index.html");
    if (cachedIndex) {
      return cachedIndex;
    }

    return cache.match("/");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin === "https://api.anthropic.com") {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});
