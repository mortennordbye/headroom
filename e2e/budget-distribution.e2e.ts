import { test, expect, putBlob, seedBlob } from './fixtures';

const LONG_NAME = 'Borettslagets felleskostnader inkludert fellesgjeld og kabel-TV';

function withManyExpenses() {
  const blob = seedBlob();
  blob.fixedExpenses = Array.from({ length: 40 }, (_, i) => ({
    id: `e${i}`,
    name: i === 0 ? LONG_NAME : `Utgift ${i}`,
    amount: 20_000 - i * 400,
    type: i % 2 ? 'subscription' : 'fixed',
  }));
  return blob;
}

test('a long distribution list folds, unfolds and fits a phone', async ({ page, request }) => {
  await putBlob(request, withManyExpenses());
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/budget');

  const card = page.locator('[class*="lg:col-span-5"]').filter({ hasText: 'Fordelingsanalyse' });
  await expect(card.getByText('De 3 største utgjør')).toBeVisible();
  await expect(card.getByText('Utgift 39', { exact: true })).toHaveCount(0);

  await card.getByRole('button', { name: /32 andre/ }).click();
  await expect(card.getByText('Utgift 39', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Vis færre' }).click();
  await expect(card.getByText('Utgift 39', { exact: true })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
