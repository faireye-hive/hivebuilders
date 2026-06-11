// sw.js - Service Worker para Cache de Imagens e Assets
const CACHE_NAME = 'hivebuilds-cache-v1';

// Domínios autorizados de imagens (sua lista branca do CSP)
const ALLOWED_IMAGE_HOSTS = [
  'images.hive.blog',
  'i.ecency.com',
  'i.imgur.com',
  'imgur.com',
  'ipfs.io',
  'pinata.cloud',
  'cloudflare-ipfs.com',
  '3speak.tv',
  'img.3speak.tv',
  'files.peakd.com',
  'hivesearcher.com',
  'nftshowroom.com',
  'v4v.app',
  'img.leopedia.io'
];

// 1. Instalação do Service Worker
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 2. Ativação e limpeza de caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Interceptação de requisições (Estratégia: Cache-First para Imagens Autorizadas)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Verifica se a requisição é uma imagem externa da lista branca
  const isAuthorizedImage = ALLOWED_IMAGE_HOSTS.some(host => url.hostname.includes(host));

  if (event.request.destination === 'image' && isAuthorizedImage) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          // Se já estiver no cache, devolve imediatamente
          if (cachedResponse) {
            return cachedResponse;
          }

          // Se não estiver, busca na rede, joga no cache e devolve
          return fetch(event.request).then((networkResponse) => {
            // Apenas coloca no cache se a resposta for válida (status 200)
            if (networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            // Falha silenciosa se estiver sem internet e não houver cache
          });
        });
      })
    );
  }
});
