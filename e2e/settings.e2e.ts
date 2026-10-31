import fs from 'node:fs';
import type { APIRequestContext } from '@playwright/test';
import { test, expect, getBlob, putBlob, seedBlob, type Blob } from './fixtures';

// The stored blob once autosave has gone quiet (debounce is 500 ms).
async function quietBlob(request: APIRequestContext): Promise<Blob> {
  let last = -1;
  await expect.poll(async () => {
    const { rev } = await getBlob(request);
    const same = rev === last;
    last = rev;
    return same;
  }, { intervals: [1_500] }).toBe(true);
  return (await getBlob(request)).blob;
}

test('export then import round-trips without changing the stored blob', async ({ page, request }) => {
  await putBlob(request, seedBlob());
  await page.goto('/settings');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
  const before = await quietBlob(request);

  const downloadPromise = page.waitForEvent('download');
  await main.getByRole('button', { name: 'Eksporter alle data' }).click();
  const download = await downloadPromise;
  const file = fs.readFileSync(await download.path());
  const exported = JSON.parse(file.toString('utf8'));
  expect(exported._version).toEqual(expect.any(Number));
  expect(exported.assets).toEqual(before.assets);

  await main.getByLabel('Slipp JSON-filen her').setInputFiles({
    name: download.suggestedFilename(), mimeType: 'application/json', buffer: file,
  });
  await main.getByRole('button', { name: 'Erstatt alle data' }).click();
  await expect(main.getByText('Data importert.')).toBeVisible();

  expect(await quietBlob(request)).toEqual(before);
});
