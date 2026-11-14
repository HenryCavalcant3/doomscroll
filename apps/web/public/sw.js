/*
 * Service worker do Doomscroll. Guarda só a casca do app (index.html, /assets/ e ícones) para o app
 * instalado abrir mesmo com o bunker fora do ar e mostrar a tela "Sem sinal do bunker".
 * A api (/api/: dados, vídeos com Range, WebSocket) e tudo que não é GET vão sempre para a rede.
 */
const CACHE = "doomscroll-casca-v1";
const SHELL = "/index.html";
const STATIC = ["/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

/** Baixa o index.html atual e os /assets/ que ele usa; apaga do cache os assets de versões antigas. */
async function cacheShell() {
  const res = await fetch("/", { cache: "no-store" });
  if (!res.ok) return;
  const html = await res.clone().text();
  const cache = await caches.open(CACHE);
  await cache.put(SHELL, res);
  const assets = new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]));
  // As fontes entram pelo CSS (url(/assets/...)), não pelo index.html.
  for (const css of [...assets].filter((a) => a.endsWith(".css"))) {
    const text = await (await fetch(css)).text();
    for (const m of text.matchAll(/url\((\/assets\/[^)"']+)\)/g)) assets.add(m[1]);
  }
  await cache.addAll([...assets, ...STATIC]);
  const keep = new Set(assets);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/assets/") && !keep.has(path)) await cache.delete(req);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

/** Quanto a abertura do app espera a rede antes de usar a casca guardada. */
const NETWORK_WAIT_MS = 3000;

/**
 * Abertura do app: rede primeiro, mas por pouco tempo. Sem rede, sem resposta em 3 s (pela rede um
 * bunker desligado pode deixar a conexão pendurada) ou com erro 5xx do proxy, a casca guardada.
 */
async function openApp(event) {
  const network = fetch(event.request).then((res) => {
    if (res.status >= 500) throw new Error(`bunker respondeu ${res.status}`);
    // Mantém a casca em dia depois de uma atualização do app.
    event.waitUntil(cacheShell().catch(() => {}));
    return res;
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("sem resposta")), NETWORK_WAIT_MS));
  try {
    return await Promise.race([network, timeout]);
  } catch {
    network.catch(() => {});
    const shell = await caches.match(SHELL);
    // Sem casca guardada (primeira abertura), resta esperar a rede.
    return shell ?? network;
  }
}

/** Arquivos com hash no nome (ou fixos): cache primeiro. */
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Só a abertura do app; outros endereços (o download do certificado, por exemplo) vão direto.
  if (request.mode === "navigate") {
    if (url.pathname === "/" || url.pathname === SHELL) event.respondWith(openApp(event));
    return;
  }
  if (url.pathname.startsWith("/assets/") || STATIC.includes(url.pathname)) event.respondWith(cacheFirst(request));
});
