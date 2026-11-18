/* eslint-env serviceworker */
// Cache pequeno e network-first: o app continua atualizando normalmente após
// cada deploy; o cache só serve como fallback quando a rede falha.
const CACHE_NAME = "encomenda-web-v2";
const PRECACHE = [
  "/",
  "/index.html",
  "/manager.html",
  "/porter.html",
  "/manifest-porter.webmanifest",
  "/icon-porttag-192.png",
  "/icon-porttag-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Os arquivos do Tesseract são grandes e não devem ocupar o cache do celular.
  if (url.pathname.startsWith("/ocr/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached ?? new Response("Sem conexão.", { status: 503 });
      }),
  );
});
