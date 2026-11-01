import type { Page } from '@playwright/test';
import { test, expect, getBlob, putBlob, seedBlob } from './fixtures';

// The "Nåværende lån" card on the Boliglån tab (seed data is a homeowner, nb locale).
function currentLoanCard(page: Page) {
  return page.getByRole('main').locator('div')
    .filter({ has: page.getByText('Nåværende lån', { exact: true }) })
    .filter({ has: page.getByText('Opprinnelig lånebeløp', { exact: true }) })
    .last();
}

// "3 200 000,00 kr" with whatever spaces the locale formatter uses.
const balance = (groups: string) => new RegExp(`Restgjeld\\s*${groups.split(' ').join('\\s')},00`);

test('editing the mortgage balance persists across a reload', async ({ page, request }) => {
  await putBlob(request, seedBlob());
  await page.goto('/bolig');
  const card = currentLoanCard(page);
  await expect(card).toContainText(balance('3 200 000'));

  await card.getByText('Restgjeld', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Restgjeld' });
  await dialog.getByRole('spinbutton', { name: 'Restgjeld' }).fill('2950000');
  await dialog.getByRole('button', { name: 'Lagre' }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText(balance('2 950 000'));

  // The autosave lands in assets.houseDebt and nowhere else.
  await expect.poll(async () => (await getBlob(request)).blob.assets.houseDebt).toBe(2_950_000);
  const { blob } = await getBlob(request);
  expect(blob.homeowner).not.toHaveProperty('currentMortgageBalance');
  expect(blob.transition).not.toHaveProperty('currentMortgageBalance');

  await page.reload();
  await expect(currentLoanCard(page)).toContainText(balance('2 950 000'));
});

test('a legacy blob with drifted copies loads the homeowner copy and converges on assets.houseDebt', async ({ page, request }) => {
  // Homeowner mode: the old rules show the homeowner copy, not Assets or transition.
  const legacy = seedBlob();
  legacy.assets.houseDebt = 2_800_000;
  legacy.homeowner = { ...legacy.homeowner, currentMortgageBalance: 2_750_000 };
  legacy.transition = { ...legacy.transition, currentMortgageBalance: 2_700_000 };
  await putBlob(request, legacy);
  const before = (await getBlob(request)).rev;

  await page.goto('/bolig');
  await expect(currentLoanCard(page)).toContainText(balance('2 750 000'));

  await expect.poll(async () => (await getBlob(request)).rev).toBeGreaterThan(before);
  const { blob } = await getBlob(request);
  expect(blob.assets.houseDebt).toBe(2_750_000);
  expect(blob.homeowner).not.toHaveProperty('currentMortgageBalance');
  expect(blob.transition).not.toHaveProperty('currentMortgageBalance');
});

test('a notified rate shows as upcoming until its month, then is the rate', async ({ page, request }) => {
  const upcoming = seedBlob();
  upcoming.homeowner = { ...upcoming.homeowner, rente: 4.11, notifiedRate: 6.37, notifiedRateFrom: '2099-01' };
  await putBlob(request, upcoming);
  await page.goto('/bolig');
  const card = currentLoanCard(page);
  await expect(card).toContainText('Varslet nominell rente');
  await expect(card).toContainText('4.11%');
  await expect(card).toContainText('6.37%');

  const due = seedBlob();
  due.homeowner = { ...due.homeowner, rente: 4.11, notifiedRate: 6.37, notifiedRateFrom: '2020-01' };
  await putBlob(request, due);
  await page.reload();
  await expect(card).toContainText('6.37%');
  await expect(card).not.toContainText('4.11%');
  await expect(card).not.toContainText('Varslet nominell rente');

  // This month's record keeps the slice as entered, so a month backfilled from
  // it before the notice keeps the old rate.
  const d = new Date();
  const nowKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  await expect.poll(async () => {
    const snaps = (await getBlob(request)).blob.balanceSnapshots as Record<string, { homeowner?: Record<string, unknown> }> | undefined;
    const h = snaps?.[nowKey]?.homeowner;
    return h && { rente: h.rente, notifiedRate: h.notifiedRate };
  }).toEqual({ rente: 4.11, notifiedRate: 6.37 });
});
