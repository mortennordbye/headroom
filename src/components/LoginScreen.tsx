import { useState } from 'react';
import { Lock } from 'lucide-react';
import { useFinanceSettings } from '../context/FinanceContext';

// Full-screen gate shown when the server requires a password and there's no valid
// session. On success the context reloads the page (cookie now set), so this
// component just collects the password and surfaces a wrong-password error.
export default function LoginScreen() {
  const { t, login } = useFinanceSettings();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(false);
    const ok = await login(password);
    if (!ok) { setError(true); setBusy(false); setPassword(''); }
    // on success the page reloads; leave busy true so the form stays disabled.
  };

  return (
    <div className="min-h-[100dvh] grid place-items-center px-6" style={{ background: 'var(--bg)' }}>
      <form onSubmit={submit} className="w-full max-w-[340px] flex flex-col items-center gap-5">
        <span className="w-12 h-12 rounded-[14px] grid place-items-center text-[var(--forest)]"
          style={{ background: 'color-mix(in srgb, var(--forest) 16%, transparent)' }}>
          <Lock size={22} />
        </span>
        <div className="text-center">
          <h1 className="text-[20px] font-semibold text-[var(--text-1)]">{t.auth.loginTitle}</h1>
          <p className="text-[13px] mt-1 text-[var(--text-3)]">{t.auth.loginSubtitle}</p>
        </div>
        <div className="w-full">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(false); }}
            placeholder={t.auth.passwordPlaceholder}
            aria-label={t.auth.passwordLabel}
            aria-invalid={error}
            className="w-full bg-[var(--bg-raised)] border rounded-[10px] px-3.5 py-3 text-[15px] text-[var(--text-1)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--forest)_30%,transparent)] transition-colors"
            style={{ borderColor: error ? 'var(--negative)' : 'var(--border)' }}
          />
          {error && <p className="text-[12px] text-[var(--negative)] mt-1.5">{t.auth.wrongPassword}</p>}
        </div>
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full py-3 rounded-[10px] text-[14px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] disabled:opacity-50 transition-colors"
        >
          {t.auth.loginButton}
        </button>
      </form>
    </div>
  );
}
