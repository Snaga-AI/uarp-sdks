import { expect, test } from '@playwright/test';

test('landing leads to quickstart and selected language follows navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Example language', exact: true }).first().selectOption('python');
  await page.getByRole('link', { name: 'Start building', exact: true }).click();
  await expect(page).toHaveURL(/getting-started\?lang=python/);
  await expect(page.getByRole('heading', { name: 'Your first agent run.' })).toBeVisible();
  await expect(page.locator('#install')).toContainText('pip install uarp-sdk');
  await expect(page.locator('#run pre')).toContainText('CreateRunRequest');
  for (const id of ['install', 'authenticate', 'run', 'result']) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }
});

test('copy preserves source and code has distinct syntax styles', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs/guides/getting-started?lang=ts');
  const frame = page.locator('#run .code-frame');
  const source = await frame.locator('code').innerText();
  await frame.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Copied ✓' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  expect(source).toContain("import { UarpClient }");
  expect(source).toContain('result.status');
  const keyword = await frame.locator('.token-keyword').first().evaluate(el => getComputedStyle(el).color);
  const string = await frame.locator('.token-string').first().evaluate(el => getComputedStyle(el).color);
  expect(keyword).not.toBe(string);
});

test('landing and quickstart fit narrow screens in all languages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/', '/docs/guides/getting-started']) {
    for (const language of ['ts', 'python', 'rust', 'swift', 'kotlin', 'ada']) {
      await page.goto(`${route}?lang=${language}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
