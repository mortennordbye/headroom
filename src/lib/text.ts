// Shared text helpers for transaction matching.

/**
 * Build the lowercased search "haystack" used by every keyword / rule / label
 * matcher over a transaction's merchant + description.
 *
 * The single leading and trailing spaces are word-boundary padding: a keyword
 * written with a boundary space (e.g. ' esso', 'vy ') then only matches at a real
 * word edge — ' esso' won't hit inside 'espresso'. Every matcher must build its
 * haystack here so that boundary trick stays uniform across the codebase.
 */
export function buildMatchHaystack(merchant?: string, description?: string): string {
  return ` ${merchant ?? ''} ${description ?? ''} `.toLowerCase();
}
