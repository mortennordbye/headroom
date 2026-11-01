// iOS sometimes delivers a tap's touchstart and touchend but never the click
// that should follow, so the button looks dead until it is tapped again. The
// on-device tap log caught it on the bottom tabs, and it can hit any control.
// This catches it once, app-wide: a clean tap on a button or link that gets no
// click within CLICK_WAIT_MS is clicked here. If the browser's own click turns
// up after that, it is swallowed, so a tap never acts twice.

/** The normal touchend → click gap is about 40 ms on an iPhone. */
const CLICK_WAIT_MS = 300;
/** How long after a recovered click a late native click is still dropped. */
const LATE_CLICK_GUARD_MS = 1000;
/** A finger that slid further than this was scrolling, not tapping. */
const MAX_MOVE_PX = 10;
/** A longer press is a long-press, which doesn't click. */
const MAX_PRESS_MS = 600;

const TARGETS = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], summary';
// Form controls need the browser's own tap to focus, open or toggle.
const SKIP = 'input, select, textarea, label, [contenteditable]';

export function installTapRecovery(doc: Document = document) {
  let start: { x: number; y: number; time: number } | null = null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let guardUntil = 0;
  const opts = { capture: true, passive: true };

  doc.addEventListener('touchstart', (e) => {
    clearTimeout(pending);
    pending = undefined;
    guardUntil = 0;
    const t = e.touches[0];
    start = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, time: e.timeStamp } : null;
  }, opts);

  doc.addEventListener('touchend', (e) => {
    const s = start;
    start = null;
    const t = e.changedTouches[0];
    if (!s || !t || e.touches.length > 0) return;
    if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > MAX_MOVE_PX || e.timeStamp - s.time > MAX_PRESS_MS) return;
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>(TARGETS) : null;
    if (!el || el.closest(SKIP) || el.matches(':disabled, [aria-disabled="true"]')) return;
    pending = setTimeout(() => {
      pending = undefined;
      // Checked here rather than above: app handlers run after this capture
      // listener, and one that cancels the touch has opted out of the click.
      if (e.defaultPrevented || !el.isConnected) return;
      guardUntil = performance.now() + LATE_CLICK_GUARD_MS;
      el.click();
    }, CLICK_WAIT_MS);
  }, opts);

  doc.addEventListener('click', (e) => {
    if (pending !== undefined) {
      // The browser's click arrived in time; nothing to recover.
      clearTimeout(pending);
      pending = undefined;
      return;
    }
    if (e.isTrusted && performance.now() < guardUntil) {
      guardUntil = 0;
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}
