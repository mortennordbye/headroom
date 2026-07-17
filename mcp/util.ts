// Shared helpers for MCP tool handlers.

/** Wrap any JSON-serialisable value as an MCP text-content tool result. */
export function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/** Wrap an error as an MCP tool error result (kept in-band so the model sees it). */
export function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** Record a before/after change for the diff a write tool returns. */
export function diff(field: string, before: unknown, after: unknown): FieldChange {
  return { field, before, after };
}
