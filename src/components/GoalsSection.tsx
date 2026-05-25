import React, { useState } from 'react';
import { Target, Plus, Edit2, Trash2 } from 'lucide-react';
import { useFinance, type Goal, type GoalSource } from '../context/FinanceContext';
import EditModal, { type ModalField } from '../components/EditModal';
import ConfirmModal from '../components/ConfirmModal';
import { isValidYearMonth, isOptionalYearMonth, isPositiveNumber, isNonEmpty } from '../lib/validators';

const card = 'bg-[var(--bg-card)] rounded-[20px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

function currentValueFor(goal: Goal, ctx: {
  assets: { bsu: number; savings: number; bufferAccount: number; portfolio: number };
  totalEquity: number;
}): number {
  switch (goal.source) {
    case 'bsu': return ctx.assets.bsu;
    case 'savings': return ctx.assets.savings;
    case 'bufferAccount': return ctx.assets.bufferAccount;
    case 'portfolio': return ctx.assets.portfolio;
    case 'totalEquity': return ctx.totalEquity;
    case 'manual':
    default: return goal.manualCurrent ?? 0;
  }
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
  const { t, lang, goals, addGoal, updateGoal, removeGoal, assets, totalEquity, formatCurrency } = useFinance();
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null);

  const sources: { value: GoalSource; label: string }[] = [
    { value: 'manual', label: t.goals.sourceManual },
    { value: 'bsu', label: t.goals.sourceBsu },
    { value: 'savings', label: t.goals.sourceSavings },
    { value: 'bufferAccount', label: t.goals.sourceBufferAccount },
    { value: 'portfolio', label: t.goals.sourcePortfolio },
    { value: 'totalEquity', label: t.goals.sourceTotalEquity },
  ];

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
          value: existing?.source ?? 'manual',
          options: sources,
        },
        { key: 'manualCurrent', label: t.goals.manualCurrent, type: 'number', value: (existing?.manualCurrent ?? 0).toString() },
        { key: 'deadline', label: t.goals.deadline, type: 'text', value: existing?.deadline ?? '', placeholder: '2027-12' },
        { key: 'notes', label: t.goals.notes, type: 'text', value: existing?.notes ?? '' },
      ],
      onSave: (vals) => {
        if (!isNonEmpty(vals.name)) {
          setModal(prev => prev && { ...prev, error: lang === 'nb' ? 'Navn er påkrevd' : 'Name required' });
          return;
        }
        if (!isPositiveNumber(vals.target)) {
          setModal(prev => prev && { ...prev, error: lang === 'nb' ? 'Målbeløp må være positivt' : 'Target must be positive' });
          return;
        }
        if (!isOptionalYearMonth(vals.deadline)) {
          setModal(prev => prev && { ...prev, error: lang === 'nb' ? 'Ugyldig frist (YYYY-MM eller tom)' : 'Invalid deadline (YYYY-MM or empty)' });
          return;
        }
        const payload: Omit<Goal, 'id'> = {
          name: vals.name.trim(),
          target: parseFloat(vals.target),
          source: vals.source as GoalSource,
          manualCurrent: vals.source === 'manual' ? parseFloat(vals.manualCurrent) || 0 : undefined,
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
            const current = currentValueFor(g, { assets, totalEquity });
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
                      {sources.find(s => s.value === g.source)?.label}
                      {monthsLabel && <span> · {monthsLabel}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[12px] font-mono font-semibold tabular-nums" style={{ color: barColor }}>
                      {progress.toFixed(0)}%
                    </span>
                    <button onClick={() => openModal(g)} className="p-1 rounded text-[var(--text-2)] hover:text-[var(--text-1)] opacity-0 group-hover:opacity-100 transition-opacity">
                      <Edit2 size={12} />
                    </button>
                    <button onClick={() => confirmDelete(g)} className="p-1 rounded text-[var(--text-2)] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--text-3) 18%, transparent)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${progress}%`,
                      background: `linear-gradient(90deg, ${barColor}, color-mix(in srgb, ${barColor} 65%, transparent))`,
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
