// Temporary diagnostic for the "first tap on a mobile tab does nothing" report
// (see BACKLOG.md). Off unless the URL carries ?debugtaps once (?debugtaps=0
// turns it off) or it is switched on in Settings, which a home-screen app needs:
// it has no address bar. Developer-only, so the log's text is not translated.
const KEY = 'headroom.debugtaps';

/** Turn the log on or off and reload, since it reads the setting once at start. */
export function setTapLog(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
  window.location.reload();
}

export function enabled(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('debugtaps');
    if (q !== null) localStorage.setItem(KEY, q === '0' ? '0' : '1');
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
