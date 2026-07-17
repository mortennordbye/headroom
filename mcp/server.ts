// Headroom MCP server (stdio, local).
//
// Exposes the app's financial data + computed insights to an AI, and a small set
// of guarded write tools. Run with: npx tsx mcp/server.ts
// Config: HEADROOM_URL (default http://localhost:8080), HEADROOM_PASSWORD (if auth on).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerReadTools } from './tools/read';
import { registerWriteTools } from './tools/write';

const server = new McpServer({ name: 'headroom', version: '1.0.0' });

registerReadTools(server);
registerWriteTools(server);

async function main() {
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; log to stderr only.
  process.stderr.write('headroom-mcp: connected over stdio\n');
}

main().catch((err) => {
  process.stderr.write(`headroom-mcp: fatal ${err?.stack || err}\n`);
  process.exit(1);
});
