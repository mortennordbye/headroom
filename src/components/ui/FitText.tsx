import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { fitFontScale, MIN_FIT_SCALE } from '../../lib/fitText';

// The test harness renders through renderToStaticMarkup, which has no layout
// pass — useLayoutEffect only warns there.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Keeps one line of text inside its box by scaling the font down when it would
 * overflow — for the big money figures on phone-width tiles, where a six- or
 * seven-digit kroner amount is wider than the card. Above the breakpoint where
 * it already fits, nothing changes.
 *
 * Sizing/colour stay with the caller: `className` styles the box (pass the text
 * utilities there, they inherit), and the scale is applied as a percentage of
 * that inherited size, so the responsive `text-[…]` steps still drive the base.
 */
export function FitText({
  children,
  className,
  style,
  min = MIN_FIT_SCALE,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Readability floor, as a fraction of the inherited font size. */
  min?: number;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useIsomorphicLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text || typeof ResizeObserver === 'undefined') return;

    const fit = () => {
      // Measure at the inherited size first, so the scale is always derived
      // from the natural width rather than compounding the previous scale.
      text.style.fontSize = '';
      const scale = fitFontScale(box.clientWidth, Math.ceil(text.getBoundingClientRect().width), min);
      text.style.fontSize = scale < 1 ? `${scale * 100}%` : '';
    };
    fit();

    // Observe the BOX, never the text: the text's size is the thing we change,
    // so observing it would feed the observer its own output.
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    // Webfonts land after first paint and change the natural width without
    // resizing the box, so re-fit once they're in.
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [children, min]);

  return (
    <span ref={boxRef} className={`block min-w-0 overflow-hidden ${className ?? ''}`} style={style}>
      <span ref={textRef} className="inline-block whitespace-nowrap">{children}</span>
    </span>
  );
}
