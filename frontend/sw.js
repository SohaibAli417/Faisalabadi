const CACHE_NAME = 'faislabadi-pos-v36';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css?v=36',
  '/manual.css?v=36',
  '/app.js?v=36',
  '/vendor/react.production.min.js',
  '/vendor/react-dom.production.min.js',
  '/manifest.json',
  '/logo.png',
  '/icon-192.png',
  '/favicon.png'
];

const URDU_FONT_CSS = 'https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap';

const API_CACHE = 'faislabadi-api-v20';
const BOOTSTRAP_CACHE = 'faislabadi-bootstrap-v18';

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
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.add(URDU_FONT_CSS).catch(function() {});
    }).then(function() {
      return caches.keys().then(function(keys) {
        return Promise.all(
          keys.filter(function(key) {
            return key !== CACHE_NAME && key !== API_CACHE && key !== BOOTSTRAP_CACHE;
          }).map(function(key) {
            return caches.delete(key);
          })
        );
      });
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

  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok && url.origin === self.location.origin) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put('/index.html', clone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match('/index.html').then(function(cached) {
          return cached || new Response('<h1>POS offline</h1><p>Reconnect to the internet once to load the app.</p>', { headers: { 'Content-Type': 'text/html' }, status: 503 });
        });
      })
    );
    return;
  }

  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response.ok || response.type === 'opaque') {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(function() {
          return cached || Response.error();
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var networkFetch = fetch(event.request).then(function(response) {
        if (response.ok && url.origin === self.location.origin) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return cached || Response.error();
      });
      return cached ? Promise.race([
        networkFetch.catch(function() { return cached; }),
        new Promise(function(resolve) { setTimeout(function() { resolve(cached); }, 1200); })
      ]) : networkFetch;
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
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
