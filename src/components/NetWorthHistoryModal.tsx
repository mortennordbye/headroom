import { useState } from 'react';
import { RotateCcw, Camera } from 'lucide-react';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../context/FinanceContext';
import { parseLocaleNumber } from '../lib/validators';
import { ProvenanceBadge } from './ui/ProvenanceBadge';
import { ModalShell } from './ui/ModalShell';

export interface NetWorthPoint {
  monthKey: string;
  value: number;
  estimated: boolean;
}

interface NetWorthHistoryModalProps {
  /** The 12-month grid, oldest → newest. The last entry is the current (live) month. */
  series: NetWorthPoint[];
  formatCurrency: (v: number) => string;
  onClose: () => void;
}

export default function NetWorthHistoryModal({ series, formatCurrency, onClose }: NetWorthHistoryModalProps) {
  const { t, lang, setNetWorthForMonth, clearNetWorthForMonth, balanceSnapshots } = useFinance();
  const nw = t.netWorthEditor;
  const dateLocale = lang === 'nb' ? nb : enUS;
  const currentKey = series[series.length - 1]?.monthKey;

  // Local editable drafts, keyed by month. A recorded month starts with its value;
  // an estimated month starts blank (the estimate shows as placeholder).
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(series.map(p => [p.monthKey, p.estimated ? '' : String(p.value)]))
  );

  const commit = (monthKey: string, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') { clearNetWorthForMonth(monthKey); return; }
    const n = parseLocaleNumber(trimmed.replace(/\s/g, ''));
    if (Number.isFinite(n)) setNetWorthForMonth(monthKey, n);
  };

  const reset = (monthKey: string) => {
    clearNetWorthForMonth(monthKey);
    setDrafts(prev => ({ ...prev, [monthKey]: '' }));
  };

  const rows = [...series].reverse(); // newest first

  return (
    <ModalShell
      title={nw.title}
      onClose={onClose}
      closeLabel={nw.done}
      panelClassName="sm:min-w-[420px] sm:max-w-md space-y-4 max-h-[85vh] flex flex-col"
      footer={
        <button
          onClick={onClose}
          className="shrink-0 w-full py-2.5 rounded-[8px] text-[13px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-opacity"
        >
          {nw.done}
        </button>
      }
    >
        <p className="text-[12px] leading-relaxed shrink-0" style={{ color: 'var(--text-3)' }}>{nw.desc}</p>

        <div className="space-y-1.5 overflow-y-auto -mx-1 px-1">
          {rows.map(p => {
            const isCurrent = p.monthKey === currentKey;
            const hasSnapshot = balanceSnapshots[p.monthKey] !== undefined;
            const label = format(parse(p.monthKey, 'yyyy-MM', new Date()), 'MMM yyyy', { locale: dateLocale });
            return (
              <div key={p.monthKey} className="flex items-center gap-3 py-1.5">
                <div className="w-[88px] shrink-0 flex items-center gap-1.5">
                  <span className="text-[12px] font-medium capitalize" style={{ color: 'var(--text-2)' }}>{label}</span>
                  {hasSnapshot && (
                    <span title={nw.snapshotSaved} className="inline-flex" aria-label={nw.snapshotSaved}>
                      <Camera size={11} style={{ color: 'var(--text-3)' }} />
                    </span>
                  )}
                </div>
                {isCurrent ? (
                  <div className="flex-1 flex items-center justify-between gap-2">
                    <span className="text-[13px] font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
                      {formatCurrency(p.value)}
                    </span>
                    <span
                      className="inline-flex items-center rounded-[4px] font-semibold h-[18px] px-[7px] text-[10px]"
                      style={{ background: 'var(--violet-bg)', color: 'var(--violet)' }}
                      title={nw.liveHint}
                    >
                      {nw.live}
                    </span>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={drafts[p.monthKey] ?? ''}
                      placeholder={`${nw.placeholderEstimate}: ${Math.round(p.value)}`}
                      onChange={(e) => setDrafts(prev => ({ ...prev, [p.monthKey]: e.target.value }))}
                      onBlur={(e) => commit(p.monthKey, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                      className="flex-1 min-w-0 h-9 px-3 rounded-[8px] text-[13px] font-mono outline-none border focus:ring-2 focus:ring-[var(--positive)]"
                      style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                    />
                    <ProvenanceBadge kind={p.estimated ? 'estimate' : 'custom'} />
                    <button
                      onClick={() => reset(p.monthKey)}
                      disabled={p.estimated}
                      className="p-1 rounded-md transition-colors disabled:opacity-30 disabled:cursor-default"
                      style={{ color: 'var(--text-3)' }}
                      onMouseEnter={e => { if (!p.estimated) e.currentTarget.style.color = 'var(--text-1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; }}
                      title={nw.reset}
                      aria-label={nw.reset}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
    </ModalShell>
  );
}
