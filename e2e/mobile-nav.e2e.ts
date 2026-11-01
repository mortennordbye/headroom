import { devices } from '@playwright/test';
import { test, expect, putBlob, seedBlob } from './fixtures';

// The bottom tab bar is md:hidden, so this needs a phone viewport with touch.
test.use({ ...devices['Pixel 7'] });

test('one tap on a tab whose page is not loaded yet shows the loading skeleton at once', async ({ page, request }) => {
  await putBlob(request, seedBlob());
  // Hold the Budget page's chunk back, as a cold chunk on a phone does. Navigation
  // runs in a transition, so without a fresh Suspense boundary per route the old
  // page stayed up unchanged until the chunk arrived, and the tap looked ignored.
  await page.route(/\/static\/.*BudgetPage.*\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await page.goto('/');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Budsjett' }).tap();

  await expect(page).toHaveURL(/\/budget/);
  await expect(main.getByRole('status', { name: 'Laster …' })).toBeVisible({ timeout: 500 });
  await expect(main.getByRole('heading', { level: 1, name: 'Månedsbudsjettet ditt.' })).toBeVisible();
});
