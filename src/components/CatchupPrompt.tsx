import React from 'react';
import { useFinance } from '../context/FinanceContext';
import ConfirmModal from './ConfirmModal';

// Surfaces one multi-month automation catch-up at a time. A ≥2-month gap is
// deferred by the runner (rather than silently back-posting a large jump); the
// user confirms the full catch-up or applies just the current month. Mounted at
// the app root so it appears regardless of the active page.
const CatchupPrompt: React.FC = () => {
  const { t, pendingCatchups, confirmCatchup, declineCatchup, formatCurrency } = useFinance();
  const next = pendingCatchups[0];
  if (!next) return null;

  const message = t.expenseDestination.catchupMessage
    .replace('{months}', String(next.monthsDue))
    .replace('{name}', next.name)
    .replace('{amount}', `${next.deltaFull >= 0 ? '+' : '−'}${formatCurrency(Math.abs(next.deltaFull))}`);

  return (
    <ConfirmModal
      title={t.expenseDestination.catchupTitle}
      message={message}
      confirmLabel={t.expenseDestination.catchupConfirm}
      cancelLabel={t.expenseDestination.catchupDecline}
      danger={false}
      onConfirm={() => confirmCatchup(next.expenseId)}
      onCancel={() => declineCatchup(next.expenseId)}
    />
  );
};

export default CatchupPrompt;
