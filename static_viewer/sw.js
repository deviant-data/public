"use strict";

const CACHE_PREFIX = "static-viewer-v5-";
const CORE_CACHE = `${CACHE_PREFIX}core`;
const CORE_FILES = ["./", "index.html", "render.html", "render.css", "render.js", "schema.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith("/latest.json")) {
    event.respondWith(refreshLatest(request));
    return;
  }

  if (url.pathname.endsWith("/pages/manifest.json")) {
    event.respondWith(refreshJson(request));
    return;
  }

  if (url.pathname.includes("/state/")) {
    event.respondWith(cacheStateAsset(request));
    return;
  }

  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

async function refreshJson(request) {
  return fetch(request, { cache: "no-store" });
}

async function refreshLatest(request) {
  const response = await fetch(request, { cache: "no-store" });
  const clone = response.clone();
  const latest = await response.clone().json().catch(() => null);
  if (latest && (latest.batchId || latest.sha256)) {
    const keep = new Set([CORE_CACHE, `${CACHE_PREFIX}${latest.batchId || latest.sha256}`]);
    await deleteOldCaches(keep);
    const cache = await caches.open(`${CACHE_PREFIX}${latest.batchId || latest.sha256}`);
    await cache.put(request, clone);
  }
  return response;
}

async function cacheStateAsset(request) {
  const latest = await latestStateId();
  const cacheName = latest ? `${CACHE_PREFIX}${latest}` : CORE_CACHE;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await cache.put(request, response.clone());
  return response;
}

async function latestStateId() {
  const response = await fetch("state/latest.json", { cache: "no-store" }).catch(() => null)
    || await fetch("latest.json", { cache: "no-store" }).catch(() => null);
  if (!response || !response.ok) return "";
  const latest = await response.json().catch(() => null);
  return latest && (latest.batchId || latest.sha256) ? String(latest.batchId || latest.sha256) : "";
}

async function deleteOldCaches(keep) {
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name))
    .map((name) => caches.delete(name)));
}
