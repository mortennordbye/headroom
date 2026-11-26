import type { Page } from '@playwright/test';
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
  accounts: { year: 2025, type: 'SELSKAP', currency: 'NOK', revenue: 70_000_000, operatingResult: 14_000_000 },
};

test('accounts: fetch, compare estimates with real figures, warnings, and "Gjør modellen lik regnskapet"', async ({ page, request }) => {
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
    const p = new URL(route.request().url()).pathname;
    asked.push(p);
    if (p.endsWith('999900011')) {
      return route.fulfill({ json: { available: true, orgnr: '999900011', noAccounts: true, stale: false, fetchedAt: '2026-11-01T10:00:00.000Z', entity: { name: 'Eksempel ENK', formCode: 'ENK', naceCode: '', employees: null, hasParent: false, inGroup: false } } });
    }
    return route.fulfill({ json: brregFixture });
  });

  await page.goto('/employer-cost');
  await expect(page.getByText('ikke hentet')).toBeVisible();
  await openAccounts(page);

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
  await expect(table.getByRole('columnheader', { name: /^◌ Anslag Modellen 2026 · regnet ut fra svarene dine og bransjetall$/ })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: /^✓ Ekte tall Årsregnskap 2025 · Brønnøysund · Eksempel Konsulent AS$/ })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Avvik' })).toBeVisible();
  const revenueRow = table.getByRole('row', { name: /^Omsetning/ });
  await expect(revenueRow.locator('td').nth(2)).toHaveText(/^70,0\smill\.$/);
  await expect(table.getByRole('row', { name: /^Driftsresultat omsetning minus driftskostnader, før renter og skatt/ })).toContainText(/14,0\smill\./);
  // Kostnader = revenue − operating result: 70,0 − 14,0.
  await expect(table.getByRole('row', { name: /^Kostnader omsetning minus driftsresultat/ }).locator('td').nth(2)).toHaveText(/^56,0\smill\.$/);
  await expect(table.getByRole('row', { name: /^Ansatte/ })).toContainText('52 personer');
  const warnings = page.getByTestId('accounts-warnings');
  await expect(warnings.locator('[data-warning="year"]')).toContainText('Regnskapet er fra 2025.');
  await expect(warnings.locator('[data-warning="resale"]')).toBeVisible();
  await expect(warnings.locator('[data-warning="persons"]')).toBeVisible();
  await expect(warnings.locator('[data-warning="holding"]')).toHaveCount(0);
  await expect(page.getByText(/Personvern: org\.nr\. sier hvem som er arbeidsgiveren din/)).toBeVisible();
  await expect.poll(async () => ((await getBlob(request)).blob.companyModel as { accounts?: { orgnr: string } }).accounts?.orgnr).toBe(ORG);

  // The default answers do not match these accounts: the card and the me card say the numbers rest on guesses.
  const mismatch = page.getByTestId('accounts-mismatch');
  await expect(mismatch).toContainText('Modellen stemmer ikke med regnskapet.');
  await expect(mismatch).toContainText(/men regnskapet for 2025 viser 14,0\smill\.\skr\. Tallene om deg lenger opp bygger derfor på anslag\./);
  const meBasis = page.getByTestId('me-basis');
  await expect(meBasis).toHaveText('◌ bygger på anslag');
  await expect(page.getByText('Stemmer ikke med regnskapet. Sjekk mot regnskapet ↓')).toBeVisible();

  const modelRevenueBefore = await revenueRow.locator('td').nth(1).textContent();
  await expect(page.getByRole('button', { name: 'Tilpass modellen' })).toHaveCount(0);
  await mismatch.getByRole('button', { name: 'Gjør modellen lik regnskapet' }).click();
  const fitted = page.getByTestId('accounts-fitted');
  await expect(fitted).toContainText('Modellen er tilpasset regnskapet 2025.');
  await expect(fitted).toContainText(/Snittlønn ble flyttet fra .+ til ≈ .+\. Vanlig fakturerbar andel ble flyttet fra 85,0 % til ≈ \d+,\d %\. To ukjente/);
  await expect(fitted.getByRole('link', { name: 'Angre' })).toHaveAttribute('href', '/settings#restore-points');
  await expect(mismatch).toHaveCount(0);
  await expect(meBasis).toHaveText('✓ tilpasset regnskap 2025');
  await expect(page.getByText('Snittlønn og fakturerbar andel er anslått fra regnskapet.')).toBeVisible();
  // The model's revenue now meets the accounts (within the 0.1 pp rounding of the share).
  await expect(revenueRow.locator('td').nth(1)).not.toHaveText(modelRevenueBefore!);
  await expect(revenueRow.locator('td').nth(1)).toHaveText(/^70,0\smill\.$/);
  await expect(revenueRow.locator('td').nth(3)).toHaveText('likt');
  await expect.poll(async () => {
    const m = (await getBlob(request)).blob.companyModel as { quick: { uncertain: string[]; dontKnow: string[] }; accounts: { fittedAt?: string } };
    return [m.quick.dontKnow, [...m.quick.uncertain].sort(), typeof m.accounts.fittedAt];
  }).toEqual([[], ['salary', 'typicalBillablePct'], 'string']);

  // The resale link opens that question in the quick setup.
  await warnings.getByRole('button', { name: 'Svar på spørsmålet om videresalg' }).click();
  await expect(page.locator('#quick-resale')).toBeInViewport();

  // A new lookup that finds no accounts hides the saved company's table, so the two never mix.
  await input.fill('999900011');
  await fetchButton.click();
  await expect(page.getByText(/^Eksempel ENK har ikke levert årsregnskap\./)).toBeVisible();
  await expect(table).toHaveCount(0);
});

