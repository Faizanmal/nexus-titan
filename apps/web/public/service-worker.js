const CACHE_PREFIX = "nexus-shell-v1-";
const CACHE = `${CACHE_PREFIX}2026-11-15`;
const SHELL = ["/", "/world", "/fieldrelay", "/mesh", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search || request.headers.has("RSC") || request.headers.has("Next-Router-State-Tree") || url.pathname.startsWith("/api/") || url.pathname.startsWith("/sync/") || url.pathname.includes("auth") || url.pathname.includes("token")) return;
  const approvedAsset = url.pathname === "/" || url.pathname === "/world" || url.pathname === "/fieldrelay" || url.pathname === "/mesh" || url.pathname === "/offline" || url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fixtures/TITAN-WTP-01/");
  if (!approvedAsset) return;
  if (url.pathname.startsWith("/fixtures/TITAN-WTP-01/")) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") await cache.put(request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(request);
        if (!cached) return new Response("Fixture is not cached.", { status: 503, headers: { "Content-Type": "text/plain" } });
        const headers = new Headers(cached.headers);
        headers.set("X-Nexus-Cache", "stale-possible");
        return new Response(await cached.blob(), { status: cached.status, statusText: cached.statusText, headers });
      }
    }));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    } catch {
      return cached ?? new Response("Offline asset is not cached.", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  }));
});
