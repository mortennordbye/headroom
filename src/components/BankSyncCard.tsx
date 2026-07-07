import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { Landmark, RefreshCw, KeyRound, ShieldCheck, Plus, Unlink, Pencil } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { Button } from './ui/Button';
import { accountToken } from '../lib/accountColor';

interface BankAccount {
  key?: string;
  name?: string;
  product?: string;
  currency?: string;
}

interface BankConnection {
  id: string;
  aspsp?: string | null;
  accounts?: BankAccount[];
  lastSync?: string | null;
  validUntil?: string | null;
  daysLeft?: number;
  needsRelink?: boolean;
}

interface BankStatus {
  linked: boolean;
  configured: boolean;
  connections?: BankConnection[];
  hasRedirect?: boolean;
  redirectUrl?: string;
  redirectFromEnv?: boolean;
  hasKey?: boolean;
  keyEncrypted?: boolean;
  keySecretSource?: 'env' | 'managed';
}

const defaultRedirect = () => `${window.location.origin}/api/bank/callback`;

// Human-readable name for one account, falling back to the bank name.
const accountLabel = (a: BankAccount, aspsp?: string | null) => a.name || a.product || aspsp || '';

// In-app Enable Banking control: set the callback URL, upload the app key,
// connect any number of banks with BankID, and sync them all. Backed by
// /api/bank/* (server/bank.js).
export function BankSyncCard() {
  const { t, setDailyTransactions, accountLabels, setAccountLabel } = useFinance();
  const b = t.settings.bank;
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [busy, setBusy] = useState<'idle' | 'connecting' | 'syncing'>('idle');
  const [uploading, setUploading] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [redirectInput, setRedirectInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [aspsps, setAspsps] = useState<{ name: string }[] | null>(null);
  const [selectedBank, setSelectedBank] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
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

  // Start BankID for a specific bank (or re-link an existing one).
  const connect = async (aspsp?: string) => {
    setBusy('connecting');
    setMessage('');
    try {
      const res = await fetch('/api/bank/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aspsp ? { aspsp } : {}),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setBusy('idle');
        setMessage(data.error ? `${b.linkError} (${data.error})` : b.linkError);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setBusy('idle');
      setMessage(b.linkError);
    }
  };

  // Reveal the bank picker and load the list.
  const startAdd = async () => {
    setAdding(true);
    setMessage('');
    if (aspsps) return;
    try {
      const res = await fetch('/api/bank/aspsps');
      const data = await res.json();
      const list: { name: string }[] = Array.isArray(data.aspsps) ? data.aspsps : [];
      setAspsps(list);
      setSelectedBank(list[0]?.name || '');
    } catch {
      setAspsps([]);
    }
  };

  const disconnect = async (id: string) => {
    setMessage('');
    try {
      const res = await fetch(`/api/bank/connection/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      setConfirmingId(null);
      await loadStatus();
    } catch {
      setMessage(b.syncError);
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

  const connections = status?.connections ?? [];

  const connectionRow = (c: BankConnection) => (
    <div key={c.id} className="rounded-[8px] border p-3 space-y-1" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className={`${row} font-medium`}>{c.aspsp}</div>
        <div className="flex gap-2 shrink-0">
          <Button variant="secondary" size="sm" disabled={busy !== 'idle'} onClick={() => connect(c.aspsp || undefined)}>
            {busy === 'connecting' ? b.connecting : b.relink}
          </Button>
          {confirmingId === c.id ? (
            <Button variant="secondary" size="sm" leadingIcon={<Unlink size={14} />} onClick={() => disconnect(c.id)}>
              {b.confirmDisconnect}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" leadingIcon={<Unlink size={14} />} onClick={() => setConfirmingId(c.id)}>
              {b.disconnect}
            </Button>
          )}
        </div>
      </div>
      {(c.accounts ?? []).map((a) => {
        const key = a.key || '';
        const current = (key && accountLabels[key]) || accountLabel(a, c.aspsp);
        if (editingKey === key && key) {
          return (
            <div key={key} className="flex flex-wrap items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={accountLabel(a, c.aspsp)}
                autoFocus
                className="h-8 px-2.5 rounded-[6px] text-[13px] border min-w-[12rem]"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
              <Button variant="secondary" size="sm" onClick={() => { setAccountLabel(key, draft); setEditingKey(null); }}>{b.save}</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingKey(null)}>{b.cancel}</Button>
            </div>
          );
        }
        return (
          <div key={key} className={`${row} flex items-center gap-1.5`} style={muted}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: `var(${accountToken(key || current)})` }} />
            <span>{current}{a.currency ? ` · ${a.currency}` : ''}</span>
            {key && (
              <button
                aria-label={`${b.renameAccount} — ${current}`}
                onClick={() => { setEditingKey(key); setDraft(accountLabels[key] || ''); }}
                className="text-[var(--text-2)] hover:text-[var(--accent)]"
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        );
      })}
      <div className={row} style={muted}>
        {b.lastSync}: {c.lastSync ? new Date(c.lastSync).toLocaleString() : b.never}
      </div>
      <div className={row} style={{ color: c.needsRelink ? 'var(--warning, var(--text))' : 'var(--text-2)' }}>
        {c.needsRelink ? b.needsRelink : b.expiresIn.replace('{n}', String(c.daysLeft ?? 0))}
      </div>
    </div>
  );

  const addBlock = adding ? (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={selectedBank}
        onChange={(e) => setSelectedBank(e.target.value)}
        disabled={!aspsps}
        className="h-9 px-3 rounded-[6px] text-[13px] border min-w-[16rem]"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {!aspsps ? (
          <option>{b.loadingBanks}</option>
        ) : aspsps.length === 0 ? (
          <option>{b.noBanksAvailable}</option>
        ) : (
          aspsps.map((a) => (
            <option key={a.name} value={a.name}>{a.name}</option>
          ))
        )}
      </select>
      <Button variant="primary" size="sm" disabled={busy !== 'idle' || !selectedBank} onClick={() => connect(selectedBank)}>
        {busy === 'connecting' ? b.connecting : b.connect}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>{b.cancel}</Button>
    </div>
  ) : (
    <Button variant="secondary" size="sm" leadingIcon={<Plus size={14} />} disabled={busy !== 'idle'} onClick={startAdd}>
      {b.addBank}
    </Button>
  );

  return (
    <Card padding="lg" className="md:col-span-12">
      <SectionLabel icon={<Landmark />}>{b.title}</SectionLabel>
      <p className="mt-2 text-[13px]" style={muted}>
        {b.desc}
      </p>

      {status && !status.configured ? (
        <div className="mt-4 space-y-4">
          {redirectBlock}
          {keyBlock}
          <div className={row} style={muted}>{b.notConfigured}</div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {connections.length > 0 ? connections.map(connectionRow) : <div className={row} style={muted}>{b.notLinked}</div>}
          <div className="flex flex-wrap gap-2 pt-1">
            {addBlock}
            {connections.length > 0 && (
              <Button variant="primary" size="sm" leadingIcon={<RefreshCw size={14} />} disabled={busy !== 'idle'} onClick={sync}>
                {busy === 'syncing' ? b.syncing : b.syncNow}
              </Button>
            )}
          </div>
          <div className="pt-1">{keyBlock}</div>
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
