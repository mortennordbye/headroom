import { useState } from 'react';
import { PiggyBank } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';
import { useFinance } from '../context/FinanceContext';
import { currentMonthKey } from '../lib/date';
import { parseLocaleNumber } from '../lib/validators';

// "Build your buffer": turns the emergency-fund recommendation into a real fixed
// expense that feeds the buffer account every month. The user accepts the
// recommended monthly amount and target, or sets their own; the expense removes
// itself once the buffer reaches that target (see bufferBuilder.ts).
interface Props {
  recommendedMonthly: number;
  recommendedTarget: number;
  onClose: () => void;
}

const lbl = 'block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-2)] mb-2';
const input = 'w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[10px] px-3.5 py-3 text-[15px] font-mono tabular-nums text-[var(--text-1)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--forest)_30%,transparent)] transition-colors';

export default function BufferBuilderDialog({ recommendedMonthly, recommendedTarget, onClose }: Props) {
  const { t, assets, fixedExpenses, setFixedExpenses, formatCurrency } = useFinance();
  const currentBuffer = assets.bufferAccount;

  const [monthly, setMonthly] = useState(String(recommendedMonthly));
  const [target, setTarget] = useState(String(recommendedTarget));
  const [error, setError] = useState('');

  const targetNum = parseLocaleNumber(target) || 0;

  const create = () => {
    const amt = parseLocaleNumber(monthly);
    const tgt = parseLocaleNumber(target);
    if (!(amt > 0)) { setError(t.bufferBuilder.errorMonthly); return; }
    if (!(tgt > currentBuffer)) { setError(t.bufferBuilder.errorTarget); return; }
    setFixedExpenses([
      ...fixedExpenses,
      {
        id: crypto.randomUUID(),
        name: t.bufferBuilder.expenseName,
        amount: amt,
        type: 'fixed',
        destinationKind: 'bufferAccount',
        bufferTargetAmount: tgt,
        // Stamp to now so the first move happens next month (same as the dialog).
        lastPostedMonth: currentMonthKey(),
      },
    ]);
    onClose();
  };

  return (
    <ModalShell
      title={t.bufferBuilder.title}
      onClose={onClose}
      closeLabel={t.cancel}
      preventBackdropClose
      panelClassName="sm:min-w-[400px] sm:max-w-[440px] w-full"
      footer={
        <div className="flex gap-2.5 pt-4 mt-1">
          <button onClick={onClose} className="flex-1 py-3 rounded-[10px] text-[14px] font-medium text-[var(--text-2)] bg-[var(--bg-elev)] hover:bg-[var(--bg-raised)] transition-colors">{t.cancel}</button>
          <button onClick={create} className="flex-1 py-3 rounded-[10px] text-[14px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-colors">{t.bufferBuilder.create}</button>
        </div>
      }
    >
      <div className="flex items-center gap-2.5 mt-1 mb-3 text-[var(--forest)]">
        <PiggyBank size={18} />
        <p className="text-[12.5px] leading-snug text-[var(--text-2)]">{t.bufferBuilder.intro}</p>
      </div>
      <div className="space-y-4">
        <div>
          <label className={lbl}>{t.bufferBuilder.monthlyLabel}</label>
          <div className="relative">
            <input className={`${input} pr-[72px]`} inputMode="decimal" value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="0" />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-[var(--text-3)] pointer-events-none">{t.expenseDialog.perMonth}</span>
          </div>
        </div>
        <div>
          <label className={lbl}>{t.bufferBuilder.targetLabel}</label>
          <input className={input} inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} placeholder="0" />
          <p className="text-[11px] text-[var(--text-3)] mt-1.5 leading-snug">
            {t.bufferBuilder.removesAt.replace('{target}', formatCurrency(targetNum))}
          </p>
        </div>
        {error && <p className="text-[12px] text-[var(--negative)] font-medium">{error}</p>}
      </div>
    </ModalShell>
  );
}
