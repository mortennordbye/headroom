import fs from 'node:fs';
import { test as base, expect, type APIRequestContext } from '@playwright/test';

export { expect };

/** The finance blob as stored; the specs only poke at a few keys. */
export type Blob = Record<string, unknown> & {
  assets: Record<string, unknown>;
  homeowner?: Record<string, unknown>;
  transition?: Record<string, unknown>;
};

/** A deep copy of the synthetic blob global-setup seeded the server with. */
export function seedBlob(): Blob {
  return JSON.parse(fs.readFileSync(process.env.E2E_SEED_PATH!, 'utf8'));
}

export async function getBlob(request: APIRequestContext): Promise<{ blob: Blob; rev: number }> {
  const res = await request.get('/api/data');
  expect(res.ok()).toBe(true);
  return { blob: await res.json(), rev: Number(res.headers()['x-data-rev']) };
}

/** Replace the stored blob (call before opening a page, so no tab holds an older rev). */
export async function putBlob(request: APIRequestContext, blob: Blob) {
  const { rev } = await getBlob(request);
  const res = await request.post('/api/data', { data: blob, headers: { 'x-data-rev': String(rev) } });
  expect(res.ok(), await res.text()).toBe(true);
}

/**
 * Points every test at the throwaway server, and fails a test on any console
 * error or uncaught exception from the app's own origin.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  baseURL: async ({ baseURL }, provide) => provide(process.env.E2E_BASE_URL ?? baseURL),
  consoleErrors: [
    async ({ page, baseURL }, provide) => {
      const errors: string[] = [];
      const origin = new URL(baseURL!).origin;
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        // WebKit on Linux reports the viewport meta's interactive-widget (a
        // Chrome-on-Android hint other browsers ignore) as an error.
        if (msg.text().startsWith('Viewport argument key "interactive-widget" not recognized')) return;
        const url = msg.location().url;
        if (!url || url.startsWith(origin)) errors.push(`${msg.text()} (${url || 'no location'})`);
      });
      page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));
      await provide(errors);
      expect(errors, 'console errors from the app').toEqual([]);
    },
    { auto: true },
  ],
});
