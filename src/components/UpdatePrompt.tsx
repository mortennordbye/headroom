import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Surfaces a waiting service worker (registerType: 'prompt'). Clicking Update
 * calls updateServiceWorker(true), which skips waiting and does one clean full
 * reload — fetching a fresh index.html + current chunks. Because the new SW
 * only takes over on this user-triggered reload, the running tab never loses
 * the chunks it's using mid-session.
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-[12px] shadow-lg"
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
