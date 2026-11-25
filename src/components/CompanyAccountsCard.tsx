import { useId, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useFinance } from '../context/FinanceContext';
import { calcCompany, NEUTRAL_LEVERS, type CompanyContext, type CompanyModel } from '../lib/companyCost';
import { accountsWarnings, consultingRevenue, parseBrregResponse, type AccountsWarning, type BrregLookup } from '../lib/companyAccounts';
import { calibrateBlocker, calibrateToAccounts, type CalibrateFailure, type CalibrateMove } from '../lib/companyCalibrate';
import { isValidOrgnr } from '../lib/validators';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { Button } from './ui/Button';

type Notice = { kind: Exclude<BrregLookup['kind'], 'accounts' | 'invalid'> | 'stale'; name?: string; date?: string };
type FitNote = { ok: true; moves: CalibrateMove[] } | { ok: false; reason: CalibrateFailure };

/**
 * "① Start med regnskapet": fetch the company's public accounts from
 * Brønnøysund (through the app's /api/brreg route, only when pressed), compare
 * the model with them, and fit the quick setup's guesses to them
 * (calibrateToAccounts in src/lib/companyCalibrate.ts).
 */
export function CompanyAccountsCard({
  model, setModel, ctx, onAskResale,
}: {
  model: CompanyModel;
  setModel: Dispatch<SetStateAction<CompanyModel>>;
  ctx: CompanyContext;
  /** Open the quick setup's resale question. */
  onAskResale: () => void;
}) {
  const { t, lang, demoMode, formatCurrencyShort } = useFinance();
  const c = t.companyModel;
  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';
  const nf = (v: number, d = 0) => v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  const kr = formatCurrencyShort;

  const acc = model.accounts;
  const [input, setInput] = useState(acc?.orgnr ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fit, setFit] = useState<FitNote | null>(null);
  const orgnr = input.replace(/\s/g, '');
  const valid = isValidOrgnr(orgnr);
  const showInvalid = orgnr.length >= 9 && !valid;
  const errorId = useId();
  // A new lookup that found no accounts hides the saved company's table, so two companies never mix.
  const showSaved = !!acc && notice?.kind !== 'notFound' && notice?.kind !== 'noAccounts';

  const fetchAccounts = async () => {
    if (demoMode || !valid) return;
    setBusy(true);
    setNotice(null);
    setFit(null);
    let lookup: BrregLookup;
    try {
      const res = await fetch(`/api/brreg/${encodeURIComponent(orgnr)}`);
      lookup = parseBrregResponse(res.status, await res.json().catch(() => null), orgnr);
    } catch {
      lookup = { kind: 'unavailable' };
    }
    setBusy(false);
    if (lookup.kind === 'accounts') {
      const accounts = lookup.accounts;
      setModel((m) => ({ ...m, accounts }));
      if (lookup.stale) setNotice({ kind: 'stale', date: new Date(accounts.fetchedAt).toLocaleDateString(locale) });
    } else if (lookup.kind === 'noAccounts') {
      setNotice({ kind: 'noAccounts', name: lookup.name || orgnr });
    } else if (lookup.kind !== 'invalid') {
      setNotice({ kind: lookup.kind });
    }
  };

  const remove = () => {
    setModel((m) => {
      const { accounts: _drop, ...rest } = m;
      return rest;
    });
    setInput('');
    setNotice(null);
    setFit(null);
  };

  // The model as saved (levers at 0), as the fit sees it.
  const r = useMemo(() => calcCompany(model, ctx, NEUTRAL_LEVERS), [model, ctx]);
  const resale = model.quick?.answers.resaleSharePct ?? 0;
  const blocker = acc ? calibrateBlocker(model, acc) : null;

  const runFit = () => {
    if (!acc) return;
    const out = calibrateToAccounts(model, ctx, acc);
    if (out.ok) {
      setModel(out.model);
      setFit({ ok: true, moves: out.moved });
    } else {
      setFit({ ok: false, reason: out.reason });
    }
  };

  const failText: Record<CalibrateFailure, string> = {
    noQuickSetup: c.accountsNeedsSetup,
    handEdited: c.accountsHandEdited,
    currency: c.accountsCurrency,
    nothingToMove: c.accountsNothingToMove,
    noSolution: c.accountsNoSolution,
  };
  const moveText = (m: CalibrateMove) => (m.key === 'typicalBillablePct'
    ? c.accountsMoveBillable.replace('{from}', nf(m.from, 1)).replace('{to}', nf(m.to, 1))
    : c.accountsMoveSalary.replace('{from}', kr(m.from)).replace('{to}', kr(m.to)));

  const warningText = (w: AccountsWarning): ReactNode => {
    if (!acc) return null;
    switch (w) {
      case 'year': return c.warnYear.replace('{year}', String(acc.year)).replace('{modelYear}', String(ctx.year));
      case 'konsern': return c.warnKonsern;
      case 'holding': return c.warnHolding;
      case 'resale': return (
        <>
          {c.warnResale}{' '}
          <button type="button" className="underline underline-offset-2" style={{ color: 'var(--accent)' }} onClick={onAskResale}>
            {c.warnResaleLink}
          </button>
        </>
      );
      case 'persons': return c.warnPersons;
      case 'currency': return c.warnCurrency.replace('{currency}', acc.currency || '?');
    }
  };

  const noticeText = notice && {
    notFound: c.accountsNotFound,
    noAccounts: c.accountsNoAccounts.replace('{name}', notice.name ?? ''),
    unavailable: c.accountsUnavailable,
    stale: c.accountsStale.replace('{date}', notice.date ?? ''),
  }[notice.kind];

  // Millions keep the table narrow on a phone; the accounts' own currency is named (the model is in kr).
  const mill = (v: number, unit = 'kr') => c.accountsMill.replace('{v}', nf(v / 1e6, 1)).replace('{unit}', unit);
  const accUnit = acc && acc.currency !== 'NOK' ? acc.currency || '?' : 'kr';
  const typeLabel = acc?.type === 'KONSERN' ? c.accountsTypeKonsern : c.accountsTypeSelskap;
  const rows = acc ? [
    {
      key: 'revenue',
      label: resale > 0 ? c.accountsRevenueAfterResale.replace('{pct}', nf(resale, 0)) : c.accountsRevenue,
      model: mill(r.revenue),
      accounts: mill(consultingRevenue(acc, resale), accUnit),
    },
    { key: 'result', label: c.accountsOperatingResult, model: mill(r.ebit), accounts: mill(acc.operatingResult, accUnit) },
    {
      key: 'employees',
      label: c.accountsEmployees,
      model: c.accountsEmployeesModel.replace('{fte}', nf(r.heads, 0)),
      accounts: acc.employees != null ? c.accountsEmployeesAccounts.replace('{persons}', nf(acc.employees)) : '–',
    },
  ] : [];

  const muted = { color: 'var(--text-3)' };
  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <SectionLabel>① {c.accountsTitle}</SectionLabel>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>{c.accountsOptional}</span>
        </div>
        <span className="text-[12px] font-mono" style={{ color: 'var(--brass)' }}>
          {acc ? c.accountsRun.replace('{year}', String(acc.year)) : c.accountsNotFetched}
        </span>
      </div>

      <p className="mt-4 text-[12px]" style={muted}>{c.accountsIntro}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[12rem] max-w-[20rem]">
          <span className="block mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={muted}>{c.accountsOrgnr}</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={11}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void fetchAccounts(); }}
            aria-invalid={showInvalid}
            aria-describedby={showInvalid ? errorId : undefined}
            className="w-full h-10 px-3 rounded-[8px] text-[14px] font-mono outline-none border"
            style={{ background: 'var(--surface-3)', borderColor: showInvalid ? 'var(--negative)' : 'var(--border)', color: 'var(--text-1)' }}
          />
        </label>
        <Button variant="primary" disabled={demoMode || !valid || busy} onClick={() => void fetchAccounts()}>
          {busy ? c.accountsFetching : c.accountsFetch}
        </Button>
        {acc && <Button variant="secondary" size="sm" onClick={remove}>{c.accountsRemove}</Button>}
      </div>
      {showInvalid && <p id={errorId} className="mt-2 text-[12px]" style={{ color: 'var(--negative)' }}>{c.accountsOrgnrInvalid}</p>}
      {demoMode && <p className="mt-2 text-[12px]" style={muted}>{c.accountsDemo}</p>}
      <p className="mt-3 text-[12px]" style={muted}>{c.accountsPrivacy}</p>
      {noticeText && <p role="status" className="mt-3 text-[12px] font-semibold" style={{ color: 'var(--warning)' }}>{noticeText}</p>}

      {acc && showSaved && (
        <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--rule)' }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <SectionLabel>{c.accountsCompare}</SectionLabel>
            <span className="text-[12px] min-w-0 [overflow-wrap:anywhere]" style={muted}>{acc.name} · {acc.orgnr}</span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-[12px] md:text-[13px] tabular-nums" data-testid="accounts-table">
            <thead>
              <tr style={muted} className="text-[11px] uppercase tracking-[0.08em]">
                <th className="text-left font-semibold pb-2"><span className="sr-only">{c.accountsCompareRow}</span></th>
                <th className="text-right font-semibold pb-2 pl-2">{c.accountsColModel.replace('{year}', String(ctx.year))}</th>
                <th className="text-right font-semibold pb-2 pl-2">{c.accountsColAccounts.replace('{year}', String(acc.year)).replace('{type}', typeLabel)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t" style={{ borderColor: 'var(--rule)' }}>
                  <td className="py-2 pr-2" style={{ color: 'var(--text-2)' }}>{row.label}</td>
                  <td className="py-2 pl-2 text-right font-mono">{row.model}</td>
                  <td className="py-2 pl-2 text-right font-mono">{row.accounts}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <ul className="mt-4 space-y-1.5 text-[12px] list-disc pl-5" style={{ color: 'var(--text-2)' }} data-testid="accounts-warnings">
            {accountsWarnings(acc).map((w) => <li key={w} data-warning={w}>{warningText(w)}</li>)}
          </ul>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="secondary" disabled={blocker != null} onClick={runFit}>{c.accountsCalibrate}</Button>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--warning-bg)', color: 'var(--brass)' }}>{c.accountsCalibrateTag}</span>
          </div>
          <p className="mt-2 text-[12px]" style={muted}>{blocker ? failText[blocker] : c.accountsCalibrateHint}</p>
          {fit && (
            <p role="status" data-testid="accounts-fit" className="mt-2 text-[12px]" style={{ color: fit.ok ? 'var(--text-1)' : 'var(--negative)' }}>
              {fit.ok
                ? (fit.moves.length > 1 ? c.accountsCalibrated : c.accountsCalibratedOne).replace('{moves}', fit.moves.map(moveText).join(', '))
                : failText[fit.reason]}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
