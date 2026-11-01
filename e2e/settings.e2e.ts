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

test('importing an export brings the exported state back', async ({ page, request }) => {
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

  // Change the data after the export, so the import has something to undo.
  const changed = seedBlob();
  changed.assets.houseDebt = 1_234_000;
  changed.income = 12_345;
  await putBlob(request, changed);
  await page.reload();
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
  expect((await quietBlob(request)).assets.houseDebt).toBe(1_234_000);

  await main.getByLabel('Slipp JSON-filen her').setInputFiles({
    name: download.suggestedFilename(), mimeType: 'application/json', buffer: file,
  });
  await main.getByRole('button', { name: 'Erstatt alle data' }).click();
  await expect(main.getByText('Data importert.')).toBeVisible();

  expect(await quietBlob(request)).toEqual(before);
});

test('the history grid opens a month in the editor, and Back steps out again', async ({ page, request }) => {
  await putBlob(request, seedBlob());
  await page.goto('/settings');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Administrer historikk' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Historikk' })).toBeVisible();

  await dialog.getByRole('button', { name: /^(Rediger|Legg til)$/ }).first().click();
  await expect(dialog.getByRole('heading', { name: /^Saldoer · / })).toBeVisible();

  // Cancel drops back to the grid; editing again and pressing Back does too.
  await dialog.getByText('Avbryt', { exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Historikk' })).toBeVisible();
  await dialog.getByRole('button', { name: /^(Rediger|Legg til)$/ }).first().click();
  await expect(dialog.getByRole('heading', { name: /^Saldoer · / })).toBeVisible();
  await page.goBack();
  await expect(dialog.getByRole('heading', { name: 'Historikk' })).toBeVisible();

  // Back from the grid closes it and stays on the page.
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings$/);
});
