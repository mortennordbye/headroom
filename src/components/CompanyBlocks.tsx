import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BlockNavContext, blockDomId, useBlockNav, type BlockNav } from './companyBlockNav';

/**
 * The numbered, folded blocks of the employer-cost page's Avansert mode, their
 * stage headings and the sticky index above them. One provider holds which
 * blocks are open; the page always opens with all of them folded.
 */

export function BlockNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const setOpen = useCallback((id: string, on: boolean) => setOpenIds((s) => {
    if (s.has(id) === on) return s;
    const next = new Set(s);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);
  const reveal = useCallback((id: string) => {
    setOpen(id, true);
    // After the block has opened, so the scroll lands on its real position.
    requestAnimationFrame(() => document.getElementById(blockDomId(id))?.scrollIntoView({ block: 'start' }));
  }, [setOpen]);
  const value = useMemo<BlockNav>(() => ({ isOpen: (id) => open.has(id), setOpen, reveal }), [open, setOpen, reveal]);
  return <BlockNavContext.Provider value={value}>{children}</BlockNavContext.Provider>;
}

/** A key figure in a block header: the one brass number. */
export function Key({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--brass)' }}>{children}</span>;
}

/** A small label next to a block title. */
export function BlockChip({ children, tone }: { children: ReactNode; tone?: 'negative' | 'warning' | 'positive' }) {
  const style = tone === 'negative'
    ? { background: 'var(--negative-bg)', color: 'var(--negative)' }
    : tone === 'warning'
      ? { background: 'var(--warning-bg)', color: 'var(--brass)' }
      : tone === 'positive'
        ? { background: 'var(--accent-bg)', color: 'var(--accent)' }
        : { background: 'var(--surface-5)', color: 'var(--text-3)' };
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap" style={style}>{children}</span>;
}

/**
 * One block: a header row (number, title, chip, key number, arrow) that opens
 * and folds the body. Folded by default.
 */
export function FoldBlock({
  id, n, title, chip, summary, children, muted,
}: {
  id: string;
  /** The block number; none for reading material ("Les mer"). */
  n?: number;
  title: string;
  chip?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  /** A softer title, for reading material. */
  muted?: boolean;
}) {
  const nav = useBlockNav();
  const [localOpen, setLocalOpen] = useState(false);
  const open = nav ? nav.isOpen(id) : localOpen;
  const setOpen = (on: boolean) => (nav ? nav.setOpen(id, on) : setLocalOpen(on));
  return (
    <section
      id={blockDomId(id)}
      className="rounded-[8px] border scroll-mt-28"
      style={{ background: 'var(--bg-2)', borderColor: 'var(--rule)' }}
    >
      <details open={open} onToggle={(e) => { const on = e.currentTarget.open; if (on !== open) setOpen(on); }} className="group">
        <summary className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 md:px-6 py-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden rounded-[8px]">
          <span className="flex items-center gap-2.5 min-w-0">
            {n != null && (
              <span
                aria-hidden
                className="shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-[11px] font-mono"
                style={{ background: 'var(--surface-5)', color: 'var(--text-2)' }}
              >
                {n}
              </span>
            )}
            <span className={`${muted ? 'text-[13px] font-medium' : 'text-[14px] font-semibold'} [overflow-wrap:anywhere]`} style={{ color: muted ? 'var(--text-2)' : 'var(--text-1)' }}>
              {title}
            </span>
            {chip}
          </span>
          <span className="flex items-center gap-3 min-w-0 ml-[34px] sm:ml-0">
            {summary != null && (
              <span className="text-[12px] font-mono tabular-nums min-w-0 [overflow-wrap:anywhere]" style={{ color: 'var(--text-3)' }}>{summary}</span>
            )}
            <span aria-hidden className="text-[11px] inline-block transition-transform group-open:rotate-90" style={{ color: 'var(--text-3)' }}>▸</span>
          </span>
        </summary>
        {open && <div className="px-5 md:px-6 pb-6 pt-4 border-t" style={{ borderColor: 'var(--rule)' }}>{children}</div>}
      </details>
    </section>
  );
}

/** A stage heading over a group of blocks, with one line on what the stage is for. */
export function StageHeading({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <div id={`company-stage-${id}`} className="pt-2 scroll-mt-28">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>{title}</span>
        <span className="flex-1 border-t" style={{ borderColor: 'var(--rule)' }} />
      </div>
      <p className="mt-1.5 text-[12px]" style={{ color: 'var(--text-3)' }}>{sub}</p>
    </div>
  );
}

export interface IndexStage {
  id: string;
  label: string;
  items: Array<{ id: string; n: number; title: string; dot?: 'negative' | 'warning' }>;
}

/**
 * The sticky index under the app header: the stages and their block numbers.
 * A click opens the block and moves to it. On a phone it scrolls sideways
 * inside itself.
 */
export function BlockIndex({ ariaLabel, top, stages, extra }: {
  ariaLabel: string;
  /** "Ditt resultat": the first link, to the top card. */
  top: { id: string; label: string };
  stages: IndexStage[];
  /** "Les mer": the last link. */
  extra: { id: string; label: string };
}) {
  const nav = useBlockNav();
  // Sit right under the app's sticky header, whatever its height.
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const header = document.querySelector('header.sticky');
    if (!(header instanceof HTMLElement)) return;
    const measure = () => setOffset(header.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  const go = (id: string) => {
    if (id === top.id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
    else nav?.reveal(id);
  };
  const link = 'inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full relative hover:bg-[var(--surface-5)] focus-visible:outline-2 focus-visible:outline-[var(--brass)]';
  return (
    <nav
      aria-label={ariaLabel}
      className="sticky z-10 -mx-1 px-1 py-2 border-b flex items-center gap-4 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden text-[12px]"
      style={{ top: offset, background: 'color-mix(in srgb, var(--bg) 92%, transparent)', backdropFilter: 'blur(6px)', borderColor: 'var(--rule)' }}
    >
      <button type="button" className={`${link} px-2`} style={{ color: 'var(--text-2)' }} onClick={() => go(top.id)}>{top.label}</button>
      {stages.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] mr-1" style={{ color: 'var(--text-3)' }}>{s.label}</span>
          {s.items.map((it) => (
            <button key={it.id} type="button" aria-label={`${it.n} ${it.title}`} title={it.title} className={`${link} font-mono`} style={{ color: 'var(--text-2)' }} onClick={() => go(it.id)}>
              {it.n}
              {it.dot && (
                <span aria-hidden className="absolute top-0.5 right-0 w-1.5 h-1.5 rounded-full" style={{ background: it.dot === 'negative' ? 'var(--negative)' : 'var(--brass)' }} />
              )}
            </button>
          ))}
        </span>
      ))}
      <button type="button" className={`${link} px-2`} style={{ color: 'var(--text-2)' }} onClick={() => go(extra.id)}>{extra.label}</button>
    </nav>
  );
}

/** What an input gives: one quiet line with a thin green rule. */
export function Gives({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 pl-2.5 border-l-2 text-[12px] leading-[1.5]" style={{ borderColor: 'var(--accent)', color: 'var(--text-2)' }}>
      {children}
    </p>
  );
}

/** A number inside a "Gir" line. */
export function GivesNum({ children }: { children: ReactNode }) {
  return <span className="font-mono tabular-nums" style={{ color: 'var(--accent)' }}>{children}</span>;
}
