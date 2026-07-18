import { useState, createElement } from 'react';
import { Link } from 'react-router-dom';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { Home, Plus, Edit2, Trash2, Clock, Building2, Building, Warehouse, TreePine, MapPin, type LucideIcon } from 'lucide-react';
import { useFinance, type Residence, type PropertyType, type DwellingType } from '../context/FinanceContext';
import EditModal, { type ModalField } from './EditModal';
import { parseLocaleNumber } from '../lib/validators';
import { normalizeMonthOrDay } from '../lib/dateInput';
import { currentResidence, residenceMetrics, sortResidences } from '../lib/property';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';

const num = (s: string): number | undefined => {
  const n = parseLocaleNumber(s);
  return isNaN(n) ? undefined : n;
};

/** Format a 'YYYY-MM' or 'YYYY-MM-DD' key for display, showing the day when set. */
function useDateFormatter() {
  const { lang } = useFinance();
  const locale = lang === 'nb' ? nb : enUS;
  return (key?: string | null): string => {
    if (!key) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return format(parse(key, 'yyyy-MM-dd', new Date()), 'd. MMM yyyy', { locale });
    return format(parse(key.slice(0, 7), 'yyyy-MM', new Date()), 'MMM yyyy', { locale });
  };
}

function useTypeOptions() {
  const { t } = useFinance();
  const lp = t.loanPage;
  const options = [
    { value: 'selveier', label: lp.typeSelveier },
    { value: 'borettslag', label: lp.typeBorettslag },
    { value: 'aksjeleilighet', label: lp.typeAksje },
    { value: 'other', label: lp.typeOther },
  ];
  return { options, label: (ty?: PropertyType) => options.find(o => o.value === ty)?.label };
}

// Boligtype → icon. The label carries the meaning; the icon is a quick visual cue.
const DWELLING_ICONS: Record<DwellingType, LucideIcon> = {
  leilighet: Building2,
  enebolig: Home,
  rekkehus: Warehouse,
  tomannsbolig: Building,
  hytte: TreePine,
  other: MapPin,
};

/** Renders the icon for a dwelling type (module-level so it's a stable component). */
function DwellingIcon({ type, size = 14, className }: { type?: DwellingType; size?: number; className?: string }) {
  return createElement(DWELLING_ICONS[type ?? 'other'], { size, strokeWidth: 2, className });
}

function useDwellingOptions() {
  const { t } = useFinance();
  const lp = t.loanPage;
  const options = [
    { value: 'leilighet', label: lp.dwLeilighet },
    { value: 'enebolig', label: lp.dwEnebolig },
    { value: 'rekkehus', label: lp.dwRekkehus },
    { value: 'tomannsbolig', label: lp.dwTomannsbolig },
    { value: 'hytte', label: lp.dwHytte },
    { value: 'other', label: lp.dwOther },
  ];
  return {
    options,
    label: (d?: DwellingType) => options.find(o => o.value === d)?.label,
  };
}

interface ModalConfig {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
  error?: string;
}

/** Shared add/edit modal for a residence. Each caller gets its own instance so
 *  the property card and the history timeline don't share modal state. */
