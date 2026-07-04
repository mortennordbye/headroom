import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Surfaces a waiting service worker (registerType: 'prompt'). Clicking Update
 * calls updateServiceWorker(true), which skips waiting and does one clean full
 * reload — fetching a fresh index.html + current chunks. Because the new SW
 * only takes over on this user-triggered reload, the running tab never loses
 * the chunks it's using mid-session.
 */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // An installed PWA kept open for days otherwise only checks for a new SW on a
    // hard navigation. Poll hourly and whenever the tab becomes visible so the
    // "new version" prompt actually appears (guards the stale-cache failure mode).
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => { void registration.update(); }, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-[8px]"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
    >
      <span className="text-[13px]">Ny versjon tilgjengelig / New version available</span>
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        className="px-3 py-1.5 rounded-[8px] text-[12px] font-medium"
        style={{ background: 'var(--accent)', color: 'var(--bg)' }}
      >
        Oppdater / Update
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="px-2 py-1.5 rounded-[8px] text-[12px]"
        style={{ color: 'var(--text-3)' }}
      >
        Senere / Later
      </button>
    </div>
  );
}
