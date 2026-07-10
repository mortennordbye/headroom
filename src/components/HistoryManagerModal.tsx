import { useMemo, useState } from 'react';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useFinance, type BalanceSnapshot } from '../context/FinanceContext';
import { ModalShell } from './ui/ModalShell';
import { NumberRow } from './ui/NumberRow';
import { netWorthFromSnapshot } from '../lib/netWorth';
import {
  nearestSnapshot,
  historyRows,
  buildManualSnapshot,
  type SnapshotBalances,
} from '../lib/snapshots';

interface HistoryManagerModalProps {
  onClose: () => void;
  /** When set, open directly into that month's balances editor (e.g. the
   *  balance-page "edit this month" action) instead of the month grid. */
  initialMonth?: string;
}

/** Row status pill: distinguishes the live month, an auto-recorded snapshot, a
 *  manual (entered-by-you) snapshot, and a missing month — each with a distinct
 *  tone. Deliberately not `ProvenanceBadge`: "recorded" is real data, not a
 *  "default you haven't changed", and live must read differently from manual. */
function StatePill({ state, hm, liveLabel }: {
  state: 'live' | 'auto' | 'manual' | 'missing';
  hm: { recorded: string; entered: string; missing: string };
  liveLabel: string;
}) {
  const tone = {
    live: { label: liveLabel, bg: 'var(--violet-bg)', color: 'var(--violet)' },
    auto: { label: hm.recorded, bg: 'var(--accent-bg)', color: 'var(--accent)' },
    manual: { label: hm.entered, bg: 'var(--positive-bg)', color: 'var(--positive)' },
    missing: { label: hm.missing, bg: 'var(--surface-5)', color: 'var(--text-3)' },
  }[state];
  return (
    <span
      className="inline-flex items-center rounded-[4px] font-semibold h-[18px] px-[7px] text-[10px] shrink-0"
      style={{ background: tone.bg, color: tone.color }}
    >
      {tone.label}
    </span>
  );
}

/** The initial balances for the editor: the existing snapshot, else the nearest
 *  recorded month, else the live state. */
function balancesFrom(base: BalanceSnapshot, live: {
  savingsTargetPercent: number; growthReturnRate: number; houseGrowthRate: number;
}): SnapshotBalances {
  const a = base.assets;
  return {
    savingsAccounts: (a.savingsAccounts ?? []).map(s => ({ ...s })),
    bsu: a.bsu ?? 0,
    bufferAccount: a.bufferAccount ?? 0,
    portfolio: a.portfolio ?? 0,
    crypto: a.crypto ?? 0,
    houseValue: a.houseValue ?? 0,
    houseDebt: a.houseDebt ?? 0,
    debts: (base.debts ?? []).map(d => ({ ...d })),
    otpBalance: base.pension?.otpBalance ?? 0,
    ipsBalance: base.pension?.ipsBalance ?? 0,
    assumptions: base.assumptions ?? {
      savingsTargetPercent: live.savingsTargetPercent,
      growthReturnRate: live.growthReturnRate,
      houseGrowthRate: live.houseGrowthRate,
    },
  };
}

