/* eslint-env serviceworker */
// Cache só de casco estático. Navegações SEMPRE vão à rede: servir HTML
// antigo depois de um deploy quebra os nomes hashed dos assets.
const CACHE_NAME = "encomenda-web-v3";
const PRECACHE = [
  "/manifest-porter.webmanifest",
  "/icon-porttag-192.png",
  "/icon-porttag-512.png",
  "/icon-porttag-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(url))),
    ),
  );
  // Sem skipWaiting(): a nova versão entra em vigor só quando o app for
  // reaberto por completo. Nunca no meio de um recebimento.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      ),
  );
  // Sem clients.claim(): não tomamos o controle da aba em uso.
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Os arquivos do Tesseract são grandes e não devem ocupar o cache do celular.
  if (url.pathname.startsWith("/ocr/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => new Response("Sem conexão. Abra o app novamente quando a rede voltar.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      ),
    );
    return;
  }

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
