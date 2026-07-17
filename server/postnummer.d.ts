// Type surface for the CommonJS postnummer→kommune lookup (server/postnummer.js).
export interface PostnrEntry {
  kommunenr: string;
  poststed: string;
}
export function lookupPostnr(postnr: string): PostnrEntry | null;
export function kommuneForPostnr(postnr: string): string | null;