function useResidenceEditor() {
  const { t, addResidence, updateResidence } = useFinance();
  const lp = t.loanPage;
  const { options: typeOptions } = useTypeOptions();
  const { options: dwellingOptions } = useDwellingOptions();
  const [modal, setModal] = useState<ModalConfig | null>(null);

  const openEditor = (existing?: Residence) => {
    const fields: ModalField[] = [
      { key: 'address', label: lp.propertyAddress, type: 'text', value: existing?.address ?? '', placeholder: 'Storgata 1, Oslo', hint: lp.propertyAddressHint },
      { key: 'dwellingType', label: lp.propertyDwellingType, type: 'select', value: existing?.dwellingType ?? 'leilighet', options: dwellingOptions },
      { key: 'propertyType', label: lp.propertyType, type: 'select', value: existing?.propertyType ?? 'selveier', options: typeOptions },
      { key: 'rooms', label: lp.propertyRooms, type: 'number', value: existing?.rooms?.toString() ?? '', placeholder: '3' },
      { key: 'sizeSqm', label: lp.propertySizeSqm, type: 'number', value: existing?.sizeSqm?.toString() ?? '', placeholder: '68' },
      { key: 'postalCode', label: lp.propertyPostalCode, type: 'text', value: existing?.postalCode ?? '', placeholder: '0575', hint: lp.propertyPostalCodeHint },
      { key: 'purchasePrice', label: lp.propertyPurchasePrice, type: 'number', value: existing?.purchasePrice?.toString() ?? '', placeholder: '3800000', hint: lp.propertyPurchasePriceHint },
      { key: 'purchaseCosts', label: lp.propertyPurchaseCosts, type: 'number', value: existing?.purchaseCosts?.toString() ?? '', placeholder: '0', hint: lp.propertyPurchaseCostsHint },
      {
        key: 'jointDebtShare', label: lp.propertyJointDebt, type: 'number', value: existing?.jointDebtShare?.toString() ?? '',
        placeholder: '0', hint: lp.propertyJointDebtHint,
        showWhen: (v) => v.propertyType === 'borettslag' || v.propertyType === 'aksjeleilighet',
      },
      { key: 'moveInDate', label: lp.propertyMoveInField, type: 'monthpicker', pickerMode: 'day', value: existing?.moveInDate ?? '', placeholder: '2022-07-15' },
      { key: 'moveOutDate', label: lp.propertyMoveOutField, type: 'monthpicker', pickerMode: 'day', value: existing?.moveOutDate ?? '', placeholder: '2024-09-01' },
      { key: 'salePrice', label: lp.propertySalePrice, type: 'number', value: existing?.salePrice?.toString() ?? '', placeholder: '0', hint: lp.propertySalePriceHint, showWhen: (v) => !!v.moveOutDate.trim() },
      { key: 'notes', label: lp.propertyNotes, type: 'text', value: existing?.notes ?? '', placeholder: lp.propertyNotesPlaceholder },
    ];
    setModal({
      title: existing ? lp.propertyEditTitle : lp.propertyAddTitle,
      fields,
      onSave: (vals) => {
        const address = vals.address.trim();
        if (!address) { setModal(p => p && { ...p, error: lp.propertyErrAddress }); return; }
        // Be forgiving about how dates are typed: normalize common variants
        // (single-digit, dd.mm.yyyy, slashes) into 'YYYY-MM(-DD)'. null = truly
        // unparseable → show the error.
        const moveIn = normalizeMonthOrDay(vals.moveInDate, 'day');
        const moveOut = normalizeMonthOrDay(vals.moveOutDate, 'day');
        if (moveIn === null || moveOut === null) {
          setModal(p => p && { ...p, error: lp.propertyErrDate });
          return;
        }
        const patch: Omit<Residence, 'id'> = {
          address,
          propertyType: vals.propertyType as PropertyType,
          dwellingType: vals.dwellingType as DwellingType,
          rooms: num(vals.rooms),
          sizeSqm: num(vals.sizeSqm),
          postalCode: vals.postalCode.trim() || undefined,
          purchasePrice: num(vals.purchasePrice),
          purchaseCosts: num(vals.purchaseCosts),
          jointDebtShare: num(vals.jointDebtShare),
          moveInDate: moveIn || undefined,
          moveOutDate: moveOut || null,
          salePrice: moveOut ? (num(vals.salePrice) ?? null) : null,
          notes: vals.notes.trim() || undefined,
        };
        if (existing) updateResidence(existing.id, patch);
        else addResidence(patch);
        setModal(null);
      },
    });
  };

  const modalEl = modal ? <EditModal {...modal} onCancel={() => setModal(null)} /> : null;
  return { openEditor, modalEl };
}

interface PropertyCardProps {
  /** Live home value (`assets.houseValue`) that purchase-vs-value metrics use. */
  currentValue: number;
  /** True when the page is showing a past month (time machine) — hide editing. */
  readOnly: boolean;
}

