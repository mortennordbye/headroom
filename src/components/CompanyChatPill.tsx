import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { formatDistanceToNow } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { MessageSquare } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import type { CompanyModel } from '../lib/companyCost';

interface Revision {
  ts: string;
  source: string | null;
  keys: string[] | null;
}

/**
 * "Endret fra chat": a small pill when the newest revision that changed
 * `companyModel` came from the MCP server (GET /api/history, newest first).
 * Read on load, when the tab gets focus again, and shortly after the model
 * changes (a save here makes the newest revision the app's own). No polling.
 */
export function CompanyChatPill({ model }: { model: CompanyModel }) {
  const { t, lang, demoMode } = useFinance();
  const c = t.companyModel;
  const [ts, setTs] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    const read = () => {
      fetch('/api/history')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { revisions?: Revision[] }) => {
          if (cancelled) return;
          const last = (d.revisions ?? []).find((r) => r.keys?.includes('companyModel'));
          setTs(last?.source === 'mcp' ? last.ts : null);
        })
        .catch(() => { /* no history: no pill */ });
    };
    // At once on load; after a model change, wait for the debounced autosave first.
    const timer = setTimeout(read, first.current ? 0 : 2_000);
    first.current = false;
    const onVisible = () => { if (document.visibilityState === 'visible') read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [model, demoMode]);

  if (!ts || demoMode) return null;
  const time = formatDistanceToNow(new Date(ts), { addSuffix: true, locale: lang === 'nb' ? nb : enUS });
  return (
    <div
      role="status"
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border px-3 py-1.5 text-[12px]"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--brass-dim)', color: 'var(--text-2)' }}
    >
      <MessageSquare className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brass)' }} aria-hidden />
      <span>{c.chatPill.replace('{time}', time)}</span>
      <Link to="/settings" className="underline underline-offset-2" style={{ color: 'var(--brass)' }}>{c.chatPillLink}</Link>
    </div>
  );
}
