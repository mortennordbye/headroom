import React, { useState } from 'react';
import { Target, Plus, Edit2, Trash2 } from 'lucide-react';
import { useFinance, type Goal, type GoalSource, type Assets } from '../context/FinanceContext';
import EditModal, { type ModalField } from '../components/EditModal';
import ConfirmModal from '../components/ConfirmModal';
import { sumSavings } from '../lib/equity';
import { isValidYearMonth, isOptionalYearMonth, isPositiveNumber, isNonEmpty, parseLocaleNumber } from '../lib/validators';

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

function currentValueFor(goal: Goal, ctx: { assets: Assets; totalEquity: number }): number {
  switch (goal.source) {
    case 'bsu': return ctx.assets.bsu;
    case 'savings': return sumSavings(ctx.assets);
    case 'savingsAccount':
      return ctx.assets.savingsAccounts?.find(s => s.id === goal.savingsAccountId)?.balance ?? 0;
    case 'bufferAccount': return ctx.assets.bufferAccount;
    case 'portfolio': return ctx.assets.portfolio;
    case 'totalEquity': return ctx.totalEquity;
    case 'manual':
    default: return goal.manualCurrent ?? 0;
  }
}

// The account-picker options are encoded as `sa:<id>` in the source <select> so
// EditModal's flat field list can offer per-account linkage without a dependent
// field. `encodeSource`/`decodeSource` bridge that back to {source, accountId}.
const SA_PREFIX = 'sa:';
function encodeSource(g: Pick<Goal, 'source' | 'savingsAccountId'>): string {
  return g.source === 'savingsAccount' && g.savingsAccountId ? `${SA_PREFIX}${g.savingsAccountId}` : g.source;
}
function decodeSource(value: string): { source: GoalSource; savingsAccountId?: string } {
  if (value.startsWith(SA_PREFIX)) return { source: 'savingsAccount', savingsAccountId: value.slice(SA_PREFIX.length) };
  return { source: value as GoalSource };
}

