import { expect, test } from '@playwright/test';

const key = process.env.UARP_API_KEY;

//  The ten conceptual sections used to be anchors on one page; they are routes
//  now, one per slug. A test that asserts facts about a section has to get to
//  the section's route first.
const CONCEPTS = [
  'install',
  'authenticate',
  'calling',
  'errors',
  'pagination',
  'streaming',
  'idempotency',
  'overrides',
  'browser',
  'limits',
] as const;

test('a visitor can ask the agent and watch the answer stream in', async ({ page }) => {
  //  Only this one needs a tenant. The skip used to sit at file scope, which
  //  silently took the two documentation tests with it — a suite that reported
  //  "3 skipped" and looked like it had run.
  test.skip(!key, 'set UARP_API_KEY to run this against a real tenant');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  //  The key never goes into the page's own storage — it is posted to the
  //  proxy, which answers with a session id. This asserts that.
  await page.getByRole('button', { name: 'Ask the agent' }).click();
  await page.getByPlaceholder('uarp_…').fill(key!);
  await page.getByRole('button', { name: 'Connect' }).click();

  await expect(page.locator('select')).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem('uarp-demo-session'));
  expect(stored, 'a session must be stored').toBeTruthy();
  expect(stored, 'the key must never reach the browser').not.toContain(key!);

  await page.getByPlaceholder('Ask something…').fill('Reply with exactly: streaming works');
  await page.getByRole('button', { name: 'Send' }).click();

  //  The reply is assembled from SSE deltas, so waiting for the text is
  //  waiting for the whole path: proxy, SDK, platform and back.
  await expect(page.getByText('streaming works', { exact: false })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('the documentation renders and the samples are copyable without a key', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /three lines/i })).toBeVisible();
  //  The hero's promise has to be on the page, not just in the headline.
  await expect(page.locator('section').first()).toContainText('npm install uarp-sdk');

  //  Every concept route has to load and show its own heading — a slug that
  //  404s would render the "Not found" page instead, so the heading is the gate.
  const titles: Record<string, string> = {
    install: 'Install',
    streaming: 'Streaming',
    browser: 'In the browser',
    limits: 'Limits',
  };
  for (const [slug, title] of Object.entries(titles)) {
    await page.goto(`/docs/concepts/${slug}`);
    //  The section heading carries a trailing "#" anchor link, so its accessible
    //  name is "Install #" — match the substring, not the exact string.
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }

  //  The widget is mounted by the root layout, so it is present on a concept
  //  route just as it is on the landing.
  await page.goto('/docs/concepts/browser');
  await page.getByRole('button', { name: 'Ask the agent' }).click();
  await expect(page.getByPlaceholder('uarp_…')).toBeVisible();
});

test('every identifier and sample is marked so a translator leaves it alone', async ({ page }) => {
  //  A browser translating this page rewrites each sentence in the target
  //  language's word order and drags inline elements along, so a paragraph
  //  holding ten of them ends with all ten in a heap: a reader saw
  //  `Idempotency-Key408 409429 500502 503504` and asked whose keys those
  //  were. Samples fare worse — a translated comment or string literal is
  //  code that does not compile.
  //
  //  The sections are routes now, so the check walks every one of them plus
  //  the landing, rather than reading a single page.
  const urls = ['/', ...CONCEPTS.map((slug) => `/docs/concepts/${slug}`)];
  for (const url of urls) {
    await page.goto(url);
    const unmarked = page.locator('code:not([translate="no"]), pre:not([translate="no"])');
    expect(await unmarked.count(), `${url} has an unmarked code element`).toBe(0);
  }

  //  And the facts must survive a fragment being moved anyway, so the ones
  //  that matter are labelled rather than strung through a sentence.
  await page.goto('/docs/concepts/idempotency');
  await expect(page.locator('#idempotency')).toContainText('408 409 429 500 502 503 504');
  await expect(page.locator('#idempotency')).toContainText('Retried');
  await page.goto('/docs/concepts/streaming');
  await expect(page.locator('#streaming')).toContainText('payload.delta');
});

test('the samples follow the language you pick, and the choice sticks', async ({ page }) => {
  await page.goto('/docs/concepts/install');

  //  TypeScript is the default, so its install line is what greets you.
  await expect(page.locator('#install')).toContainText('npm install uarp-sdk');

  await page.getByRole('button', { name: 'Rust', exact: true }).click();
  await expect(page.locator('#install')).toContainText('cargo add uarp-sdk');

  //  The choice is carried by `?lang` / localStorage, so it follows onto a
  //  different section's route without being re-picked.
  await page.goto('/docs/concepts/streaming');
  await expect(page.locator('#streaming')).toContainText('futures_util');

  await page.getByRole('button', { name: 'Ada', exact: true }).click();
  await page.goto('/docs/concepts/install');
  await expect(page.locator('#install')).toContainText('alr with uarp_sdk');
  //  Ada is the one that is not in the community index yet; the page has to
  //  say so rather than send someone to a command that fails.
  await expect(page.locator('#install')).toContainText('Not in the Alire community index yet');

  //  A reader who works in one language should not have to pick it again.
  await page.reload();
  await expect(page.locator('#install')).toContainText('alr with uarp_sdk');
});