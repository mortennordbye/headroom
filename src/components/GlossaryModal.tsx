import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { ModalShell } from './ui';
import { glossaryTermsFor } from '../lib/glossary';

/**
 * A persistent, searchable lookup of the domain terms used across the app
 * (headroom, LTV, trinnskatt, OTP/IPS, …). Reachable any time from the header /
 * More sheet, independent of the one-shot onboarding tour. Definitions come from
 * `t.glossary.terms`; Norway-specific terms are hidden outside the NO region.
 */
export default function GlossaryModal({ onClose }: { onClose: () => void }) {
  const { t, region } = useFinance();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => {
    const g = t.glossary.terms;
    const all = glossaryTermsFor(region).map(({ key }) => g[key as keyof typeof g]);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((e) => e.term.toLowerCase().includes(q) || e.def.toLowerCase().includes(q));
  }, [t.glossary.terms, region, query]);

  return (
    <ModalShell
      title={t.glossary.title}
      onClose={onClose}
      closeLabel={t.onboarding.close}
      panelClassName="sm:w-[520px] max-w-[520px] flex flex-col max-h-[82vh]"
      initialFocus={searchRef}
    >
      <p className="text-[13px] -mt-1" style={{ color: 'var(--text-2)' }}>{t.glossary.subtitle}</p>

      <div className="relative">
        <Search size={15} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.glossary.searchPlaceholder}
          className="w-full pl-9 pr-3 py-2 rounded-[8px] text-[14px] border bg-[var(--bg-2)]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-1)' }}
        />
      </div>

      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        {entries.length === 0 ? (
          <p className="text-[13px] py-6 text-center" style={{ color: 'var(--text-3)' }}>{t.glossary.empty}</p>
        ) : (
          <dl className="space-y-3">
            {entries.map((e) => (
              <div key={e.term} className="pb-3 border-b border-[var(--border)] last:border-0 last:pb-0">
                <dt className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>{e.term}</dt>
                <dd className="text-[13px] mt-0.5 leading-snug" style={{ color: 'var(--text-2)' }}>{e.def}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </ModalShell>
  );
}
