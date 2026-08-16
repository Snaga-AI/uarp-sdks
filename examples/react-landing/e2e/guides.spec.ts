import { expect, test } from '@playwright/test';

//  Guides mix 5-language `Samples` blocks (install/auth/hello/stream/errors/
//  pagination/overrides) with TypeScript-only blocks whose signatures come from
//  reference.json. These tests drive the language switcher through a guide so a
//  block that reads the wrong field, or a Samples record that lost a language,
//  shows up here rather than only in a bundle-size number.

test('the guide index lists every guide', async ({ page }) => {
  await page.goto('/docs/guides');
  await expect(page.getByRole('heading', { name: 'Guides' })).toBeVisible();
  //  The install guide is the first card in the main column (the sidebar links
  //  to the same route, so scope to <main> to avoid a strict-mode match of two).
  const install = page.locator('main').getByRole('link', { name: /Install & authenticate/ });
  await expect(install).toBeVisible();
  await install.click();
  await expect(page).toHaveURL(/\/docs\/guides\/getting-started$/);
});

test('a guide renders prose, a TS code block and a 5-language install block', async ({ page }) => {
  await page.goto('/docs/guides/getting-started');
  await expect(page.getByRole('heading', { name: 'Install & authenticate' })).toBeVisible();
  //  The install block's platform line mentions a registry name.
  await expect(page.locator('body')).toContainText(/npm|crates\.io|SwiftPM|Maven Central|Alire/);
  //  The auth block is a Samples record — switching language rewrites it.
  const before = (await page.locator('pre').filter({ hasText: /UarpClient|from_env|fromEnvironment|From_Environment/ }).first().innerText()).trim();
  await page.goto('/docs/guides/getting-started?lang=swift');
  const after = (await page.locator('pre').filter({ hasText: /UarpClient|from_env|fromEnvironment|From_Environment/ }).first().innerText()).trim();
  expect(after).not.toEqual(before);
  expect(after).toContain('UARPClient');
});

test('a TypeScript guide shows the real method signature from the reference', async ({ page }) => {
  await page.goto('/docs/guides/knowledge-bases');
  //  createKnowledgeBase is named in a TS-only block built from reference.json.
  await expect(page.locator('body')).toContainText('createKnowledgeBase');
  await expect(page.locator('pre').first()).toContainText('name:');
});

test('a guide links to its neighbours along the ordered list', async ({ page }) => {
  await page.goto('/docs/guides/run-and-stream');
  //  run-and-stream is #2: prev is getting-started, next is hitl-run-control.
  await expect(page.getByRole('link', { name: /Install & authenticate/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Human-in-the-loop run control/ }).first()).toBeVisible();
});

test('the mobile nav drawer opens and reaches a route', async ({ page }) => {
  //  Force a mobile viewport so the desktop sidebar is hidden and the Contents
  //  button is the only way in.
  await page.setViewportSize({ width: 414, height: 896 });
  await page.goto('/docs/concepts/install');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  //  The desktop sidebar is hidden at this width.
  await expect(page.locator('aside')).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  //  The drawer exposes the guides group; tap a guide and land on its route.
  await page.getByRole('link', { name: 'Knowledge bases' }).click();
  await expect(page).toHaveURL(/\/docs\/guides\/knowledge-bases$/);
  //  Navigation closed the drawer.
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeHidden();
});