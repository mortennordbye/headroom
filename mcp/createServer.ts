// Builds a fully-registered Headroom MCP server. Shared by both transports —
// the stdio entrypoint (server.ts) and the HTTP entrypoint (http.ts) — so the
// two never drift in which tools they expose.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReadTools } from './tools/read';
import { registerWriteTools } from './tools/write';
import { registerMarketTools, syncMarketTools } from './tools/market';

/**
 * The server plus a `syncOptIn` that shows or hides the opt-in tool groups
 * (market data) to match the app's settings. They start hidden.
 */
export function createServer(): { server: McpServer; syncOptIn: () => Promise<void> } {
  const server = new McpServer({ name: 'headroom', version: '1.0.0' });
  registerReadTools(server);
  registerWriteTools(server);
  const marketTools = registerMarketTools(server);
  for (const t of marketTools) t.disable();
  return { server, syncOptIn: async () => { await syncMarketTools(marketTools); } };
}
