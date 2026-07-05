import { useId, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Check, FileText, Loader2, Maximize2, Upload, X } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { parsePayslip, parsePayslipAmount, PROVIDERS, type ParsedPayslip } from '../lib/payslip';

/** One editable payslip row. Figure fields are strings so any misparse can be
 * corrected before importing. In single-payslip mode all fields show; in batch
 * mode only net is editable inline (the rest are stored from the parse). */
interface Row {
  pageIndex: number;
  employer: string;
  month: string;
  net: string;
  gross: string;
  tax: string;
  base: string;
  holidayPay: string;
  include: boolean;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'error'; message: string }
  | { kind: 'review' };

const toInput = (n: number | null | undefined): string => (n == null ? '' : String(n).replace('.', ','));
const toNumber = (s: string): number => (s.trim() === '' ? NaN : parsePayslipAmount(s));
const numOr0 = (s: string): number => { const n = toNumber(s); return Number.isNaN(n) ? 0 : n; };

/** Dedupe payslips that share a month, keeping the one with the highest net
 * (an archive can contain a real run and a 0,00 void run for the same month). */
function dedupeByMonth(items: { parsed: ParsedPayslip; pageIndex: number }[]) {
  const byMonth = new Map<string, { parsed: ParsedPayslip; pageIndex: number }>();
  const noMonth: { parsed: ParsedPayslip; pageIndex: number }[] = [];
  for (const it of items) {
    const key = it.parsed.period;
    if (!key) { noMonth.push(it); continue; }
    const cur = byMonth.get(key);
    if (!cur || (it.parsed.net ?? -Infinity) > (cur.parsed.net ?? -Infinity)) byMonth.set(key, it);
  }
  return [...byMonth.values(), ...noMonth];
}

/**
 * Import Visma payslips into the budget — a single month or a whole archive.
 * The PDF is parsed entirely in the browser (see extractPayslipPages); its bytes
 * are never uploaded, persisted, or added to app state. Parsed figures pre-fill
 * editable rows the user can correct, a rendered page lets them validate against
 * the document, and on confirm each month's figures are stored via `setPayslip`
 * with that month's budget income set to the net pay via `setMonthlyIncomeForMonth`.
 */
