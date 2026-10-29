#!/usr/bin/env node
// Adds a new income year's withholding constants from Skatteetaten's published
// trekkrutine (github.com/Skatteetaten/trekktabell, Konstanter.java) to
// TREKK_PARAMS in src/lib/forskuddstrekk.ts, and to TAX_PARAMS in
// src/lib/norwegianTax.ts when that year is missing there too.
//
//   node scripts/trekk/update-trekk-year.mjs <year>
//
// Exit 0 with "not-published" when Skatteetaten hasn't released the year yet,
// "up-to-date" when the year is already in TREKK_PARAMS, "updated" after
// editing. Exits non-zero when the Java no longer matches what the port
// assumes (a new bracket, a non-zero lønnsfradrag), so a human looks at it.
// Writes `status` and `zip_url` to $GITHUB_OUTPUT when set.
//
// The edit is checked afterwards by src/lib/forskuddstrekk.file.test.ts against
// the year's full "trekktabeller i tekstformat" file.

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const year = Number(process.argv[2]);
if (!Number.isInteger(year) || year < 2026 || year > 2100) {
  console.error('usage: update-trekk-year.mjs <year>');
  process.exit(2);
}

const output = (key, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};
const done = (status) => { console.log(status); output('status', status); process.exit(0); };

const TREKK_FILE = 'src/lib/forskuddstrekk.ts';
const TAX_FILE = 'src/lib/norwegianTax.ts';

const trekkSrc = readFileSync(TREKK_FILE, 'utf8');
if (new RegExp(`\\n  ${year}: \\{`).test(blockOf(trekkSrc, 'export const TREKK_PARAMS'))) done('up-to-date');

const KONSTANTER = `https://raw.githubusercontent.com/Skatteetaten/trekktabell/master/src/main/java/no/skatteetaten/fastsetting/formueinntekt/forskudd/trekkrutine${year}/Konstanter.java`;
const res = await fetch(KONSTANTER);
if (res.status === 404) done('not-published');
if (!res.ok) throw new Error(`Konstanter.java: HTTP ${res.status}`);
const java = await res.text();

// `NAME = 123L` / `NAME = 1.7d` entries; computed ones (= beregn…()) are skipped.
const k = {};
for (const m of java.matchAll(/\b([A-Z][A-Z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)[Ld]?\b/g)) k[m[1]] = Number(m[2]);

const need = (name) => {
  if (!Number.isFinite(k[name])) throw new Error(`Konstanter.java ${year}: ${name} missing — the trekkrutine changed shape`);
  return k[name];
};
// The port has five trinnskatt brackets and no lønnsfradrag; anything else needs code.
if (k.TRINN6 !== undefined) throw new Error(`${year} has a sixth trinnskatt bracket`);
for (const zero of ['MIN_ANV_MINSTE_FRADRAG', 'MIN_MINSTE_FRADRAG', 'LONNSFRADRAG', 'ANV_LONNSFRADRAG']) {
  if (need(zero) !== 0) throw new Error(`${year}: ${zero} is ${k[zero]}, the port assumes 0`);
}

const n = (v) => {
  if (!Number.isInteger(v)) return String(v);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '_');
};
const trinn = [1, 2, 3, 4, 5].map((i) => ({ from: need(`TRINN${i}`), pct: need(`PROSENT_TRINN${i}`) }));

