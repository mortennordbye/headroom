import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { History, RotateCcw, Undo2 } from 'lucide-react';
import { useFinanceSettings } from '../context/FinanceContext';
import { formatBytes } from '../lib/format';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { Button } from './ui/Button';

type RevisionSource = 'ui' | 'mcp' | 'import' | 'bank-sync' | 'restore' | 'undo';

interface Revision {
  rev: number;
  ts: string;
  bytes: number;
  /** Who made it; null on revisions saved before attribution existed. */
  source: RevisionSource | null;
  label: string | null;
  /** Top-level keys it changed; null on old revisions (those can't be undone alone). */
  keys: string[] | null;
}

type Action = 'restore' | 'undo';

/** First few changed keys, then a count, so a first save touching everything stays one line. */
const summarizeKeys = (keys: string[]) =>
  keys.length <= 3 ? keys.join(', ') : `${keys.slice(0, 3).join(', ')} +${keys.length - 3}`;

/**
 * Revision-history / restore-points card for Settings. Reads the server's rolling
 * per-write backups (GET /api/history) and lets the user roll back to any of them
 * (POST /api/history/:rev/restore). A restore is itself recorded as a new revision,
 * so it can be undone. A revision that records what it changed can also be undone
 * on its own (POST /api/history/:rev/undo), keeping everything saved after it.
 * After a successful restore or undo we full-reload — matching how
 * login/logout re-run the initial data-load path — rather than surgically patching
 * state, so the client can never re-diverge from the restored blob.
 */
export function RestorePointsCard() {
  const { t, lang } = useFinanceSettings();
  const rp = t.settings.restorePoints;
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [confirming, setConfirming] = useState<{ rev: number; action: Action } | null>(null);
  const [busyRev, setBusyRev] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

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

  const run = async (rev: number, action: Action) => {
    setBusyRev(rev);
    setFailure(null);
    try {
      const res = await fetch(`/api/history/${rev}/${action}`, { method: 'POST' });
      if (res.status === 409 && action === 'undo') {
        const body = (await res.json().catch(() => ({}))) as { conflicts?: string[] };
        throw new Error(rp.undoConflict.replace('{fields}', (body.conflicts ?? []).join(', ')));
      }
      if (!res.ok) throw new Error(action === 'undo' ? rp.undoError : rp.restoreError);
      window.location.reload(); // re-run the initial data-load with the new blob
    } catch (e) {
      setFailure((e as Error).message);
      setBusyRev(null);
      setConfirming(null);
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
            const action = confirming?.rev === r.rev ? confirming.action : null;
            const canUndo = !!r.keys && r.keys.length > 0;
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
                    {r.source && (
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: 'var(--surface-4)', color: 'var(--text-2)' }}
                      >
                        {rp.sources[r.source]}
                      </span>
                    )}
                    {isCurrent && (
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                      >
                        {rp.current}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                    #{r.rev} · {formatBytes(r.bytes)}
                    {/* Restore/undo rows are labelled with the revision they acted on; the
                        others with what they changed (an MCP label is its changed fields). */}
                    {r.source === 'undo' && r.label
                      ? <> · {rp.undoOf.replace('{rev}', r.label)}</>
                      : r.source === 'restore' && r.label
                        ? <> · {rp.restoreOf.replace('{rev}', r.label)}</>
                        : canUndo && <> · {rp.changed.replace('{keys}', r.label ?? summarizeKeys(r.keys!))}</>}
                  </div>
                </div>

                {!action && (
                  <div className="flex items-center gap-2 shrink-0">
                    {canUndo && (
                      <Button
                        variant="secondary"
                        size="sm"
                        leadingIcon={<Undo2 />}
                        disabled={busyRev !== null}
                        onClick={() => {
                          setConfirming({ rev: r.rev, action: 'undo' });
                          setFailure(null);
                        }}
                      >
                        {rp.undo}
                      </Button>
                    )}
                    {!isCurrent && (
                      <Button
                        variant="secondary"
                        size="sm"
                        leadingIcon={<RotateCcw />}
                        disabled={busyRev !== null}
                        onClick={() => {
                          setConfirming({ rev: r.rev, action: 'restore' });
                          setFailure(null);
                        }}
                      >
                        {rp.restore}
                      </Button>
                    )}
                  </div>
                )}

                {action && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[12px] hidden sm:block" style={{ color: 'var(--text-2)' }}>
                      {action === 'undo' ? rp.undoConfirmQuestion : rp.confirmQuestion}
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busyRev === r.rev}
                      onClick={() => run(r.rev, action)}
                    >
                      {busyRev === r.rev
                        ? (action === 'undo' ? rp.undoing : rp.restoring)
                        : (action === 'undo' ? rp.undo : rp.confirmYes)}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busyRev === r.rev}
                      onClick={() => setConfirming(null)}
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

      {confirming && (
        <p className="mt-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
          {confirming.action === 'undo' ? rp.undoConfirmNote : rp.confirmNote}
        </p>
      )}
      {failure && (
        <p className="mt-2 text-[12px]" style={{ color: 'var(--negative)' }}>
          {failure}
        </p>
      )}
      <p className="mt-3 text-[11px]" style={{ color: 'var(--text-3)' }}>
        {rp.keptNote}
      </p>
    </Card>
  );
}
