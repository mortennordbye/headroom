import { useState, useEffect } from 'react';
import { Landmark, RefreshCw } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { Button } from './ui/Button';

interface BankStatus {
  linked: boolean;
  configured: boolean;
  aspsp?: string | null;
  accounts?: { name?: string; currency?: string }[];
  lastSync?: string | null;
  validUntil?: string | null;
  daysLeft?: number;
  needsRelink?: boolean;
}

// In-app Enable Banking control: connect / re-link with BankID and sync
// transactions. Backed by /api/bank/* (server/bank.js).
export function BankSyncCard() {
  const { t, setDailyTransactions } = useFinance();
  const b = t.settings.bank;
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [busy, setBusy] = useState<'idle' | 'connecting' | 'syncing'>('idle');
  // Seed the message from the BankID redirect outcome (?bank=linked|error) once,
  // during init, so the effect doesn't setState synchronously.
  const [message, setMessage] = useState(() => {
    const outcome = new URLSearchParams(window.location.search).get('bank');
    if (outcome === 'linked') return b.linkedOk;
    if (outcome === 'error') return b.linkError;
    return '';
  });

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/bank/status');
      if (res.ok) setStatus(await res.json());
    } catch {
      /* offline — leave status null (card stays quiet) */
    }
  };

  useEffect(() => {
    // Fetch current bank status once on mount (external-system sync); setState
    // happens after the awaited fetch, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus();
    // Clean the ?bank=… params out of the URL (no setState here).
    const params = new URLSearchParams(window.location.search);
    if (params.has('bank')) {
      params.delete('bank');
      params.delete('reason');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''));
    }
  }, []);

  const connect = async () => {
    setBusy('connecting');
    setMessage('');
    try {
      const res = await fetch('/api/bank/link', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'link failed');
      window.location.href = data.url; // → BankID, then back to /settings?bank=linked
    } catch {
      setBusy('idle');
      setMessage(b.linkError);
    }
  };

  const sync = async () => {
    setBusy('syncing');
    setMessage('');
    try {
      const res = await fetch('/api/bank/sync', { method: 'POST' });
      const data = await res.json();
      if (res.status === 409 && data.needsRelink) {
        setMessage(b.needsRelink);
        await loadStatus();
        return;
      }
      if (!res.ok) throw new Error(data.error || 'sync failed');
      if (Array.isArray(data.dailyTransactions)) setDailyTransactions(data.dailyTransactions);
      setMessage(b.synced.replace('{n}', String(data.added ?? 0)));
      await loadStatus();
    } catch {
      setMessage(b.syncError);
    } finally {
      setBusy('idle');
    }
  };

  const row = 'text-[13px]';
  const muted = { color: 'var(--text-2)' };

  return (
    <Card padding="lg" className="md:col-span-12">
      <SectionLabel icon={<Landmark />}>{b.title}</SectionLabel>
      <p className="mt-2 text-[13px]" style={muted}>
        {b.desc}
      </p>

      {status && !status.configured && (
        <p className="mt-3 text-[13px]" style={{ color: 'var(--warning, var(--text-2))' }}>
          {b.notConfigured}
        </p>
      )}

      {status?.linked ? (
        <div className="mt-4 space-y-1">
          <div className={row}>
            <span style={muted}>{b.linkedTo}: </span>
            {status.aspsp}
            {status.accounts?.[0]?.currency ? ` · ${status.accounts[0].currency}` : ''}
          </div>
          <div className={row} style={muted}>
            {b.lastSync}: {status.lastSync ? new Date(status.lastSync).toLocaleString() : b.never}
          </div>
          <div
            className={row}
            style={{ color: status.needsRelink ? 'var(--warning, var(--text))' : 'var(--text-2)' }}
          >
            {status.needsRelink ? b.needsRelink : b.expiresIn.replace('{n}', String(status.daysLeft ?? 0))}
          </div>
          <div className="flex flex-wrap gap-2 pt-3">
            <Button variant="primary" size="sm" leadingIcon={<RefreshCw size={14} />} disabled={busy !== 'idle'} onClick={sync}>
              {busy === 'syncing' ? b.syncing : b.syncNow}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy !== 'idle'} onClick={connect}>
              {busy === 'connecting' ? b.connecting : b.relink}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className={row} style={muted}>{b.notLinked}</div>
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<Landmark size={14} />}
            disabled={busy !== 'idle' || (status != null && !status.configured)}
            onClick={connect}
          >
            {busy === 'connecting' ? b.connecting : b.connect}
          </Button>
        </div>
      )}

      {message && (
        <p className="mt-3 text-[13px]" style={{ color: 'var(--accent)' }}>
          {message}
        </p>
      )}
    </Card>
  );
}
