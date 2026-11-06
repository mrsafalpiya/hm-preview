// Serves an unlocked site's files at real addresses, so every kind of reference in it works: relative links in
// HTML, url() in CSS, paths built in JavaScript. index.html shows the site in a frame at __site__/<entry>, and each
// request under __site__/ is answered with the decrypted file of that path, which this asks the unlocking page for.
// Nothing decrypted is stored: the files stay in the page's memory, and are gone when it closes.
// Addresses starting with "/" point outside __site__/ and aren't served.

const PREFIX = new URL('__site__/', self.registration.scope).pathname;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return;
  event.respondWith(serve(url, event.request.headers.get('Range')));
});

async function serve(url, range) {
  let path = decodeURIComponent(url.pathname.slice(PREFIX.length));
  if (path === '' || path.endsWith('/')) path += 'index.html';
  const file = await askPages(path);
  if (!file) return new Response('Not found: ' + path, { status: 404, headers: { 'Content-Type': 'text/plain' } });
  const type = file.type || 'application/octet-stream';
  // Local patch (not upstream): answer byte-range requests with 206, as Safari won't play <video> without them.
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match && (match[1] || match[2])) {
    const size = file.size;
    let start, end;
    if (match[1]) { start = +match[1]; end = match[2] ? Math.min(+match[2], size - 1) : size - 1; }
    else { start = Math.max(size - +match[2], 0); end = size - 1; }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    }
    return new Response(file.slice(start, end + 1, type), {
      status: 206,
      headers: {
        'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Content-Length': String(end - start + 1),
      },
    });
  }
  return new Response(file, {
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' },
  });
}

// Asks every open unlocking page (not the frames showing the site) for the file; the first that has it answers.
async function askPages(path) {
  const pages = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter((client) => !new URL(client.url).pathname.startsWith(PREFIX));
  const answers = pages.map((page) => new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 5000);
    channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data || null); };
    page.postMessage({ type: 'unlocked-file', path }, [channel.port2]);
  }));
  for (const answer of answers) {
    const file = await answer;
    if (file) return file;
  }
  return null;
}
