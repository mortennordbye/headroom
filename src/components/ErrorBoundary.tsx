import { Component, type ReactNode } from 'react';

// Timestamp of the last auto-reload (survives the reload via sessionStorage).
// We only auto-reload once per window: if a chunk is still missing right after
// a reload, reloading again would loop forever, so we show a fallback instead.
const LAST_RELOAD_KEY = 'headroom:chunk-reload-at';
const RELOAD_WINDOW_MS = 10_000;

/**
 * A code-split page chunk fetched via lazy() can fail to load — most commonly
 * when the app was rebuilt/redeployed while a tab stayed open, so the running
 * page still references old hashed chunk filenames that no longer exist. The
 * dynamic import rejects, and without a boundary the error propagates past
 * <Suspense> to the root and unmounts the whole app (blank screen). A one-time
 * full reload pulls a fresh index.html with current chunk hashes and recovers.
 */
function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(msg);
}

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  reloading: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (!isChunkLoadError(error)) return;
    // Auto-reload at most once per window. If we already reloaded recently and
    // the chunk is *still* missing, fall through to the fallback UI rather than
    // looping. The timestamp lives in sessionStorage so it survives the reload.
    const last = Number(sessionStorage.getItem(LAST_RELOAD_KEY) || 0);
    if (Date.now() - last > RELOAD_WINDOW_MS) {
      sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
      this.setState({ reloading: true });
      window.location.reload();
    }
  }

  render() {
    const { error, reloading } = this.state;

    // A reload is in flight after a chunk error — render nothing briefly.
    if (reloading) return null;
    if (!error) return this.props.children;

    return (
      <div
        className="grid place-items-center min-h-[100dvh] px-6 text-center"
        style={{ color: 'var(--text-2)', background: 'var(--bg)' }}
      >
        <div className="max-w-md">
          <div className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
            Noe gikk galt
          </div>
          <div className="text-[13px] mb-1">Something went wrong loading this page.</div>
          <p className="text-[12px] mb-5" style={{ color: 'var(--text-3)' }}>
            Last siden på nytt for å fortsette. / Reload the page to continue.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-[8px] text-[13px] font-medium"
            style={{ background: 'var(--accent)', color: 'var(--bg)' }}
          >
            Last på nytt / Reload
          </button>
        </div>
      </div>
    );
  }
}
