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
  await expect(page.getByText(/^Endret fra chat · /)).toBeVisible();
  const link = page.getByRole('link', { name: 'Se eller angre i historikken' });
  await expect(link).toHaveAttribute('href', '/settings#restore-points');
  await link.click();
  await expect(page.locator('#restore-points')).toBeInViewport();
});

// After a hand edit the guesses no longer describe the model: no range, a note instead.
test('a hand-edited model shows no ranges, only a note', async ({ page, request }) => {
  const { blob } = await getBlob(request);
  const m = blob.companyModel as { quick: { edited: boolean } };
  m.quick.edited = true;
  await putBlob(request, blob);

  await page.goto('/employer-cost');
  await expect(page.getByText(/Spennet gjelder svarene i hurtigoppsettet/)).toBeVisible();
  await expect(page.getByTestId('fair-band')).toHaveCount(0);
  await expect(page.getByTestId('drivers')).toHaveCount(0);
  await expect(page.getByText(/^spenn /)).toHaveCount(0);
});

// The SSB market pay for the chosen STYRK code: a "Marked" marker and a p25–p75
// band on the salary axis. SSB is stubbed at the app route; "not available" hides the
// marker and shows a note, and the card still renders.
test('market pay: marker and band from SSB, the picker switches code, an error shows a note', async ({ page, request }) => {
  const blob = seedBlob();
  blob.companyModel = { ...(blob.companyModel as Record<string, unknown> | undefined), mode: 'advanced' };
  await putBlob(request, blob);

  const asked: string[] = [];
  await page.route('**/api/wage-stats/occupation?*', async (route) => {
    const code = new URL(route.request().url()).searchParams.get('code')!;
    asked.push(code);
    if (code === '2522') return route.fulfill({ json: { code, available: false } });
    return route.fulfill({ json: { code, available: true, label: 'x', year: 2025, median: 912_720, p25: 751_920, p75: 1_089_240, measure: 'AvtaltManedslonn', source: 'ssb-live', stale: false } });
  });

  await page.goto('/employer-cost');
  await expect(page.getByTestId('marker-market')).toContainText(/^Marked \d/);
  await expect(page.getByTestId('market-band')).toBeVisible();
  await expect(page.getByText(/^SSB tabell 11418, 2512: avtalt månedslønn \(grunnlønn og faste tillegg, uten bonus, uregelmessige tillegg og overtid\), privat sektor, heltid, november 2025, ×12, fremskrevet til \d{4}\./)).toBeVisible();
  expect(asked).toEqual(['2512']);

  const picker = page.getByLabel('Ditt yrke (STYRK-08)');
  await picker.selectOption('2511');
  await expect(page.getByText(/^SSB tabell 11418, 2511:/)).toBeVisible();
  await expect.poll(async () => ((await getBlob(request)).blob.companyModel as { market?: unknown }).market).toEqual({ styrk: '2511' });

  await picker.selectOption('2522');
  await expect(page.getByTestId('market-error')).toBeVisible();
  await expect(page.getByTestId('marker-market')).toHaveCount(0);
  await expect(page.getByTestId('market-band')).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Hva om lønna di var' })).toBeVisible();
});

// SSB data newer than the model year is not projected back: it is labelled with the SSB year.
test('market pay newer than the model year keeps the SSB year', async ({ page, request }) => {
  const blob = seedBlob();
  blob.companyModel = { ...(blob.companyModel as Record<string, unknown> | undefined), mode: 'advanced' };
  await putBlob(request, blob);
  await page.route('**/api/wage-stats/occupation?*', (route) => route.fulfill({
    json: { code: '2512', available: true, label: 'x', year: 2099, median: 912_720, measure: 'AvtaltManedslonn', source: 'ssb-live', stale: false },
  }));
  await page.goto('/employer-cost');
  await expect(page.getByText(/^Median 910\s000\skr i 2099 \(SSB\)$/)).toBeVisible();
  await expect(page.getByText(/^SSB tabell 11418, 2512: .*november 2099, ×12\. Median for alle aldre/)).toBeVisible();
  await expect(page.getByText(/fremskrevet/)).toHaveCount(0);
});
