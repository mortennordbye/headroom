/**
 * Postnummer → kommune lookup, backed by the free Bring "Postnummerregister"
 * (data/postnummer.tsv, columns: postnr, kommunenr, poststed). A postnummer
 * belongs to a single (primary) kommune, so this is a straight 1:1 map.
 *
 * The file rarely changes (Bring publishes updates ~2x/year); refresh it by
 * re-running the download + trim step documented in the plan. Parsed once into
 * a Map on first use.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'postnummer.tsv');

let cache = null;

function load() {
  if (cache) return cache;
  cache = new Map();
  const text = fs.readFileSync(FILE, 'utf-8');
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [postnr, kommunenr, poststed] = line.split('\t');
    if (postnr && kommunenr) cache.set(postnr, { kommunenr, poststed: poststed || '' });
  }
  return cache;
}

/** Full entry { kommunenr, poststed } for a 4-digit postnummer, or null. */
function lookupPostnr(postnr) {
  const key = String(postnr || '').padStart(4, '0');
  return load().get(key) || null;
}

/** Just the 4-digit kommunenummer for a postnummer, or null if unknown. */
function kommuneForPostnr(postnr) {
  return lookupPostnr(postnr)?.kommunenr || null;
}

module.exports = { lookupPostnr, kommuneForPostnr };