test('after a hand edit, "Gjør modellen lik regnskapet" asks first, then builds and fits in one save', async ({ page, request }) => {
  const blob = seedBlob();
  const answers = {
    totalFte: 50, nonBilling: 6, onBench: 2, salaryLow: 800000, salaryHigh: 1100000, rateAverage: 1450, rateYou: 1450,
    ownBillablePct: 85, typicalBillablePct: 85, realizationPct: 95, bonusPct: 15, officeMode: 'desks', annualRent: 3600000, tripsPerYear: 2,
  };
  blob.companyModel = {
    ...(blob.companyModel as Record<string, unknown> | undefined),
    mode: 'advanced',
    quick: { answers, uncertain: [], dontKnow: [], edited: true },
    accounts: {
      orgnr: ORG, name: 'Eksempel Konsulent AS', year: 2025, type: 'SELSKAP', currency: 'NOK', revenue: 70_000_000, operatingResult: 14_000_000,
      employees: 52, formCode: 'AS', naceCode: '62.020', hasParent: false, inGroup: false, fetchedAt: '2026-11-01T10:00:00.000Z',
    },
  };
  await putBlob(request, blob);
  await page.goto('/employer-cost');
  await openAccounts(page);

  const button = page.getByTestId('accounts-mismatch').getByRole('button', { name: 'Gjør modellen lik regnskapet' });
  await button.click();
  await page.getByRole('button', { name: 'Avbryt' }).click();
  await page.waitForTimeout(1_000);
  expect(((await getBlob(request)).blob.companyModel as { quick: { edited: boolean } }).quick.edited).toBe(true);

  await button.click();
  await expect(page.getByText('Bygge modellen på nytt?')).toBeVisible();
  await page.getByRole('button', { name: 'Bygg på nytt' }).click();
  await expect(page.getByTestId('accounts-fitted')).toContainText('Modellen er tilpasset regnskapet 2025.');
  await expect.poll(async () => {
    const m = (await getBlob(request)).blob.companyModel as { quick: { edited: boolean }; accounts: { fittedAt?: string } };
    return [m.quick.edited, typeof m.accounts.fittedAt];
  }).toEqual([false, 'string']);
});

test('demo mode: the fetch button is disabled and nothing reaches /api/brreg', async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ json: { demoMode: true } }));
  const asked: string[] = [];
  await page.route('**/api/brreg/*', (route) => { asked.push(route.request().url()); return route.fulfill({ status: 403, json: { error: 'demo' } }); });

  await page.goto('/employer-cost');
  await page.getByRole('radio', { name: 'Avansert' }).or(page.getByRole('button', { name: 'Avansert' })).first().click();
  await openAccounts(page);
  const input = page.getByRole('textbox', { name: 'Organisasjonsnummer' });
  await input.fill(ORG);
  await expect(page.getByRole('button', { name: 'Hent regnskap' })).toBeDisabled();
  await expect(page.getByText('Ikke tilgjengelig i demomodus.')).toBeVisible();
  await input.press('Enter');
  expect(asked).toEqual([]);
});

/** Block 1 ("Start med regnskapet") is folded when the page opens. */
async function openAccounts(page: Page) {
  await page.locator('summary', { hasText: 'Start med regnskapet' }).click();
}