function monthsUntil(deadline: string): number | null {
  if (!isValidYearMonth(deadline)) return null;
  const [y, m] = deadline.split('-').map(Number);
  const target = new Date(y, m - 1, 1);
  const now = new Date();
  return (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
}

interface ModalConfig {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
  error?: string;
}

interface ConfirmConfig {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  danger?: boolean;
}

const GoalsSection: React.FC = () => {
  const { t, goals, addGoal, updateGoal, removeGoal, assets, netWorth, formatCurrency } = useFinance();
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null);

  // Encoded <select> options: fixed sources plus one `sa:<id>` per savings
  // account, so a goal can track a specific account (e.g. a vacation fund) or the
  // combined savings total.
  const savingsAccounts = assets.savingsAccounts ?? [];
  const sourceOptions: { value: string; label: string }[] = [
    { value: 'manual', label: t.goals.sourceManual },
    { value: 'bsu', label: t.goals.sourceBsu },
    { value: 'savings', label: t.goals.sourceSavings },
    ...savingsAccounts.map(s => ({ value: `${SA_PREFIX}${s.id}`, label: `${t.goals.sourceSavingsAccount}: ${s.name}` })),
    { value: 'bufferAccount', label: t.goals.sourceBufferAccount },
    { value: 'portfolio', label: t.goals.sourcePortfolio },
    { value: 'totalEquity', label: t.goals.sourceTotalEquity },
  ];

  // Display label for a goal's source (resolves an account goal to its name).
  const labelForGoal = (g: Goal): string => {
    if (g.source === 'savingsAccount') {
      const acc = savingsAccounts.find(s => s.id === g.savingsAccountId);
      return acc ? `${t.goals.sourceSavingsAccount}: ${acc.name}` : t.goals.sourceSavingsAccount;
    }
    return sourceOptions.find(s => s.value === g.source)?.label ?? '';
  };

  const openModal = (existing?: Goal) => {
    setModal({
      title: existing ? existing.name : t.goals.addGoal,
      fields: [
        { key: 'name', label: t.goals.name, type: 'text', value: existing?.name ?? '' },
        { key: 'target', label: t.goals.target, type: 'number', value: (existing?.target ?? 0).toString() },
        {
          key: 'source',
          label: t.goals.source,
          type: 'select',
          value: existing ? encodeSource(existing) : 'manual',
          options: sourceOptions,
        },
        { key: 'manualCurrent', label: t.goals.manualCurrent, type: 'number', value: (existing?.manualCurrent ?? 0).toString() },
        { key: 'deadline', label: t.goals.deadline, type: 'text', value: existing?.deadline ?? '', placeholder: '2027-12' },
        { key: 'notes', label: t.goals.notes, type: 'text', value: existing?.notes ?? '' },
      ],
      onSave: (vals) => {
        if (!isNonEmpty(vals.name)) {
          setModal(prev => prev && { ...prev, error: t.validation.nameRequired });
          return;
        }
        if (!isPositiveNumber(vals.target)) {
          setModal(prev => prev && { ...prev, error: t.validation.targetPositive });
          return;
        }
        if (!isOptionalYearMonth(vals.deadline)) {
          setModal(prev => prev && { ...prev, error: t.validation.invalidDeadline });
          return;
        }
        const { source, savingsAccountId } = decodeSource(vals.source);
        const payload: Omit<Goal, 'id'> = {
          name: vals.name.trim(),
          target: parseLocaleNumber(vals.target),
          source,
          savingsAccountId,
          manualCurrent: source === 'manual' ? parseLocaleNumber(vals.manualCurrent) || 0 : undefined,
          deadline: isValidYearMonth(vals.deadline) ? vals.deadline : undefined,
          notes: vals.notes.trim() || undefined,
        };
        if (existing) updateGoal(existing.id, payload);
        else addGoal(payload);
        setModal(null);
      },
    });
  };

  const confirmDelete = (g: Goal) => {
    setConfirm({
      title: t.confirmDelete,
      message: `${t.delete}: ${g.name}?`,
      confirmLabel: t.delete,
      cancelLabel: t.cancel,
      danger: true,
      onConfirm: () => { removeGoal(g.id); setConfirm(null); },
    });
  };

  return (
    <div className={`${card} p-5 md:p-7 space-y-4`}>
      <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Target size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <h3 className={sectionLabel}>{t.goals.title}</h3>
        </div>
        <button
          onClick={() => openModal()}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
        >
          <Plus size={12} /> {t.goals.addGoal}
        </button>
      </div>

      {goals.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{t.goals.empty}</p>
      ) : (
        <div className="space-y-4">
          {goals.map(g => {
            const current = currentValueFor(g, { assets, totalEquity: netWorth });
            const progress = g.target > 0 ? Math.min(100, (current / g.target) * 100) : 0;
            const remaining = Math.max(0, g.target - current);
            const isComplete = current >= g.target;
            const months = g.deadline ? monthsUntil(g.deadline) : null;
            const monthsLabel =
              months === null ? '' :
              months < 0 ? t.goals.overdue :
              `${months} ${t.goals.monthsLeft}`;
            const barColor = isComplete ? 'var(--positive)' : (months !== null && months < 0) ? 'var(--negative)' : 'var(--accent)';
            return (
              <div key={g.id} className="space-y-2 group">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[var(--text-1)] truncate">{g.name}</div>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                      {labelForGoal(g)}
                      {monthsLabel && <span> · {monthsLabel}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[12px] font-mono font-semibold tabular-nums" style={{ color: barColor }}>
                      {progress.toFixed(0)}%
                    </span>
                    <button aria-label={`${t.edit} — ${g.name}`} onClick={() => openModal(g)} className="p-1 rounded text-[var(--text-2)] hover:text-[var(--text-1)] opacity-0 group-hover:opacity-100 transition-opacity">
                      <Edit2 size={12} />
                    </button>
                    <button aria-label={`${t.delete} — ${g.name}`} onClick={() => confirmDelete(g)} className="p-1 rounded text-[var(--text-2)] hover:text-[var(--negative)] opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="h-2 rounded-[3px] overflow-hidden" style={{ background: 'var(--bg-elev)' }}>
                  <div
                    className="h-full rounded-[3px] transition-all duration-700"
                    style={{
                      width: `${progress}%`,
                      background: barColor,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[11px] font-mono" style={{ color: 'var(--text-2)' }}>
                  <span>{formatCurrency(current)}</span>
                  <span>
                    {isComplete
                      ? <span style={{ color: 'var(--positive)', fontWeight: 600 }}>{t.goals.completed}</span>
                      : `${t.goals.remaining} ${formatCurrency(remaining)}`}
                    {' · '}
                    {formatCurrency(g.target)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <EditModal {...modal} onCancel={() => setModal(null)} />}
      {confirm && <ConfirmModal {...confirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
};

export default GoalsSection;
