import { expect, test } from '@playwright/test';

test('direct links scroll to asynchronously loaded sections and keep the contents current', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/docs/reference/agents/create#response');
  const contents = page.getByRole('navigation', { name: 'On this page' });
  await expect(contents.getByRole('link', { name: 'Response', exact: true })).toHaveAttribute('aria-current', 'location');
  const top = await page.locator('#response').evaluate(el => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(200);
  expect(await contents.evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  await contents.getByRole('link', { name: 'Example', exact: true }).click();
  await expect(contents.getByRole('link', { name: 'Example', exact: true })).toHaveAttribute('aria-current', 'location');
  await contents.getByRole('link', { name: 'Back to top' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
});

test('deep resource navigation keeps the current item inside the sidebar viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const ref = await (await page.request.get('/reference.json')).json();
  const group = ref.groups.at(-1);
  const method = group.methods.at(-1);
  await page.goto(`/docs/reference/${group.accessor}/${method.name}`);
  const current = page.locator('aside a[aria-current="page"]');
  await expect(current).toBeVisible();
  await expect(current).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('method links are copyable and mobile contents keep a single column', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/reference/agents/create?lang=python');
  await page.getByRole('button', { name: 'Copy page link' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/docs\/reference\/agents\/create\?lang=python$/);
  await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