/** The current home: purchase details + derived appreciation vs live value. */
export function PropertyCard({ currentValue, readOnly }: PropertyCardProps) {
  const { t, residences, formatCurrency } = useFinance();
  const lp = t.loanPage;
  const fmtDate = useDateFormatter();
  const { label: typeLabel } = useTypeOptions();
  const { label: dwellingLabel } = useDwellingOptions();
  const { openEditor, modalEl } = useResidenceEditor();

  const current = currentResidence(residences);
  const metrics = residenceMetrics(current, currentValue);
  const gainColor = metrics.gainKr != null && metrics.gainKr < 0 ? 'var(--negative)' : 'var(--positive)';

  return (
    <Card padding="none" className="p-5 md:p-7 space-y-5">
      <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <DwellingIcon type={current?.dwellingType} size={14} className="text-[var(--text-2)]" />
          <SectionLabel>{lp.propertyTitle}</SectionLabel>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-3 shrink-0">
            <Link to="/assets" className="text-[10px] text-[var(--text-2)] hover:text-[var(--positive)] transition-colors whitespace-nowrap">
              {t.editInAssets}
            </Link>
            <button onClick={() => openEditor(current)} className="flex items-center gap-1 text-[var(--text-2)] hover:text-[var(--positive)] transition-colors">
              <Edit2 size={11} />
              <span className="text-[10px] font-medium">{current ? t.edit : lp.propertyAddCta}</span>
            </button>
          </div>
        )}
      </div>

      {current ? (
        <div className="space-y-1">
          <PropRow label={lp.propertyAddress} value={current.address} />
          {current.dwellingType && <PropRow label={lp.propertyDwellingType} value={dwellingLabel(current.dwellingType) ?? ''} />}
          {current.propertyType && <PropRow label={lp.propertyType} value={typeLabel(current.propertyType) ?? ''} />}
          {current.rooms != null && current.rooms > 0 && <PropRow label={lp.propertyRooms} value={String(current.rooms)} />}
          {current.sizeSqm != null && current.sizeSqm > 0 && <PropRow label={lp.propertySizeSqm} value={`${current.sizeSqm} m²`} />}
          {current.purchasePrice != null && <PropRow label={lp.propertyPurchasePrice} value={formatCurrency(current.purchasePrice)} />}
          {current.purchaseCosts != null && current.purchaseCosts > 0 && (
            <PropRow label={lp.propertyPurchaseCosts} value={formatCurrency(current.purchaseCosts)} />
          )}
          {current.jointDebtShare != null && current.jointDebtShare > 0 && (
            <PropRow label={lp.propertyJointDebt} value={formatCurrency(current.jointDebtShare)} />
          )}
          {current.moveInDate && <PropRow label={lp.propertyMoveIn} value={fmtDate(current.moveInDate)} />}
          <PropRow label={lp.propertyCurrentValue} value={formatCurrency(Math.round(currentValue))} highlight />
          {metrics.gainKr != null && (
            <PropRow
              label={lp.propertyGain}
              value={`${metrics.gainKr >= 0 ? '+' : ''}${formatCurrency(Math.round(metrics.gainKr))}${metrics.gainPct != null ? ` (${metrics.gainPct >= 0 ? '+' : ''}${metrics.gainPct.toFixed(1)}%)` : ''}`}
              color={gainColor}
            />
          )}
          {metrics.annualizedPct != null && (
            <PropRow label={lp.propertyAnnualized} value={`${metrics.annualizedPct >= 0 ? '+' : ''}${metrics.annualizedPct.toFixed(1)}%`} color={gainColor} />
          )}
          {metrics.yearsOwned != null && (
            <PropRow label={lp.propertyYearsOwned} value={`${metrics.yearsOwned.toFixed(1)} ${lp.yearsShort}`} />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>{lp.propertyEmpty}</p>
          {!readOnly && (
            <button onClick={() => openEditor()} className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-2)] hover:text-[var(--positive)] transition-colors">
              <Plus size={13} /> {lp.propertyAddCta}
            </button>
          )}
        </div>
      )}
      {modalEl}
    </Card>
  );
}

