import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { Landmark, RefreshCw, KeyRound, ShieldCheck, Plus, Unlink, Pencil, AlertTriangle, BookOpen, ExternalLink, Trash2 } from 'lucide-react';
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
  iban?: string | null;
}

// Masked account-number tail (last 4) to distinguish same-named accounts.
const ibanTail = (iban?: string | null) => (iban ? `••${iban.slice(-4)}` : '');

interface BankConnection {
  id: string;
  aspsp?: string | null;
  accounts?: BankAccount[];
  accountsNote?: string | null;
  lastSync?: string | null;
  validUntil?: string | null;
  daysLeft?: number;
  needsRelink?: boolean;
}

interface SyncLogEntry {
  at: string;
  ok: boolean;
  added?: number;
  fetched?: number;
  total?: number;
  error?: string;
}

interface BankStatus {
  linked: boolean;
  configured: boolean;
  connections?: BankConnection[];
  syncLog?: SyncLogEntry[];
  hasRedirect?: boolean;
  redirectUrl?: string;
  redirectFromEnv?: boolean;
  hasKey?: boolean;
  keyEncrypted?: boolean;
  keySecretSource?: 'env' | 'managed';
  appId?: string;
  hasAppId?: boolean;
  appIdFromEnv?: boolean;
}

const defaultRedirect = () => `${window.location.origin}/api/bank/callback`;

// Warn this many days before a bank consent expires — early enough to re-link
// before a nightly sync silently starts failing.
const RELINK_LEAD_DAYS = 14;

// Human-readable name for one account, falling back to the bank name.
const accountLabel = (a: BankAccount, aspsp?: string | null) => a.name || a.product || aspsp || '';

