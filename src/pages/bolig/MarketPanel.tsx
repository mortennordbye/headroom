import { useEffect, useMemo, useRef, useState } from 'react';
import { format, subMonths } from 'date-fns';
import { ArrowDown, ArrowUp, ArrowUpDown, Building2, Check, Database, ExternalLink, LineChart, Plus, Tag, Upload } from 'lucide-react';
import { Area, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ResponsiveContainer } from '../../components/charts/ResponsiveContainer';
import { useFinance } from '../../context/FinanceContext';
import { useMarketData, MarketImportError } from '../../hooks/useMarketData';
import { useBalanceHistory } from '../../hooks/useBalanceHistory';
import { currentResidence } from '../../lib/property';
import { estimatedPropertyValue } from '../../lib/propertyEstimate';
import {
  bedroomsFromRooms, valuationConfidence, valuationFromSales, valuationHistory,
  type ComparableSale, type ValuationConfidence,
} from '../../lib/marketValuation';
import { AXIS_PROPS, AXIS_PROPS_Y, CHART, GRID_PROPS } from '../../lib/chartColors';
import {
  inRange, listingMetrics, saleOverAskingPct, saleTotalPerSqm, sortRows,
  type MarketListing, type SortDir,
} from '../../lib/marketListings';
import { parseMarketFile, saleFromForm } from '../../lib/marketImport';
import { Card } from '../../components/ui/Card';
import { SectionLabel } from '../../components/ui/SectionLabel';
import { Button } from '../../components/ui/Button';
import { DeltaChip } from '../../components/ui/DeltaChip';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import EditModal from '../../components/EditModal';
import ConfirmModal from '../../components/ConfirmModal';

// Rows shown before "Show all" in each table.
const PREVIEW_ROWS = 10;

// Literal, language-neutral example of the import format, so it lives here
// rather than in the i18n table (like the MCP config snippets).
const FORMAT_EXAMPLE = `{
  "seenOn": "2026-10-25",
  "sales": [
    { "address": "Storgata 12B", "unit": "H0201", "postnr": "0182",
      "bra": 54, "floor": 2, "soldPrice": 5250000, "askingPrice": 4990000,
      "fellesgjeld": 120000, "soldOn": "2026-09-14", "source": "megler" }
  ],
  "listings": [
    { "url": "https://example.com/bolig/123", "address": "Parkveien 3",
      "postnr": "0350", "bra": 62, "bedrooms": 2, "askingPrice": 5900000,
      "fellesgjeld": 0, "felleskost": 3400, "dwellingType": "leilighet",
      "ownership": "selveier" }
  ]
}`;

const saleKey = (s: ComparableSale) => `${s.address}|${s.unit ?? ''}|${s.soldOn}|${s.soldPrice}`;

const fmtDate = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
};

const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} %`;

type SoldKey = 'address' | 'bra' | 'soldOn' | 'askingPrice' | 'soldPrice' | 'perSqm' | 'vsAsking';
type ListKey = 'address' | 'bra' | 'bedrooms' | 'total' | 'perSqm' | 'felleskost' | 'change' | 'days';
type Period = '12' | '24' | 'all';
interface Sort<K> { key: K; dir: SortDir }

const SOLD_VALUE: Record<SoldKey, (s: ComparableSale) => number | string | null | undefined> = {
  address: (s) => `${s.address} ${s.unit ?? ''}`,
  bra: (s) => s.bra,
  soldOn: (s) => s.soldOn,
  askingPrice: (s) => s.askingPrice,
  soldPrice: (s) => s.soldPrice,
  perSqm: saleTotalPerSqm,
  vsAsking: saleOverAskingPct,
};

const LIST_VALUE: Record<ListKey, (l: MarketListing) => number | string | null | undefined> = {
  address: (l) => `${l.address ?? ''} ${l.unit ?? ''}`,
  bra: (l) => l.bra,
  bedrooms: (l) => l.bedrooms,
  total: (l) => listingMetrics(l).totalPrice,
  perSqm: (l) => listingMetrics(l).totalPerSqm,
  felleskost: (l) => l.felleskost,
  change: (l) => listingMetrics(l).priceChange,
  days: (l) => listingMetrics(l).daysListed,
};

/** First click on a column sorts text A→Z and numbers/dates high→low; a second click flips it. */
function nextSort<K extends string>(cur: Sort<K>, key: K, textKeys: K[]): Sort<K> {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: textKeys.includes(key) ? 'asc' : 'desc' };
}

/** A sortable column header: a real button inside the th, with aria-sort on the th. */
function SortTh<K extends string>({ k, label, sort, onSort, align = 'right' }: {
  k: K; label: string; sort: Sort<K>; onSort: (k: K) => void; align?: 'left' | 'right';
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`font-medium py-2 px-2 whitespace-nowrap ${align === 'left' ? 'text-left' : 'text-right'}`}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:opacity-80 ${align === 'right' ? 'flex-row-reverse' : ''}`}
        style={{ color: active ? 'var(--text-1)' : 'var(--text-3)' }}
      >
        {label}
        <Icon size={11} style={{ opacity: active ? 1 : 0.5 }} />
      </button>
    </th>
  );
}