interface ResidenceTimelineProps {
  readOnly: boolean;
}

/** Full-width history of homes lived in — the "where you lived" timeline. */
export function ResidenceTimeline({ readOnly }: ResidenceTimelineProps) {
  const { t, residences, removeResidence, formatCurrency } = useFinance();
  const lp = t.loanPage;
  const fmtDate = useDateFormatter();
  const { openEditor, modalEl } = useResidenceEditor();
  const sorted = sortResidences(residences);

  return (
    <Card padding="none" className="p-5 md:p-7 space-y-4">
      <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Clock size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <SectionLabel>{lp.propertyHistoryTitle}</SectionLabel>
        </div>
        {!readOnly && (
          <button onClick={() => openEditor()} className="flex items-center gap-1 text-[var(--text-2)] hover:text-[var(--positive)] transition-colors shrink-0">
            <Plus size={12} />
            <span className="text-[10px] font-medium">{lp.propertyAddCta}</span>
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>{lp.propertyEmpty}</p>
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: 'var(--border)' }} />
          {sorted.map((r) => {
            const isCurrent = r.moveOutDate == null || r.moveOutDate === '';
            const period = `${fmtDate(r.moveInDate) || '—'} → ${isCurrent ? lp.propertyPeriodNow : fmtDate(r.moveOutDate)}`;
            const gain = r.salePrice != null && r.purchasePrice != null ? r.salePrice - r.purchasePrice : null;
            const size = [
              r.rooms != null && r.rooms > 0 ? `${r.rooms} ${lp.propertyRoomsUnit}` : null,
              r.sizeSqm != null && r.sizeSqm > 0 ? `${r.sizeSqm} m²` : null,
            ].filter(Boolean).join(' · ');
            return (
              <div key={r.id} className="relative flex items-start justify-between gap-3 py-2.5 group">
                <span
                  className="absolute left-[-25px] top-[12px] grid place-items-center w-4 h-4 rounded-full"
                  style={{ background: 'var(--bg-card)', color: isCurrent ? 'var(--accent)' : 'var(--text-3)' }}
                >
                  <DwellingIcon type={r.dwellingType} size={13} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-[13px] text-[var(--text-1)]">
                    <span className="font-medium truncate">{r.address}</span>
                    {isCurrent && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        {lp.propertyCurrentBadge}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                    {period}
                    {size ? ` · ${size}` : ''}
                    {r.purchasePrice != null ? ` · ${formatCurrency(r.purchasePrice)}` : ''}
                    {r.salePrice != null ? ` · ${lp.propertySold} ${formatCurrency(r.salePrice)}` : ''}
                    {gain != null ? ` (${gain >= 0 ? '+' : ''}${formatCurrency(Math.round(gain))})` : ''}
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button aria-label={`${t.edit} — ${r.address}`} onClick={() => openEditor(r)} className="p-1.5 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-elev)] transition-colors"><Edit2 size={13} /></button>
                    <button
                      aria-label={`${t.delete} — ${r.address}`}
                      onClick={() => { if (window.confirm(lp.deleteResidenceConfirm)) removeResidence(r.id); }}
                      className="p-1.5 rounded-md text-[var(--text-2)] hover:text-[var(--negative)] hover:bg-[var(--bg-elev)] transition-colors"
                    ><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {modalEl}
    </Card>
  );
}

function PropRow({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: string }) {
  const valueColor = color ?? (highlight ? 'var(--positive)' : 'var(--text-1)');
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-[var(--border)] last:border-0">
      <span className="text-[13px] font-medium text-[var(--text-1)] mr-4 min-w-0 truncate">{label}</span>
      <span className="text-[13px] font-mono font-medium whitespace-nowrap" style={{ color: valueColor }}>{value}</span>
    </div>
  );
}
