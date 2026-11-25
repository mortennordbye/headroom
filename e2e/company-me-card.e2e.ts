import { test, expect, getBlob, putBlob, seedBlob } from './fixtures';

// The what-if salary slider on the employer-cost page (Avansert) is local
// state only: moving it must never save the blob.
test('the what-if salary slider sends no POST /api/data', async ({ page, request }) => {
  const blob = seedBlob();
  blob.companyModel = { ...(blob.companyModel as Record<string, unknown> | undefined), mode: 'advanced' };
  await putBlob(request, blob);

  await page.goto('/employer-cost');
  const slider = page.getByRole('slider', { name: 'Hva om lønna di var' });
  await expect(slider).toBeVisible();
  // Let any load-time autosave settle before counting.
  await page.waitForTimeout(1_500);

  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/data') posts.push(r.url()); });

  const before = await slider.inputValue();
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await slider.press('ArrowRight');
  expect(await slider.inputValue()).not.toBe(before);
  await expect(page.getByRole('button', { name: 'Tilbake til nå' })).toBeVisible();

  // Autosave debounces 500 ms; wait well past it.
  await page.waitForTimeout(2_000);
  expect(posts).toEqual([]);
});

// Saved "usikker" flags give a range on the headline numbers and the
// "Hva betyr mest" list; a company-model write from MCP shows the chat pill.
test('saved guesses show ranges, and an MCP write shows the chat pill', async ({ page, request }) => {
  const { blob, rev } = await getBlob(request);
  const answers = {
    totalFte: 50, nonBilling: 6, onBench: 2, salaryLow: 800000, salaryHigh: 1100000, rateAverage: 1450, rateYou: 1500,
    ownBillablePct: 88, typicalBillablePct: 85, realizationPct: 95, bonusPct: 15, officeMode: 'desks', annualRent: 3600000, tripsPerYear: 2,
  };
  // Only the quick setup's answers and flags; the ranges rebuild from them.
  blob.companyModel = {
    ...(blob.companyModel as Record<string, unknown> | undefined),
    mode: 'advanced',
    quick: { answers, uncertain: ['salary', 'typicalBillablePct'], dontKnow: ['realizationPct'], edited: false },
  };
  const res = await request.post('/api/data', { data: blob, headers: { 'x-data-rev': String(rev), 'x-headroom-source': 'mcp' } });
  expect(res.ok(), await res.text()).toBe(true);

  await page.goto('/employer-cost');
  await expect(page.getByText(/^spenn .+–.+ · nå /)).toBeVisible();
  await expect(page.getByTestId('drivers').getByRole('listitem')).toHaveCount(3);
  await expect(page.getByTestId('fair-band')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Endret fra chat' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Se eller angre i historikken' })).toHaveAttribute('href', '/settings');
});
