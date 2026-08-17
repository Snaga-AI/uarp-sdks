import { expect, test } from '@playwright/test';

//  The reference is generated at build time and lazy-fetched as /reference.json,
//  so these tests drive a real browser through the fetch + render path — a page
//  that 404s the JSON, or a component that reads the wrong field, shows up here
//  rather than in a bundle-size number.

test('the reference index lists every resource group', async ({ page }) => {
  await page.goto('/docs/reference');
  await expect(page.getByRole('heading', { name: 'API reference' })).toBeVisible();
  // 43 groups, each a link to its own route.
  await expect(page.getByText(/43 resource groups/)).toBeVisible();
  const agentCard = page.getByRole('link', { name: /agents/ }).first();
  await expect(agentCard).toBeVisible();
});

test('a group page lists its methods and reaches a method page', async ({ page }) => {
  await page.goto('/docs/reference/agents');
  await expect(page.getByRole('heading', { name: 'agents', exact: true })).toBeVisible();
  // Pick the create method by its route — the grid layout uses CSS gaps, so the
  // link's textContent has no space between the method name and the verb.
  const createLink = page.locator('a[href="/docs/reference/agents/create"]');
  await expect(createLink).toBeVisible();
  await createLink.click();
  await expect(page).toHaveURL(/\/docs\/reference\/agents\/create$/);
});

test('a method page shows the signature, verb+path and an example', async ({ page }) => {
  await page.goto('/docs/reference/agents/create');
  await expect(page.getByRole('heading', { name: /agents\.create/ })).toBeVisible();
  //  The VERB and path the generator lifted from the JSDoc.
  await expect(page.locator('body')).toContainText('POST');
  await expect(page.locator('body')).toContainText('/api/v1/agents');
  //  The page has two code blocks — signature first, generated example last.
  await expect(page.locator('pre').first()).toContainText('create(body: CreateAgentRequest');
  //  The generated usage snippet.
  await expect(page.locator('pre').last()).toContainText('client.agents.create(body)');
  //  Scopes are shown.
  await expect(page.locator('body')).toContainText('agents:write');
});

test('a streaming method is marked SSE and shows the stream snippet', async ({ page }) => {
  await page.goto('/docs/reference/runs/streamRunEvents');
  await expect(page.getByText('sse', { exact: true })).toBeVisible();
  //  The generated snippet is the last code block on the page.
  await expect(page.locator('pre').last()).toContainText('for await (const event of');
  await expect(page.locator('body')).toContainText('GET');
  await expect(page.locator('body')).toContainText('/api/v1/runs/');
});

test('search finds a method by name', async ({ page }) => {
  await page.goto('/docs/reference');
  //  ⌘K focuses the search box; on Linux/headless Ctrl-K.
  await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+k');
  const search = page.getByPlaceholder(/Search methods/);
  await expect(search).toBeVisible();
  await search.fill('createAPIKey');
  //  The hit links straight to the method route.
  const hit = page.getByRole('button', { name: /tenants\.createAPIKey/ });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(/\/docs\/reference\/tenants\/createAPIKey$/);
});

test('method sections are deep-linkable and the TOC matches what is rendered', async ({ page }) => {
  await page.goto('/docs/reference/agents/create');

  //  A POST with a body has every block: signature, scopes, returns, request
  //  body, response, example. The anchor ids are what a bug report pastes.
  for (const id of ['signature', 'scopes', 'returns', 'request-body', 'example']) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }

  //  The TOC and the blocks are built from one array — this asserts they agree,
  //  which is the whole reason for that array. A block gaining a condition
  //  without a TOC entry would otherwise look like "does not apply here".
  const tocTargets = await page
    .locator('nav[aria-label="On this page"] a')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(tocTargets.length).toBeGreaterThan(2);
  for (const href of tocTargets) {
    await expect(page.locator(href!)).toBeAttached();
  }

  //  Following an anchor moves the browser to that section.
  await page.locator('nav[aria-label="On this page"] a[href="#example"]').click();
  await expect(page).toHaveURL(/#example$/);

  //  A GET with no request body drops that block — from the page AND the TOC.
  await page.goto('/docs/reference/agents/list');
  await expect(page.locator('#request-body')).toHaveCount(0);
  await expect(page.locator('nav[aria-label="On this page"] a[href="#request-body"]')).toHaveCount(0);
  await expect(page.locator('#signature')).toBeAttached();
});

test('a model page renders its fields', async ({ page }) => {
  await page.goto('/docs/reference/model/Agent');
  await expect(page.getByRole('heading', { name: 'Agent', exact: true })).toBeVisible();
  //  The Agent model has a `name` field — a basic drift check.
  await expect(page.locator('table')).toContainText('name');
});