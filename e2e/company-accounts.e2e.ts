import { test, expect, getBlob, putBlob, seedBlob } from './fixtures';

// The "Start med regnskapet" card on Avansert, with /api/brreg stubbed at the
// app route: a made-up company and made-up numbers, no call to Brønnøysund.
const ORG = '999900003';
const brregFixture = {
  available: true,
  orgnr: ORG,
  stale: false,
  fetchedAt: '2026-11-01T10:00:00.000Z',
  entity: { name: 'Eksempel Konsulent AS', formCode: 'AS', naceCode: '62.020', employees: 52, hasParent: false, inGroup: false },
  accounts: { year: 2025, type: 'SELSKAP', currency: 'NOK', revenue: 70_000_000, operatingResult: 6_000_000 },
};

test('accounts: fetch, compare, warnings, and "Tilpass modellen" moves the guesses', async ({ page, request }) => {
  const blob = seedBlob();
  const answers = {
    totalFte: 50, nonBilling: 6, onBench: 2, salaryLow: 800000, salaryHigh: 1100000, rateAverage: 1450, rateYou: 1450,
    ownBillablePct: 85, typicalBillablePct: 85, realizationPct: 95, bonusPct: 15, officeMode: 'desks', annualRent: 3600000, tripsPerYear: 2,
  };
  blob.companyModel = {
    ...(blob.companyModel as Record<string, unknown> | undefined),
    mode: 'advanced',
    quick: { answers, uncertain: ['salary'], dontKnow: ['typicalBillablePct'], edited: false },
  };
  await putBlob(request, blob);

  const asked: string[] = [];
  await page.route('**/api/brreg/*', (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: brregFixture });
  });

  await page.goto('/employer-cost');
  await expect(page.getByText('ikke hentet')).toBeVisible();

  const input = page.getByRole('textbox', { name: 'Organisasjonsnummer' });
  const fetchButton = page.getByRole('button', { name: 'Hent regnskap' });
  await input.fill('999900004');
  await expect(page.getByText(/Ugyldig organisasjonsnummer/)).toBeVisible();
  await expect(fetchButton).toBeDisabled();
  await input.fill('999 900 003');
  await expect(fetchButton).toBeEnabled();
  await fetchButton.click();
  expect(asked).toEqual([`/api/brreg/${ORG}`]);

  const table = page.getByTestId('accounts-table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Regnskap 2025 (selskap)' })).toBeVisible();
  const revenueRow = table.getByRole('row', { name: /^Omsetning/ });
  await expect(revenueRow).toContainText(/70,0\smill\.\skr/);
  await expect(table.getByRole('row', { name: /^Ansatte/ })).toContainText('52 personer');
  const warnings = page.getByTestId('accounts-warnings');
  await expect(warnings.locator('[data-warning="year"]')).toContainText('Regnskapet er fra 2025.');
  await expect(warnings.locator('[data-warning="resale"]')).toBeVisible();
  await expect(warnings.locator('[data-warning="persons"]')).toBeVisible();
  await expect(warnings.locator('[data-warning="holding"]')).toHaveCount(0);
  await expect(page.getByText(/Personvern: org\.nr\. sier hvem som er arbeidsgiveren din/)).toBeVisible();
  await expect.poll(async () => ((await getBlob(request)).blob.companyModel as { accounts?: { orgnr: string } }).accounts?.orgnr).toBe(ORG);

  const modelRevenueBefore = await revenueRow.locator('td').nth(1).textContent();
  await page.getByRole('button', { name: 'Tilpass modellen' }).click();
  await expect(page.getByTestId('accounts-fit')).toContainText(/^Anslått fra regnskapet: vanlig fakturerbar andel 85,0 → \d+,\d %, snittlønn .+ → .+\. To ukjente/);
  // The model's revenue now meets the accounts (within the 0.1 pp rounding of the share).
  await expect(revenueRow.locator('td').nth(1)).not.toHaveText(modelRevenueBefore!);
  await expect(revenueRow.locator('td').nth(1)).toHaveText(/^70,0\smill\.\skr$/);
  await expect.poll(async () => ((await getBlob(request)).blob.companyModel as { quick: { dontKnow: string[] } }).quick.dontKnow).toEqual([]);

  // The resale link opens that question in the quick setup.
  await warnings.getByRole('button', { name: 'Svar på spørsmålet om videresalg' }).click();
  await expect(page.locator('#quick-resale')).toBeInViewport();
});

test('demo mode: the fetch button is disabled and nothing reaches /api/brreg', async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ json: { demoMode: true } }));
  const asked: string[] = [];
  await page.route('**/api/brreg/*', (route) => { asked.push(route.request().url()); return route.fulfill({ status: 403, json: { error: 'demo' } }); });

  await page.goto('/employer-cost');
  await page.getByRole('radio', { name: 'Avansert' }).or(page.getByRole('button', { name: 'Avansert' })).first().click();
  const input = page.getByRole('textbox', { name: 'Organisasjonsnummer' });
  await input.fill(ORG);
  await expect(page.getByRole('button', { name: 'Hent regnskap' })).toBeDisabled();
  await expect(page.getByText('Ikke tilgjengelig i demomodus.')).toBeVisible();
  await input.press('Enter');
  expect(asked).toEqual([]);
});
