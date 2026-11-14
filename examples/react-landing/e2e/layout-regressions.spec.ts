import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`long wire headings and generated model links wrap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    for (const path of ['/docs/wire', '/docs/reference/adminConfig/putQualificationSponsorshipProgram']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (path === '/docs/wire') await expect(page.locator('#scenario-22')).toBeAttached();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
      for (const heading of await page.locator('main h2, main h3').all()) {
        expect(await heading.evaluate(el => el.scrollWidth <= el.clientWidth + 2), await heading.textContent()).toBe(true);
      }
    }
  });
}

test('mobile model fields expose types and descriptions without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/docs/reference/model/Agent');
  await page.getByRole('searchbox', { name: 'Filter agent fields' }).fill('agent_id');
  const table = page.getByRole('table', { name: 'Agent', exact: true });
  await expect(table).toBeVisible();
  const rows = table.locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
  for (const row of await rows.all()) {
    const boxes = await row.locator('td').evaluateAll(cells => cells.map(cell => ({ top: cell.getBoundingClientRect().top, width: cell.getBoundingClientRect().width, scroll: cell.scrollWidth, client: cell.clientWidth })));
    expect(boxes[1].top).toBeGreaterThan(boxes[0].top);
    expect(boxes[2].top).toBeGreaterThan(boxes[1].top);
    for (const box of boxes) { expect(box.width).toBeGreaterThan(100); expect(box.scroll).toBeLessThanOrEqual(box.client + 1); }
  }
  expect(await table.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('docs root and missing pages use readable layouts', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/docs');
  await expect(page).toHaveURL(/\/docs\/guides\/getting-started$/);
  await expect(page.getByRole('heading', { name: 'Your first agent run.' })).toBeVisible();
  for (const path of ['/missing-page', '/docs/reference/no-such-group']) {
    await page.goto(path);
    const title = page.getByRole('heading', { name: 'Not found', exact: true });
    await expect(title).toBeVisible();
    expect((await title.boundingBox())!.x).toBeGreaterThanOrEqual(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('search remains usable in a short landscape viewport', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await page.locator('header').getByRole('button', { name: 'Search documentation' }).click();
  const search = page.getByRole('dialog', { name: 'Search documentation' });
  await search.getByRole('searchbox').fill('agent');
  await expect(search.locator('ul button').first()).toBeVisible();
  const bounds = (await search.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(390);
  await expect(search.getByRole('button', { name: 'Close search' })).toBeInViewport();
  await expect(search.getByText('↑ ↓ to explore · Enter to open · Esc to close')).toBeInViewport();
});
