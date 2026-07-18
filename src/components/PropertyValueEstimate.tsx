import { useEffect, useState } from 'react';
import { LineChart } from 'lucide-react';
import { useFinance, type Residence } from '../context/FinanceContext';
import { Sparkline, DeltaChip } from './ui';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { estimatedPropertyValue } from '../lib/propertyEstimate';

interface Props {
  /** The current residence — its postalCode + dwellingType + sizeSqm drive the estimate. */
  residence: Residence | undefined;
  /** The user's own current value for the home, for the vs-estimate delta. */
  currentValue: number;
}

/**
 * Estimated market value of the current home from SSB square-metre prices
 * (table 14310): sizeSqm × the kommune's average kr/m² for the dwelling type.
 * A rough, kommune-average ballpark — labelled as such.
 */
export function PropertyValueEstimate({ residence, currentValue }: Props) {
  const { t, formatCurrency, kvmpris, kvmprisStale, loadKvmpris, refreshKvmpris } = useFinance();
  const lp = t.loanPage;

  const postnr = residence?.postalCode;
  const type = residence?.dwellingType;
  const sizeSqm = residence?.sizeSqm;

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void loadKvmpris(postnr, type);
  }, [postnr, type, loadKvmpris]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshKvmpris();
    } finally {
      setRefreshing(false);
    }
  };

  const header = (
    <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
      <LineChart size={14} strokeWidth={2} className="text-[var(--text-2)]" />
      <SectionLabel>{lp.estValueTitle}</SectionLabel>
    </div>
  );

  // No postnummer yet — prompt for one rather than showing an empty card.
  if (!postnr || postnr.replace(/\D/g, '').length !== 4) {
    return (
      <Card padding="none" className="p-5 md:p-7 space-y-5">
        {header}
        <p className="text-[13px] text-[var(--text-2)]">{lp.estValueNoPostal}</p>
      </Card>
    );
  }

  const estimate = estimatedPropertyValue(sizeSqm, kvmpris?.latestPrice);
  const priceSeries = (kvmpris?.points ?? [])
    .map((p) => p.price)
    .filter((v): v is number => typeof v === 'number');

  const delta = estimate != null && currentValue > 0 ? estimate - currentValue : null;
  const deltaPct = delta != null ? (delta / currentValue) * 100 : null;

  return (
    <Card padding="none" className="p-5 md:p-7 space-y-5">
      {header}

      {estimate == null ? (
        <p className="text-[13px] text-[var(--text-2)]">{lp.estValueNoData}</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[26px] font-mono font-semibold text-[var(--text-1)] leading-none">
                {formatCurrency(estimate)}
              </div>
              <div className="mt-1.5 text-[12px] text-[var(--text-2)]">
                {formatCurrency(kvmpris!.latestPrice!)}{lp.estValuePerSqmUnit}
                {kvmpris?.poststed ? ` · ${kvmpris.poststed}` : ''} · {lp.estValueBasis}
              </div>
            </div>
            {delta != null && (
              <DeltaChip tone={delta >= 0 ? 'positive' : 'negative'} showArrow>
                {`${delta >= 0 ? '+' : ''}${formatCurrency(delta)}${
                  deltaPct != null ? ` (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%)` : ''
                }`}
              </DeltaChip>
            )}
          </div>

          {delta != null && (
            <div className="text-[11px] text-[var(--text-2)]">{lp.estValueVsCurrent}</div>
          )}

          {priceSeries.length >= 2 && (
            <Sparkline values={priceSeries} tone="auto" height={36} />
          )}

          {kvmpris?.latestSales != null && kvmpris.latestQuarter && (
            <div className="text-[11px] text-[var(--text-2)]">
              {kvmpris.latestSales} {lp.estValueSalesLabel} · {kvmpris.latestQuarter}
            </div>
          )}
        </>
      )}

      {kvmprisStale && (
        <p className="text-[11px] flex items-center gap-2" style={{ color: 'var(--warning)' }}>
          <span>{lp.estValueOffline}</span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="underline underline-offset-2 hover:opacity-80 transition-opacity disabled:opacity-60 disabled:no-underline"
          >
            {refreshing ? lp.estValueRefreshing : lp.estValueRefresh}
          </button>
        </p>
      )}

      <p className="text-[11px] text-[var(--text-3)] leading-relaxed">{lp.estValueSource}</p>
    </Card>
  );
}
