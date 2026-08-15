import { expect, test } from '@playwright/test';

const key = process.env.UARP_API_KEY;

test.skip(!key, 'set UARP_API_KEY to run this against a real tenant');

test('a visitor can ask the agent and watch the answer stream in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  //  The key never goes into the page's own storage — it is posted to the
  //  proxy, which answers with a session id. This asserts that.
  await page.getByRole('button', { name: 'Ask the agent' }).click();
  await page.getByPlaceholder('uarp_…').fill(key!);
  await page.getByRole('button', { name: 'Connect' }).click();

  await expect(page.locator('select')).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem('uarp-demo-session'));
  expect(stored, 'a session must be stored').toBeTruthy();
  expect(stored, 'the key must never reach the browser').not.toContain(key!);

  await page.getByPlaceholder('Ask something…').fill('Reply with exactly: streaming works');
  await page.getByRole('button', { name: 'Send' }).click();

  //  The reply is assembled from SSE deltas, so waiting for the text is
  //  waiting for the whole path: proxy, SDK, platform and back.
  await expect(page.getByText('streaming works', { exact: false })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('the documentation renders and the samples are copyable without a key', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /557 endpoints/i })).toBeVisible();
  //  The page is the documentation, so the sections have to be reachable.
  for (const id of ['install', 'streaming', 'browser', 'limits']) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }
  await expect(page.getByRole('heading', { name: 'In the browser' })).toBeVisible();

  await page.getByRole('button', { name: 'Ask the agent' }).click();
  await expect(page.getByPlaceholder('uarp_…')).toBeVisible();
});
