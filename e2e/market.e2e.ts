import { format } from 'date-fns';
import type { APIRequestContext } from '@playwright/test';
import { test, expect, putBlob, seedBlob } from './fixtures';

const UI = { 'X-Headroom-Source': 'ui' };

async function marketPost(request: APIRequestContext, route: string, data: unknown) {
  const res = await request.post(`/api/market/${route}`, { data, headers: UI });
  expect(res.ok(), await res.text()).toBe(true);
}

test.afterEach(async ({ request }) => {
  await marketPost(request, 'config', { enabled: false, wipe: true });
});

test('Marked tab shows imported counts and when the data was last refreshed', async ({ page, request }) => {
  await putBlob(request, seedBlob());
  await marketPost(request, 'config', { enabled: true });
  const today = format(new Date(), 'yyyy-MM-dd');
  await marketPost(request, 'sales', {
    sales: [{ address: 'Testveien 1', postnr: '0001', soldPrice: 4_000_000, soldOn: today, bra: 60 }],
  });
  await marketPost(request, 'listings', {
    listings: [{ url: 'https://example.test/listing/1', address: 'Testveien 2', postnr: '0001', askingPrice: 4_200_000, bra: 62 }],
  });

  await page.goto('/bolig');
  await page.getByRole('tablist', { name: 'Bolig-verktøy' }).getByRole('tab', { name: 'Marked' }).click();
  const main = page.getByRole('main');
  await expect(main.getByText('Dataene dine', { exact: true })).toBeVisible();
  await expect(main.getByText('1 til salgs · 1 solgte', { exact: true })).toBeVisible();
  await expect(main.getByText(/^Nye solgte sist lagt til \d{2}\.\d{2}\.\d{4} · Til salgs sist sett .+\d/)).toBeVisible();
});
