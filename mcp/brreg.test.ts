import { describe, it, expect, vi, afterEach } from 'vitest';
import { getBrreg } from './client';

// getBrreg reads the app route's status as the page does, and never puts the
// org number (it names the user's employer) in an error. Fetch is stubbed: no
// app and no network. Made-up number.
const ORG = '999900003';
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('getBrreg', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps the route status like the page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'not found' }, 404));
    expect(await getBrreg(ORG)).toEqual({ kind: 'notFound' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'invalid organisation number' }, 400));
    expect(await getBrreg(ORG)).toEqual({ kind: 'invalid' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'demo' }, 403));
    expect(await getBrreg(ORG)).toEqual({ kind: 'unavailable' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ available: false }, 200));
    expect(await getBrreg(ORG)).toEqual({ kind: 'unavailable' });
  });

  it('a failed request is a fixed message without the org number', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError(`fetch failed for /api/brreg/${ORG}`));
    const err = await getBrreg(ORG).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('the app could not be reached for the accounts lookup');
    expect((err as Error).message).not.toContain(ORG);
  });
});
