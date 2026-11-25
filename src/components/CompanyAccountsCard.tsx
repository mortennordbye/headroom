import { useId, useMemo, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Check } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { calcCompany, NEUTRAL_LEVERS, type CompanyContext, type CompanyModel } from '../lib/companyCost';
import {
  accountsWarnings, compareWithAccounts, parseBrregResponse, ACCOUNTS_MATCH_TOLERANCE,
  type AccountsWarning, type BrregLookup,
} from '../lib/companyAccounts';
import { accountsStatus, fitModelToAccounts, type CalibrateFailure, type CalibrateMove } from '../lib/companyCalibrate';
import { isValidOrgnr } from '../lib/validators';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { Button } from './ui/Button';
import ConfirmModal from './ConfirmModal';
import { RESTORE_POINTS_ANCHOR } from './RestorePointsCard';

type Notice = { kind: Exclude<BrregLookup['kind'], 'accounts' | 'invalid'> | 'stale'; name?: string; date?: string };

/** The accounts card's id, so the me card can link down to it. */
export const ACCOUNTS_CARD_ANCHOR = 'company-accounts';

/** Faint column tints: brass for the model's estimates, green for the real accounts. */
const GUESS_TINT: CSSProperties = { background: 'color-mix(in srgb, var(--warning) 5%, transparent)' };
const FACT_TINT: CSSProperties = { background: 'color-mix(in srgb, var(--positive) 5%, transparent)' };

/** A small label pill in a tone: brass for an estimate, green for a fact. */
export function BasisTag({ fact, children }: { fact: boolean; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-[4px] font-semibold h-[18px] px-[7px] text-[10px] whitespace-nowrap normal-case tracking-normal"
      style={fact ? { background: 'var(--positive-bg)', color: 'var(--positive)' } : { background: 'var(--warning-bg)', color: 'var(--warning)' }}
    >
      {children}
    </span>
  );
}

