import { expect, test } from '@playwright/test';
import { VERSION } from 'uarp-sdk';

test('SDK version agrees with the generated reference and install samples', async ({ page }) => {
  const reference = await (await page.request.get('/reference.json')).json();
  expect(reference.sdkVersion).toBe(VERSION);
  await page.goto('/docs/reference');
  await expect(page.getByTestId('sdk-version')).toHaveText(VERSION);
  await expect(page.locator('main')).toContainText(`v${VERSION}`);
  await page.goto('/docs/concepts/install?lang=kotlin');
  await expect(page.locator('pre')).toContainText(`ai.snaga:uarp-sdk:${VERSION}`);
  await page.goto('/docs/concepts/install?lang=swift');
  await expect(page.locator('pre')).toContainText(`exact: "${VERSION}"`);
});

test('resource and method filters narrow results and show an empty state', async ({ page }) => {
  await page.goto('/docs/reference');
  await page.getByRole('searchbox', { name: 'Filter resource groups' }).fill('agents');
  await expect(page.locator('main a[href="/docs/reference/agents"]').last()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Filter resource groups' }).fill('no-such-resource');
  await expect(page.getByText(/No resource groups match/)).toBeVisible();
  await page.goto('/docs/reference/agents');
  await page.getByRole('searchbox', { name: 'Filter methods' }).fill('create');
  await expect(page.locator('main a[href="/docs/reference/agents/create"]')).toBeVisible();
  await expect(page.locator('main a[href="/docs/reference/agents/list"]')).toHaveCount(0);
});

test('guide contents link to rendered sections and shared language follows navigation', async ({ page }) => {
  await page.goto('/docs/guides/run-and-stream?lang=python');
  const toc = page.getByRole('navigation', { name: 'On this page' });
  for (const href of await toc.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')))) {
    await expect(page.locator(href!)).toBeVisible();
  }
  await toc.getByRole('link', { name: 'Stream the response' }).click();
  await expect(page).toHaveURL(/#stream-the-response$/);
  await page.getByRole('link', { name: 'Next → Human-in-the-loop run control' }).click();
  await expect(page.getByRole('combobox', { name: 'Example language', exact: true }).first()).toHaveValue('python');
});

test('guide and reference pages remain readable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/docs/guides', '/docs/guides/run-and-stream', '/docs/reference', '/docs/reference/agents', '/docs/reference/agents/create', '/docs/reference/model/Agent']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
  }
});
