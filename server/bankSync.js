// Optional in-process bank-sync scheduler. Disabled unless
// BANK_SYNC_INTERVAL_HOURS > 0. Runs inside the single `node index.js` process
// (like backup.js) so there's no cron to install, no compose sidecar, and no
// self-POST to the unauthenticated /api/bank/sync route. The first tick is
// delayed by the time left on the interval since the last successful sync, so
// frequent restarts don't re-sync early (mirrors backup.js's newestAgeMs). All
// timers are unref'd so they never keep the process alive on their own; a live
// consent syncs on schedule, an expired one flags itself and is retried next tick.
function startBankSyncSchedule({ intervalHours, runSync, lastSyncAgeMs, log = console.log, clock = () => Date.now() }) {
  if (!(intervalHours > 0)) return null;
  const intervalMs = intervalHours * 3600_000;

  const tick = () => Promise.resolve().then(runSync)
    .then((r) => log(`[bank] scheduled sync: +${(r && r.added) || 0} (fetched ${(r && r.fetched) || 0})`))
    .catch((err) => log(`[bank] scheduled sync failed: ${err && err.message}`));

  const age = lastSyncAgeMs(clock());
  const firstDelay = Math.max(0, intervalMs - (Number.isFinite(age) ? age : intervalMs));

  let interval = null;
  const first = setTimeout(() => {
    tick();
    interval = setInterval(tick, intervalMs);
    if (interval.unref) interval.unref();
  }, firstDelay);
  if (first.unref) first.unref();

  return {
    intervalHours,
    stop() {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    },
  };
}

module.exports = { startBankSyncSchedule };
