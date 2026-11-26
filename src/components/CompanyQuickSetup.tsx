import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useFinance } from '../context/FinanceContext';
import { calcCompany, isBenchGroup, leaveRefundCap, quickReplacesHandEdits, type CompanyContext, type CompanyModel } from '../lib/companyCost';
import {
  buildModelFromAnswers, quickMeanSalary, QUICK_DEFAULTS, QUICK_KR_PER_TRIP, QUICK_KR_EVENTS,
  type OfficeMode, type QuickAnswers, type QuickGuessKey,
} from '../lib/companySetup';
import { answersFromModel } from '../lib/companyQuickFromModel';
import { NumberRow } from './ui/NumberRow';
import { BlockChip, FoldBlock, Gives, GivesNum } from './CompanyBlocks';
import { fill, useBlockNav } from './companyBlockNav';
import { Button } from './ui/Button';
import { SegmentedControl } from './ui/SegmentedControl';
import ConfirmModal from './ConfirmModal';

interface Draft {
  answers: QuickAnswers;
  uncertain: QuickGuessKey[];
  dontKnow: QuickGuessKey[];
}

type NumberKey = { [K in keyof QuickAnswers]-?: QuickAnswers[K] extends number | undefined ? K : never }[keyof QuickAnswers];

/** The answers each "vet ikke" resets to the industry value. An unknown office is one desk per FTE. */
const DEFAULT_FIELDS: Record<QuickGuessKey, (keyof QuickAnswers)[]> = {
  salary: ['salaryLow', 'salaryHigh'],
  rateAverage: ['rateAverage'],
  ownBillablePct: ['ownBillablePct'],
  typicalBillablePct: ['typicalBillablePct'],
  realizationPct: ['realizationPct'],
  office: ['officeMode'],
};

/** A draft in one order, so two drafts with the same content compare equal. */
const draftKey = (d: Draft) => JSON.stringify([
  Object.entries(d.answers).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)),
  [...d.uncertain].sort(),
  [...d.dontKnow].sort(),
]);

/**
 * "2 Hurtigoppsett": eleven plain questions that build the company model's groups
 * and cost lines (buildModelFromAnswers in src/lib/companySetup.ts). The form
 * edits a local draft; "Bruk svarene" writes the model. After a hand edit of
 * groups or cost lines it asks first, because the rebuild replaces them.
 * Each question says its unit and what the answer gives, from the draft.
 */
