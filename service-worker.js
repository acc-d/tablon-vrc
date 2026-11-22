const SCOPE = self.registration.scope;
const CACHE_PREFIX = `vrc:${new URL(SCOPE).pathname}:`;
const CACHE_VERSION = `${CACHE_PREFIX}v7`;
const BOARD_URL = new URL("./index.html", SCOPE).href;
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./css/vrc.css",
  "./js/app.js",
  "./js/supabase.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || !url.href.startsWith(SCOPE)) {
    return;
  }

  if (request.mode === "navigate") {
    if (url.href === SCOPE || url.href === BOARD_URL) {
      event.respondWith(fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(BOARD_URL)) ?? Response.error();
      }));
    }

    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    return (await cache.match(request)) ?? fetch(request);
  })());
});

function notificationUrl(value) {
  try {
    const target = new URL(value || BOARD_URL, SCOPE);
    const board = new URL(BOARD_URL);
    if (target.origin === board.origin && target.pathname === board.pathname) {
      return target.href;
    }
  } catch (error) {
    console.warn("URL de aviso inválida:", error);
  }
  return BOARD_URL;
}

self.addEventListener("push", (event) => {
  let payload = {
    title: "VRC",
    body: "Hay una nueva publicación.",
    url: "./index.html"
  };

  try {
    if (event.data) {
      payload = {
        ...payload,
        ...event.data.json()
      };
    }
  } catch (error) {
    console.error("Push inválido:", error);
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: new URL("./icons/icon-192.png", SCOPE).href,
      badge: new URL("./icons/icon-192.png", SCOPE).href,
      tag: payload.tag || "rally-board-publication",
      data: {
        url: notificationUrl(payload.url)
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = notificationUrl(event.notification.data?.url);

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const board = windows.find((client) => client.url === targetUrl || client.url === SCOPE);
    if (board) return board.focus();
    return clients.openWindow(targetUrl);
  })());
});
