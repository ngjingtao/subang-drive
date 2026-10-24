/* Subang Drive — offline shell + runtime cache */
const CACHE = 'subang-drive-v35'
const BASE = self.registration.scope
const SHELL = BASE

async function precache() {
  const cache = await caches.open(CACHE)
  const urls = new Set([
    SHELL,
    BASE + 'manifest.webmanifest',
    BASE + 'data/subang-jaya.json',
    BASE + 'icons/icon-192.png',
    BASE + 'icons/icon-512.png',
    BASE + 'icons/apple-touch-icon.png',
    BASE + 'icons/icon.svg',
  ])
  try {
    const html = await fetch(SHELL, { cache: 'reload' }).then((r) => r.text())
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      try {
        const u = new URL(m[1], BASE)
        if (u.origin === self.location.origin) urls.add(u.href)
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  await Promise.all([...urls].map((u) => cache.add(u).catch(() => {})))
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  let url
  try { url = new URL(req.url) } catch { return }
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy))
        return res
      }).catch(async () => {
        const hit = await caches.match(req)
        return hit || (await caches.match(SHELL)) || Response.error()
      }),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      }).catch(() => Response.error())
    }),
  )
})
