import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { Landmark, RefreshCw, KeyRound, ShieldCheck } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { Button } from './ui/Button';

interface BankStatus {
  linked: boolean;
  configured: boolean;
  hasRedirect?: boolean;
  redirectUrl?: string;
  redirectFromEnv?: boolean;
  hasKey?: boolean;
  keyEncrypted?: boolean;
  keySecretSource?: 'env' | 'managed';
  aspsp?: string | null;
  accounts?: { name?: string; currency?: string }[];
  lastSync?: string | null;
  validUntil?: string | null;
  daysLeft?: number;
  needsRelink?: boolean;
}

const defaultRedirect = () => `${window.location.origin}/api/bank/callback`;

// In-app Enable Banking control: set the callback URL, upload the app key,
// connect / re-link with BankID, and sync. Backed by /api/bank/* (server/bank.js).
export function BankSyncCard() {
  const { t, setDailyTransactions } = useFinance();
  const b = t.settings.bank;
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [busy, setBusy] = useState<'idle' | 'connecting' | 'syncing'>('idle');
  const [uploading, setUploading] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [redirectInput, setRedirectInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState(() => {
    const outcome = new URLSearchParams(window.location.search).get('bank');
    if (outcome === 'linked') return b.linkedOk;
    if (outcome === 'error') return b.linkError;
    return '';
  });

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/bank/status');
      if (!res.ok) return;
      const data: BankStatus = await res.json();
      setStatus(data);
      setRedirectInput((prev) => prev || data.redirectUrl || defaultRedirect());
    } catch {
      /* offline — leave status null (card stays quiet) */
    }
  };

  useEffect(() => {
    // Fetch current bank status once on mount (external-system sync); setState
    // happens after the awaited fetch, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus();
    const params = new URLSearchParams(window.location.search);
    if (params.has('bank')) {
      params.delete('bank');
      params.delete('reason');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''));
    }
  }, []);

  const saveRedirect = async () => {
    setSavingCfg(true);
    setMessage('');
    try {
      const res = await fetch('/api/bank/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUrl: redirectInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'save failed');
      setMessage(b.saved);
      await loadStatus();
    } catch {
      setMessage(b.linkError);
    } finally {
      setSavingCfg(false);
    }
  };

  const uploadKey = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      const pem = await file.text();
      const res = await fetch('/api/bank/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pem }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(b.keyInvalid);
        return;
      }
      setMessage(data.verified ? b.keyOkVerified : b.keyOkUnverified);
      await loadStatus();
    } catch {
      setMessage(b.keyInvalid);
    } finally {
      setUploading(false);
    }
  };

  const connect = async () => {
    setBusy('connecting');
    setMessage('');
    try {
      const res = await fetch('/api/bank/link', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'link failed');
      window.location.href = data.url;
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

  const keyLabel = !status?.keyEncrypted
    ? b.keyPlaintextLabel
    : status.keySecretSource === 'env'
      ? b.keyEncEnv
      : b.keyEncManaged;

  const keyBlock = status?.hasKey ? (
    <div className={`${row} inline-flex items-center gap-1.5`} style={muted}>
      <ShieldCheck size={14} />
      {b.keyInstalled} · {keyLabel}
    </div>
  ) : (
    <div className="space-y-2">
      <div className={row} style={muted}>{b.keyMissing}</div>
      <input ref={fileRef} type="file" accept=".pem,application/x-pem-file" className="hidden" onChange={uploadKey} />
      <Button variant="secondary" size="sm" leadingIcon={<KeyRound size={14} />} disabled={uploading} onClick={() => fileRef.current?.click()}>
        {uploading ? b.uploading : b.uploadKey}
      </Button>
    </div>
  );

  // Callback URL: env-provided (read-only) or an editable setting.
  const redirectBlock = (
    <div className="space-y-1.5">
      <label className={row} style={muted}>{b.redirectLabel}</label>
      {status?.redirectFromEnv ? (
        <div className={`${row} font-mono break-all`}>{status.redirectUrl}</div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="url"
            value={redirectInput}
            onChange={(e) => setRedirectInput(e.target.value)}
            placeholder={defaultRedirect()}
            className="flex-1 min-w-[16rem] h-9 px-3 rounded-[6px] text-[13px] border font-mono"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <Button variant="secondary" size="sm" disabled={savingCfg || !redirectInput.trim()} onClick={saveRedirect}>
            {b.save}
          </Button>
        </div>
      )}
      <div className={row} style={muted}>{b.redirectHint}</div>
    </div>
  );

  return (
    <Card padding="lg" className="md:col-span-12">
      <SectionLabel icon={<Landmark />}>{b.title}</SectionLabel>
      <p className="mt-2 text-[13px]" style={muted}>
        {b.desc}
      </p>

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
          <div className={row} style={{ color: status.needsRelink ? 'var(--warning, var(--text))' : 'var(--text-2)' }}>
            {status.needsRelink ? b.needsRelink : b.expiresIn.replace('{n}', String(status.daysLeft ?? 0))}
          </div>
          <div className="pt-1">{keyBlock}</div>
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
        <div className="mt-4 space-y-4">
          {redirectBlock}
          {keyBlock}
          <div className="space-y-2">
            <div className={row} style={muted}>{b.notLinked}</div>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Landmark size={14} />}
              disabled={busy !== 'idle' || uploading || (status != null && !status.configured)}
              onClick={connect}
            >
              {busy === 'connecting' ? b.connecting : b.connect}
            </Button>
          </div>
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