export default function PayslipImportModal({ onClose }: { onClose: () => void }) {
  const { t, payslips, setPayslip, setMonthlyIncomeForMonth } = useFinance();
  const im = t.salary.importPayslip;

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [providerId, setProviderId] = useState<string>(PROVIDERS[0].id);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [singleThumb, setSingleThumb] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ pageIndex: number; url: string | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Modal trap stays active; the lightbox has its own trap that holds focus, so
  // Escape there closes the preview first (not the whole modal).
  const dialogRef = useFocusTrap<HTMLDivElement>(onClose);
  const lightboxRef = useFocusTrap<HTMLDivElement>(() => setPreview(null), undefined, preview !== null);
  const titleId = useId();

  const single = rows.length === 1;

  const handleFile = async (f: File) => {
    setFile(f);
    setSingleThumb(null);
    setPhase({ kind: 'parsing' });
    try {
      const { extractPayslipPages, renderPdfPage } = await import('../lib/payslip/extractPdfText');
      const pages = await extractPayslipPages(f);
      const parsed = pages
        .map((lines, pageIndex) => ({ parsed: parsePayslip(lines, providerId), pageIndex }))
        .filter((x): x is { parsed: ParsedPayslip; pageIndex: number } => x.parsed !== null);
      if (parsed.length === 0) {
        setPhase({ kind: 'error', message: im.parseError });
        return;
      }
      const newRows: Row[] = dedupeByMonth(parsed)
        .map(({ parsed: p, pageIndex }) => ({
          pageIndex,
          employer: p.employer,
          month: p.period ?? '',
          net: toInput(p.net),
          gross: toInput(p.gross),
          tax: toInput(p.taxWithheld),
          base: toInput(p.monthlySalary),
          holidayPay: toInput(p.holidayPayThisYear),
          include: true,
        }))
        .sort((a, b) => b.month.localeCompare(a.month));
      setRows(newRows);
      setPhase({ kind: 'review' });
      // Eagerly render the thumbnail only for a single payslip (cheap).
      if (newRows.length === 1) {
        void renderPdfPage(f, newRows[0].pageIndex).then(setSingleThumb);
      }
    } catch {
      setPhase({ kind: 'error', message: im.readError });
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const openPreview = async (pageIndex: number) => {
    if (!file) return;
    setPreview({ pageIndex, url: null });
    const { renderPdfPage } = await import('../lib/payslip/extractPdfText');
    const url = await renderPdfPage(file, pageIndex);
    setPreview(p => (p && p.pageIndex === pageIndex ? { pageIndex, url } : p));
  };

  const validRows = rows.filter(r => r.include && r.month.length > 0 && !Number.isNaN(toNumber(r.net)));

  const doImport = () => {
    for (const r of validRows) {
      const net = toNumber(r.net);
      const holiday = toNumber(r.holidayPay);
      setPayslip(r.month, {
        gross: numOr0(r.gross),
        net,
        tax: numOr0(r.tax),
        base: numOr0(r.base),
        holidayPay: Number.isNaN(holiday) ? undefined : holiday,
      });
      // Net pay is the real take-home — overwrite the month's budget income.
      setMonthlyIncomeForMonth(r.month, net);
    }
    onClose();
  };

  const figureInput = (i: number, key: keyof Row, label: string) => (
    <label className="block">
      <span className="text-[11px] font-medium text-[var(--text-2)]">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={rows[i][key] as string}
        onChange={e => updateRow(i, { [key]: e.target.value })}
        className="mt-1 w-full h-9 px-2 rounded-[6px] text-[13px] font-mono tabular-nums bg-[var(--bg-elev)] border border-[var(--border)] text-[var(--text-1)]"
      />
    </label>
  );

  // ── Single-payslip detailed editor ──────────────────────────────
  const renderSingle = () => {
    const r = rows[0];
    const net = toNumber(r.net);
    const canImport = !Number.isNaN(net) && r.month.length > 0;
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--text-2)' }}>
          <span className="font-semibold text-[var(--text-1)]">{r.employer}</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ color: 'var(--accent)', background: 'var(--accent-bg)' }}>Visma</span>
        </div>

        {singleThumb && (
          <button
            type="button"
            onClick={() => openPreview(r.pageIndex)}
            className="group relative block w-full overflow-hidden rounded-[6px] border border-[var(--border)]"
            aria-label={im.clickToEnlarge}
          >
            <img src={singleThumb} alt={im.preview} className="w-full max-h-40 object-cover object-top" />
            <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-white opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.45)' }}>
              <Maximize2 size={14} /> {im.clickToEnlarge}
            </span>
          </button>
        )}

        <div className="p-3 rounded-[6px] border border-[var(--border)] space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={r.net}
              onChange={e => updateRow(0, { net: e.target.value })}
              className="flex-1 min-w-0 h-10 px-2 rounded-[6px] text-[15px] font-semibold font-mono tabular-nums bg-[var(--bg-elev)] border border-[var(--border)] text-[var(--text-1)]"
            />
            <span className="text-[13px] text-[var(--text-2)] shrink-0">kr</span>
          </div>
          <div className="text-[11px]" style={{ color: canImport ? 'var(--text-2)' : 'var(--negative)' }}>
            {canImport ? im.setsIncome : im.noNetFound}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)]">{im.month}</span>
            <input
              type="text"
              value={r.month}
              placeholder="2026-06"
              onChange={e => updateRow(0, { month: e.target.value })}
              className="mt-1 w-full h-9 px-2 rounded-[6px] text-[13px] font-mono tabular-nums bg-[var(--bg-elev)] border border-[var(--border)] text-[var(--text-1)]"
            />
          </label>
          {figureInput(0, 'gross', im.extraGross)}
          {figureInput(0, 'tax', im.extraTax)}
          {figureInput(0, 'base', im.extraBase)}
          {figureInput(0, 'holidayPay', im.extraHolidayPay)}
        </div>

        {r.month.length > 0 && payslips[r.month] && (
          <p className="text-[12px]" style={{ color: 'var(--warning)' }}>{im.overwriteNote}</p>
        )}

        {footer(canImport)}
      </div>
    );
  };

  // ── Batch archive list ──────────────────────────────────────────
  const renderBatch = () => {
    const allOn = rows.every(r => r.include);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
            <span className="font-semibold text-[var(--text-1)]">{rows.length}</span> {im.payslipsFound}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ color: 'var(--accent)', background: 'var(--accent-bg)' }}>Visma</span>
          </div>
          <button
            onClick={() => setRows(rs => rs.map(r => ({ ...r, include: !allOn })))}
            className="text-[11px] font-semibold text-[var(--accent)]"
          >
            {allOn ? im.deselectAll : im.selectAll}
          </button>
        </div>

        <div className="max-h-[46vh] overflow-y-auto -mx-1 px-1 divide-y divide-[var(--border)]">
          {rows.map((r, i) => (
            <div key={r.pageIndex} className="flex items-center gap-2 py-2">
              <input
                type="checkbox"
                checked={r.include}
                onChange={e => updateRow(i, { include: e.target.checked })}
                className="accent-[var(--accent)] shrink-0"
                aria-label={r.month}
              />
              <div className="w-[64px] shrink-0 text-[12px] font-mono tabular-nums text-[var(--text-1)]">{r.month}</div>
              <div className="flex-1 min-w-0 text-[11px] truncate" style={{ color: 'var(--text-3)' }}>{r.employer}</div>
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="text"
                  inputMode="decimal"
                  value={r.net}
                  onChange={e => updateRow(i, { net: e.target.value })}
                  disabled={!r.include}
                  className="w-[92px] h-8 px-2 rounded-[6px] text-[12px] text-right font-mono tabular-nums bg-[var(--bg-elev)] border border-[var(--border)] text-[var(--text-1)] disabled:opacity-40"
                />
                <span className="text-[11px] text-[var(--text-3)]">kr</span>
              </div>
              <button
                onClick={() => openPreview(r.pageIndex)}
                className="p-1.5 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-elev)] transition-colors shrink-0"
                aria-label={`${im.view} ${r.month}`}
              >
                <Maximize2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{im.setsIncome}</p>

        {footer(validRows.length > 0)}
      </div>
    );
  };

  const footer = (canImport: boolean) => (
    <div className="flex gap-2 pt-1">
      <button
        onClick={onClose}
        className="flex-1 py-2.5 rounded-[6px] text-[13px] font-medium text-[var(--text-2)] bg-[var(--bg-elev)] hover:bg-[var(--bg-raised)] transition-colors"
      >
        {t.cancel}
      </button>
      <button
        onClick={doImport}
        disabled={!canImport}
        className="flex-1 py-2.5 rounded-[6px] text-[13px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {single ? im.importAction : `${im.importAction} (${validRows.length})`}
      </button>
    </div>
  );

  const content = (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full sm:w-auto ${phase.kind === 'review' && !single ? 'sm:min-w-[520px] sm:max-w-lg' : 'sm:min-w-[400px] sm:max-w-md'} bg-[var(--bg-card)] rounded-t-[8px] sm:rounded-[8px] p-6 space-y-5 border border-[var(--border)] max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-[var(--accent)]" />
            <h3 id={titleId} className="text-[14px] font-semibold text-[var(--text-1)]">{im.title}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label={t.cancel}
            className="p-1 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-elev)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {phase.kind === 'idle' && (
          <>
            <p className="text-[13px] text-[var(--text-2)] leading-relaxed">{im.intro}</p>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{im.supports}</p>

            {/* Payroll-provider picker — driven by the registry so new providers
                appear automatically. One available today (Visma), pre-selected. */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium" style={{ color: 'var(--text-2)' }}>{im.providerLabel}</div>
              <div role="radiogroup" aria-label={im.providerLabel} className="space-y-1.5">
                {PROVIDERS.map(p => {
                  const selected = p.id === providerId;
                  return (
                    <button
                      key={p.id}
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setProviderId(p.id)}
                      className="w-full flex items-center justify-between px-3 h-10 rounded-[6px] text-[13px] font-medium border transition-colors"
                      style={{
                        color: selected ? 'var(--accent)' : 'var(--text-1)',
                        background: selected ? 'var(--accent-bg)' : 'var(--bg-elev)',
                        borderColor: selected ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border)',
                      }}
                    >
                      {p.name}
                      {selected && <Check size={15} />}
                    </button>
                  );
                })}
                <div className="px-3 h-9 flex items-center rounded-[6px] text-[12px] border border-dashed" style={{ color: 'var(--text-3)', borderColor: 'var(--border)' }}>
                  {im.moreProviders}
                </div>
              </div>
            </div>

            <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={onPick} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-[6px] text-[13px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-colors"
            >
              <Upload size={14} /> {im.chooseFile}
            </button>
          </>
        )}

        {phase.kind === 'parsing' && (
          <div className="flex items-center gap-2 py-6 justify-center text-[13px] text-[var(--text-2)]">
            <Loader2 size={16} className="animate-spin" /> {im.parsing}
          </div>
        )}

        {phase.kind === 'error' && (
          <>
            <p className="text-[13px] text-[#B5533A] leading-relaxed">{phase.message}</p>
            <button
              onClick={() => setPhase({ kind: 'idle' })}
              className="w-full py-2.5 rounded-[6px] text-[13px] font-medium text-[var(--text-2)] bg-[var(--bg-elev)] hover:bg-[var(--bg-raised)] transition-colors"
            >
              {im.chooseFile}
            </button>
          </>
        )}

        {phase.kind === 'review' && (single ? renderSingle() : renderBatch())}
      </div>

      {/* Full-size preview lightbox — own focus trap so Escape closes it first */}
      {preview && (
        <div
          ref={lightboxRef}
          role="dialog"
          aria-modal="true"
          aria-label={im.preview}
          className="fixed inset-0 z-[60] bg-black/85 flex flex-col items-center overflow-y-auto p-4 sm:p-8"
          onClick={() => setPreview(null)}
        >
          <button
            onClick={() => setPreview(null)}
            aria-label={im.closePreview}
            className="self-end sticky top-0 p-2 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
          <div className="flex flex-col gap-4 items-center" onClick={e => e.stopPropagation()}>
            {preview.url ? (
              <img src={preview.url} alt={im.preview} className="max-w-full sm:max-w-2xl rounded-[4px] shadow-lg" />
            ) : (
              <div className="flex items-center gap-2 text-[13px] text-white/80 py-10">
                <Loader2 size={16} className="animate-spin" /> {im.loadingPreview}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
