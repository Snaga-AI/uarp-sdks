import { expect, test } from '@playwright/test';

test('mobile code wraps by default and exposes touch-sized controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/concepts/authenticate');
  const frame = page.locator('main .code-frame').first();
  await expect(frame.getByRole('button', { name: 'Wrap lines' })).toHaveAttribute('aria-pressed', 'true');
  expect(await frame.locator('pre').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  for (const control of await frame.locator('button, select').all()) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await frame.getByRole('button', { name: 'Wrap lines' }).click();
  await expect(frame.getByRole('button', { name: 'Wrap lines' })).toHaveAttribute('aria-pressed', 'false');
});

test('expanded code supports language changes, exact copying and focus restoration', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/concepts/authenticate');
  const trigger = page.locator('main .code-frame').first().getByRole('button', { name: 'Expand code' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'TypeScript code example' });
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBe(390);
  await dialog.getByRole('combobox', { name: 'Example language' }).selectOption('python');
  const python = page.getByRole('dialog', { name: 'Python code example' });
  await expect(python.locator('code')).toContainText('from uarp_sdk import Client');
  const source = await python.locator('code').innerText();
  await python.getByRole('button', { name: 'Copy', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  await python.getByRole('button', { name: 'Close code example' }).click();
  await expect(python).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.locator('main .code-frame select').first()).toHaveValue('python');
});

test('clipboard rejection selects the source for manual copying', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied')) } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/concepts/authenticate');
  const frame = page.locator('main .code-frame').first();
  const source = await frame.locator('code').innerText();
  await frame.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Code selected' })).toBeVisible();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(source);
});

test('small screens and landscape keep code tools and chat inside the viewport', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/docs/concepts/authenticate');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const frame = page.locator('main .code-frame').first();
    await frame.getByRole('button', { name: 'Expand code' }).click();
    const dialog = page.getByRole('dialog', { name: 'TypeScript code example' });
    await expect(dialog).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds.width).toBeLessThanOrEqual(viewport.width);
    await dialog.getByRole('button', { name: 'Close code example' }).click();
  }
});

test('mobile chat opens from the header without a launcher overlaying code', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await page.goto('/docs/concepts/authenticate');
  const trigger = page.getByRole('button', { name: 'Ask the agent', exact: true });
  await expect(trigger).toBeVisible();
  expect(await trigger.evaluate(el => el.closest('header') !== null)).toBe(true);
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Agent assistant' });
  await expect(panel.getByPlaceholder('uarp_…')).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(568);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(trigger).toBeFocused();
});
