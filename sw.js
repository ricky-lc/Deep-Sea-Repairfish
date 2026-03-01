/**
 * Deep-sea Reparefish — Service Worker
 * Strategy: cache-first for all game assets, network-first for the rooms API.
 */
'use strict';

var CACHE_NAME = 'reparefish-v2';

// All static assets needed to play offline
var PRECACHE_URLS = [
  './',
  './index.html',
  './game.js',
  './style.css',
  './manifest.json',
  './assets/skins.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/images/background.png',
  './assets/images/skins/elegant.png',
  './assets/images/skins/viking.png',
  './assets/images/skins/ninja.png'
];

// ── Install: pre-cache all static assets ─────────────────────────────────────
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Cache each URL individually so a single missing asset doesn't fail everything
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn('[SW] Failed to cache', url, err);
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// ── Activate: remove old caches ───────────────────────────────────────────────
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// ── Fetch: cache-first for static assets, network-first for /api/* ────────────
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for multiplayer API (always needs fresh data)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(function () {
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
      })
    );
    return;
  }

  // Cache-first for everything else (game assets, HTML, JS, CSS)
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;

      // Not in cache — fetch from network and cache the response
      return fetch(event.request).then(function (response) {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        var toCache = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, toCache);
        });
        return response;
      }).catch(function () {
        // Offline and not cached — for HTML navigation fall back to cached index
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 404 });
      });
    })
  );
});
