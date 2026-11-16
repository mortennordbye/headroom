// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installTapRecovery } from './tapRecovery';

type Point = { x: number; y: number };

let doc: Document;
let clicks: number;

/** Dispatch a touch event with the fields tapRecovery reads; the DOM shim
 * has no usable Touch constructor, so touches are plain objects. */
function touch(
  target: EventTarget,
  type: 'touchstart' | 'touchend',
  opts: { touches?: Point[]; changedTouches?: Point[]; timeStamp?: number } = {},
) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const toList = (ps: Point[] = []) => ps.map((p) => ({ clientX: p.x, clientY: p.y }));
  Object.defineProperty(e, 'touches', { value: toList(opts.touches) });
  Object.defineProperty(e, 'changedTouches', { value: toList(opts.changedTouches) });
  Object.defineProperty(e, 'timeStamp', { value: opts.timeStamp ?? performance.now() });
  target.dispatchEvent(e);
  return e;
}

/** A clean single-finger tap: start and end at the same point, 50 ms apart. */
function tap(target: EventTarget, { move = 0, pressMs = 50 } = {}) {
  touch(target, 'touchstart', { touches: [{ x: 10, y: 10 }], timeStamp: 1000 });
  return touch(target, 'touchend', { changedTouches: [{ x: 10 + move, y: 10 }], timeStamp: 1000 + pressMs });
}

function nativeClick(target: EventTarget, trusted: boolean) {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true });
  // Dispatched events are never trusted in a DOM shim; a real browser click is.
  if (trusted) Object.defineProperty(e, 'isTrusted', { value: true });
  target.dispatchEvent(e);
  return e;
}

function mount<T extends HTMLElement>(html: string, selector = 'button'): T {
  doc.body.innerHTML = html;
  const el = doc.querySelector<T>(selector)!;
  el.addEventListener('click', () => { clicks += 1; });
  return el;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  doc = document.implementation.createHTMLDocument();
  clicks = 0;
  installTapRecovery(doc);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('installTapRecovery', () => {
  it('clicks a button once, 300 ms after a tap that got no native click', () => {
    const btn = mount('<button>Go</button>');
    tap(btn);
    vi.advanceTimersByTime(299);
    expect(clicks).toBe(0);
    vi.advanceTimersByTime(1);
    expect(clicks).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(clicks).toBe(1);
  });

  it('does nothing extra when the native click arrives within 300 ms', () => {
    const btn = mount('<button>Go</button>');
    tap(btn);
    vi.advanceTimersByTime(40);
    nativeClick(btn, true);
    vi.advanceTimersByTime(5000);
    expect(clicks).toBe(1);
  });

  it('swallows a trusted native click that arrives after the recovered one, within 1 s', () => {
    const btn = mount('<button>Go</button>');
    tap(btn);
    vi.advanceTimersByTime(300);
    expect(clicks).toBe(1);
    vi.advanceTimersByTime(500);
    const late = nativeClick(btn, true);
    expect(late.defaultPrevented).toBe(true);
    expect(clicks).toBe(1);
  });

  it('lets a trusted native click through once the 1 s guard has passed', () => {
    const btn = mount('<button>Go</button>');
    tap(btn);
    vi.advanceTimersByTime(300);
    vi.advanceTimersByTime(1000);
    const late = nativeClick(btn, true);
    expect(late.defaultPrevented).toBe(false);
    expect(clicks).toBe(2);
  });

  it('does not swallow an untrusted click inside the guard window', () => {
    const btn = mount('<button>Go</button>');
    tap(btn);
    vi.advanceTimersByTime(300);
    nativeClick(btn, false);
    expect(clicks).toBe(2);
  });

  it('skips a tap where the finger moved more than 10 px', () => {
    const btn = mount('<button>Go</button>');
    tap(btn, { move: 11 });
    vi.advanceTimersByTime(1000);
    expect(clicks).toBe(0);
  });

  it('skips a press that lasted over 600 ms', () => {
    const btn = mount('<button>Go</button>');
    tap(btn, { pressMs: 601 });
    vi.advanceTimersByTime(1000);
    expect(clicks).toBe(0);
  });

  it('skips a two-finger touch', () => {
    const btn = mount('<button>Go</button>');
    touch(btn, 'touchstart', { touches: [{ x: 10, y: 10 }, { x: 50, y: 50 }], timeStamp: 1000 });
    touch(btn, 'touchend', { touches: [{ x: 50, y: 50 }], changedTouches: [{ x: 10, y: 10 }], timeStamp: 1050 });
    touch(btn, 'touchend', { changedTouches: [{ x: 50, y: 50 }], timeStamp: 1060 });
    vi.advanceTimersByTime(1000);
    expect(clicks).toBe(0);
  });

  it.each([
    ['an input', '<input type="button" value="Go">', 'input'],
    ['a select', '<select><option>a</option></select>', 'select'],
    ['a label', '<label role="button">Go</label>', 'label'],
    ['a button inside a label', '<label><button>Go</button></label>', 'button'],
  ])('skips %s', (_name, html, selector) => {
    const el = mount(html, selector);
    tap(el);
    vi.advanceTimersByTime(1000);
    expect(clicks).toBe(0);
  });

  it.each([
    ['a :disabled button', '<button disabled>Go</button>'],
    ['an aria-disabled="true" button', '<button aria-disabled="true">Go</button>'],
  ])('skips %s', (_name, html) => {
    const btn = mount(html);
    tap(btn);
    vi.advanceTimersByTime(1000);
    expect(clicks).toBe(0);
  });

  it('skips a tap whose touchend a handler cancelled', () => {
    const btn = mount('<button>Go</button>');
    btn.addEventListener('touchend', (e) => e.preventDefault());
    tap(btn);
    vi.advanceTimersByTime(1000);
    expect(clicks).toBe(0);
  });

  it('skips an element removed before the timer fired', () => {
    const btn = mount('<button>Go</button>');
    tap(btn);
    btn.remove();
    vi.advanceTimersByTime(1000);
    expect(clicks).toBe(0);
  });

  it('cancels a pending recovery on a new touchstart', () => {
    const btn = mount('<button>Go</button>');
    tap(btn);
    vi.advanceTimersByTime(100);
    touch(btn, 'touchstart', { touches: [{ x: 10, y: 10 }], timeStamp: 1200 });
    vi.advanceTimersByTime(1000);
    expect(clicks).toBe(0);
  });
});
