// Shared text helpers for transaction matching.

/**
 * Normalize a string for substring matching: lowercase, turn the separators
 * payment rails glue onto merchant names into spaces, and collapse whitespace.
 *
 * Card feeds prefix the real merchant with the rail that carried the payment —
 * `Vipps*Kitch n`, `VFI*Fotballfesten`, `SVEA*Bikeshop.no`, `Zettle_*60 degrees`,
 * `PP*Flixtools`, `GOOGLE*CLOUD`. Left as-is, `google*cloud` misses the
 * `google cloud` keyword and every rail-prefixed merchant reads as one long
 * token. Splitting on `*`/`_` exposes the merchant to the same keyword table as
 * a plain card purchase.
 *
 * Both sides of a comparison must go through this — see `buildMatchHaystack`
 * for the haystack, and call it directly on the needle (user rule, search
 * query) so a rule the user typed with a `*` in it still matches.
 */
export function normalizeMatchText(raw: string | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[*_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  return ` ${normalizeMatchText(`${merchant ?? ''} ${description ?? ''}`)} `;
}
