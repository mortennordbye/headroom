import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { RotateCcw } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import {
  youEconomics, TARGET_MARGIN_RANGE,
  type CompanyModel, type CompanyContext, type CompanyResult, type YouBreakdownPart,
} from '../lib/companyCost';
import { companyRanges, SMALL_SWING_KR, type Range } from '../lib/companyRanges';
import { DEFAULT_STYRK, MARKET_WAGE_GROWTH_PCT, STYRK_CODES, isStyrkCode, marketWage } from '../lib/marketWage';
import { accountsStatus } from '../lib/companyCalibrate';
import { ACCOUNTS_CARD_ANCHOR, BasisTag } from './CompanyAccountsCard';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { NumberRow } from './ui/NumberRow';
import { Button } from './ui/Button';

/** Fill `{key}` slots in a translated string with React nodes. */
function fill(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <span key={i}>{values[part] ?? part}</span> : part));
}

/** Render `**bold**` spans of a translated string. */
function rich(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? <b key={i} style={{ color: 'var(--text-1)' }}>{part}</b> : part));
}

const BAR_COLOR: Record<YouBreakdownPart['kind'], string> = {
  salary: 'var(--text-1)',
  onCosts: 'var(--teal)',
  bench: 'var(--rust)',
  support: 'var(--slate)',
  office: 'var(--text-3)',
  other: 'var(--text-3)',
  kept: 'var(--forest-light)',
};

interface AxisMarker {
  key: string;
  value: number;
  label: string;
  color: string;
  above: boolean;
  dashed?: boolean;
  /** Label top in px, when the default row would overlap another label. */
  labelTop?: number;
}

/** Round tick step for a salary axis span: at most 5 intervals. */
function tickStep(span: number): number {
  return [50_000, 100_000, 200_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000].find((s) => span / s <= 5) ?? 10_000_000;
}

/**
 * The top card of Avansert: what the company keeps on you, the fair salary, the
 * one-year kroner bar and the salary axis with a "what if" slider. All numbers
 * come from youEconomics in src/lib/companyCost.ts. The slider is local state
 * only: it never writes the model or the salary page. Ranges and "Hva betyr
 * mest" come from the saved quick setup's guesses (companyRanges.ts).
 */