/**
 * "① Start med regnskapet": fetch the company's public accounts from
 * Brønnøysund (through the app's /api/brreg route, only when pressed), compare
 * the model (estimates) with them (real figures), and make the model match them
 * in one step (fitModelToAccounts in src/lib/companyCalibrate.ts).
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
  // A fit error belongs to the model it ran on: any later change to the model (a hand edit, a rebuild) hides it.
  const [fitFailure, setFitError] = useState<{ reason: CalibrateFailure; on: CompanyModel } | null>(null);
  const fitError = fitFailure?.on === model ? fitFailure.reason : null;
  const [confirming, setConfirming] = useState(false);
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
    setFitError(null);
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
    setFitError(null);
  };

  const muted = { color: 'var(--text-3)' };
  // The model as saved (levers at 0), as the fit sees it.
  const r = useMemo(() => calcCompany(model, ctx, NEUTRAL_LEVERS), [model, ctx]);
  const status = useMemo(() => accountsStatus(model, ctx), [model, ctx]);
  const resale = model.quick?.answers.resaleSharePct ?? 0;
  const blocker: CalibrateFailure | null = !acc ? null : !model.quick ? 'noQuickSetup' : acc.currency !== 'NOK' ? 'currency' : null;

  // One model update: flags, a rebuild after hand edits (asked first), the fit and the fit marker.
  const runFit = (replaceHandEdits: boolean) => {
    if (!acc) return;
    if (model.quick?.edited && !replaceHandEdits) { setConfirming(true); return; }
    setConfirming(false);
    const out = fitModelToAccounts(model, ctx, acc, { replaceHandEdits, labels: c.quickLabels });
    if (out.ok) {
      setModel(out.model);
      setFitError(null);
    } else {
      setFitError({ reason: out.reason, on: model });
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
    ? c.accountsFitMoveBillable.replace('{from}', nf(m.from, 1)).replace('{to}', nf(m.to, 1))
    : c.accountsFitMoveSalary.replace('{from}', kr(m.from)).replace('{to}', kr(m.to)));

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

  // Millions keep the table narrow on a phone. Only another currency in the accounts is named (the model is in kr).
  const sign = (v: number) => (v < 0 ? '−' : '');
  const mill = (v: number, unit = '') => c.accountsMill.replace('{v}', `${sign(v)}${nf(Math.abs(v) / 1e6, 1)}`).replace('{unit}', unit).trim();
  const nok = acc?.currency === 'NOK';
  const accUnit = acc && !nok ? acc.currency || '?' : '';
  const cmp = acc ? compareWithAccounts(r, acc, resale) : null;
  // A gap above the match tolerance (10 % of the accounts' revenue) is rust; one that rounds to 0 is "likt".
  const tolerance = cmp ? Math.abs(cmp.revenue.accounts) * ACCOUNTS_MATCH_TOLERANCE : 0;
  type Diff = { text: string; color: string };
  const same: Diff = { text: c.accountsDiffSame, color: 'var(--positive)' };
  const none: Diff = { text: '–', color: 'var(--text-3)' };
  const moneyDiff = (d: number): Diff => {
    if (!nok) return none;
    if (Math.abs(d) < 50_000) return same;
    return { text: `${d > 0 ? '+' : ''}${mill(d)}`, color: Math.abs(d) > tolerance ? 'var(--negative)' : 'var(--text-2)' };
  };
  const heads = Math.round(r.heads);
  const headDiff: Diff = acc?.employees == null ? none
    : heads === acc.employees ? same
      : { text: `${heads > acc.employees ? '+' : '−'}${nf(Math.abs(heads - acc.employees))}`, color: Math.abs(heads - acc.employees) > acc.employees * ACCOUNTS_MATCH_TOLERANCE ? 'var(--negative)' : 'var(--text-2)' };
  const rows: Array<{ key: string; label: string; sub?: string; model: string; accounts: string; diff: Diff }> = acc && cmp ? [
    {
      key: 'revenue',
      label: resale > 0 ? c.accountsRevenueAfterResale.replace('{pct}', nf(resale, 0)) : c.accountsRevenue,
      model: mill(cmp.revenue.model),
      accounts: mill(cmp.revenue.accounts, accUnit),
      diff: moneyDiff(cmp.revenue.diff),
    },
    {
      key: 'result', label: c.accountsOperatingResult, sub: c.accountsOperatingResultSub,
      model: mill(cmp.operatingResult.model), accounts: mill(cmp.operatingResult.accounts, accUnit), diff: moneyDiff(cmp.operatingResult.diff),
    },
    {
      key: 'costs', label: c.accountsCosts, sub: c.accountsCostsSub,
      model: mill(cmp.costs.model), accounts: mill(cmp.costs.accounts, accUnit), diff: moneyDiff(cmp.costs.diff),
    },
    {
      key: 'employees',
      label: c.accountsEmployees,
      model: c.accountsEmployeesModel.replace('{fte}', nf(r.heads, 0)),
      accounts: acc.employees != null ? c.accountsEmployeesAccounts.replace('{persons}', nf(acc.employees)) : '–',
      diff: headDiff,
    },
  ] : [];
  const modelSub = c.accountsColModelSub.replace('{year}', String(ctx.year));
  const accountsSub = acc ? c.accountsColAccountsSub.replace('{year}', String(acc.year)).replace('{name}', acc.name || acc.orgnr) : '';

  const showMismatch = !!acc && showSaved && status.match === 'mismatch';
  const showFitted = !!acc && showSaved && status.basis === 'accounts';
  const fitButton = (
    <Button variant={showMismatch ? 'primary' : 'secondary'} disabled={blocker != null} onClick={() => runFit(false)}>{c.accountsCalibrate}</Button>
  );
  const fitHint = (
    <>
      <p className="mt-2 text-[12px]" style={muted}>{blocker ? failText[blocker] : c.accountsCalibrateHint}</p>
      {fitError && <p role="status" data-testid="accounts-fit" className="mt-2 text-[12px]" style={{ color: 'var(--negative)' }}>{failText[fitError]}</p>}
    </>
  );

  return (
    <Card padding="lg" id={ACCOUNTS_CARD_ANCHOR} className="scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <SectionLabel>① {c.accountsTitle}</SectionLabel>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>{c.accountsOptional}</span>
        </div>
        <span className="text-[12px] font-mono" style={{ color: 'var(--brass)' }}>
          {acc ? c.accountsRun.replace('{year}', String(acc.year)) : c.accountsNotFetched}
        </span>
      </div>

      {showMismatch && cmp && acc && (
        <div role="status" data-testid="accounts-mismatch" className="mt-4 flex gap-3 items-start rounded-[8px] border px-4 py-3.5" style={{ borderColor: 'var(--negative)', background: 'var(--negative-bg)' }}>
          <AlertTriangle size={18} aria-hidden className="shrink-0 mt-0.5" style={{ color: 'var(--negative)' }} />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>{c.accountsMismatchTitle}</p>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--text-2)' }}>
              {c.accountsMismatchBody
                .replace('{model}', mill(cmp.operatingResult.model, 'kr'))
                .replace('{accounts}', mill(cmp.operatingResult.accounts, 'kr'))
                .replace('{year}', String(acc.year))}
            </p>
            <div className="mt-3">{fitButton}</div>
            {fitHint}
          </div>
        </div>
      )}
      {showFitted && acc && (
        <div role="status" data-testid="accounts-fitted" className="mt-4 flex gap-3 items-start rounded-[8px] border px-4 py-3.5" style={{ borderColor: 'var(--positive)', background: 'var(--positive-bg)' }}>
          <Check size={18} aria-hidden className="shrink-0 mt-0.5" style={{ color: 'var(--positive)' }} />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>{c.accountsFittedTitle.replace('{year}', String(acc.year))}</p>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--text-2)' }}>
              {(['salary', 'typicalBillablePct'] as const).flatMap((k) => (acc.fitMoves ?? []).filter((m) => m.key === k)).map(moveText).join(' ')}{' '}
              {c.accountsFitProof}{' '}
              <Link to={`/settings#${RESTORE_POINTS_ANCHOR}`} className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>{c.accountsFitUndo}</Link>
            </p>
          </div>
        </div>
      )}

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
          <table className="w-full text-[11px] sm:text-[13px] tabular-nums" data-testid="accounts-table">
            <thead>
              <tr className="align-bottom">
                <th className="hidden sm:table-cell text-left pb-2"><span className="sr-only">{c.accountsCompareRow}</span></th>
                <th className="text-right font-semibold pb-2 pt-2 px-1.5 sm:px-3 rounded-t-[6px]" style={GUESS_TINT}>
                  <BasisTag fact={false}>{c.accountsBadgeGuess}</BasisTag>
                  <span className="hidden sm:block mt-1 text-[11px] font-normal" style={muted}>{modelSub}</span>
                </th>
                <th className="text-right font-semibold pb-2 pt-2 px-1.5 sm:px-3 rounded-t-[6px]" style={FACT_TINT}>
                  <BasisTag fact>{c.accountsBadgeFact}</BasisTag>
                  <span className="hidden sm:block mt-1 text-[11px] font-normal [overflow-wrap:anywhere]" style={muted}>{accountsSub}</span>
                </th>
                <th className="text-right font-semibold pb-2 pl-1.5 sm:pl-3 text-[11px] uppercase tracking-[0.08em]" style={muted}>{c.accountsColDiff}</th>
              </tr>
            </thead>
            {rows.map((row) => {
              const label = (
                <>
                  {row.label}
                  {row.sub && <span className="block text-[11px] font-normal" style={muted}>{row.sub}</span>}
                </>
              );
              return (
                <tbody key={row.key}>
                  {/* A phone puts the label on its own line, so the three numbers fit beside each other. */}
                  <tr className="sm:hidden border-t" style={{ borderColor: 'var(--rule)' }}>
                    <td colSpan={3} className="pt-2" style={{ color: 'var(--text-2)' }}>{label}</td>
                  </tr>
                  <tr className="sm:border-t" style={{ borderColor: 'var(--rule)' }}>
                    <td className="hidden sm:table-cell py-2.5 pr-3" style={{ color: 'var(--text-2)' }}>{label}</td>
                    <td className="py-1.5 sm:py-2.5 px-1.5 sm:px-3 text-right font-mono whitespace-nowrap" style={GUESS_TINT}>{row.model}</td>
                    <td className="py-1.5 sm:py-2.5 px-1.5 sm:px-3 text-right font-mono whitespace-nowrap" style={FACT_TINT}>{row.accounts}</td>
                    <td className="py-1.5 sm:py-2.5 pl-1.5 sm:pl-3 text-right font-mono whitespace-nowrap" style={{ color: row.diff.color }}>{row.diff.text}</td>
                  </tr>
                </tbody>
              );
            })}
          </table>
          {/* The column sources, on a phone where the headers are too narrow for them. */}
          <dl className="sm:hidden mt-3 space-y-1 text-[11px]" style={muted}>
            <div><dt className="inline"><BasisTag fact={false}>{c.accountsBadgeGuess}</BasisTag></dt> <dd className="inline">{modelSub}</dd></div>
            <div><dt className="inline"><BasisTag fact>{c.accountsBadgeFact}</BasisTag></dt> <dd className="inline [overflow-wrap:anywhere]">{accountsSub}</dd></div>
          </dl>
          <p className="mt-3 text-[12px]" style={muted}>{c.accountsTolerance}</p>

          <ul className="mt-4 space-y-1.5 text-[12px] list-disc pl-5" style={{ color: 'var(--text-2)' }} data-testid="accounts-warnings">
            {accountsWarnings(acc).map((w) => <li key={w} data-warning={w}>{warningText(w)}</li>)}
          </ul>

          {!showMismatch && !showFitted && (
            <>
              <div className="mt-5">{fitButton}</div>
              {fitHint}
            </>
          )}
        </div>
      )}
      {confirming && (
        <ConfirmModal
          title={c.quickConfirmTitle}
          message={c.quickConfirmMsg}
          confirmLabel={c.quickConfirm}
          cancelLabel={t.cancel}
          onConfirm={() => runFit(true)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Card>
  );
}
