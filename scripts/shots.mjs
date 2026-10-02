// Screens of every flight stop and each tool page for review: node scripts/shots.mjs [1366,390]
import { launch } from './browser.mjs';
const base = process.env.BASE_URL || 'http://localhost:5586', out = 'artifacts/redo';
const widths = (process.argv[2] || '1366,390').split(',').map(Number);
const browser = await launch({ args: ['--use-angle=d3d11'] });
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: w < 500 ? 844 : 768 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1500);
  const span = await page.evaluate(() => { const t = document.querySelector('.flight'); return t.offsetHeight - innerHeight; });
  for (let i = 0; i < 8; i++) {
    await page.evaluate(y => scrollTo(0, y), Math.round(span * i / 7)); await page.waitForTimeout(1300);
    await page.screenshot({ path: `${out}/${w}-stop${i}.png` });
  }
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${w}-end.png` });
  for (const r of ['privacy', 'vault', 'docs']) { await page.goto(base + '/' + r, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); await page.screenshot({ path: `${out}/${w}-${r}.png` }); }
  console.log(w, 'errors', JSON.stringify(errors.slice(0, 5)));
  await page.close();
}
await browser.close();
