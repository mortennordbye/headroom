// Public read-only demo mode (DEMO_MODE=1).
//
// A demo instance is meant to be reachable from the open internet, so unlike the
// normal single-user deployment it cannot assume the caller is the owner. The
// API is therefore closed by default and only safe reads get through — the
// client-side demo dataset lives in the browser (src/lib/demoData.ts), so a
// visitor's edits never need to reach the server at all.
//
// Pure, dependency-free helpers (no Express, no SQLite) so the gate is unit
// testable without booting the app; index.js holds only the wiring.

const DEMO_ERROR = 'this is a public read-only demo — changes are not saved';

/** Is DEMO_MODE switched on in this environment? */
function isDemoMode(env) {
  return /^(1|true|yes|on)$/i.test(String((env && env.DEMO_MODE) || '').trim());
}

/**
 * Build the `/api/*` demo gate middleware. Deny-by-default: every mutation is
 * refused, and the bank namespace is refused outright because its GETs are not
 * safe reads — `/api/bank/aspsps` proxies to Enable Banking on the app's own
 * credentials (someone else's quota and money) and `/api/bank/callback`
 * completes a bank link as a side effect of a GET.
 *
 * The path is lowercased before every comparison because Express matches routes
 * case-insensitively: without it, `/API/data` would slip past the gate and still
 * reach the `/api/data` handler.
 */
function makeDemoGate() {
  return (req, res, next) => {
    const path = (req.path || '').toLowerCase();
    if (!path.startsWith('/api/')) return next(); // static assets + SPA shell
    // Prefix (not `/api/bank/`) so a future bare `/api/bank` route is covered
    // too. Over-blocking is the safe direction here.
    if (path.startsWith('/api/bank')) {
      return res.status(403).json({ error: DEMO_ERROR });
    }
    const method = (req.method || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return next();
    return res.status(403).json({ error: DEMO_ERROR });
  };
}

module.exports = { DEMO_ERROR, isDemoMode, makeDemoGate };
