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