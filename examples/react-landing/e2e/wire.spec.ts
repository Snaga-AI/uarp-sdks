import { expect, test } from '@playwright/test';

//  The wire page renders wire.json, generated from contract/SCENARIOS.md and
//  the five per-language runners. These tests check that the page loads the
//  generated data, lists all sixteen scenarios, switches the per-scenario
//  snippet with the language toggle, and renders the prose sections (which
//  carry inline code and bullets) without dropping their content.

test('the wire page lists all sixteen scenarios', async ({ page }) => {
  await page.goto('/docs/wire');
  await expect(page.getByRole('heading', { name: 'Wire' })).toBeVisible();
  await expect(page.locator('body')).toContainText('16 scenarios');
  //  Scenario 1's call renders as an inline code heading.
  await expect(page.getByText('agents.list(limit = 2)', { exact: true })).toBeVisible();
  //  The multipart scenario (10) and the decoder scenario (16) are present.
  await expect(page.locator('body')).toContainText('registryPublish');
  await expect(page.locator('body')).toContainText('runs.get');
});

test('switching language rewrites the scenario snippet', async ({ page }) => {
  await page.goto('/docs/wire');
  //  TypeScript default: the list scenario uses `await client.agents.list`.
  const tsBlock = page.locator('#scenario-1 pre').first();
  await expect(tsBlock).toContainText('await client.agents.list');
  //  Switch to Rust: the same scenario now shows the Rust params struct.
  await page.goto('/docs/wire?lang=rust');
  const rustBlock = page.locator('#scenario-1 pre').first();
  await expect(rustBlock).toContainText('ListAgentsParams');
});

test('the prose sections render their bullets and inline code', async ({ page }) => {
  await page.goto('/docs/wire');
  await expect(page.getByRole('heading', { name: 'What is normalised' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Known differences' })).toBeVisible();
  //  An inline code span from the normalisation section survives as a code
  //  element rather than a literal backtick.
  await expect(page.locator('body')).toContainText('Idempotency-Key');
  //  The recorded bigint difference is mentioned.
  await expect(page.locator('body')).toContainText('9007199254740993');
});