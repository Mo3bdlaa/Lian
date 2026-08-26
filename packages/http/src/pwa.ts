// The PWA shell: manifest, service worker, and the page that registers it.
//
// PRD §16 and UI-UX §41. There are no screens yet, so the shell is minimal —
// but the service worker is not a placeholder: it is what receives a push and
// draws the notification, which is the product's defining behaviour and the
// one thing that has to be right before any screen exists.
/**
 * The manifest and the shell need a real colour rather than a CSS variable —
 * the OS parses one as JSON and the other before any stylesheet loads. The
 * value is passed in from the composition root, which reads it out of
 * design-system/lian-tokens.css, so this file still contains no colour.
 *
 * design.md §3: Cream is the canvas. It is the brand token, not a per-mood
 * value — the OS draws this and it must not follow her mood.
 */
export function manifestJson(themeColor: string): string {
  return JSON.stringify({
    name: 'Lian',
    short_name: 'Lian',
    start_url: '/',
    display: 'standalone',
    background_color: themeColor,
    theme_color: themeColor,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
}

/**
 * The service worker.
 *
 * Push handling is the whole point of it right now. Two details that are easy
 * to get wrong and expensive to notice:
 *
 *   - `event.waitUntil` around showNotification, or the worker can be killed
 *     before the notification is drawn and the push is silently lost.
 *   - a `tag`, so a reminder delivered twice REPLACES rather than stacks.
 */
export const SERVICE_WORKER = `
self.addEventListener('install', (event) => {
  // Take over immediately: a user who just installed should not need a second
  // launch before push works.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Lian', {
      body: payload.body || '',
      tag: payload.tag || 'lian',
      renotify: false,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus a window that is already open rather than opening a second one:
      // tapping a notification should land you in the conversation you were
      // already in.
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
`.trim();

/**
 * The shell page. It registers the worker and does nothing else — the screens
 * are a separate piece of work, and a placeholder that looked like a product
 * would be worse than one that plainly does not.
 */
export function shellHtml(themeColor: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Lian</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="${themeColor}">
</head><body>
<noscript>Lian needs JavaScript.</noscript>
<script type="module">
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
</script>
</body></html>`;
}

export function staticFiles(themeColor: string): Record<string, { contentType: string; body: string }> {
  return {
    '/': { contentType: 'text/html; charset=utf-8', body: shellHtml(themeColor) },
    '/manifest.webmanifest': { contentType: 'application/manifest+json; charset=utf-8', body: manifestJson(themeColor) },
    '/sw.js': { contentType: 'text/javascript; charset=utf-8', body: SERVICE_WORKER },
  };
}
