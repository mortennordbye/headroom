import { describe, it, expect, vi } from 'vitest';
import { createModalHistory, type HistoryHost } from './modalHistory';

// A fake browser history: pushState is synchronous, go() is queued like a real
// traversal and fires popstate when it lands. `settle()` runs microtasks, then
// pending traversals, the way the browser orders them.
function fakeHost() {
  const entries: unknown[] = [null];
  let index = 0;
  let microtasks: Array<() => void> = [];
  let traversals: number[] = [];
  const listeners: Array<() => void> = [];
  const history = {
    get state() { return entries[index]; },
    pushState(state: unknown) {
      entries.splice(index + 1, entries.length, state);
      index++;
    },
    go(delta: number) { traversals.push(delta); },
  };
  const host: HistoryHost = {
    history: history as unknown as HistoryHost['history'],
    addEventListener: (_type, fn) => listeners.push(fn),
    queueMicrotask: (fn) => microtasks.push(fn),
  };
  const back = () => {
    index = Math.max(0, index - 1);
    listeners.forEach(fn => fn());
  };
  const settle = () => {
    const tasks = microtasks;
    microtasks = [];
    tasks.forEach(fn => fn());
    const pending = traversals;
    traversals = [];
    for (const delta of pending) {
      index = Math.max(0, index + delta);
      listeners.forEach(fn => fn());
    }
  };
  return { host, back, settle, depth: () => index, length: () => entries.length };
}

describe('createModalHistory', () => {
  it('pushes an entry on open and goes back on close', () => {
    const h = fakeHost();
    const open = createModalHistory(h.host);
    const close = vi.fn();
    const release = open(close);
    expect(h.depth()).toBe(1);
    release();
    h.settle();
    expect(h.depth()).toBe(0);
    expect(close).not.toHaveBeenCalled();
  });

  it('hands the entry over when one modal is swapped for another', () => {
    const h = fakeHost();
    const open = createModalHistory(h.host);
    const closeGrid = vi.fn();
    const closeEditor = vi.fn();
    const releaseGrid = open(closeGrid);
    // Same commit: the grid unmounts, the editor mounts.
    releaseGrid();
    const releaseEditor = open(closeEditor);
    h.settle();
    expect(h.depth()).toBe(1);
    expect(closeEditor).not.toHaveBeenCalled();
    releaseEditor();
    h.settle();
    expect(h.depth()).toBe(0);
  });

  it('Back closes only the top modal', () => {
    const h = fakeHost();
    const open = createModalHistory(h.host);
    const closeA = vi.fn();
    const closeB = vi.fn();
    open(closeA);
    const releaseB = open(closeB);
    h.back();
    expect(closeB).toHaveBeenCalledOnce();
    expect(closeA).not.toHaveBeenCalled();
    // B unmounts in response; its entry is already gone, so no extra back.
    releaseB();
    h.settle();
    expect(h.depth()).toBe(1);
    h.back();
    expect(closeA).toHaveBeenCalledOnce();
  });

  it('closing the top modal by other means leaves the one below open', () => {
    const h = fakeHost();
    const open = createModalHistory(h.host);
    const closeA = vi.fn();
    open(closeA);
    const releaseB = open(vi.fn());
    releaseB();
    h.settle();
    expect(h.depth()).toBe(1);
    expect(closeA).not.toHaveBeenCalled();
  });

  it('Back from a swapped-in modal closes it, and a re-opened modal pushes again', () => {
    const h = fakeHost();
    const open = createModalHistory(h.host);
    const releaseGrid = open(vi.fn());
    releaseGrid();
    const closeEditor = vi.fn();
    const releaseEditor = open(closeEditor);
    h.settle();
    h.back();
    expect(closeEditor).toHaveBeenCalledOnce();
    // The editor's close returns to the grid.
    releaseEditor();
    open(vi.fn());
    h.settle();
    expect(h.depth()).toBe(1);
  });

  it('leaves history alone when the router navigated meanwhile', () => {
    const h = fakeHost();
    const open = createModalHistory(h.host);
    const release = open(vi.fn());
    h.host.history.pushState({ route: true }, '');
    release();
    h.settle();
    expect(h.depth()).toBe(2);
  });
});
