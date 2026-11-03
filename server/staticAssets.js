const express = require('express');
const path = require('path');

/** Serve the built SPA from `dist`: hashed chunks, other static files, then the shell. */
function mountStatic(app, dist) {
  // Everything under /static has a content hash in its name, so a new build gets
  // new URLs and these can be cached for good. Without this the browser revalidates
  // every chunk on every load. index.html and sw.js stay on the handler below, which
  // revalidates, or an update would never be noticed.
  app.use('/static', express.static(path.join(dist, 'static'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(dist));
  // A missing hashed chunk (e.g. a stale reference after redeploy) must 404, not
  // fall through to the SPA handler — returning index.html (text/html) for a
  // /static/*.js request triggers a MIME error and a blank screen instead of a
  // catchable "chunk failed to load". Build output now lives under /static; the
  // legacy /assets/ branch stays so a client still holding the pre-migration
  // index.html gets a clean 404 for its old chunks. Both require a filename with
  // an extension, so the /assets client route (the Formue page) is unaffected.
  app.get(/^\/(?:static|assets)\/.+\.[^/]+$/, (_req, res) => res.sendStatus(404));
  // SPA fallback. Regex route (not the bare '*' string) for Express 5 /
  // path-to-regexp v8 compatibility; matches any unhandled GET.
  app.get(/.*/, (req, res) => res.sendFile('index.html', { root: dist }));
}

module.exports = { mountStatic };
