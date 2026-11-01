import type { Page } from '@playwright/test';
import { test, expect, putBlob, seedBlob } from './fixtures';

// A loan paydown the savings allocation set up is saving, not a fixed cost. With
// one active, every saving/spending split must still add up to the month's
// income, through the real FinanceContext (seed data is nb locale).

const INCOME = 55_000;
const PAYDOWN = 3_000;
const TARGET_PCT = 20;

/** "21 100,00 kr" / "-1 234 kr" with whatever spaces the locale formatter uses. */
function kr(text: string): number {
  const m = text.replace(/[\s\u00a0\u202f]/g, '').match(/-?\d+(?:,\d+)?/);
  return m ? Math.round(Number(m[0].replace(',', '.'))) : NaN;
}

function withPlanPaydown() {
  const blob = seedBlob();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  blob.monthlyIncomes = { ...(blob.monthlyIncomes as Record<string, number>), [month]: INCOME };
  blob.savingsTargetPercent = TARGET_PCT;
  blob.savingsAllocations = [
    { id: 'm', percent: 0, mode: 'amount', amount: PAYDOWN, destinationKind: 'mortgage' },
    { id: 'r', percent: 0, mode: 'rest', destinationKind: 'bsu' },
  ];
  blob.fixedExpenses = [
    ...(blob.fixedExpenses as object[]),
    { id: 'pm', name: 'Ekstra nedbetaling', amount: PAYDOWN, type: 'fixed', destinationKind: 'mortgage', lastPostedMonth: month, allocationId: 'm' },
  ];
  // Only the plan's own rest transfer, so nothing hand-made overfills the target.
  blob.savings = [{ ...(blob.savings as object[])[0], mode: 'rest', allocationId: 'r' }];
  return blob;
}

/** The value next to a label, read from the element that holds both. */
async function valueBeside(page: Page, scope: string, label: string): Promise<number> {
  const text = await page.locator(scope).filter({ has: page.getByText(label, { exact: true }) }).last().innerText();
  return kr(text.slice(text.indexOf(label) + label.length));
}

/** A Budget stat card's value (StatCard: the title span, then the value). */
async function statCard(page: Page, title: string): Promise<number> {
  const card = page.getByRole('main')
    .locator(`xpath=.//span[normalize-space()="${title}"]/parent::div[contains(@class, "rounded-[8px]")]`);
  const text = await card.first().innerText();
  return kr(text.slice(text.indexOf(title) + title.length));
}

test('Budget and Dashboard splits add up to income with a plan paydown active', async ({ page, request }) => {
  const blob = withPlanPaydown();
  await putBlob(request, blob);
  // Every listed fixed expense, the paydown row included.
  const listTotal = (blob.fixedExpenses as { amount: number }[]).reduce((sum, e) => sum + e.amount, 0);

  await page.goto('/budget');
  const plan = '[data-tour="budget-plan"]';
  await expect(page.locator(plan)).toBeVisible();
  // The paydown's row is listed once the stored blob has loaded.
  await expect(page.getByText('Ekstra nedbetaling', { exact: true })).toBeVisible();
  const canSpend = await valueBeside(page, `${plan} [role="presentation"]`, 'Kan bruke');
  const saving = await valueBeside(page, `${plan} [role="presentation"]`, 'Sparing');
  const pieFixed = await valueBeside(page, `${plan} [role="button"][aria-pressed]`, 'Faste Utgifter');
  const pieSaving = await valueBeside(page, `${plan} [role="button"][aria-pressed]`, 'Sparing');
  const pieSpend = await valueBeside(page, `${plan} [role="button"][aria-pressed]`, 'Kan bruke');
  const statFixed = await statCard(page, 'Faste Utgifter');
  const statBudget = await statCard(page, 'Budsjett / Måned');

  // The paydown is in the saving, not in the fixed costs: the card is the list
  // total less the paydown, a line under the list says so, and the saving is
  // the target share of income less the other fixed costs.
  expect(statFixed).toBe(listTotal - PAYDOWN);
  await expect(page.getByText('Ekstra nedbetaling fra sparefordelingen, regnet som sparing', { exact: true })).toBeVisible();
  expect(saving).toBe(Math.round((INCOME - (listTotal - PAYDOWN)) * TARGET_PCT / 100));
  expect(saving).toBe(pieSaving);
  expect(saving).toBeGreaterThanOrEqual(PAYDOWN);
  expect(pieFixed).toBe(statFixed);
  expect(pieSpend).toBe(canSpend);
  expect(statBudget).toBe(canSpend);
  expect(statFixed + saving + canSpend).toBe(INCOME);
  expect(pieFixed + pieSaving + pieSpend).toBe(INCOME);

  await page.goto('/');
  // The Budget Health composition legend (LegendItem: dot + name, then value).
  const legend = async (label: string) => {
    const item = page.getByRole('main')
      .locator(`xpath=.//span[normalize-space()="${label}"]/parent::div[contains(@class, "mb-1")]/parent::div`);
    const text = await item.first().innerText();
    return kr(text.slice(text.indexOf(label) + label.length));
  };
  // Wait for the loaded blob, not the first render's defaults.
  await expect.poll(() => legend('Faste Utgifter')).toBe(statFixed);
  const dashFixed = await legend('Faste Utgifter');
  const dashSaving = await legend('Sparing');
  const spent = await legend('Brukt denne måneden');
  const remaining = await legend('Gjenstående budsjett');
  expect(dashFixed).toBe(statFixed);
  expect(dashFixed + dashSaving + spent + remaining).toBe(INCOME);
});
