import { expect, test } from '@playwright/test';

test('top navigation describes sections instead of programming languages', async ({ page }) => {
  await page.goto('/docs/concepts/errors');
  await expect(page.locator('header').getByRole('combobox')).toHaveCount(0);
  const sections = page.getByRole('navigation', { name: 'Documentation sections' });
  await expect(sections.getByRole('link', { name: 'Concepts' })).toHaveAttribute('aria-current', 'page');
  await sections.getByRole('link', { name: 'Guides', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Guides', exact: true })).toBeVisible();
});

test('code language synchronizes samples, persists, and preserves the section anchor', async ({ page }) => {
  await page.goto('/docs/guides/getting-started#run');
  await page.locator('#run').getByRole('combobox', { name: 'Example language' }).selectOption('python');
  await expect(page).toHaveURL(/\?lang=python#run$/);
  await expect(page.locator('#install')).toContainText('pip install uarp-sdk');
  await expect(page.locator('#authenticate pre')).toContainText('from uarp_sdk import Client');
  await expect(page.locator('#run pre')).toContainText('CreateRunRequest');
  await page.reload();
  await expect(page.locator('#run').getByRole('combobox')).toHaveValue('python');
});

test('reference makes its language explicit and exposes the active method in the tree', async ({ page }) => {
  await page.goto('/docs/reference/agents/create?lang=python');
  await expect(page.getByRole('combobox', { name: 'Example language' })).toHaveCount(0);
  await expect(page.locator('aside')).toContainText('TypeScript SDK');
  await expect(page.locator('aside a[href="/docs/reference/agents/create"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('aside a[href="/docs/reference/agents/create"]')).toBeVisible();
  await expect(page.locator('#example pre')).toContainText('await client.agents.create(body)');
});

test('global search finds guides from the landing and supports arrow keys and Enter', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search documentation' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('searchbox');
  await input.fill('Quickstart');
  await expect(dialog.getByRole('button', { name: /Quickstart/ }).first()).toBeVisible();
  await input.press('ArrowDown');
  await expect(dialog.locator('ul button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/getting-started$/);
  await expect(dialog).not.toBeVisible();
});

test('search recovers after a failed index request and restores keyboard focus', async ({ page }) => {
  let fail = true;
  await page.route('**/reference.json', route => fail ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue());
  await page.goto('/');
  const trigger = page.locator('header').getByRole('button', { name: 'Search documentation' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Search documentation' });
  await dialog.getByRole('searchbox').fill('createAPIKey');
  await expect(dialog.getByRole('alert')).toBeVisible();
  fail = false;
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByRole('button', { name: /tenants.createAPIKey/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('long schemas can be narrowed by field name and required status', async ({ page }) => {
  await page.goto('/docs/reference/model/Agent');
  const fields = page.getByRole('region', { name: 'Agent fields', exact: true });
  await fields.getByRole('searchbox').fill('agent_id');
  expect(await fields.locator('tbody tr').count()).toBeGreaterThanOrEqual(2);
  await fields.getByRole('checkbox', { name: 'Required only' }).check();
  await expect(fields.locator('tbody tr')).toHaveCount(1);
  await expect(fields.locator('tbody tr')).toContainText('agent_id');
  await fields.getByRole('searchbox').fill('nonexistent-field');
  await expect(fields.getByText(/No fields match/)).toBeVisible();
});

test('wrapping code preserves the copied source', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs/reference/agents/create');
  const example = page.locator('#example');
  const before = await example.locator('code').innerText();
  await example.getByRole('button', { name: 'Wrap lines' }).click();
  await expect(example.getByRole('button', { name: 'Wrap lines' })).toHaveAttribute('aria-pressed', 'true');
  expect(await example.locator('pre').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  await example.getByRole('button', { name: 'Copy', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(before);
});

test('mobile navigation traps focus, closes on Escape, and can open global search', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/guides');
  const trigger = page.getByRole('button', { name: 'Open navigation' });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Contents', exact: true });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole('button', { name: 'Search documentation' }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Search documentation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
