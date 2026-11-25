/**
 * Brønnøysund (Brreg) client for the "Start med regnskapet" card on Avansert:
 * the newest filed annual accounts and a few facts about the entity, for one
 * organisation number.
 *
 *   https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}        entity
 *   https://data.brreg.no/regnskapsregisteret/regnskap/{orgnr}        accounts
 *
 * Both are open data without a key. The org number is checked (9 digits and the
 * mod-11 digit) before any URL is built, the host is fixed, a redirect is an
 * error, each call has a timeout and a body size cap, and only allowlisted
 * fields leave this module: finite numbers and short strings. The org number
 * names the user's employer, so nothing here logs it or puts it in an error
 * message.
 */

const HOST = 'data.brreg.no';
const ENTITY_BASE = `https://${HOST}/enhetsregisteret/api/enheter/`;
const ACCOUNTS_BASE = `https://${HOST}/regnskapsregisteret/regnskap/`;
const FETCH_TIMEOUT_MS = 10_000;
/** Brreg's answers are a few kB; a much larger body is not one of them. */
const MAX_BODY_BYTES = 1_000_000;

/**
 * A Norwegian organisation number: 9 digits whose last digit is the mod-11
 * check digit over the first 8 (weights 3, 2, 7, 6, 5, 4, 3, 2).
 * TWIN of isValidOrgnr in src/lib/validators.ts; a test checks they agree.
 */
function isValidOrgnr(s) {
  if (typeof s !== 'string' || !/^\d{9}$/.test(s)) return false;
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(s[i]), 0);
  const check = (11 - (sum % 11)) % 11;
  return check !== 10 && check === Number(s[8]);
}

/** An upstream failure with a fixed, orgnr-free reason (safe to log). */
class BrregError extends Error {
  constructor(reason) {
    super(`brreg ${reason}`);
    this.reason = reason;
  }
}

function buildUrl(base, orgnr) {
  if (!isValidOrgnr(orgnr)) throw new BrregError('invalid number');
  const url = new URL(`${base}${orgnr}`);
  if (url.protocol !== 'https:' || url.hostname !== HOST) throw new BrregError('bad host');
  return url.toString();
}

/** Read a body up to `max` bytes; a longer body is an error, not a truncation. */
async function readCapped(res, max) {
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) throw new BrregError('body too large');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new BrregError('body too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/** GET one Brreg URL: { status: 404 } for not found, { status: 200, json } for a body, else throws. */
async function getJson(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new BrregError(err && err.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  // 410 is a deleted entity: as unknown as 404 for this card.
  if (res.status === 404 || res.status === 410) {
    await res.body?.cancel().catch(() => {});
    return { status: 404 };
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    throw new BrregError(`status ${res.status}`);
  }
  const text = await readCapped(res, MAX_BODY_BYTES);
  try {
    return { status: 200, json: text ? JSON.parse(text) : null };
  } catch {
    throw new BrregError('bad json');
  }
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const shortStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The allowlisted entity facts. Null when the body is not an entity. */
function parseEntity(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const name = shortStr(data.navn, 200);
  if (!name) return null;
  const form = shortStr(data.organisasjonsform?.kode, 10);
  const nace = shortStr(data.naeringskode1?.kode, 10);
  const employees = finite(data.antallAnsatte);
  return {
    name,
    formCode: /^[A-ZÆØÅ]{2,6}$/.test(form) ? form : '',
    naceCode: /^\d{2}\.\d{1,3}$/.test(nace) ? nace : '',
    employees: employees != null && employees >= 0 ? Math.round(employees) : null,
    hasParent: typeof data.overordnetEnhet === 'string' && data.overordnetEnhet !== '',
    inGroup: data.erIKonsern === true,
  };
}

/**
 * The newest filed accounts with finite revenue and operating result; for that
 * year the company's own accounts (SELSKAP) win over the group's (KONSERN).
 * Null when there is none.
 */
function parseAccounts(data) {
  if (!Array.isArray(data)) return null;
  const rows = [];
  for (const r of data) {
    if (!r || typeof r !== 'object') continue;
    const type = r.regnskapstype === 'SELSKAP' || r.regnskapstype === 'KONSERN' ? r.regnskapstype : null;
    const to = typeof r.regnskapsperiode?.tilDato === 'string' ? r.regnskapsperiode.tilDato : '';
    const year = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Number(to.slice(0, 4)) : null;
    const drift = r.resultatregnskapResultat?.driftsresultat;
    const revenue = finite(drift?.driftsinntekter?.sumDriftsinntekter);
    const operatingResult = finite(drift?.driftsresultat);
    const currency = /^[A-Z]{3}$/.test(r.valuta ?? '') ? r.valuta : '';
    if (!type || year == null || revenue == null || operatingResult == null || !currency) continue;
    rows.push({ year, type, currency, revenue, operatingResult });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.year - a.year || (a.type === 'SELSKAP' ? -1 : 1) - (b.type === 'SELSKAP' ? -1 : 1));
  return rows[0];
}

/**
 * Entity and newest accounts for one org number.
 * { found: false } when Brreg does not know it; { found: true, entity, accounts }
 * otherwise (accounts null when none are filed). Throws BrregError when Brreg
 * cannot be read.
 */
async function fetchBrreg(orgnr) {
  const entityRes = await getJson(buildUrl(ENTITY_BASE, orgnr));
  if (entityRes.status === 404) return { found: false };
  const entity = parseEntity(entityRes.json);
  if (!entity) throw new BrregError('bad entity');
  const accountsRes = await getJson(buildUrl(ACCOUNTS_BASE, orgnr));
  const accounts = accountsRes.status === 404 ? null : parseAccounts(accountsRes.json);
  return { found: true, entity, accounts };
}

module.exports = { isValidOrgnr, fetchBrreg, parseEntity, parseAccounts, buildUrl, BrregError, ENTITY_BASE, ACCOUNTS_BASE, MAX_BODY_BYTES };
