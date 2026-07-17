import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { History, RotateCcw } from 'lucide-react';
import { useFinanceSettings } from '../context/FinanceContext';
import { formatBytes } from '../lib/format';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { Button } from './ui/Button';

interface Revision {
  rev: number;
  ts: string;
  bytes: number;
}

/**
 * Revision-history / restore-points card for Settings. Reads the server's rolling
 * per-write backups (GET /api/history) and lets the user roll back to any of them
 * (POST /api/history/:rev/restore). A restore is itself recorded as a new revision,
 * so it can be undone. After a successful restore we full-reload — matching how
 * login/logout re-run the initial data-load path — rather than surgically patching
 * state, so the client can never re-diverge from the restored blob.
 */
export function RestorePointsCard() {
  const { t, lang } = useFinanceSettings();
  const rp = t.settings.restorePoints;
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [confirmingRev, setConfirmingRev] = useState<number | null>(null);
  const [restoringRev, setRestoringRev] = useState<number | null>(null);
  const [restoreFailed, setRestoreFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/history')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { revisions: Revision[] }) => {
        if (cancelled) return;
        setRevisions(d.revisions);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = lang === 'nb' ? nb : enUS;
  const fmtTime = (ts: string) => format(new Date(ts), 'd MMM yyyy HH:mm', { locale });

  const doRestore = async (rev: number) => {
    setRestoringRev(rev);
    setRestoreFailed(false);
    try {
      const res = await fetch(`/api/history/${rev}/restore`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      window.location.reload(); // re-run the initial data-load with the restored blob
    } catch {
      setRestoreFailed(true);
      setRestoringRev(null);
      setConfirmingRev(null);
    }
  };

  return (
    <Card padding="lg" className="md:col-span-12" data-tour="settings-restore-points">
      <SectionLabel icon={<RotateCcw />}>{rp.title}</SectionLabel>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--text-3)' }}>
        {rp.desc}
      </p>

      {status === 'loading' && (
        <p className="mt-4 text-[13px]" style={{ color: 'var(--text-3)' }}>
          …
        </p>
      )}
      {status === 'error' && (
        <p className="mt-4 text-[13px]" style={{ color: 'var(--negative)' }}>
          {rp.loadError}
        </p>
      )}
      {status === 'ready' && revisions && revisions.length === 0 && (
        <p className="mt-4 text-[13px]" style={{ color: 'var(--text-3)' }}>
          {rp.empty}
        </p>
      )}

      {status === 'ready' && revisions && revisions.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {revisions.map((r, i) => {
            const isCurrent = i === 0;
            const confirming = confirmingRev === r.rev;
            return (
              <div
                key={r.rev}
                className="rounded-[8px] border p-3 flex items-center gap-3"
                style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
              >
                <div
                  className="w-8 h-8 rounded-[8px] grid place-items-center shrink-0"
                  style={{ background: 'var(--surface-4)', color: 'var(--text-2)' }}
                >
                  <History size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                    <span className="truncate">{fmtTime(r.ts)}</span>
                    {isCurrent && (
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                      >
                        {rp.current}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    #{r.rev} · {formatBytes(r.bytes)}
                  </div>
                </div>

                {!isCurrent && !confirming && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    leadingIcon={<RotateCcw />}
                    disabled={restoringRev !== null}
                    onClick={() => {
                      setConfirmingRev(r.rev);
                      setRestoreFailed(false);
                    }}
                  >
                    {rp.restore}
                  </Button>
                )}

                {confirming && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[12px] hidden sm:block" style={{ color: 'var(--text-2)' }}>
                      {rp.confirmQuestion}
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={restoringRev === r.rev}
                      onClick={() => doRestore(r.rev)}
                    >
                      {restoringRev === r.rev ? rp.restoring : rp.confirmYes}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={restoringRev === r.rev}
                      onClick={() => setConfirmingRev(null)}
                    >
                      {rp.cancel}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmingRev !== null && (
        <p className="mt-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
          {rp.confirmNote}
        </p>
      )}
      {restoreFailed && (
        <p className="mt-2 text-[12px]" style={{ color: 'var(--negative)' }}>
          {rp.restoreError}
        </p>
      )}
      <p className="mt-3 text-[11px]" style={{ color: 'var(--text-3)' }}>
        {rp.keptNote}
      </p>
    </Card>
  );
}
