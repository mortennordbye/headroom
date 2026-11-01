/// <reference lib="dom" />
import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect, putBlob, seedBlob } from './fixtures';

// The bottom tab bar is md:hidden, so these run in the mobile-* projects
// (phone viewport with touch) in playwright.config.ts.

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

/**
 * What the on-device tap log showed iOS doing: touchstart and touchend on the
 * element, then no click. Dispatched in the page so no click follows.
 */
async function touchWithoutClick(locator: Locator) {
  await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const touch = { identifier: 1, target: el, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    // Plain events carrying touch lists: WebKit has no Touch constructor.
    const fire = (type: string, touches: object[]) => {
      const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
      Object.defineProperties(e, { touches: { value: touches }, changedTouches: { value: [touch] } });
      el.dispatchEvent(e);
    };
    fire('touchstart', [touch]);
    fire('touchend', []);
  });
}

async function openDashboard(page: Page, request: APIRequestContext) {
  await putBlob(request, seedBlob());
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
}

test('a tab tap that never gets its click still navigates', async ({ page, request }) => {
  await openDashboard(page, request);
  await touchWithoutClick(page.getByRole('navigation').getByRole('link', { name: 'Lønn' }));
  await expect(page).toHaveURL(/\/salary/);
});

test('More and the links in its sheet work when the click never comes', async ({ page, request }) => {
  await openDashboard(page, request);
  await touchWithoutClick(page.getByRole('navigation').getByRole('button', { name: 'Mer' }));
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await touchWithoutClick(sheet.getByRole('link', { name: 'Prognose' }));
  await expect(page).toHaveURL(/\/forecast/);
  await expect(sheet).toBeHidden();
});

test('a click that turns up late after a recovered tap is dropped', async ({ page, request }) => {
  await openDashboard(page, request);
  const more = page.getByRole('navigation').getByRole('button', { name: 'Mer' });
  const box = (await more.boundingBox())!;
  await touchWithoutClick(more);
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  // The browser's own click arriving now would land on the backdrop that
  // just opened and close the sheet. It must be ignored.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await expect(sheet).toBeVisible();
});

test('a normal tap acts once', async ({ page, request }) => {
  await openDashboard(page, request);
  await page.getByRole('navigation').getByRole('button', { name: 'Mer' }).tap();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  // Long enough for a wrongly recovered second click to have fired.
  await page.waitForTimeout(600);
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Avbryt' }).tap();
  await expect(sheet).toBeHidden();

  const before = await page.evaluate(() => history.length);
  await page.getByRole('navigation').getByRole('link', { name: 'Budsjett' }).tap();
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Månedsbudsjettet ditt.' })).toBeVisible();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
});

test('a page whose code is already loaded opens without the skeleton, at the top', async ({ page, request }) => {
  await openDashboard(page, request);
  // Let the idle preload fetch every page's code.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const w = window as unknown as { sawSkeleton: boolean };
    w.sawSkeleton = false;
    new MutationObserver(() => {
      if (document.querySelector('main [role=status][aria-label="Laster …"]')) w.sawSkeleton = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole('navigation').getByRole('link', { name: 'Budsjett' }).tap();
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Månedsbudsjettet ditt.' })).toBeVisible();

  expect(await page.evaluate(() => (window as unknown as { sawSkeleton: boolean }).sawSkeleton)).toBe(false);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});