export function CompanyQuickSetup({ model, setModel, ctx, askResale = 0 }: {
  model: CompanyModel;
  setModel: Dispatch<SetStateAction<CompanyModel>>;
  ctx: CompanyContext;
  /** A count that goes up each time the accounts card asks for the resale question. */
  askResale?: number;
}) {
  const { t, lang, billingConfig, formatCurrencyShort: kr } = useFinance();
  const nav = useBlockNav();
  const c = t.companyModel;
  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';
  const nf = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1 });

  const saved = model.quick;
  // No saved setup: the answers are read from the model the page uses, so the form and its "Gir" lines describe it.
  // Your rate: your own in the model, else the calculator's billed rate when it is set, as before.
  const derived = useMemo(() => {
    if (saved) return null;
    const a = answersFromModel(model);
    return model.self?.hourlyRate == null && billingConfig.billedHourly != null ? { ...a, rateYou: billingConfig.billedHourly } : a;
  }, [saved, model, billingConfig.billedHourly]);
  const fromModel = (): Draft => saved
    ? { answers: saved.answers, uncertain: saved.uncertain, dontKnow: saved.dontKnow }
    : { answers: derived ?? QUICK_DEFAULTS, uncertain: [], dontKnow: [] };
  const [draft, setDraft] = useState<Draft>(fromModel);
  // A change from outside (undo, chat) shows the stored answers again. A hand edit (`edited`) does not reset the form,
  // but without a saved setup the form follows the model.
  const savedKey = saved ? draftKey(saved) : `model:${JSON.stringify(derived)}`;
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(fromModel()); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [confirming, setConfirming] = useState(false);
  const dirty = !saved || draftKey(draft) !== savedKey;
  // Open the block and bring the resale question into view when the accounts card asks for it.
  const open = nav?.isOpen('quick') ?? true;
  // The last ask that has been scrolled to, so a later open of the block does not scroll again.
  const handledAsk = useRef(0);
  useEffect(() => { if (askResale > 0) nav?.setOpen('quick', true); }, [askResale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (askResale === 0 || !open || handledAsk.current === askResale) return;
    handledAsk.current = askResale;
    const el = document.getElementById('quick-resale');
    el?.scrollIntoView({ block: 'center' });
    el?.querySelector('input')?.focus({ preventScroll: true });
  }, [askResale, open]);

  const a = draft.answers;
  // The draft keeps what was typed; buildModelFromAnswers and the sanitizer clamp it.
  const setAnswer = <K extends keyof QuickAnswers>(key: K, value: QuickAnswers[K], guess?: QuickGuessKey) =>
    setDraft((d) => ({
      ...d,
      answers: { ...d.answers, [key]: value },
      // A typed answer is no longer the industry value.
      dontKnow: guess ? d.dontKnow.filter((k) => k !== guess) : d.dontKnow,
    }));
  const clearDesks = () => setDraft((d) => {
    const { desks: _desks, ...rest } = d.answers;
    return { ...d, answers: rest };
  });
  const toggleUncertain = (k: QuickGuessKey) => setDraft((d) => ({
    ...d,
    uncertain: d.uncertain.includes(k) ? d.uncertain.filter((x) => x !== k) : [...d.uncertain, k],
    dontKnow: d.dontKnow.filter((x) => x !== k),
  }));
  const toggleDontKnow = (k: QuickGuessKey) => setDraft((d) => {
    if (d.dontKnow.includes(k)) return { ...d, dontKnow: d.dontKnow.filter((x) => x !== k) };
    const answers: QuickAnswers = { ...d.answers, ...Object.fromEntries(DEFAULT_FIELDS[k].map((f) => [f, QUICK_DEFAULTS[f]])) };
    if (k === 'office') delete answers.desks;
    return { answers, uncertain: d.uncertain.filter((x) => x !== k), dontKnow: [...d.dontKnow, k] };
  });

  // Hand edits: flagged on the quick setup, or (before any quick setup) groups and costs that differ from the example.
  const handEdited = quickReplacesHandEdits(model);
  const apply = () => {
    setModel((m) => buildModelFromAnswers(draft.answers, m, {
      uncertain: draft.uncertain,
      dontKnow: draft.dontKnow,
      labels: c.quickLabels,
    }));
    setConfirming(false);
    nav?.setOpen('quick', false);
  };

  // What the draft gives: the model it would build, run once per draft.
  const preview = useMemo(() => calcCompany(buildModelFromAnswers(draft.answers, model), ctx), [draft.answers, model, ctx]);
  const groupOf = (id: string) => preview.groups.find((g) => g.id === id);

  // The header shows the saved model, not the draft.
  const sumCount = (f: (g: CompanyModel['groups'][number]) => boolean) => model.groups.filter(f).reduce((s, g) => s + g.count, 0);
  const guesses = saved ? new Set([...saved.uncertain, ...saved.dontKnow]).size : 0;
  const run = c.quickRun
    .replace('{fte}', nf(sumCount(() => true) + (model.leave?.count ?? 0)))
    .replace('{delivery}', nf(sumCount((g) => g.kind === 'delivery')))
    .replace('{bench}', nf(sumCount((g) => g.kind === 'support' && isBenchGroup(g))))
    .replace('{leave}', nf(model.leave?.count ?? 0));
  const gives = (text: string, values: Record<string, string>) => (
    <Gives>
      {c.givesPrefix}{' '}
      {fill(text, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, <GivesNum>{v}</GivesNum>])))}
    </Gives>
  );
  const kons = groupOf('kons');
  const benkCost = groupOf('benk')?.costPerFte ?? 0;
  const led = groupOf('led');

  const flags = (k: QuickGuessKey, name: string) => (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Chip on={draft.uncertain.includes(k)} onClick={() => toggleUncertain(k)} label={`${c.quickUncertain}: ${name}`}>{c.quickUncertain}</Chip>
      <Chip on={draft.dontKnow.includes(k)} onClick={() => toggleDontKnow(k)} label={`${c.quickDontKnow}: ${name}`}>{c.quickDontKnow}</Chip>
      {draft.dontKnow.includes(k) && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--warning-bg)', color: 'var(--brass)' }}>{c.quickIndustry}</span>
      )}
    </span>
  );
  const field = (label: string, key: NumberKey, suffix: string, guess?: QuickGuessKey) => (
    <NumberRow label={label} value={a[key] ?? 0} onCommit={(v) => setAnswer(key, v, guess)} suffix={suffix} />
  );

  const questions: Array<{ q: string; body: ReactNode; id?: string }> = [
    {
      q: c.q1,
      body: (
        <>
          <Hint>{c.hintFte}</Hint>
          {field(c.quickFte, 'totalFte', c.unitFte)}
          {gives(c.givesFte, { fte: nf(preview.heads) })}
        </>
      ),
    },
    {
      q: c.q2,
      body: (
        <>
          <Hint>{c.hintNonBilling}</Hint>
          {field(c.quickFte, 'nonBilling', c.unitFte)}
          {gives(c.givesNonBilling, { n: nf(a.nonBilling), cost: kr(led?.costPerFte ?? 0), gross: kr(led?.avgGross ?? 0) })}
        </>
      ),
    },
    {
      q: c.q3,
      body: (
        <>
          <Hint>{c.hintBench}</Hint>
          {field(c.quickFte, 'onBench', c.unitFte)}
          {gives(c.givesBench, { n: nf(a.onBench), cost: kr(benkCost) })}
        </>
      ),
    },
    {
      q: c.qLeave,
      body: (
        <>
          <Hint>{c.leaveHint}</Hint>
          {field(c.leaveCount, 'onLeave', c.unitFte)}
          <label className="mt-3 inline-flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
            <input
              type="checkbox"
              checked={a.leaveFullPay ?? true}
              onChange={(e) => setAnswer('leaveFullPay', e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            {c.leaveFullPay}
          </label>
          {(a.leaveFullPay ?? true)
            ? gives(c.leaveGivesFull, { cap: kr(leaveRefundCap(ctx.year)), cost: kr(preview.leave.costPerFte) })
            : gives(c.leaveGivesNav, {})}
        </>
      ),
    },
    {
      q: c.q4,
      body: (
        <>
          <Hint>{c.hintSalary}</Hint>
          <div className="grid grid-cols-2 gap-3">
            {field(c.quickLow, 'salaryLow', t.common.krPerYear, 'salary')}
            {field(c.quickHigh, 'salaryHigh', t.common.krPerYear, 'salary')}
          </div>
          <div className="mt-2">{flags('salary', c.q4)}</div>
          <Hint>{c.quickSalaryHint.replace('{mean}', Math.round(quickMeanSalary(a)).toLocaleString(locale))}</Hint>
          {gives(c.givesSalary, { cost: kr(kons?.costPerFte ?? 0) })}
        </>
      ),
    },
    {
      q: c.q5,
      body: (
        <>
          <Hint>{c.hintRate}</Hint>
          <div className="grid grid-cols-2 gap-3">
            {field(c.quickAverage, 'rateAverage', `kr/${t.common.hourUnit}`, 'rateAverage')}
            {field(c.quickYours, 'rateYou', `kr/${t.common.hourUnit}`)}
          </div>
          <div className="mt-2">{flags('rateAverage', `${c.q5} (${c.quickAverage})`)}</div>
          {gives(c.givesRate, { revenue: kr(kons?.revenuePerFte ?? 0) })}
        </>
      ),
    },
    {
      q: c.q6,
      body: (
        <>
          <Hint>{c.hintBillable.replace('{available}', nf(Math.round(preview.hours.available)))}</Hint>
          <div className="grid grid-cols-2 gap-3">
            <div>{field(c.quickYou, 'ownBillablePct', '%', 'ownBillablePct')}<div className="mt-2">{flags('ownBillablePct', `${c.q6} (${c.quickYou})`)}</div></div>
            <div>{field(c.quickTypical, 'typicalBillablePct', '%', 'typicalBillablePct')}<div className="mt-2">{flags('typicalBillablePct', `${c.q6} (${c.quickTypical})`)}</div></div>
          </div>
          {gives(c.givesBillable2, {
            you: nf(Math.round(preview.hours.available * a.ownBillablePct / 100)),
            typical: nf(Math.round(kons?.billableHours ?? 0)),
          })}
        </>
      ),
    },
    {
      q: c.q7,
      body: (
        <>
          {field(c.quickRealization, 'realizationPct', '%', 'realizationPct')}
          <div className="mt-2">{flags('realizationPct', c.q7)}</div>
          <Hint>{c.quickRealizationHint}</Hint>
          {gives(c.givesRealization, { pct: nf(a.realizationPct) })}
        </>
      ),
    },
    {
      q: c.q8,
      body: (
        <>
          <Hint>{c.hintBonus}</Hint>
          {field(c.quickBonus, 'bonusPct', '%')}
          {gives(c.givesBonus, { bonus: kr(preview.bonus) })}
        </>
      ),
    },
    {
      q: c.q9,
      body: (
        <>
          <SegmentedControl<OfficeMode>
            ariaLabel={c.quickOfficeMode}
            value={a.officeMode}
            onChange={(v) => setAnswer('officeMode', v, 'office')}
            items={[{ value: 'desks', label: c.quickDesks }, { value: 'rent', label: c.quickRent }]}
          />
          <div className="mt-3 grid grid-cols-2 gap-3">
            {a.officeMode === 'desks'
              ? (
                // Empty: one desk per FTE, shown as the placeholder.
                <NumberRow
                  label={c.quickDesks}
                  value={a.desks ?? null}
                  placeholder={nf(a.totalFte)}
                  onCommit={(v) => setAnswer('desks', v, 'office')}
                  onBlank={clearDesks}
                  suffix={c.unitDesks}
                />
              )
              : field(c.quickRent, 'annualRent', t.common.krPerYear, 'office')}
            {field(c.quickTrips, 'tripsPerYear', c.unitPerYear)}
          </div>
          <div className="mt-2">{flags('office', c.q9)}</div>
          {gives(c.givesOffice, {
            office: kr(preview.lines.find((l) => l.id === 'office')?.total ?? 0),
            trips: kr(a.tripsPerYear * QUICK_KR_PER_TRIP + QUICK_KR_EVENTS),
          })}
        </>
      ),
    },
    {
      q: c.q10,
      id: 'quick-resale',
      body: (
        <>
          <NumberRow label={c.quickResale} value={a.resaleSharePct ?? 0} onCommit={(v) => setAnswer('resaleSharePct', v)} suffix="%" />
          <Hint>{c.quickResaleHint}</Hint>
        </>
      ),
    },
  ];

  return (
    <FoldBlock
      id="quick"
      n={2}
      title={c.quickTitle}
      chip={guesses > 0 ? <BlockChip tone="warning">{c.chipGuesses.replace('{n}', String(guesses))}</BlockChip> : undefined}
      summary={run}
    >
      <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{c.quickIntro}</p>
      {!saved && <p className="mt-2 text-[12px]" style={{ color: 'var(--text-2)' }}>{c.quickFromModel}</p>}
      <ol className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        {questions.map((q, i) => (
          <li key={i} id={q.id} className="rounded-[8px] px-4 py-4 flex gap-3 min-w-0 scroll-mt-24" style={{ background: 'var(--surface-2)' }}>
            <span
              aria-hidden
              className="shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-[11px] font-mono"
              style={{ background: 'var(--surface-5)', color: 'var(--text-2)' }}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-1)' }}>{q.q}</div>
              {q.body}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{handEdited ? c.quickApplyEditedHint : c.quickApplyHint}</p>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-[12px] font-semibold" style={{ color: 'var(--warning)' }}>{c.quickNotSaved}</span>}
          <Button variant="primary" onClick={() => (handEdited ? setConfirming(true) : apply())}>{c.quickApply}</Button>
        </div>
      </div>
      {confirming && (
        <ConfirmModal
          title={c.quickConfirmTitle}
          message={c.quickConfirmMsg}
          confirmLabel={c.quickConfirm}
          cancelLabel={t.cancel}
          onConfirm={apply}
          onCancel={() => setConfirming(false)}
        />
      )}
    </FoldBlock>
  );
}

function Chip({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className="h-6 pointer-coarse:h-8 px-2.5 rounded-full text-[11px] border transition-colors"
      style={on
        ? { background: 'var(--text-2)', borderColor: 'var(--text-2)', color: 'var(--bg-page)', fontWeight: 600 }
        : { background: 'transparent', borderColor: 'var(--border)', color: 'var(--text-3)' }}
    >
      {children}
    </button>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-2 mb-3 first:mt-0 text-[12px]" style={{ color: 'var(--text-3)' }}>{children}</p>;
}
