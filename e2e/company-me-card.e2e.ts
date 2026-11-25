import { test, expect, putBlob, seedBlob } from './fixtures';

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
