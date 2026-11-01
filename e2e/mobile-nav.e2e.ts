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

test('a tab navigates on lift-off even when the browser never sends the click', async ({ page, request }) => {
  await putBlob(request, seedBlob());
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();

  // What the on-device log showed iOS doing: touch down and up on the tab, no click.
  const tab = page.getByRole('navigation').getByRole('link', { name: 'Lønn' });
  const box = (await tab.boundingBox())!;
  const at = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await tab.dispatchEvent('pointerdown', at);
  await tab.dispatchEvent('pointerup', at);

  await expect(page).toHaveURL(/\/salary/);
});

test('a normal tap on a tab navigates once', async ({ page, request }) => {
  await putBlob(request, seedBlob());
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Budsjett' }).tap();
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Månedsbudsjettet ditt.' })).toBeVisible();

  // Lift-off navigated and the click that followed was ignored, so one step
  // back lands on the dashboard rather than on a duplicate Budget entry.
  await page.goBack();
  await expect(page).toHaveURL(/\/(\?|$)/);
});

test('More opens on one tap, stays open, and its items navigate on one tap', async ({ page, request }) => {
  await putBlob(request, seedBlob());
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.getByRole('navigation').getByRole('button', { name: 'Mer' }).tap();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  // The touch was handled on lift-off and its click cancelled, so nothing
  // lands on the backdrop that just appeared and closes the sheet again.
  await page.waitForTimeout(500);
  await expect(sheet).toBeVisible();

  await sheet.getByRole('link', { name: 'Prognose' }).tap();
  await expect(page).toHaveURL(/\/forecast/);
  await expect(sheet).toBeHidden();

  await page.getByRole('navigation').getByRole('button', { name: 'Mer' }).tap();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Avbryt' }).tap();
  await expect(sheet).toBeHidden();
});
