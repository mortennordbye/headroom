import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { formatDistanceToNow } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { MessageSquare } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import type { CompanyModel } from '../lib/companyCost';
import { RESTORE_POINTS_ANCHOR, type Revision } from './RestorePointsCard';

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

  const read = useCallback((isCurrent: () => boolean) => {
    fetch('/api/history')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { revisions?: Revision[] }) => {
        if (!isCurrent()) return;
        const last = (d.revisions ?? []).find((r) => r.keys?.includes('companyModel'));
        setTs(last?.source === 'mcp' ? last.ts : null);
      })
      .catch(() => { /* no history: no pill */ });
  }, []);

  // At once on load, and when the tab gets focus again.
  useEffect(() => {
    if (demoMode) return;
    let current = true;
    read(() => current);
    const onVisible = () => { if (document.visibilityState === 'visible') read(() => current); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      current = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [demoMode, read]);

  // After a change to the model, once the debounced autosave has run. Not for the model shown at load.
  const loadedModel = useRef(model);
  useEffect(() => {
    if (demoMode || model === loadedModel.current) return;
    let current = true;
    const timer = setTimeout(() => read(() => current), 2_000);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [model, demoMode, read]);

  if (!ts || demoMode) return null;
  const time = formatDistanceToNow(new Date(ts), { addSuffix: true, locale: lang === 'nb' ? nb : enUS });
  return (
    <div
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[16px] border px-3 py-1.5 text-[12px]"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--brass-dim)', color: 'var(--text-2)' }}
    >
      <MessageSquare className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brass)' }} aria-hidden />
      <span>{c.chatPill.replace('{time}', time)}</span>
      <Link to={`/settings#${RESTORE_POINTS_ANCHOR}`} className="underline underline-offset-2" style={{ color: 'var(--brass)' }}>{c.chatPillLink}</Link>
    </div>
  );
}