// In-app Enable Banking control: set the callback URL, upload the app key,
// connect any number of banks with BankID, and sync them all. Backed by
// /api/bank/* (server/bank.js).
export function BankSyncCard() {
  const { t, applyBankSync, accountLabels, setAccountLabel, dataAccounts, dailyTransactions, removeAccountData } = useFinance();
  const b = t.settings.bank;
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [busy, setBusy] = useState<'idle' | 'connecting' | 'syncing'>('idle');
  const [uploading, setUploading] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [redirectInput, setRedirectInput] = useState('');
  const [appIdInput, setAppIdInput] = useState('');
  const [adding, setAdding] = useState(false);
  // Set when the picker was opened to re-link a legacy connection whose bank is
  // unknown (aspsp null); sent along so the server reuses that connection's
  // id/prefix and backfills the chosen bank instead of minting a duplicate.
  const [relinkId, setRelinkId] = useState<string | null>(null);
  const [aspsps, setAspsps] = useState<{ name: string }[] | null>(null);
  const [selectedBank, setSelectedBank] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showGuide, setShowGuide] = useState(false);
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
      setAppIdInput((prev) => prev || data.appId || '');
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

  // Save one non-secret config field (redirectUrl or appId) via /api/bank/config.
  const saveConfig = async (patch: { redirectUrl?: string; appId?: string }) => {
    setSavingCfg(true);
    setMessage('');
    try {
      const res = await fetch('/api/bank/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
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
  const saveRedirect = () => saveConfig({ redirectUrl: redirectInput.trim() });
  const saveAppId = () => saveConfig({ appId: appIdInput.trim() });

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
  const connect = async (aspsp?: string, connectionId?: string) => {
    setBusy('connecting');
    setMessage('');
    try {
      const res = await fetch('/api/bank/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(aspsp ? { aspsp } : {}), ...(connectionId ? { connectionId } : {}) }),
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

  // Reveal the bank picker and load the list. With a connection id, the picker
  // re-links that connection (legacy aspsp-less store) instead of adding a bank.
  const startAdd = async (relinkConnectionId?: string) => {
    setRelinkId(relinkConnectionId ?? null);
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
      // Adopt the new rev the sync returned so this tab doesn't flag its own
      // sync as an external change (the "data changed elsewhere" reload).
      if (Array.isArray(data.dailyTransactions)) applyBankSync(data.dailyTransactions, data.rev);
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

  // Application ID: env-provided (read-only) or an editable setting, like the
  // callback URL above.
  const appIdBlock = (
    <div className="space-y-1.5">
      <label className={row} style={muted}>{b.appIdLabel}</label>
      {status?.appIdFromEnv ? (
        <div className={`${row} font-mono break-all`}>{status.appId}</div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={appIdInput}
            onChange={(e) => setAppIdInput(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="flex-1 min-w-[16rem] h-9 px-3 rounded-[6px] text-[13px] border font-mono"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <Button variant="secondary" size="sm" disabled={savingCfg || !appIdInput.trim()} onClick={saveAppId}>
            {b.save}
          </Button>
        </div>
      )}
      <div className={row} style={muted}>{b.appIdHint}</div>
    </div>
  );

  const connections = status?.connections ?? [];
  const syncLog = status?.syncLog ?? [];

  // Colour the status line by outcome: error messages read as negative, success
  // as accent. `linkError` can carry a `(reason)` suffix, so match by prefix.
  const errorMessages = [b.linkError, b.keyInvalid, b.syncError, b.needsRelink];
  const messageIsError = errorMessages.some((m) => message === m || message.startsWith(`${m} `));

  // Explain why a connection has no accounts, using the server's diagnostic note.
  const emptyAccountsMessage = (note?: string | null) => {
    if (note && note.startsWith('fetch-failed')) return b.accountsFetchFailed.replace('{msg}', note.replace('fetch-failed: ', ''));
    if (note === 'no-accounts-granted') return b.noAccountsGranted;
    return b.noAccounts;
  };

  // One renamable account row (shared by live connections and historical/orphan
  // accounts). `key` is the account key; `suffix` adds currency/IBAN.
  const accountRow = (key: string, fallbackLabel: string, suffix = '') => {
    const current = (key && accountLabels[key]) || fallbackLabel;
    if (editingKey === key && key) {
      return (
        <div key={key} className="flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={fallbackLabel}
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
        <span data-selectable>{current}{suffix}</span>
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
  };

  // Accounts seen in the transaction history that aren't in any current
  // connection (e.g. a re-linked bank issued a new account id). Surfaced so the
  // user can rename them to match — merging both under one name everywhere.
  const connectedKeys = new Set(connections.flatMap((c) => (c.accounts ?? []).map((a) => a.key).filter(Boolean)));
  const orphanAccounts = dataAccounts.filter((a) => !connectedKeys.has(a.key));

  const connectionRow = (c: BankConnection) => (
    <div key={c.id} className="rounded-[8px] border p-3 space-y-1" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className={`${row} font-medium`}>{c.aspsp || b.unknownBank}</div>
        <div className="flex gap-2 shrink-0">
          <Button variant="secondary" size="sm" disabled={busy !== 'idle'} onClick={() => (c.aspsp ? connect(c.aspsp, c.id) : startAdd(c.id))}>
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
      {(c.accounts ?? []).map((a) => accountRow(
        a.key || '',
        accountLabel(a, c.aspsp),
        `${a.currency ? ` · ${a.currency}` : ''}${a.iban ? ` · ${ibanTail(a.iban)}` : ''}`,
      ))}
      {(c.accounts ?? []).length === 0 && (
        <div className={`${row} flex items-start gap-1.5`} style={{ color: 'var(--warning, var(--text-2))' }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{emptyAccountsMessage(c.accountsNote)}</span>
        </div>
      )}
      <div className={row} style={muted}>
        {b.lastSync}: {c.lastSync ? new Date(c.lastSync).toLocaleString() : b.never}
      </div>
      <div
        className={row}
        style={{
          // Amber the expiry line once consent is within its lead-time window, so a
          // cron-driven sync doesn't go silent right up until it's already expired.
          color: c.needsRelink || (!c.needsRelink && (c.daysLeft ?? Infinity) <= RELINK_LEAD_DAYS)
            ? 'var(--warning, var(--text))'
            : 'var(--text-2)',
        }}
      >
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
      <Button variant="primary" size="sm" disabled={busy !== 'idle' || !selectedBank} onClick={() => connect(selectedBank, relinkId ?? undefined)}>
        {busy === 'connecting' ? b.connecting : b.connect}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setRelinkId(null); }}>{b.cancel}</Button>
    </div>
  ) : (
    <Button variant="secondary" size="sm" leadingIcon={<Plus size={14} />} disabled={busy !== 'idle'} onClick={() => startAdd()}>
      {b.addBank}
    </Button>
  );

  return (
    <Card padding="lg" className="md:col-span-12">
      <SectionLabel icon={<Landmark />}>{b.title}</SectionLabel>
      <p className="mt-2 text-[13px]" style={muted}>
        {b.desc}
      </p>

      <button
        onClick={() => setShowGuide((v) => !v)}
        className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium"
        style={{ color: 'var(--accent)' }}
      >
        <BookOpen size={13} />
        {showGuide ? b.setup.hide : b.setup.show}
      </button>
      {showGuide && (
        <div className="mt-3 rounded-[8px] border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-2)' }}>
          <div className="text-[13px] font-semibold">{b.setup.title}</div>
          <ol className="list-decimal pl-5 space-y-2 text-[13px] leading-[1.5]" style={muted}>
            {b.setup.steps.map((step, i) => (
              <li key={i}>{step.replace('{callback}', status?.redirectUrl || defaultRedirect())}</li>
            ))}
          </ol>
          <a
            href="https://enablebanking.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-medium"
            style={{ color: 'var(--accent)' }}
          >
            {b.setup.openLabel} <ExternalLink size={12} />
          </a>
        </div>
      )}

      {status && !status.configured ? (
        <div className="mt-4 space-y-4">
          {redirectBlock}
          {appIdBlock}
          {keyBlock}
          <div className={row} style={muted}>{b.notConfigured}</div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {connections.length > 0 ? connections.map(connectionRow) : <div className={row} style={muted}>{b.notLinked}</div>}
          {orphanAccounts.length > 0 && (
            <div className="rounded-[8px] border p-3 space-y-1" style={{ borderColor: 'var(--border)' }}>
              <div className={`${row} font-medium`}>{b.historicalAccounts}</div>
              <div className={row} style={muted}>{b.historicalAccountsHint}</div>
              <div className="pt-1 space-y-1.5">
                {orphanAccounts.map((a) => {
                  const count = dailyTransactions.filter((t) => t.account === a.key).length;
                  return (
                    <div key={a.key} className="flex flex-wrap items-center gap-2">
                      {accountRow(a.key, a.accountName || a.bank || a.key, a.accountName && a.bank ? ` · ${a.bank}` : '')}
                      {confirmingDeleteKey === a.key ? (
                        <Button variant="danger" size="sm" leadingIcon={<Trash2 size={13} />} onClick={() => { removeAccountData(a.key); setConfirmingDeleteKey(null); }}>
                          {b.removeDataConfirm.replace('{n}', String(count))}
                        </Button>
                      ) : (
                        <button
                          aria-label={`${b.removeData} — ${a.accountName || a.bank || a.key}`}
                          onClick={() => setConfirmingDeleteKey(a.key)}
                          className="text-[var(--text-2)] hover:text-[var(--negative)]"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {addBlock}
            {connections.length > 0 && (
              <Button variant="primary" size="sm" leadingIcon={<RefreshCw size={14} />} disabled={busy !== 'idle'} onClick={sync}>
                {busy === 'syncing' ? b.syncing : b.syncNow}
              </Button>
            )}
          </div>
          {syncLog.length > 0 && (
            <div className="pt-1">
              <div className="text-[12px] font-medium mb-1" style={muted}>{b.syncHistory}</div>
              <ul className="space-y-0.5">
                {syncLog.slice(0, 5).map((e, i) => (
                  <li key={`${e.at}-${i}`} className="text-[12px] flex items-baseline gap-2" style={muted}>
                    <span className="tabular-nums">{new Date(e.at).toLocaleString()}</span>
                    <span style={{ color: e.ok ? 'var(--positive, var(--text-2))' : 'var(--negative)' }}>
                      {e.ok ? b.syncOkEntry.replace('{added}', String(e.added ?? 0)) : b.syncErrEntry}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="pt-1">{keyBlock}</div>
        </div>
      )}

      {message && (
        <p className="mt-3 text-[13px]" style={{ color: messageIsError ? 'var(--negative)' : 'var(--accent)' }}>
          {message}
        </p>
      )}
    </Card>
  );
}
