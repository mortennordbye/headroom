// Headroom MCP server — HTTP (Streamable HTTP) transport.
//
// An alternative to the stdio entrypoint for clients that speak MCP over HTTP
// (e.g. a remote/web connector). Exposes the SAME tools as server.ts via the
// shared createServer() factory. Run with: npm run mcp:http
//
// Security posture (this endpoint is network-reachable, unlike stdio):
//   • Bearer token REQUIRED. The server refuses to start without
//     HEADROOM_MCP_TOKEN, and every request must send `Authorization: Bearer …`
//     matching it (constant-time compare). Deny by default.
//   • Binds to loopback (127.0.0.1) by default. Only widen HEADROOM_MCP_HOST
//     behind a TLS-terminating reverse proxy / VPN you control — the token is the
//     only credential and there is no transport encryption here.
//   • DNS-rebinding protection on, so a malicious web page can't drive the local
//     server through a rebound hostname.
//   • A small fixed-window rate limit caps abuse of the (expensive) tool calls.
//
// Stateless: each request gets a fresh server+transport, so there is no session
// store to leak or exhaust.

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './createServer';

const TOKEN = process.env.HEADROOM_MCP_TOKEN || '';
const HOST = process.env.HEADROOM_MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.HEADROOM_MCP_PORT || 3900);
const MCP_PATH = '/mcp';

if (!TOKEN) {
  process.stderr.write(
    'headroom-mcp(http): refusing to start — set HEADROOM_MCP_TOKEN to a strong secret ' +
      '(this endpoint is network-reachable and the token is its only credential).\n',
  );
  process.exit(1);
}

// Constant-time bearer check (avoids leaking the token length/prefix via timing).
function authorized(req: IncomingMessage): boolean {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return false;
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Fixed-window rate limit, keyed by remote address. Modest by design: this is a
// single-user local tool, not a public API — the cap just bounds runaway loops.
const RATE_LIMIT = 120; // requests
const RATE_WINDOW_MS = 60_000; // per minute
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now > cur.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > RATE_LIMIT;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('request body too large'); // 1 MB cap
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const httpServer = createHttpServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname !== MCP_PATH) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (!authorized(req)) {
      res.setHeader('www-authenticate', 'Bearer');
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    if (rateLimited(req)) {
      sendJson(res, 429, { error: 'rate limited' });
      return;
    }

    const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`${HOST}:${PORT}`, `localhost:${PORT}`, `127.0.0.1:${PORT}`],
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    process.stderr.write(`headroom-mcp(http): request error ${String((err as Error)?.stack || err)}\n`);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
  }
});

httpServer.listen(PORT, HOST, () => {
  process.stderr.write(`headroom-mcp: HTTP transport listening on http://${HOST}:${PORT}${MCP_PATH}\n`);
});
