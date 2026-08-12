import React, { useState } from 'react';
import { useFinance } from '../context/FinanceContext';
import EditModal from './EditModal';
import { pendingGainReview, costBasis } from '../lib/gainReview';
import { parseLocaleNumber } from '../lib/validators';

// Asks for the unrealized gain the month an automation pays into the portfolio.
// The contribution moves the balance only — the gain follows the market, which
// the app has no feed for — so this is the one place the figure gets refreshed.
// The portfolio total comes along as a second field: the user is already looking
// at the account, so it costs nothing to confirm the sum we posted. Mounted at
// the app root next to CatchupPrompt so it appears regardless of the page.
const GainReviewPrompt: React.FC = () => {
  const { t, assets, resolveGainReview, formatCurrency } = useFinance();
  const [error, setError] = useState('');
  const review = pendingGainReview(assets);
  if (!review) return null;

  const save = (values: Record<string, string>) => {
    const unrealizedGain = parseLocaleNumber(values.unrealizedGain);
    const portfolio = parseLocaleNumber(values.portfolio);
    // A gain may be negative (a loss carries a latent tax benefit); a portfolio
    // may not — same rule the Formue page applies to these two fields.
    if (!Number.isFinite(unrealizedGain) || !Number.isFinite(portfolio) || portfolio < 0) {
      setError(t.gainReview.invalid);
      return;
    }
    setError('');
    resolveGainReview({ unrealizedGain, portfolio });
  };

  return (
    <EditModal
      title={t.gainReview.title}
      header={
        <p className="text-[12.5px] leading-relaxed text-[var(--text-2)]">
          {review.amount > 0
            ? t.gainReview.intro.replace('{amount}', formatCurrency(review.amount))
            : t.gainReview.introNoAmount}
        </p>
      }
      fields={[
        {
          key: 'unrealizedGain',
          label: t.unrealizedGain,
          type: 'number',
          value: String(assets.unrealizedGain),
          hint: t.gainReview.gainHint.replace('{basis}', formatCurrency(costBasis(assets))),
        },
        {
          key: 'portfolio',
          label: t.portfolio,
          type: 'number',
          value: String(assets.portfolio),
          hint: t.gainReview.portfolioHint.replace('{portfolio}', formatCurrency(assets.portfolio)),
        },
      ]}
      error={error}
      saveLabel={t.save}
      cancelLabel={t.gainReview.skip}
      onSave={save}
      onCancel={() => resolveGainReview(null)}
    />
  );
};

export default GainReviewPrompt;
