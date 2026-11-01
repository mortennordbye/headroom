import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { enabled } from '../lib/tapLog';

const describe = (el: Element | null) => {
  if (!el) return 'none';
  const link = el.closest('a,button');
  const base = link ?? el;
  const label = base.getAttribute('href') ?? base.getAttribute('aria-label') ?? base.textContent?.trim().slice(0, 16) ?? '';
  return `${base.tagName.toLowerCase()}${label ? ` ${label}` : ''}`;
};

// Milliseconds since page load, so touches, clicks and route changes line up.
const line = (s: string) => `${Math.round(performance.now())} ${s}`;

export default function TapDebugLog() {
  const [on] = useState(enabled);
  const [lines, setLines] = useState<string[]>([]);
  const location = useLocation();

  useEffect(() => {
    if (!on) return;
    const log = (s: string) => setLines(l => [...l.slice(-15), line(s)]);
    const bundle = document.querySelector('script[type=module][src]')?.getAttribute('src')?.split('/').pop() ?? '?';
    log(`bundle ${bundle} sw=${navigator.serviceWorker?.controller ? 'yes' : 'no'}`);

    const onTouch = (e: TouchEvent) => {
      const p = e.changedTouches[0];
      // What the finger actually hit, which may differ from the event target if
      // something invisible is stacked over the tab bar.
      const hit = p ? describe(document.elementFromPoint(p.clientX, p.clientY)) : '';
      log(`${e.type} @${p ? `${Math.round(p.clientX)},${Math.round(p.clientY)}` : ''} hit=${hit}${e.defaultPrevented ? ' PREVENTED' : ''}`);
    };
    const onClick = (e: MouseEvent) => log(`click ${describe(e.target as Element)}${e.defaultPrevented ? ' PREVENTED' : ''}`);
    const onVis = () => log(`visibility ${document.visibilityState}`);

    // Main-thread stalls: a frame gap over 100 ms means a tap could not be handled.
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (now - last > 100) log(`stall ${Math.round(now - last)}ms`);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const opts = { capture: true, passive: true };
    window.addEventListener('touchstart', onTouch, opts);
    window.addEventListener('touchend', onTouch, opts);
    window.addEventListener('touchcancel', onTouch, opts);
    window.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('touchstart', onTouch, opts);
      window.removeEventListener('touchend', onTouch, opts);
      window.removeEventListener('touchcancel', onTouch, opts);
      window.removeEventListener('click', onClick, true);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [on]);

  // Log route changes when the new route renders (adjusting state during render).
  const [seenPath, setSeenPath] = useState(location.pathname);
  if (on && seenPath !== location.pathname) {
    setSeenPath(location.pathname);
    setLines(l => [...l.slice(-15), line(`route ${location.pathname}`)]);
  }

  if (!on) return null;
  return (
    <pre
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[100] m-0 p-2 text-[10px] leading-tight whitespace-pre-wrap pointer-events-none"
      style={{ background: 'color-mix(in srgb, var(--bg) 85%, transparent)', color: 'var(--text-1)' }}
    >
      {lines.join('\n')}
    </pre>
  );
}