/** Parse an m² filter input; empty or invalid means "no bound". */
const bound = (v: string): number | null => {
  const n = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

const CONFIDENCE_TONE: Record<ValuationConfidence, 'positive' | 'warning' | 'negative'> = {
  high: 'positive',
  medium: 'warning',
  low: 'negative',
};

const filterInput =
  'w-20 h-8 px-2.5 rounded-[6px] text-[12.5px] font-mono outline-none border bg-[var(--bg-raised)] border-[var(--border)] text-[var(--text-1)]';

/**
 * The Bolig page's Marked tab: the opt-in switch, the value of the current home
 * from comparable sales, and the stored sold homes and homes for sale. All
 * market data lives in its own server tables (server/market.js), never in the
 * finance blob; Headroom only stores what the user adds.
 */
const MarketPanel: React.FC = () => {
  const { t, lang, formatCurrencyShort, residences, assets, updateAsset, kvmpris, loadKvmpris, demoMode } = useFinance();
  const mk = t.boligPage.market;
  const home = currentResidence(residences ?? []);
  const postnr = home?.postalCode && /^\d{4}$/.test(home.postalCode) ? home.postalCode : undefined;

  const { status, sales, listings, error, setEnabled, importFile, addSale } =
    useMarketData(demoMode ? undefined : postnr, { withListings: !demoMode });

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applied, setApplied] = useState(false);
  const [addingSale, setAddingSale] = useState(false);
  const [saleError, setSaleError] = useState<string | undefined>();
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [allSold, setAllSold] = useState(false);
  const [allListings, setAllListings] = useState(false);
  const [soldSort, setSoldSort] = useState<Sort<SoldKey>>({ key: 'soldOn', dir: 'desc' });
  const [listSort, setListSort] = useState<Sort<ListKey>>({ key: 'total', dir: 'asc' });
  const [soldMin, setSoldMin] = useState('');
  const [soldMax, setSoldMax] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [listMin, setListMin] = useState('');
  const [listMax, setListMax] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // Viewing a past or future month is read-only, like the Boliglån tab.
  const { isLive } = useBalanceHistory();

  // The estimate and its 24-month replay are the expensive part (24 valuations
  // over every sale), so they only rerun when their inputs change, not on every
  // keystroke in the table filters.
  const asOfDay = format(new Date(), 'yyyy-MM-dd');
  const size = home?.sizeSqm;
  const indexPoints = kvmpris?.points;
  const homeAddress = home?.address;
  const homeRooms = home?.rooms;
  const homeFellesgjeld = home?.jointDebtShare;
  const { valuation, history } = useMemo(() => {
    if (homeAddress == null || !postnr) return { valuation: null, history: [] };
    const subject = {
      address: homeAddress, postnr, sizeSqm: size,
      bedrooms: bedroomsFromRooms(homeRooms), fellesgjeld: homeFellesgjeld,
    };
    const opts = { asOf: asOfDay, listLimit: Number.MAX_SAFE_INTEGER, index: indexPoints };
    const v = valuationFromSales(subject, sales, opts);
    return { valuation: v, history: v ? valuationHistory(subject, sales, opts) : [] };
  }, [homeAddress, postnr, size, homeRooms, homeFellesgjeld, sales, indexPoints, asOfDay]);

  useEffect(() => {
    void loadKvmpris(postnr, home?.dwellingType);
  }, [postnr, home?.dwellingType, loadKvmpris]);

  const header = (
    <header className="max-w-4xl">
      <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
        {mk.eyebrow}
      </div>
      <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
        {mk.titlePre}<em className="font-serif italic" style={{ color: 'var(--brass)' }}>{mk.titleEm}</em>
      </h1>
      <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>{mk.subtitle}</p>
    </header>
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await fn();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (demoMode || error || !status || !status.enabled) {
    return (
      <div className="space-y-6 md:space-y-7">
        {header}
        <Card padding="lg" className="max-w-3xl">
          {demoMode || error ? (
            <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{demoMode ? mk.demo : mk.loadError}</p>
          ) : (
            <div className="space-y-4">
              <SectionLabel icon={<Building2 />}>{mk.offTitle}</SectionLabel>
              <p className="text-[14px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>{mk.offBody}</p>
              <Button variant="primary" disabled={!status || busy} onClick={() => void run(() => setEnabled(true))}>
                {mk.offCta}
              </Button>
              {failed && <p className="text-[12px]" style={{ color: 'var(--negative)' }}>{mk.saveError}</p>}
            </div>
          )}
        </Card>
      </div>
    );
  }

  // When the stored data was last refreshed. A sales import is an ISO timestamp
  // (shown as the local day), a listing's last sighting a 'YYYY-MM-DD' day.
  const salesImported = status.lastSalesImport ? new Date(status.lastSalesImport) : null;
  const freshness = [
    salesImported && !isNaN(salesImported.getTime()) && mk.lastSalesImport.replace('{date}', format(salesImported, 'dd.MM.yyyy')),
    status.lastListingSeen && mk.lastListingSeen.replace('{date}', fmtDate(status.lastListingSeen)),
  ].filter((s): s is string => !!s);

  // ── Valuation ──────────────────────────────────────────────────────────────
  const confidence = valuation ? valuationConfidence(valuation, asOfDay) : null;
  const chartData = history.map((p) => ({ ...p, range: [p.low, p.high] as [number, number] }));
  const monthLabel = (m: string) =>
    new Date(`${m}-01T00:00:00`).toLocaleDateString(lang === 'nb' ? 'nb-NO' : 'en-GB', { month: 'short', year: '2-digit' });
  const weightOf = new Map(valuation?.comps.map((c) => [saleKey(c), c.weight]) ?? []);
  const used = new Set(weightOf.keys());
  const ssbEstimate = estimatedPropertyValue(size, kvmpris?.latestPrice);
  const currentValue = assets.houseValue;
  const delta = valuation && currentValue > 0 ? valuation.mid - currentValue : null;

  // Range bar scale: the low–high band plus today's value, padded a little.
  const marks = valuation ? [valuation.low, valuation.high, ...(currentValue > 0 ? [currentValue] : [])] : [];
  const lo = marks.length ? Math.min(...marks) * 0.97 : 0;
  const hi = marks.length ? Math.max(...marks) * 1.03 : 1;
  const pos = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;

  const onSaveSale = async (values: Record<string, string>) => {
    const r = saleFromForm(values);
    if ('error' in r) {
      setSaleError(mk.addSale.errors[r.error]);
      return;
    }
    try {
      if (await addSale(r.sale)) {
        setAddingSale(false);
      } else {
        setSaleError(mk.addSale.duplicate);
      }
    } catch {
      setSaleError(mk.addSale.failed);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = ''; // allow picking the same file again
    if (!file) return;
    setImportMsg(null);
    const parsed = parseMarketFile(await file.text());
    if ('error' in parsed) {
      setImportMsg({ ok: false, text: { json: mk.importErrJson, shape: mk.importErrShape, empty: mk.importErrEmpty }[parsed.error] });
      return;
    }
    setBusy(true);
    try {
      const r = await importFile(parsed);
      setImportMsg({
        ok: true,
        text: mk.importDone
          .replace('{salesAdded}', String(r.salesAdded)).replace('{salesSkipped}', String(r.salesSkipped))
          .replace('{listingsAdded}', String(r.listingsAdded)).replace('{listingsUpdated}', String(r.listingsUpdated)),
      });
    } catch (e) {
      const details = e instanceof MarketImportError && e.details.length ? e.details.join('; ') : String((e as Error).message);
      setImportMsg({ ok: false, text: mk.importErrRejected.replace('{details}', details) });
    } finally {
      setBusy(false);
    }
  };

  // ── Table filters and sorting ──
  const today = format(new Date(), 'yyyy-MM-dd');
  const since = period === 'all' ? null : format(subMonths(new Date(), Number(period)), 'yyyy-MM-dd');
  const filteredSold = sortRows(
    sales.filter((s) => inRange(s.bra, bound(soldMin), bound(soldMax)) && (!since || (s.soldOn >= since && s.soldOn <= today))),
    SOLD_VALUE[soldSort.key],
    soldSort.dir,
  );
  const filteredListings = sortRows(
    listings.filter((l) => inRange(l.bra, bound(listMin), bound(listMax))),
    LIST_VALUE[listSort.key],
    listSort.dir,
  );
  const soldFiltered = soldMin !== '' || soldMax !== '' || period !== 'all';
  const listFiltered = listMin !== '' || listMax !== '';
  const shownSold = allSold ? filteredSold : filteredSold.slice(0, PREVIEW_ROWS);
  const shownListings = allListings ? filteredListings : filteredListings.slice(0, PREVIEW_ROWS);
  const onSoldSort = (k: SoldKey) => setSoldSort((cur) => nextSort(cur, k, ['address']));
  const onListSort = (k: ListKey) => setListSort((cur) => nextSort(cur, k, ['address']));
  const td = 'py-2 px-2 whitespace-nowrap';

  // "Like mine": the same ±25 % size window the estimate uses.
  const likeMine = size ? { min: String(Math.round(size * 0.75)), max: String(Math.round(size * 1.25)) } : null;

  const sizeFilter = (min: string, max: string, setMin: (v: string) => void, setMax: (v: string) => void) => (
    <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
      <span>{mk.filterSize}</span>
      <input type="number" inputMode="decimal" min={0} value={min} onChange={(e) => setMin(e.target.value)} placeholder={mk.filterFrom} aria-label={`${mk.filterSize} ${mk.filterFrom}`} className={filterInput} />
      <span>–</span>
      <input type="number" inputMode="decimal" min={0} value={max} onChange={(e) => setMax(e.target.value)} placeholder={mk.filterTo} aria-label={`${mk.filterSize} ${mk.filterTo}`} className={filterInput} />
      {likeMine && (
        <button
          type="button"
          onClick={() => { setMin(likeMine.min); setMax(likeMine.max); }}
          className="h-8 px-2.5 rounded-[6px] border text-[12px] hover:opacity-80"
          style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          {mk.filterLikeMine.replace('{min}', likeMine.min).replace('{max}', likeMine.max)}
        </button>
      )}
    </div>
  );

  const countLabel = (title: string, shown: number, total: number, filtered: boolean) =>
    `${title}${total ? ` (${filtered ? mk.filterShowing.replace('{shown}', String(shown)).replace('{total}', String(total)) : total})` : ''}`;

  const resetButton = (onReset: () => void) => (
    <button type="button" onClick={onReset} className="text-[12px] font-medium hover:opacity-80" style={{ color: 'var(--accent)' }}>
      {mk.filterReset}
    </button>
  );

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" leadingIcon={<Plus size={13} />} onClick={() => { setSaleError(undefined); setAddingSale(true); }}>
        {mk.add}
      </Button>
      <Button variant="secondary" size="sm" leadingIcon={<Upload size={13} />} disabled={busy} onClick={() => fileInput.current?.click()}>
        {busy ? mk.importing : mk.importFile}
      </Button>
    </div>
  );

  const showMore = (all: boolean, total: number, toggle: () => void) =>
    total > PREVIEW_ROWS && (
      <button type="button" onClick={toggle} className="mt-3 text-[12px] font-medium hover:opacity-80" style={{ color: 'var(--accent)' }}>
        {all ? mk.showLess : mk.showAll.replace('{count}', String(total))}
      </button>
    );

  return (
    <div className="space-y-6 md:space-y-7">
      {header}

      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />

      {/* ── Value of the current home ── */}
      <Card padding="lg">
        <SectionLabel icon={<LineChart />}>{mk.valueTitle}</SectionLabel>
        {!home || !postnr || !size ? (
          <p className="mt-3 text-[13px]" style={{ color: 'var(--text-2)' }}>{mk.valueNeedsHome}</p>
        ) : !valuation ? (
          <div className="mt-3 space-y-2">
            <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{mk.valueNeedsSales}</p>
            {ssbEstimate != null && (
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{mk.valueSsb.replace('{amount}', formatCurrencyShort(ssbEstimate))}</p>
            )}
          </div>
        ) : (
          <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] md:items-end">
            <div className="space-y-4 min-w-0">
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div className="font-mono font-semibold leading-none text-[34px] md:text-[40px]" style={{ color: 'var(--text-1)' }}>
                  {formatCurrencyShort(valuation.mid)}
                </div>
                {delta != null && (
                  <DeltaChip tone={delta >= 0 ? 'positive' : 'negative'} showArrow>
                    {`${delta >= 0 ? '+' : ''}${formatCurrencyShort(delta)} ${mk.valueVsCurrent}`}
                  </DeltaChip>
                )}
                {confidence && (
                  <DeltaChip tone={CONFIDENCE_TONE[confidence.level]}>{mk.confidence[confidence.level]}</DeltaChip>
                )}
              </div>
              {confidence && (
                <p className="text-[12px] -mt-1" style={{ color: 'var(--text-3)' }}>
                  {mk.confidenceDetail
                    .replace('{count}', confidence.effectiveCount.toLocaleString(lang === 'nb' ? 'nb-NO' : 'en-GB'))
                    .replace('{months}', String(Math.round(confidence.newestMonths)))
                    .replace('{spread}', String(Math.round(confidence.spreadPct)))}
                </p>
              )}

              {/* Range: the low–high band, the estimate, and today's value as a tick. */}
              <div>
                <div className="relative h-2 rounded-full" style={{ background: 'var(--surface-3)' }}>
                  <div
                    className="absolute inset-y-0 rounded-full"
                    style={{ left: pos(valuation.low), width: `calc(${pos(valuation.high)} - ${pos(valuation.low)})`, background: 'var(--forest)' }}
                  />
                  <div
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2"
                    style={{ left: pos(valuation.mid), background: 'var(--brass)', borderColor: 'var(--bg-card)' }}
                  />
                  {currentValue > 0 && (
                    <div className="absolute -top-1 -bottom-1 w-px" style={{ left: pos(currentValue), background: 'var(--text-2)' }} />
                  )}
                </div>
                <div className="mt-2 flex justify-between text-[12px] font-mono" style={{ color: 'var(--text-2)' }}>
                  <span>{formatCurrencyShort(valuation.low)}</span>
                  <span>{formatCurrencyShort(valuation.high)}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: 'var(--text-2)' }}>
                <span>
                  {(valuation.scope === 'street' ? mk.valueStreet : mk.valuePostnr).replace('{count}', String(valuation.count))}
                  {valuation.sameRooms && ` · ${mk.valueSameRooms}`}
                  {valuation.timeAdjusted && ` · ${mk.valueAdjusted}`}
                </span>
                <span>{mk.valuePerSqm.replace('{amount}', formatCurrencyShort(valuation.perSqm.mid))}</span>
                {valuation.overAskingPct != null && <span>{mk.valueOverAsking.replace('{pct}', pct(valuation.overAskingPct))}</span>}
                {ssbEstimate != null && <span>{mk.valueSsb.replace('{amount}', formatCurrencyShort(ssbEstimate))}</span>}
              </div>
            </div>

            {chartData.length >= 2 && (
              <div className="min-w-0">
                <div className="text-[11px] mb-2" style={{ color: 'var(--text-3)' }}>{mk.historyTitle}</div>
                <div className="h-[170px]" role="img" aria-label={mk.historyAria.replace('{from}', formatCurrencyShort(chartData[0].mid)).replace('{to}', formatCurrencyShort(chartData[chartData.length - 1].mid))}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid {...GRID_PROPS} vertical={false} />
                      <XAxis {...AXIS_PROPS} dataKey="month" tickFormatter={monthLabel} minTickGap={28} />
                      <YAxis
                        {...AXIS_PROPS_Y}
                        width={44}
                        domain={['dataMin - 100000', 'dataMax + 100000']}
                        tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}`}
                      />
                      <Tooltip
                        cursor={{ stroke: CHART.forestLight, strokeDasharray: '2 3', strokeOpacity: 0.6 }}
                        content={({ active, payload }) => {
                          const p = active && payload?.[0]?.payload as (typeof chartData)[number] | undefined;
                          if (!p) return null;
                          return (
                            <div className="rounded-[8px] px-3 py-2.5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                              <div className="text-[10px] uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--text-3)' }}>{monthLabel(p.month)}</div>
                              <div className="text-[13px] font-semibold font-mono tabular-nums" style={{ color: 'var(--text-1)' }}>{formatCurrencyShort(p.mid)}</div>
                              <div className="text-[11px] mt-1 font-mono tabular-nums" style={{ color: 'var(--text-3)' }}>
                                {formatCurrencyShort(p.low)} – {formatCurrencyShort(p.high)} · {mk.historySales.replace('{count}', String(p.count))}
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Area dataKey="range" stroke="none" fill={CHART.forest} fillOpacity={0.45} isAnimationActive={false} />
                      {currentValue > 0 && (
                        <ReferenceLine y={currentValue} stroke={CHART.textSoft} strokeDasharray="3 3" strokeWidth={1} />
                      )}
                      <Line dataKey="mid" stroke={CHART.forestLight} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: CHART.bgCard, strokeWidth: 2 }} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: CHART.forestLight }} />{mk.historyMid}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ background: CHART.forest, opacity: 0.7 }} />{mk.historyRange}</span>
                  {currentValue > 0 && (
                    <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t border-dashed" style={{ borderColor: CHART.textSoft }} />{mk.historyCurrent}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {isLive && valuation && delta != null && Math.abs(delta) >= 1000 && !applied && (
          <div className="mt-5">
            <Button variant="secondary" size="sm" onClick={() => setConfirmApply(true)}>
              {mk.applyValue.replace('{amount}', formatCurrencyShort(valuation.mid))}
            </Button>
          </div>
        )}
        {applied && (
          <p className="mt-5 text-[12px] inline-flex items-center gap-1.5" role="status" style={{ color: 'var(--positive)' }}>
            <Check size={13} /> {mk.applyDone}
          </p>
        )}
        {valuation && <p className="mt-5 text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>{mk.valueMethod}</p>}
      </Card>

      {/* ── Sold homes ── */}
      <Card padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel icon={<Tag />}>{countLabel(mk.soldTitle, filteredSold.length, sales.length, soldFiltered)}</SectionLabel>
          {actions}
        </div>
        {importMsg && (
          <p className="mt-3 text-[12px] break-words" role="status" style={{ color: importMsg.ok ? 'var(--positive)' : 'var(--negative)' }}>
            {importMsg.text}
          </p>
        )}
        {sales.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            {sizeFilter(soldMin, soldMax, setSoldMin, setSoldMax)}
            <SegmentedControl
              role="radiogroup"
              ariaLabel={mk.filterPeriod}
              value={period}
              onChange={setPeriod}
              items={[
                { value: '12', label: mk.period12 },
                { value: '24', label: mk.period24 },
                { value: 'all', label: mk.periodAll },
              ]}
            />
            {soldFiltered && resetButton(() => { setSoldMin(''); setSoldMax(''); setPeriod('all'); })}
          </div>
        )}
        {sales.length === 0 ? (
          <p className="mt-4 text-[13px]" style={{ color: 'var(--text-2)' }}>{mk.soldEmpty}</p>
        ) : filteredSold.length === 0 ? (
          <p className="mt-4 text-[13px]" style={{ color: 'var(--text-2)' }}>{mk.filterNone}</p>
        ) : (
          <div className="mt-4 overflow-x-auto -mx-2">
            <table className="w-full text-[12.5px] tabular-nums">
              <thead>
                <tr>
                  <SortTh k="address" label={mk.colAddress} sort={soldSort} onSort={onSoldSort} align="left" />
                  <SortTh k="bra" label={mk.colSqm} sort={soldSort} onSort={onSoldSort} />
                  <SortTh k="soldOn" label={mk.colDate} sort={soldSort} onSort={onSoldSort} />
                  <SortTh k="askingPrice" label={mk.colAsking} sort={soldSort} onSort={onSoldSort} />
                  <SortTh k="soldPrice" label={mk.colSold} sort={soldSort} onSort={onSoldSort} />
                  <SortTh k="perSqm" label={mk.colPerSqm} sort={soldSort} onSort={onSoldSort} />
                  <SortTh k="vsAsking" label={mk.colVsAsking} sort={soldSort} onSort={onSoldSort} />
                </tr>
              </thead>
              <tbody>
                {shownSold.map((s, i) => {
                  const over = saleOverAskingPct(s);
                  const ppm = saleTotalPerSqm(s);
                  const inEstimate = used.has(saleKey(s));
                  const weight = weightOf.get(saleKey(s)) ?? 0;
                  return (
                    <tr key={`${saleKey(s)}-${i}`} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className={`${td} text-left`} style={{ color: 'var(--text-1)' }}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            title={inEstimate ? mk.usedInEstimate : undefined}
                            aria-label={inEstimate ? mk.usedInEstimate : undefined}
                            // Fainter dot = counts less (older, or further from your size).
                            style={{ background: inEstimate ? 'var(--brass)' : 'transparent', opacity: inEstimate ? 0.3 + 0.7 * weight : 1 }}
                          />
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:underline underline-offset-2">
                              {s.address}{s.unit ? ` ${s.unit}` : ''}
                              <ExternalLink size={11} className="shrink-0" style={{ color: 'var(--text-3)' }} />
                            </a>
                          ) : (
                            <>{s.address}{s.unit ? ` ${s.unit}` : ''}</>
                          )}
                        </span>
                      </td>
                      <td className={`${td} text-right font-mono`} style={{ color: 'var(--text-2)' }}>{s.bra ?? '–'}</td>
                      <td className={`${td} text-right font-mono`} style={{ color: 'var(--text-2)' }}>{fmtDate(s.soldOn)}</td>
                      <td className={`${td} text-right font-mono`} style={{ color: 'var(--text-2)' }}>{s.askingPrice ? formatCurrencyShort(s.askingPrice) : '–'}</td>
                      <td className={`${td} text-right font-mono font-medium`} style={{ color: 'var(--text-1)' }}>{formatCurrencyShort(s.soldPrice)}</td>
                      <td className={`${td} text-right font-mono`} style={{ color: 'var(--text-2)' }}>{ppm != null ? formatCurrencyShort(ppm) : '–'}</td>
                      <td className={`${td} text-right font-mono`} style={{ color: over == null ? 'var(--text-3)' : over >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                        {over != null ? pct(over) : '–'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {used.size > 0 && (
              <div className="mt-3 px-2 flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--brass)' }} /> {mk.usedInEstimate}
              </div>
            )}
          </div>
        )}
        {showMore(allSold, filteredSold.length, () => setAllSold((v) => !v))}
      </Card>

      {/* ── Homes for sale ── */}
      <Card padding="lg">
        <SectionLabel icon={<Building2 />}>{countLabel(mk.listingsTitle, filteredListings.length, listings.length, listFiltered)}</SectionLabel>
        {listings.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            {sizeFilter(listMin, listMax, setListMin, setListMax)}
            {listFiltered && resetButton(() => { setListMin(''); setListMax(''); })}
          </div>
        )}
        {listings.length === 0 ? (
          <p className="mt-4 text-[13px]" style={{ color: 'var(--text-2)' }}>{mk.listingsEmpty}</p>
        ) : filteredListings.length === 0 ? (
          <p className="mt-4 text-[13px]" style={{ color: 'var(--text-2)' }}>{mk.filterNone}</p>
        ) : (
          <div className="mt-4 overflow-x-auto -mx-2">
            <table className="w-full text-[12.5px] tabular-nums">
              <thead>
                <tr>
                  <SortTh k="address" label={mk.colAddress} sort={listSort} onSort={onListSort} align="left" />
                  <SortTh k="bra" label={mk.colSqm} sort={listSort} onSort={onListSort} />
                  <SortTh k="bedrooms" label={mk.colBedrooms} sort={listSort} onSort={onListSort} />
                  <SortTh k="total" label={mk.colTotal} sort={listSort} onSort={onListSort} />
                  <SortTh k="perSqm" label={mk.colPerSqm} sort={listSort} onSort={onListSort} />
                  <SortTh k="felleskost" label={mk.colFelleskost} sort={listSort} onSort={onListSort} />
                  <SortTh k="change" label={mk.colChange} sort={listSort} onSort={onListSort} />
                  <SortTh k="days" label={mk.colDays} sort={listSort} onSort={onListSort} />
                </tr>
              </thead>
              <tbody>
                {shownListings.map((l) => {
                  const m = listingMetrics(l);
                  return (
                    <tr key={l.url} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className={`${td} text-left`} style={{ color: 'var(--text-1)' }}>
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:underline underline-offset-2">
                          {l.address || l.url}{l.unit ? ` ${l.unit}` : ''}
                          <ExternalLink size={11} className="shrink-0" style={{ color: 'var(--text-3)' }} />
                        </a>
                        {l.area && <span className="ml-2" style={{ color: 'var(--text-3)' }}>{l.area}</span>}
                      </td>
                      <td className={`${td} text-right font-mono`} style={{ color: 'var(--text-2)' }}>{l.bra ?? '–'}</td>
                      <td className={`${td} text-right font-mono`} style={{ color: 'var(--text-2)' }}>{l.bedrooms ?? '–'}</td>
                      <td className={`${td} text-right font-mono font-medium`} style={{ color: 'var(--text-1)' }}>{m.totalPrice != null ? formatCurrencyShort(m.totalPrice) : '–'}</td>
                      <td className={`${td} text-right font-mono`} style={{ color: 'var(--text-2)' }}>{m.totalPerSqm != null ? formatCurrencyShort(m.totalPerSqm) : '–'}</td>
                      <td className={`${td} text-right font-mono`} style={{ color: 'var(--text-2)' }}>{l.felleskost ? formatCurrencyShort(l.felleskost) : '–'}</td>
                      <td className={`${td} text-right font-mono`} style={{ color: !m.priceChange ? 'var(--text-3)' : m.priceChange < 0 ? 'var(--positive)' : 'var(--negative)' }}>
                        {m.priceChange ? `${m.priceChange > 0 ? '+' : ''}${formatCurrencyShort(m.priceChange)}` : '–'}
                      </td>
                      <td className={`${td} text-right font-mono`} style={{ color: 'var(--text-2)' }}>{m.daysListed > 0 ? m.daysListed : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {showMore(allListings, filteredListings.length, () => setAllListings((v) => !v))}
      </Card>

      {/* ── Data and controls ── */}
      <Card padding="lg">
        <SectionLabel icon={<Database />}>{mk.dataTitle}</SectionLabel>
        <p className="mt-1 text-[12px] font-mono" style={{ color: 'var(--text-3)' }}>
          {mk.dataCounts.replace('{listings}', String(status.listings)).replace('{sales}', String(status.sales))}
        </p>
        {freshness.length > 0 && (
          <p className="mt-1 text-[12px] font-mono" style={{ color: 'var(--text-3)' }}>{freshness.join(' · ')}</p>
        )}
        <p className="mt-3 text-[13px] max-w-3xl leading-relaxed" style={{ color: 'var(--text-2)' }}>{mk.dataBody}</p>
        <details className="mt-4 text-[12px] max-w-3xl" style={{ color: 'var(--text-2)' }}>
          <summary className="cursor-pointer select-none" style={{ color: 'var(--text-1)' }}>{mk.formatTitle}</summary>
          <p className="mt-2 leading-relaxed" style={{ color: 'var(--text-3)' }}>{mk.formatDesc}</p>
          <pre
            className="mt-2 rounded-[8px] p-3 text-[11.5px] leading-[1.5] overflow-x-auto border"
            style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
          >
            <code>{FORMAT_EXAMPLE}</code>
          </pre>
        </details>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => setEnabled(false))}>{mk.turnOff}</Button>
          {status.listings + status.sales > 0 && (
            <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirmWipe(true)}>{mk.wipe}</Button>
          )}
        </div>
        {failed && <p className="mt-3 text-[12px]" style={{ color: 'var(--negative)' }}>{mk.saveError}</p>}
      </Card>

      {addingSale && (
        <EditModal
          title={mk.addSale.title}
          saveLabel={mk.addSale.save}
          error={saleError}
          onCancel={() => setAddingSale(false)}
          onSave={(v) => void onSaveSale(v)}
          fields={[
            { key: 'address', label: mk.addSale.address, type: 'text', value: '' },
            { key: 'unit', label: mk.addSale.unit, type: 'text', value: '' },
            { key: 'postnr', label: mk.addSale.postnr, type: 'text', value: postnr ?? '' },
            { key: 'bra', label: mk.addSale.bra, type: 'number', value: '' },
            { key: 'soldPrice', label: mk.addSale.soldPrice, type: 'text', value: '' },
            { key: 'soldOn', label: mk.addSale.soldOn, type: 'monthpicker', pickerMode: 'day', value: '' },
            { key: 'askingPrice', label: mk.addSale.askingPrice, type: 'text', value: '' },
            { key: 'fellesgjeld', label: mk.addSale.fellesgjeld, type: 'text', value: '' },
          ]}
        />
      )}

      {confirmApply && valuation && (
        <ConfirmModal
          danger={false}
          title={mk.applyTitle}
          message={mk.applyMessage
            .replace('{amount}', formatCurrencyShort(valuation.mid))
            .replace('{current}', formatCurrencyShort(currentValue))}
          confirmLabel={mk.applyConfirm}
          cancelLabel={mk.cancel}
          onCancel={() => setConfirmApply(false)}
          onConfirm={() => {
            setConfirmApply(false);
            updateAsset('houseValue', valuation.mid);
            setApplied(true);
          }}
        />
      )}

      {confirmWipe && (
        <ConfirmModal
          title={mk.wipeTitle}
          message={mk.wipeMessage}
          confirmLabel={mk.wipeConfirm}
          cancelLabel={mk.cancel}
          onCancel={() => setConfirmWipe(false)}
          onConfirm={() => {
            setConfirmWipe(false);
            void run(() => setEnabled(false, true));
          }}
        />
      )}
    </div>
  );
};

export default MarketPanel;
