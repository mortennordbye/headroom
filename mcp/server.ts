// Headroom MCP server (stdio, local).
//
// Exposes the app's financial data + computed insights to an AI, and a small set
// of guarded write tools. Run with: npx tsx mcp/server.ts
// Config: HEADROOM_URL (default http://localhost:8080), HEADROOM_PASSWORD (if auth on).

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './createServer';

const { server, syncOptIn } = createServer();

// How often to re-check which opt-in tool groups the user has turned on, so
// flipping the switch in Settings reaches a long-running client without a restart.
const OPT_IN_POLL_MS = 60_000;

async function main() {
  await syncOptIn();
  await server.connect(new StdioServerTransport());
  setInterval(() => void syncOptIn(), OPT_IN_POLL_MS).unref();
  // stdout is the MCP channel; log to stderr only.
  process.stderr.write('headroom-mcp: connected over stdio\n');
}

main().catch((err) => {
  process.stderr.write(`headroom-mcp: fatal ${err?.stack || err}\n`);
  process.exit(1);
});
