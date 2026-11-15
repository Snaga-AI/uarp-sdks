/** Geometry audit of every generated reference route and all authored docs pages. */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ref = JSON.parse(readFileSync(resolve(root, 'public/reference.json'), 'utf8'));
const guideSlugs = [...readFileSync(resolve(root, 'src/content/guides.tsx'), 'utf8').matchAll(/slug: '([^']+)'/g)].map(match => match[1]);
const concepts = ['install', 'authenticate', 'calling', 'errors', 'pagination', 'streaming', 'idempotency', 'overrides', 'browser', 'limits'];
const routes = [...new Set(['/', '/docs/guides', '/docs/reference', '/docs/wire', '/docs/missing-page', '/missing-page', ...concepts.map(slug => `/docs/concepts/${slug}`), ...guideSlugs.map(slug => `/docs/guides/${slug}`), ...ref.groups.flatMap(group => [`/docs/reference/${group.accessor}`, ...group.methods.map(method => `/docs/reference/${group.accessor}/${method.name}`)]), ...Object.keys(ref.models).map(model => `/docs/reference/model/${model}`)])];
const widths = (process.env.AUDIT_WIDTHS ?? '320,390,1440').split(',').map(Number);
const browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
try {
  const scans = await Promise.allSettled(widths.map(async width => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(process.env.AUDIT_URL ?? 'http://localhost:4318/docs/reference');
    await page.locator('h1').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const issues = [];
    for (let index = 0; index < routes.length; index++) {
      const route = routes[index];
      await page.evaluate(route => {
        history.pushState({}, '', route); dispatchEvent(new PopStateEvent('popstate'));
      }, route);
      await page.waitForFunction(route => {
        if (document.querySelector('[data-docs-route]')?.getAttribute('data-docs-route') !== route) return false;
        const heading = document.querySelector('main h1') ?? document.querySelector('main h2');
        if (!heading) return false;
        if (route === '/docs/wire') return Boolean(document.querySelector('#scenario-22'));
        if (route.startsWith('/docs/reference/')) {
          const parts = route.split('/');
          const expected = parts[3] === 'model' ? parts[4] : parts.length === 5 ? `${parts[3]}.${parts[4]}` : parts[3];
          return heading.textContent.trim() === expected;
        }
        return !document.querySelector('main [role="status"]')?.textContent.startsWith('Loading');
      }, route).catch(error => { throw new Error(`${width}px ${route}: ${error.message}`); });
      const errors = await page.evaluate(() => {
        document.querySelectorAll('main details').forEach(node => { node.open = true; });
        const errors = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) errors.push({ kind: 'page-overflow', extra: document.documentElement.scrollWidth - innerWidth });
        const main = document.querySelector('main') ?? document.querySelector('#root');
        for (const el of main.querySelectorAll('h1,h2,h3,p,button,select,input,a,summary,code')) {
          if (!el.getClientRects().length || el.closest('dialog:not([open])') || el.closest('pre,[role="region"],.shell-source')) continue;
          const bounds = el.getBoundingClientRect();
          if (!bounds.width || !bounds.height) continue;
          const style = getComputedStyle(el);
          if (style.display === 'inline' || style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '') continue;
          if (el.scrollWidth > el.clientWidth + 2 && style.overflowX !== 'auto' && style.overflowX !== 'scroll') errors.push({ kind: 'text-overflow', tag: el.tagName, text: el.textContent.trim().slice(0, 100), extra: el.scrollWidth - el.clientWidth });
          if (el.matches('input[type="search"]') && bounds.width < 80) errors.push({ kind: 'cramped-input', width: bounds.width });
        }
        for (const toolbar of main.querySelectorAll('.code-toolbar')) {
          if (!toolbar.getClientRects().length) continue;
          const controls = [...toolbar.querySelectorAll('button,select')].map(el => el.getBoundingClientRect());
          for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
            const a = controls[i], b = controls[j];
            if (Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1) errors.push({ kind: 'control-overlap' });
          }
        }
        return errors.slice(0, 12);
      });
      if (errors.length) issues.push({ route, errors });
      if ((index + 1) % 500 === 0) console.log(`${width}px: ${index + 1}/${routes.length} routes, ${issues.length} affected`);
    }
    await page.close(); return { width, count: routes.length, issues };
  }));
  const report = scans.map(scan => scan.status === 'fulfilled' ? scan.value : { error: String(scan.reason) });
  const output = process.env.AUDIT_OUTPUT ?? '/tmp/sdk-layout-audit.json';
  writeFileSync(output, JSON.stringify(report, null, 2));
  for (const scan of report) console.log(JSON.stringify({ width: scan.width, checked: scan.count, affected: scan.issues?.length, examples: scan.issues?.slice(0, 5), error: scan.error }));
  console.log(`Report: ${output}`);
  if (report.some(scan => scan.error || scan.issues?.length)) process.exitCode = 1;
} finally { await browser.close(); }
