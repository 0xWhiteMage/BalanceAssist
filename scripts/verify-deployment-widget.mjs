import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const deploymentUrl = process.env.DEPLOYMENT_URL;
const releaseSha = process.env.RELEASE_SHA;
if (!deploymentUrl || !/^[0-9a-f]{40}$/.test(releaseSha ?? '')) process.exit(1);

let origin;
try {
  const parsed = new URL(deploymentUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) process.exit(1);
  origin = parsed.origin;
} catch {
  process.exit(1);
}

const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(new URL('/preview', origin).href, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Build a brief with AI', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Talk to the team without AI', exact: true }).waitFor();
    const results = await new AxeBuilder({ page })
      .include('.balance-widget-dialog')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    if (results.violations.length) {
      console.error(`Immutable deployment accessibility check failed: ${results.violations.map(({ id }) => id).join(',')}`);
      process.exitCode = 1;
    }
    if (viewport.width === 390) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) process.exitCode = 1;
    }
    await context.close();
  }
} finally {
  await browser.close();
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Immutable deployment desktop/mobile entry accessibility passed.');