export function CompanyMeCard({
  model, setModel, ctx, result,
}: {
  model: CompanyModel;
  setModel: Dispatch<SetStateAction<CompanyModel>>;
  ctx: CompanyContext;
  result: CompanyResult;
}) {
  const { t, lang, region, formatCurrencyShort } = useFinance();
  const c = t.companyModel;
  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';
  const nf = (v: number, d = 0) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  const kr = formatCurrencyShort;
  const k = (v: number) => `${v < 0 ? '−' : ''}${nf(Math.abs(v) / 1000)}k`;
  const mill = (v: number) => c.millions.replace('{v}', `${v < 0 ? '−' : ''}${nf(Math.abs(v) / 1e6, 2)}`);
  const b = (v: ReactNode) => <b className="font-mono font-medium" style={{ color: 'var(--text-1)' }}>{v}</b>;

  const now = result.you.gross;
  const [whatIf, setWhatIf] = useState<number | null>(null);
  const gross = whatIf ?? now;
  // Fair salary, ceiling and the ranges do not depend on the "what if" salary: solve them once per model.
  const atNow = useMemo(() => youEconomics(model, ctx, result), [model, ctx, result]);
  const y = whatIf == null ? atNow : youEconomics(model, ctx, result, whatIf, atNow);
  const fair = y.fairGross;
  const ceiling = y.ceilingGross;
  // One rounding rule for every shown fair salary and ceiling; the exact values only place the markers.
  const round10k = (v: number) => Math.round(v / 10_000) * 10_000;
  const fairShown = fair != null ? round10k(fair) : null;
  const ceilingShown = ceiling != null ? round10k(ceiling) : null;

  // ── Ranges from the saved guesses (not the form's unsaved draft) ──
  const ranges = useMemo(() => companyRanges(model, ctx), [model, ctx]);
  const handEdited = model.quick?.edited === true;
  const hasWidth = (r: Range | undefined): r is Range & { low: number; high: number } =>
    !!r && r.low != null && r.high != null && r.high - r.low >= 1;
  const span = (r: Range | undefined) => (hasWidth(r) ? c.rangeSpan.replace('{low}', k(r.low)).replace('{high}', k(r.high)) : null);
  // Keep's swings do not depend on your salary, so the range moves with the "what if" keep.
  const keepShift = ranges?.keep.mid != null ? y.keep - ranges.keep.mid : 0;
  const keepSpan = span(ranges && ranges.keep.low != null && ranges.keep.high != null
    ? { mid: y.keep, low: ranges.keep.low + keepShift, high: ranges.keep.high + keepShift }
    : undefined);
  const fairRange = ranges?.fairGross;
  const fairSpan = span(fairRange);

  // ── Kroner bar: office and other cost lines share one segment ──
  const office = y.breakdown.filter((p) => p.kind === 'office' || p.kind === 'other');
  const officeTotal = office.reduce((s, p) => s + p.value, 0);
  const segs = [
    ...y.breakdown.filter((p) => p.kind !== 'office' && p.kind !== 'other' && p.kind !== 'kept').map((p) => ({
      key: p.key,
      label: p.kind === 'salary' ? c.barSalary : p.kind === 'onCosts' ? c.barOnCosts : p.label || '–',
      value: p.value,
      color: BAR_COLOR[p.kind],
      extra: '',
    })),
    {
      key: 'office', label: c.barOffice, value: officeTotal, color: BAR_COLOR.office,
      extra: c.barOfficeTip.replace('{office}', kr(office.find((p) => p.kind === 'office')?.value ?? 0)).replace('{other}', kr(office.find((p) => p.kind === 'other')?.value ?? 0)),
    },
    { key: 'kept', label: c.barKept, value: y.keep, color: BAR_COLOR.kept, extra: '' },
  ];
  const shown = segs.filter((s) => s.value > 0);
  const shownTotal = shown.reduce((s, x) => s + x.value, 0);
  const [hover, setHover] = useState<string | null>(null);
  const hovered = shown.find((s) => s.key === hover);
  const hoverCenter = (() => {
    if (!hovered || shownTotal <= 0) return 50;
    let before = 0;
    for (const s of shown) { if (s.key === hovered.key) break; before += s.value; }
    return Math.min(85, Math.max(15, (before + hovered.value / 2) / shownTotal * 100));
  })();

  // ── Market pay: SSB median for your occupation, moved to the model year ──
  // Public statistics with no identifier, so it also loads in demo mode. Norway only.
  const styrk = model.market?.styrk ?? DEFAULT_STYRK;
  const showMarket = region === 'no';
  const [fetched, setFetched] = useState<{ code: string; raw: unknown; failed: boolean } | null>(null);
  useEffect(() => {
    if (!showMarket) return;
    const ac = new AbortController();
    fetch(`/api/wage-stats/occupation?code=${encodeURIComponent(styrk)}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => setFetched({ code: styrk, raw, failed: raw == null }))
      .catch(() => { if (!ac.signal.aborted) setFetched({ code: styrk, raw: null, failed: true }); });
    return () => ac.abort();
  }, [styrk, showMarket]);
  const current = showMarket && fetched?.code === styrk ? fetched : null;
  const market = current ? marketWage(current.raw, ctx.year) : null;
  const marketFailed = !!current && (current.failed || market == null);
  // A model year before the SSB year is not projected back: the value is labelled with the SSB year.
  const projected = market != null && ctx.year > market.year;
  const mkt = market?.projected.median ?? null;
  const mktBand = market && market.projected.p25 != null && market.projected.p75 != null
    ? { low: market.projected.p25, high: market.projected.p75 }
    : null;

  // ── Salary axis: its range comes from now, fair, ceiling and market (not the slider) ──
  const band = hasWidth(fairRange) ? fairRange : null;
  const anchors = [now, fair, ceiling, band?.low, band?.high, mkt].filter((v): v is number => v != null && v > 0);
  const span0 = anchors.length ? Math.max(...anchors) - Math.min(...anchors) : 0;
  const pad = Math.max(100_000, span0 * 0.25);
  const step = tickStep(anchors.length ? span0 + 2 * pad : 1_000_000);
  const lo = anchors.length ? Math.max(0, Math.floor((Math.min(...anchors) - pad) / step) * step) : 0;
  const hi = anchors.length ? Math.ceil((Math.max(...anchors) + pad) / step) * step : 1_000_000;
  const x = (v: number) => (hi > lo ? (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * 100 : 0);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  // One marker per line. "Marked" sits above with "Tak"; its label moves up a row when the two would overlap.
  const mktShown = mkt != null ? round10k(mkt) : null;
  const marketStacked = mkt != null && ceiling != null && Math.abs(x(mkt) - x(ceiling)) < 22;
  const markers: AxisMarker[] = [
    ...(ceiling != null ? [{ key: 'ceiling', value: ceiling, label: `${c.axisCeiling} ${k(ceilingShown!)}`, color: 'var(--rust)', above: true }] : []),
    ...(fair != null ? [{ key: 'fair', value: fair, label: `${c.axisFair} ${k(fairShown!)}`, color: 'var(--forest-light)', above: false }] : []),
    ...(mkt != null ? [{
      key: 'market', value: mkt, label: `${c.axisMarket} ${k(mktShown!)}`, color: 'var(--text-2)', above: true, dashed: true,
      ...(marketStacked ? { labelTop: -16 } : {}),
    }] : []),
  ];
  // The "Nå" label sits below the axis like "Rimelig": hide it when they would overlap (wider labels on a phone).
  const nowFairGap = fair != null ? Math.abs(x(now) - x(fair)) : 100;
  const nowLabelClass = nowFairGap < 9 ? 'hidden' : nowFairGap < 24 ? 'hidden sm:block' : '';
  const labelLeft = (v: number) => `${Math.min(94, Math.max(6, x(v)))}%`;

  // ── Target margin ──
  const shownTarget = Math.round(y.targetMarginPct * 10) / 10;
  const commitTarget = (v: number) => {
    if (y.targetIsCompany && Math.abs(v - shownTarget) < 0.05) return; // a blur without an edit keeps the default
    setModel((m) => ({ ...m, targetMarginPct: Math.min(TARGET_MARGIN_RANGE.max, Math.max(TARGET_MARGIN_RANGE.min, v)) }));
  };

  // What "keep" rests on: guesses, or a fit to the accounts that still matches them (Norway only, as the accounts card).
  const basis = useMemo(() => (region === 'no' ? accountsStatus(model, ctx) : null), [region, model, ctx]);
  const fitted = basis?.basis === 'accounts';

  const lineTemplate = y.raise.bonusDrop > 0 ? c.meLine : c.meLineNoBonus;
  // Your real salary against the fair salary; the slider does not move it.
  const fairDiff = fairShown != null ? now - fairShown : 0;

  return (
    <Card padding="lg">
      {/* Two headline numbers, with their ranges when the setup has guesses. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <SectionLabel>{c.meKeep}</SectionLabel>
            {basis && (
              <span data-testid="me-basis">
                <BasisTag fact={fitted}>{fitted ? c.meBasisAccounts.replace('{year}', String(model.accounts?.year ?? '')) : c.meBasisGuess}</BasisTag>
              </span>
            )}
          </div>
          <div className="mt-2 font-mono font-semibold leading-[1.1] text-[30px] md:text-[40px] tabular-nums" style={{ color: y.keep < 0 ? 'var(--negative)' : 'var(--brass)' }}>
            {kr(y.keep)}
          </div>
          <div className="mt-1.5 text-[12px] font-mono" style={{ color: 'var(--text-3)' }}>{c.meKeepSub.replace('{pct}', nf(y.keepPct))}{keepSpan && <> · <span className="whitespace-nowrap">{keepSpan}</span></>}</div>
          {basis && (
            <div className="mt-1 text-[12px]" style={{ color: 'var(--text-3)' }}>
              {fitted ? c.meBasisAccountsSub : (
                <>
                  {basis.match === 'mismatch' ? c.meBasisMismatch : c.meBasisUnchecked}{' '}
                  <a
                    href={`#${ACCOUNTS_CARD_ANCHOR}`}
                    className="underline underline-offset-2"
                    style={{ color: 'var(--accent)' }}
                    onClick={(e) => { e.preventDefault(); document.getElementById(ACCOUNTS_CARD_ANCHOR)?.scrollIntoView({ block: 'start' }); }}
                  >
                    {c.meBasisCheck}
                  </a>
                </>
              )}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <SectionLabel>{c.meFair}</SectionLabel>
          {fair != null ? (
            <>
              <div className="mt-2 font-mono font-semibold leading-[1.1] text-[30px] md:text-[40px] tabular-nums" style={{ color: 'var(--positive)' }}>
                {c.meFairValue.replace('{v}', kr(fairShown!))}
              </div>
              <div className="mt-1.5 text-[12px] font-mono" style={{ color: 'var(--text-3)' }}>
                {fairSpan && <><span className="whitespace-nowrap">{fairSpan}</span> · </>}{c.meFairSub.replace('{now}', kr(now)).replace('{diff}', `${fairDiff < 0 ? '−' : '+'}${k(Math.abs(fairDiff))}`)}
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 font-mono font-semibold leading-[1.1] text-[30px] md:text-[40px]" style={{ color: 'var(--text-3)' }}>{c.meFairNone}</div>
              <div className="mt-1.5 text-[12px]" style={{ color: 'var(--text-3)' }}>{c.meFairNoneSub}</div>
            </>
          )}
        </div>
      </div>

      <p className="mt-4 text-[14px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
        {fill(lineTemplate, {
          revenue: b(mill(y.revenue)),
          cost: b(mill(y.ownCost + y.share)),
          share: b(`${nf(y.salarySharePct)} %`),
          companyShare: `${nf(y.companySalarySharePct)} %`,
          raise: kr(y.raise.amount),
          raiseCost: b(kr(Math.round(y.raise.cost / 1000) * 1000)),
          dropPct: `${nf(y.raise.cost > 0 ? y.raise.bonusDrop / y.raise.cost * 100 : 0)} %`,
          drop: kr(Math.round(y.raise.bonusDrop / 100) * 100),
        })}
      </p>

      {/* One year for you, in kroner */}
      <SectionLabel className="mt-5">{c.barTitle}</SectionLabel>
      <div className="relative">
        {hovered && (
          <div
            role="tooltip"
            className="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none z-10 rounded-[6px] border px-2.5 py-2 text-[12px] whitespace-nowrap"
            style={{ left: `${hoverCenter}%`, background: 'var(--bg-3)', borderColor: 'var(--brass-dim)', color: 'var(--text-2)' }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--text-3)' }}>{hovered.label}</div>
            <div className="font-mono font-semibold text-[14px] my-0.5" style={{ color: 'var(--text-1)' }}>{kr(hovered.value)}</div>
            <div>{c.barTipPct.replace('{pct}', nf(y.revenue > 0 ? hovered.value / y.revenue * 100 : 0))}{hovered.extra && ` · ${hovered.extra}`}</div>
          </div>
        )}
        <div className="flex gap-[2px] h-[22px] mt-2.5 mb-2" onMouseLeave={() => setHover(null)}>
          {shown.map((s, i) => (
            <div
              key={s.key}
              role="img"
              aria-label={`${s.label}: ${kr(s.value)}`}
              onMouseEnter={() => setHover(s.key)}
              className="transition-opacity"
              style={{
                flex: s.value,
                background: s.color,
                opacity: hover && hover !== s.key ? 0.5 : 1,
                borderRadius: `${i === 0 ? 4 : 2}px ${i === shown.length - 1 ? 4 : 2}px ${i === shown.length - 1 ? 4 : 2}px ${i === 0 ? 4 : 2}px`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px]" style={{ color: 'var(--text-3)' }}>
        <span>{b(kr(y.revenue))} {c.barInvoiced}</span>
        {segs.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: s.color }} />
            {s.label} {b(k(s.value))}
          </span>
        ))}
        {y.keep < 0 && <span style={{ color: 'var(--negative)' }}>{c.meLoss}</span>}
      </div>

      {/* Salary axis + what-if slider */}
      <div className="mt-6 flex items-baseline justify-between gap-2 mb-2">
        <SectionLabel>{mkt != null ? c.axisTitleMarket : c.axisTitle}</SectionLabel>
        <span className="text-[18px] font-semibold tabular-nums whitespace-nowrap">
          {whatIf == null ? c.axisNow : c.axisWhatIf} {kr(gross)}
          {whatIf != null && whatIf !== now && (
            <span className="ml-2 text-[12px] font-mono" style={{ color: whatIf > now ? 'var(--positive)' : 'var(--negative)' }}>
              {whatIf > now ? '+' : '−'}{nf(Math.abs(whatIf - now))}
            </span>
          )}
        </span>
      </div>
      <div
        className={`relative h-[120px] mx-1 ${marketStacked ? 'mt-6' : ''}`}
        role="img"
        aria-label={c.axisAria.replace('{now}', kr(now)).replace('{fair}', fairShown != null ? kr(fairShown) : '–').replace('{ceiling}', ceilingShown != null ? kr(ceilingShown) : '–')
          + (mktShown != null ? c.axisAriaMarket.replace('{market}', kr(mktShown)) : '') + (fairSpan ? ` · ${fairSpan}` : '')}
      >
        <div className="absolute left-0 right-0 top-[57px] h-[6px] rounded-full" style={{ background: 'var(--rule)' }} />
        {band && (
          <div
            data-testid="fair-band"
            className="absolute top-[54px] h-[12px] rounded-[4px]"
            style={{ left: `${x(band.low)}%`, width: `${x(band.high) - x(band.low)}%`, background: 'var(--forest)', opacity: 0.8 }}
          />
        )}
        {mktBand && (
          <div
            data-testid="market-band"
            className="absolute top-[47px] h-[4px] rounded-full"
            style={{ left: `${x(mktBand.low)}%`, width: `${x(mktBand.high) - x(mktBand.low)}%`, background: 'var(--text-3)', opacity: 0.6 }}
          />
        )}
        {ticks.map((v, i) => (
          <div key={v} className="absolute top-[58px]" style={{ left: `${x(v)}%` }}>
            <div className="w-px h-[6px] -translate-x-1/2" style={{ background: 'var(--text-3)' }} />
            {/* Every other label on a phone, so they do not overlap. */}
            <div
              className={`absolute top-[10px] -translate-x-1/2 text-[11px] font-mono whitespace-nowrap ${i % 2 ? 'hidden sm:block' : ''} ${
                i === 0 ? 'max-sm:translate-x-0' : i === ticks.length - 1 ? 'max-sm:-translate-x-full' : ''}`} style={{ color: 'var(--text-3)' }}>{c.millions.replace('{v}', nf(v / 1e6, 1))}</div>
          </div>
        ))}
        {markers.map((m) => (
          <div key={m.key} data-testid={`marker-${m.key}`}>
            <div
              className="absolute w-0 -translate-x-1/2"
              style={{ left: `${x(m.value)}%`, top: m.above ? 24 : 60, height: 36, borderLeft: `${m.dashed ? '1.5px dashed' : '2px solid'} ${m.color}` }}
            />
            <div className="absolute -translate-x-1/2 text-[12px] font-semibold whitespace-nowrap" style={{ left: labelLeft(m.value), top: m.labelTop ?? (m.above ? 2 : 100), color: m.color }}>{m.label}</div>
          </div>
        ))}
        <div className="absolute w-4 h-4 rounded-full -translate-x-1/2 border-2" style={{ left: `${x(now)}%`, top: 52, background: 'var(--brass)', borderColor: 'var(--bg-2)' }} />
        {nowLabelClass !== 'hidden' && (
          <div className={`absolute -translate-x-1/2 text-[12px] font-semibold whitespace-nowrap ${nowLabelClass}`} style={{ left: labelLeft(now), top: 100, color: 'var(--brass)' }}>{c.axisNow} {k(now)}</div>
        )}
        {whatIf != null && whatIf !== now && (
          <div className="absolute w-[14px] h-[14px] rounded-full -translate-x-1/2 border-2" style={{ left: `${x(whatIf)}%`, top: 53, borderColor: 'var(--text-1)' }} />
        )}
      </div>
      <input
        type="range"
        min={lo}
        max={hi}
        step={10_000}
        value={Math.min(hi, Math.max(lo, gross))}
        onChange={(e) => setWhatIf(Number(e.target.value))}
        aria-label={c.sliderAria}
        aria-valuetext={kr(gross)}
        className="w-full mt-2"
        style={{ accentColor: 'var(--forest-light)' }}
      />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{c.sliderHint}</p>
        {whatIf != null && whatIf !== now && (
          <Button size="sm" variant="secondary" leadingIcon={<RotateCcw />} onClick={() => setWhatIf(null)}>{c.backToNow}</Button>
        )}
      </div>

      {/* Target margin, your occupation (SSB market pay) and what matters most. */}
      <div className="mt-5 pt-4 border-t grid grid-cols-1 md:grid-cols-3 gap-6" style={{ borderColor: 'var(--rule)' }}>
        <div>
          <NumberRow
            label={c.targetTitle}
            value={shownTarget}
            onCommit={commitTarget}
            onBlank={() => setModel((m) => ({ ...m, targetMarginPct: null }))}
            suffix="%"
            badge={(
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                style={y.targetIsCompany
                  ? { background: 'var(--positive-bg)', color: 'var(--positive)' }
                  : { background: 'var(--surface-5)', color: 'var(--text-3)' }}
              >
                {y.targetIsCompany ? c.targetCompany : c.targetOwn}
              </span>
            )}
          />
          {!y.targetIsCompany && (
            <Button size="sm" variant="secondary" className="mt-2" leadingIcon={<RotateCcw />} onClick={() => setModel((m) => ({ ...m, targetMarginPct: null }))}>
              {c.targetReset}
            </Button>
          )}
          <p className="mt-2 text-[12px]" style={{ color: 'var(--text-3)' }}>{c.targetHint}</p>
          {y.targetClamped && <p className="mt-2 text-[12px]" style={{ color: 'var(--warning)' }}>{c.targetClampedNote}</p>}
        </div>
        {showMarket && (
          <div className="min-w-0">
            <SectionLabel id="company-styrk-label">{c.marketTitle}</SectionLabel>
            <select
              aria-labelledby="company-styrk-label"
              value={styrk}
              onChange={(e) => { const v = e.target.value; if (isStyrkCode(v)) setModel((m) => ({ ...m, market: { styrk: v } })); }}
              className="mt-2 w-full cursor-pointer rounded-[6px] border px-2 py-1.5 text-[13px] outline-none focus:border-[var(--forest)]"
              style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
            >
              {STYRK_CODES.map((code) => <option key={code} value={code}>{code} {c.styrk[code]}</option>)}
            </select>
            {market ? (
              <div data-testid="market-info">
                <p className="mt-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
                  {projected
                    ? c.marketMedian.replace('{v}', kr(mktShown!)).replace('{modelYear}', String(ctx.year)).replace('{year}', String(market.year))
                      .replace('{raw}', kr(market.median)).replace('{growth}', nf(MARKET_WAGE_GROWTH_PCT))
                    : c.marketMedianNoProjection.replace('{v}', kr(mktShown!)).replace('{year}', String(market.year))}
                </p>
                {mktBand && (
                  <p className="mt-1 text-[12px] font-mono" style={{ color: 'var(--text-3)' }}>
                    {c.marketBand.replace('{low}', k(round10k(mktBand.low))).replace('{high}', k(round10k(mktBand.high)))}
                  </p>
                )}
                <p className="mt-2 text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                  {(projected ? c.marketSource : c.marketSourceNoProjection).replace('{code}', styrk).replace('{year}', String(market.year)).replace('{modelYear}', String(ctx.year))}
                </p>
              </div>
            ) : marketFailed ? (
              <p className="mt-2 text-[12px]" style={{ color: 'var(--text-3)' }} data-testid="market-error">{c.marketError}</p>
            ) : null}
          </div>
        )}
        {(ranges || handEdited) && (
          <div className="md:col-start-3 min-w-0">
            <SectionLabel>{c.driversTitle}</SectionLabel>
            {!ranges ? (
              <p className="mt-2 text-[12px]" style={{ color: 'var(--text-3)' }}>{c.rangesHandEdited}</p>
            ) : ranges.drivers.length > 0 ? (
              <ul className="mt-2 space-y-1.5 text-[13px]" data-testid="drivers">
                {ranges.drivers.map((d) => (
                  <li key={d.key} className="flex items-baseline justify-between gap-3">
                    <span style={{ color: 'var(--text-2)' }}>{c.guessLabels[d.key]}</span>
                    <b className="font-mono font-medium whitespace-nowrap" style={{ color: 'var(--text-1)' }}>
                      {d.width < SMALL_SWING_KR ? c.driversSmall : `${d.down < 0 ? '−' : ''}${k(Math.abs(d.down))} / +${k(d.up)}`}
                    </b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12px]" style={{ color: 'var(--text-3)' }}>{c.driversNone}</p>
            )}
            {ranges && ranges.drivers.length > 0 && (
              <>
                <p className="mt-2 text-[12px]" style={{ color: 'var(--text-3)' }}>{ranges.rankedBy === 'keep' ? c.driversHintKeep : c.driversHint}</p>
                <p className="mt-1 text-[11.5px]" style={{ color: 'var(--text-3)' }}>{c.rangeMethod}</p>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** The two folded explainers under the card. */
export function CompanyExplainers() {
  const { t } = useFinance();
  const c = t.companyModel;
  return (
    <>
      <Explainer title={c.explainMoneyTitle}>
        <p>{rich(c.explainMoneyBody)}</p>
      </Explainer>
      <Explainer title={c.explainArgsTitle}>
        <ul className="list-disc pl-5 space-y-1">
          {[c.argBench, c.argRisk, c.argRecruit, c.argBonus, c.argMarket].map((a) => <li key={a}>{rich(a)}</li>)}
        </ul>
      </Explainer>
    </>
  );
}

function Explainer({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padding="lg">
      <details className="group">
        <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
          <SectionLabel>
            {title} <span aria-hidden className="inline-block transition-transform group-open:rotate-90">▸</span>
          </SectionLabel>
        </summary>
        <div className="mt-4 text-[14px] leading-[1.6] max-w-3xl" style={{ color: 'var(--text-2)' }}>{children}</div>
      </details>
    </Card>
  );
}
