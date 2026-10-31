import { test, expect, putBlob, seedBlob } from './fixtures';

// Every top-level route in src/App.tsx (the redirects excluded).
const ROUTES = ['/', '/budget', '/assets', '/bolig', '/salary', '/forecast', '/pension', '/employer-cost', '/year', '/settings'];

test.beforeAll(async ({ request }) => {
  await putBlob(request, seedBlob());
});

for (const route of ROUTES) {
  test(`renders ${route}`, async ({ page }) => {
    await page.goto(route);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByText('Something went wrong loading this page.')).toHaveCount(0);
    // Give lazy panels and their data fetches a moment to surface errors.
    await page.waitForLoadState('networkidle');
  });
}
