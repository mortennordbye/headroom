// Builds a fully-registered Headroom MCP server. Shared by both transports —
// the stdio entrypoint (server.ts) and the HTTP entrypoint (http.ts) — so the
// two never drift in which tools they expose.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReadTools } from './tools/read';
import { registerWriteTools } from './tools/write';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'headroom', version: '1.0.0' });
  registerReadTools(server);
  registerWriteTools(server);
  return server;
}