const trekkEntry = `  // Skatteetaten trekkrutine${year} (Konstanter.java), added by scripts/trekk/update-trekk-year.mjs.
  ${year}: {
    personfradrag: ${n(need('PERSONFRADRAG'))},
    personfradragFinnmark: ${n(need('PERSONFRADRAG_FINNMARK'))},
    trinn: [
${trinn.map((t) => `      { from: ${n(t.from)}, ratePct: ${t.pct} },`).join('\n')}
    ],
    trygdeFree: ${n(need('AVG_FRI_TRYGDEAVGIFT'))},
    trygdeOpptrappingPct: ${need('TRYGDE_PROSENT')},
    trygdeHighPct: ${need('HOY_TRYGDEAVG_PROSENT')},
    trygdeLowPct: ${need('LAV_TRYGDEAVG_PROSENT')},
    minstefradragPct: ${need('ANV_MINSTE_FRAD_PROSENT')},
    minstefradragMax: ${n(need('MAX_ANV_MINSTE_FRADRAG'))},
    sjoMinstefradragPct: ${need('MINSTE_FRAD_PROSENT')},
    sjoMinstefradragMax: ${n(need('MAX_MINSTE_FRADRAG'))},
    standardfradragPct: ${need('STFRADRAG_PROSENT')},
    standardfradragMax: ${n(need('MAX_STFRADRAG'))},
    sjofradragPct: ${need('SJO_PROSENT')},
    sjofradragMax: ${n(need('MAX_SJO_FRADRAG'))},
    kommunePct: ${need('SKATTORE')},
    fellesPct: ${need('FELLES_SKATT_VANLIG')},
    fellesFinnmarkPct: ${need('FELLES_SKATT_FINNMARK')},
  },
`;
writeFileSync(TREKK_FILE, insertInto(trekkSrc, 'export const TREKK_PARAMS', trekkEntry));

// TAX_PARAMS (the annual tax model) shares these figures: the real minstefradrag
// is the trekkrutine's sjø one (46%, its own cap), and the 22% is kommune + felles.
const taxSrc = readFileSync(TAX_FILE, 'utf8');
let taxAdded = false;
if (!new RegExp(`\\n  ${year}: \\{`).test(blockOf(taxSrc, 'export const TAX_PARAMS'))) {
  const round = (v) => Math.round(v * 1e6) / 1e6;
  const taxEntry = `  // Skatteetaten trekkrutine${year} (Konstanter.java), added by scripts/trekk/update-trekk-year.mjs.
  ${year}: {
    skattAlminneligRate: ${round((need('SKATTORE') + need('FELLES_SKATT_VANLIG')) / 100)},
    trygdeavgiftRate: ${round(need('HOY_TRYGDEAVG_PROSENT') / 100)},
    trygdeavgiftLowerLimit: ${n(need('AVG_FRI_TRYGDEAVGIFT'))},
    minstefradragRate: ${round(need('MINSTE_FRAD_PROSENT') / 100)},
    minstefradragMax: ${n(need('MAX_MINSTE_FRADRAG'))},
    personfradrag: ${n(need('PERSONFRADRAG'))},
    trinnskatt: [
      { from: 0, rate: 0 },
${trinn.map((t) => `      { from: ${n(t.from)}, rate: ${round(t.pct / 100)} },`).join('\n')}
    ],
  },
`;
  writeFileSync(TAX_FILE, insertInto(taxSrc, 'export const TAX_PARAMS', taxEntry));
  taxAdded = true;
}
output('tax_params_added', String(taxAdded));

// The year's full table file, for the verification test.
const page = await (await fetch(`https://www.skatteetaten.no/satser/trekktabeller-i-tekstformat/?year=${year}`)).text();
const zip = page.match(/href="([^"]+\.zip)"/i)?.[1];
output('zip_url', zip ? new URL(zip, 'https://www.skatteetaten.no').href : '');
done('updated');

// The `{ … }` object literal that follows `declaration` (up to its closing `};`).
function blockOf(src, declaration) {
  const start = src.indexOf(declaration);
  if (start < 0) throw new Error(`${declaration} not found`);
  const end = src.indexOf('\n};\n', start);
  if (end < 0) throw new Error(`end of ${declaration} not found`);
  return src.slice(start, end);
}

function insertInto(src, declaration, entry) {
  const start = src.indexOf(declaration);
  const end = src.indexOf('\n};\n', start);
  return `${src.slice(0, end + 1)}${entry}${src.slice(end + 1)}`;
}
