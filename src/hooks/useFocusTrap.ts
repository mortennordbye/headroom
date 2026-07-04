import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Modal accessibility for portal-based dialogs: traps Tab within the container,
 * closes on Escape, moves focus in on mount, and restores it on unmount. Attach
 * the returned ref to the dialog element (which should also carry
 * role="dialog" aria-modal="true" and a label).
 *
 * `initialFocus` — element to focus on open (e.g. the first input). Falls back to
 * the first focusable child, then the container itself.
 * `active` — gate for conditionally-rendered dialogs mounted by an always-mounted
 * parent (e.g. a sheet toggled by state): pass the open flag so the trap engages
 * when the element appears. Defaults to true for dialogs rendered only when open.
 */
export function useFocusTrap<T extends HTMLElement>(
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
  active: boolean = true,
): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const prevActive = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        el => el.offsetParent !== null,
      );

    const target = initialFocus?.current ?? focusables()[0] ?? node;
    if (target === node) node.setAttribute('tabindex', '-1');
    target.focus();
    if (target instanceof HTMLInputElement) target.select();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      prevActive?.focus?.();
    };
  }, [onClose, initialFocus, active]);

  return ref;
}
