/** The slice of `window` the modal history needs, so it can be tested without a DOM. */
export interface HistoryHost {
  history: Pick<History, 'pushState' | 'go' | 'state'>;
  addEventListener(type: 'popstate', listener: () => void): void;
  queueMicrotask(callback: () => void): void;
}

/**
 * Ties each open modal to a browser-history entry so the hardware/browser Back
 * button (and Android back gesture) closes the top modal instead of navigating
 * the app away. `open(close)` returns the release to call when the modal goes.
 *
 * Releases are deferred to a microtask: a modal that unmounts while another
 * mounts in the same commit (one dialog swapped for the next) hands its entry
 * over instead of going back, since that `back()` would land after the new
 * modal's push and close it. Back only closes the top modal, and popstates
 * caused by our own `go()` are ignored. If the user navigated the router while
 * a modal was open (history.state.modal no longer set), history is left alone.
 */
export function createModalHistory(host: HistoryHost) {
  const stack: Array<() => void> = [];
  let pendingBacks = 0;
  let ownPops = 0;
  let listening = false;

  const onPop = () => {
    if (ownPops > 0) {
      ownPops--;
      return;
    }
    stack.pop()?.();
  };

  const flush = () => {
    const n = pendingBacks;
    pendingBacks = 0;
    if (n > 0 && host.history.state?.modal) {
      ownPops++;
      host.history.go(-n);
    }
  };

  return function open(close: () => void): () => void {
    if (!listening) {
      host.addEventListener('popstate', onPop);
      listening = true;
    }
    if (pendingBacks > 0) pendingBacks--;
    else host.history.pushState({ modal: true }, '');
    const entry = () => close();
    stack.push(entry);
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i === -1) return; // closed by Back: its entry is already gone
      stack.splice(i, 1);
      if (pendingBacks++ === 0) host.queueMicrotask(flush);
    };
  };
}