export default function HistoryManagerModal({ onClose, initialMonth }: HistoryManagerModalProps) {
  const {
    t, lang, formatCurrency,
    balanceSnapshots, netWorthHistory, setManualSnapshot, deleteManualSnapshot,
    assets, loan, pension, homeowner, transition, housingMode, debts, fixedExpenses, categoryBudgets,
    savingsTargetPercent, growthReturnRate, houseGrowthRate,
  } = useFinance();
  const hm = t.historyManager;
  const dateLocale = lang === 'nb' ? nb : enUS;
  const nowKey = format(new Date(), 'yyyy-MM');

  const [monthsBefore, setMonthsBefore] = useState(0);
  const [editing, setEditing] = useState<string | null>(initialMonth ?? null); // month being edited
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const rows = useMemo(
    () => historyRows(balanceSnapshots, netWorthHistory, nowKey, monthsBefore),
    [balanceSnapshots, netWorthHistory, nowKey, monthsBefore],
  );

  // The live snapshot, used as the defaulting base when no recorded month exists.
  const liveSnapshot = useMemo<BalanceSnapshot>(() => ({
    assets, loan, pension, homeowner, transition, housingMode, debts,
    fixedExpenses, categoryBudgets,
    assumptions: { savingsTargetPercent, growthReturnRate, houseGrowthRate },
    v: 2, source: 'manual',
  }), [assets, loan, pension, homeowner, transition, housingMode, debts, fixedExpenses,
       categoryBudgets, savingsTargetPercent, growthReturnRate, houseGrowthRate]);

  const monthLabel = (key: string) =>
    format(parse(key, 'yyyy-MM', new Date()), 'MMM yyyy', { locale: dateLocale });

  const refValue = (key: string): number | null => {
    const snap = balanceSnapshots[key];
    if (snap) return netWorthFromSnapshot(snap);
    if (key in netWorthHistory) return netWorthHistory[key];
    return null;
  };

  if (editing) {
    const base = balanceSnapshots[editing] ?? nearestSnapshot(balanceSnapshots, editing) ?? liveSnapshot;
    // Opened straight into this month (balance-page "edit this month"): save/cancel
    // closes the modal rather than dropping to the grid the user never saw.
    const done = editing === initialMonth ? onClose : () => setEditing(null);
    return (
      <SnapshotEditor
        monthTitle={monthLabel(editing)}
        initial={balancesFrom(base, { savingsTargetPercent, growthReturnRate, houseGrowthRate })}
        base={base}
        onCancel={done}
        onSave={(balances) => {
          setManualSnapshot(editing, buildManualSnapshot(base, balances));
          done();
        }}
      />
    );
  }

  return (
    <ModalShell
      title={hm.title}
      onClose={onClose}
      closeLabel={hm.cancel}
      panelClassName="sm:min-w-[520px] sm:max-w-xl space-y-4 max-h-[85vh] flex flex-col"
    >
      <p className="text-[12px] leading-relaxed shrink-0" style={{ color: 'var(--text-3)' }}>{hm.desc}</p>

      <div className="space-y-1 overflow-y-auto -mx-1 px-1">
        {rows.map(row => {
          const isCurrent = row.monthKey === nowKey;
          const ref = refValue(row.monthKey);
          return (
            <div key={row.monthKey} className="flex items-center gap-3 py-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="w-[76px] shrink-0">
                <span className="text-[12px] font-medium capitalize" style={{ color: 'var(--text-2)' }}>{monthLabel(row.monthKey)}</span>
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <StatePill state={isCurrent ? 'live' : row.state} hm={hm} liveLabel={t.netWorthEditor.live} />
                <span className="text-[12px] font-mono" style={{ color: ref === null ? 'var(--text-3)' : 'var(--text-1)' }}>
                  {ref === null ? '—' : formatCurrency(ref)}
                </span>
              </div>
              {!isCurrent && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditing(row.monthKey)}
                    className="p-1.5 rounded-md transition-colors"
                    style={{ color: 'var(--text-3)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; }}
                    title={row.state === 'missing' ? hm.add : hm.edit}
                    aria-label={row.state === 'missing' ? hm.add : hm.edit}
                  >
                    {row.state === 'missing' ? <Plus size={14} /> : <Pencil size={14} />}
                  </button>
                  {row.state === 'manual' && (
                    confirmDelete === row.monthKey ? (
                      <button
                        onClick={() => { deleteManualSnapshot(row.monthKey); setConfirmDelete(null); }}
                        className="px-2 py-1 rounded-md text-[11px] font-semibold"
                        style={{ background: 'var(--negative-bg)', color: 'var(--negative)' }}
                      >
                        {hm.deleteConfirm}
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(row.monthKey)}
                        className="p-1.5 rounded-md transition-colors"
                        style={{ color: 'var(--text-3)' }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--negative)'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; }}
                        title={hm.delete}
                        aria-label={hm.delete}
                      >
                        <Trash2 size={14} />
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={() => setMonthsBefore(m => m + 12)}
        className="shrink-0 w-full py-2 rounded-[8px] text-[12px] font-semibold border transition-colors"
        style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
      >
        {hm.addEarlier}
      </button>
    </ModalShell>
  );
}

// ── The per-month balances editor ────────────────────────────────────────────

function SnapshotEditor({
  monthTitle, initial, base, onCancel, onSave,
}: {
  monthTitle: string;
  initial: SnapshotBalances;
  base: BalanceSnapshot;
  onCancel: () => void;
  onSave: (balances: SnapshotBalances) => void;
}) {
  const { t, formatCurrency } = useFinance();
  const hm = t.historyManager;
  const f = hm.fields;
  const [b, setB] = useState<SnapshotBalances>(initial);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const set = (patch: Partial<SnapshotBalances>) => setB(prev => ({ ...prev, ...patch }));
  const setAccount = (id: string, balance: number) =>
    set({ savingsAccounts: b.savingsAccounts.map(s => (s.id === id ? { ...s, balance } : s)) });
  const setDebt = (id: string, balance: number) =>
    set({ debts: b.debts.map(d => (d.id === id ? { ...d, balance } : d)) });

  const preview = netWorthFromSnapshot(buildManualSnapshot(base, b));

  return (
    <ModalShell
      title={`${hm.balances} · ${monthTitle}`}
      onClose={onCancel}
      closeLabel={hm.cancel}
      panelClassName="sm:min-w-[520px] sm:max-w-xl space-y-4 max-h-[85vh] flex flex-col"
      footer={
        <div className="shrink-0 flex gap-2 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-[8px] text-[13px] font-semibold border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
          >
            {hm.cancel}
          </button>
          <button
            onClick={() => onSave(b)}
            className="flex-1 py-2.5 rounded-[8px] text-[13px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)]"
          >
            {hm.save}
          </button>
        </div>
      }
    >
      <div className="overflow-y-auto -mx-1 px-1 space-y-3">
        <div className="flex items-center justify-between text-[12px]" style={{ color: 'var(--text-3)' }}>
          <span>{hm.note}</span>
          <span className="font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{formatCurrency(preview)}</span>
        </div>

        <NumberRow label={f.portfolio} value={b.portfolio} onCommit={v => set({ portfolio: v })} />
        <NumberRow label={f.houseValue} value={b.houseValue} onCommit={v => set({ houseValue: v })} />
        <NumberRow label={f.houseDebt} value={b.houseDebt} onCommit={v => set({ houseDebt: v })} />
        <NumberRow label={f.crypto} value={b.crypto} onCommit={v => set({ crypto: v })} />
        <NumberRow label={f.bsu} value={b.bsu} onCommit={v => set({ bsu: v })} />
        <NumberRow label={f.buffer} value={b.bufferAccount} onCommit={v => set({ bufferAccount: v })} />
        {b.savingsAccounts.map(s => (
          <NumberRow key={s.id} label={s.name} value={s.balance} onCommit={v => setAccount(s.id, v)} />
        ))}
        {b.debts.map(d => (
          <NumberRow key={d.id} label={d.name} value={d.balance} onCommit={v => setDebt(d.id, v)} />
        ))}
        <NumberRow label={f.otp} value={b.otpBalance} onCommit={v => set({ otpBalance: v })} />
        <NumberRow label={f.ips} value={b.ipsBalance} onCommit={v => set({ ipsBalance: v })} />

        <button
          onClick={() => setAdvancedOpen(o => !o)}
          className="flex items-center gap-1 text-[12px] font-semibold pt-1"
          style={{ color: 'var(--text-2)' }}
        >
          {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {hm.advanced}
        </button>
        {advancedOpen && b.assumptions && (
          <div className="space-y-3 pl-1">
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>{hm.advancedHint}</p>
            <NumberRow
              label={f.savingsTarget}
              value={b.assumptions.savingsTargetPercent}
              onCommit={v => set({ assumptions: { ...b.assumptions!, savingsTargetPercent: v } })}
            />
            <NumberRow
              label={f.growthRate}
              value={b.assumptions.growthReturnRate}
              onCommit={v => set({ assumptions: { ...b.assumptions!, growthReturnRate: v } })}
            />
            <NumberRow
              label={f.houseGrowthRate}
              value={b.assumptions.houseGrowthRate}
              onCommit={v => set({ assumptions: { ...b.assumptions!, houseGrowthRate: v } })}
            />
          </div>
        )}
      </div>
    </ModalShell>
  );
}
