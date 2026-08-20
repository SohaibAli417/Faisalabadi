const CACHE_NAME = 'faislabadi-pos-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manual.css',
  '/app.js',
  '/vendor/react.production.min.js',
  '/vendor/react-dom.production.min.js',
  '/manifest.json'
];

const API_CACHE = 'faislabadi-api-v1';
const BOOTSTRAP_CACHE = 'faislabadi-bootstrap-v1';

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME && key !== API_CACHE && key !== BOOTSTRAP_CACHE;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  if (url.pathname === '/api/bootstrap') {
    event.respondWith(
      caches.open(BOOTSTRAP_CACHE).then(function(cache) {
        return fetch(event.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            cache.put(event.request, clone);
          }
          return response;
        }).catch(function() {
          return cache.match(event.request);
        });
      })
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(JSON.stringify({ error: 'Offline' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      return cached || fetch(event.request).then(function(response) {
        if (response.ok && url.origin === self.location.origin) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    }).catch(function() {
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'CACHE_BOOTSTRAP') {
    caches.open(BOOTSTRAP_CACHE).then(function(cache) {
      var response = new Response(JSON.stringify(event.data.payload), {
        headers: { 'Content-Type': 'application/json' }
      });
      cache.put('/api/bootstrap', response);
    });
  }
});
