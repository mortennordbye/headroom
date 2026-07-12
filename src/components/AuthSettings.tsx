import { useState } from 'react';
import { Lock } from 'lucide-react';
import { useFinanceSettings } from '../context/FinanceContext';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';

// Access / Security settings: turn the optional password on or off and set/change
// it. When auth is forced by the AUTH_PASSWORD env var, the controls are replaced
// by a read-only note (the server owns it; see server/auth.js).
export function AuthSettings() {
  const { t, authEnabled, authSource, setAuthConfig, logout } = useFinanceSettings();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [changing, setChanging] = useState(false); // "change password" form open while enabled
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const envManaged = authSource === 'env';

  const input = 'w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[10px] px-3.5 py-2.5 text-[14px] text-[var(--text-1)] outline-none focus:border-[var(--forest)] transition-colors';
  const btn = 'py-2.5 px-4 rounded-[10px] text-[13px] font-semibold transition-colors';

  const reset = () => { setPw(''); setConfirm(''); setError(''); setChanging(false); };

  const savePassword = async () => {
    if (pw.length < 4) { setError(t.auth.tooShort); return; }
    if (pw !== confirm) { setError(t.auth.mismatch); return; }
    setBusy(true); setError('');
    const r = await setAuthConfig(true, pw);
    setBusy(false);
    if (r.ok) reset();
    else setError(r.error === 'password too short' ? t.auth.tooShort : t.auth.saveError);
  };

  const disable = async () => {
    setBusy(true); setError('');
    const r = await setAuthConfig(false);
    setBusy(false);
    if (r.ok) reset();
    else setError(t.auth.saveError);
  };

  return (
    <Card padding="lg" className="md:col-span-12">
      <SectionLabel icon={<Lock />}>{t.auth.sectionTitle}</SectionLabel>
      <p className="text-[12px] mt-1 mb-4" style={{ color: 'var(--text-3)' }}>{t.auth.sectionHint}</p>

      {envManaged ? (
        <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{t.auth.managedByEnv}</p>
      ) : !authEnabled ? (
        // OFF → collect a password to turn it on.
        <div className="flex flex-col gap-2.5 max-w-[360px]">
          <input type="password" className={input} value={pw} onChange={e => { setPw(e.target.value); setError(''); }} placeholder={t.auth.newPassword} aria-label={t.auth.newPassword} />
          <input type="password" className={input} value={confirm} onChange={e => { setConfirm(e.target.value); setError(''); }} placeholder={t.auth.confirmPassword} aria-label={t.auth.confirmPassword} />
          {error && <p className="text-[12px] text-[var(--negative)]">{error}</p>}
          <button type="button" disabled={busy || !pw} onClick={savePassword} className={`${btn} self-start text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] disabled:opacity-50`}>
            {t.auth.enable}
          </button>
        </div>
      ) : (
        // ON (app-managed) → change password or turn off.
        <div className="flex flex-col gap-3 max-w-[360px]">
          <p className="text-[13px]" style={{ color: 'var(--positive)' }}>{t.auth.enabledNote}</p>
          {changing ? (
            <div className="flex flex-col gap-2.5">
              <input type="password" className={input} value={pw} onChange={e => { setPw(e.target.value); setError(''); }} placeholder={t.auth.newPassword} aria-label={t.auth.newPassword} />
              <input type="password" className={input} value={confirm} onChange={e => { setConfirm(e.target.value); setError(''); }} placeholder={t.auth.confirmPassword} aria-label={t.auth.confirmPassword} />
              {error && <p className="text-[12px] text-[var(--negative)]">{error}</p>}
              <div className="flex gap-2">
                <button type="button" disabled={busy || !pw} onClick={savePassword} className={`${btn} text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] disabled:opacity-50`}>{t.auth.changePassword}</button>
                <button type="button" onClick={reset} className={`${btn} text-[var(--text-2)] bg-[var(--bg-raised)]`}>{t.cancel}</button>
              </div>
            </div>
          ) : (
            <>
              {error && <p className="text-[12px] text-[var(--negative)]">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => { setError(''); setChanging(true); }} className={`${btn} text-[var(--text-1)] bg-[var(--bg-raised)] hover:bg-[var(--bg-elev)]`}>{t.auth.changePassword}</button>
                <button type="button" onClick={logout} className={`${btn} text-[var(--text-1)] bg-[var(--bg-raised)] hover:bg-[var(--bg-elev)]`}>{t.auth.logout}</button>
                <button type="button" disabled={busy} onClick={disable} className={`${btn} text-[var(--negative)] bg-[color-mix(in_srgb,var(--negative)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--negative)_20%,transparent)] disabled:opacity-50`}>{t.auth.disable}</button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
