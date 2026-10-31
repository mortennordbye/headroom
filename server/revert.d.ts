// Type surface for the CommonJS revision undo (server/revert.js), so the
// Vitest round-trip tests in src/lib get types. Runtime is plain JS.
type Blob = Record<string, unknown>;

export function deepEqual(a: unknown, b: unknown): boolean;
export function changedKeys(prev: unknown, next: unknown): string[];
export function revertChange(
  currentBlob: Blob,
  afterBlob: Blob,
  beforeBlob: Blob,
  keys: string[],
): { blob: Blob; conflicts?: undefined } | { conflicts: string[]; blob?: undefined };
