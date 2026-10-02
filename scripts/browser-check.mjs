import { expect } from '@playwright/test';
import { launch } from './browser.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const base = process.env.BASE_URL || 'http://localhost:5586';
const dir = `artifacts/${process.env.BASE_URL ? 'production' : 'local'}`;
mkdirSync(dir, { recursive: true });
const browser = await launch({ args: ['--use-angle=d3d11'] });
const report = [];
try {
  for (const width of [1366, 1920, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    for (const route of ['/', '/terminal', '/privacy', '/vault', '/docs']) {
      await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      await page.locator('h1').waitFor(); await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(()=>document.fonts.check('14px "Spline Sans Mono Variable"') && getComputedStyle(document.body).fontFamily.includes('Spline Sans Mono Variable')),true,'Authored UI font is loaded');
      await page.waitForTimeout(300);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} overflow ${width}`);
      if (route === '/terminal') {
        await page.locator('.t-row').first().waitFor({ timeout: 40000 }); await page.locator('.t-head h2').waitFor({ timeout: 40000 }); await page.waitForTimeout(1500);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `terminal overflow with data ${width}`);
        assert.ok(await page.locator('.t-chart canvas, .t-chart-state').count() > 0, 'Terminal shows a chart or its state');
      }
      await page.screenshot({ path: `${dir}/${width}-${route === '/' ? 'home' : route.slice(1)}.png` });
      if (route === '/') {
        const mark = page.locator('.ch-first .wordmark-mark');
        await expect(mark).toHaveAttribute('data-ready', 'true');
        assert.ok(Number(await mark.getAttribute('data-particles')) > 1000, 'Wordmark is sampled into particles');
        if (width >= 768) {
          await page.waitForTimeout(2600);
          const mb = await mark.boundingBox();
          await page.mouse.move(mb.x - 200, mb.y + mb.height / 2); await page.mouse.move(mb.x + mb.width * .45, mb.y + mb.height / 2, { steps: 10 });
          await expect(mark).toHaveAttribute('data-moving', '');
          await page.screenshot({ path: `${dir}/${width}-wordmark-hover.png` });
          await page.mouse.move(5, 5);
          await expect(mark).not.toHaveAttribute('data-moving', '', { timeout: 8000 });
        }
        const cta = page.getByRole('link', { name: 'Open privacy workspace', exact: true });
        const box = await cta.boundingBox();
        assert.ok(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('a')?.getAttribute('href')==='/privacy',{x:box.x+box.width/2,y:box.y+box.height/2}), 'Hero CTA receives pointer input');
        await page.locator('.tape[data-ready]').waitFor({ timeout: 20000 });
        assert.ok(await page.locator('.tape .lane-set:not([aria-hidden]) .coin').count() >= 16, 'Running coins are listed');
        await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.tape .coin img')].some(i => i.complete && i.naturalWidth > 0)), { message: 'Coin logos load', timeout: 15000 }).toBe(true);
        assert.equal(await page.locator('.tape .lane-label').count(), 6, 'Three groups in two lanes, doubled for the loop');
        const track = () => page.evaluate(() => getComputedStyle(document.querySelector('.lane-track')).transform);
        const t0 = await track(); await page.waitForTimeout(600); assert.notEqual(await track(), t0, 'Coins run');
        const coinBox = await page.locator('.tape .lane-set:not([aria-hidden]) .coin').nth(2).boundingBox();
        if (coinBox && coinBox.x > 0 && coinBox.x + coinBox.width < width) {
          await page.mouse.move(coinBox.x + coinBox.width / 2, coinBox.y + coinBox.height / 2); await page.waitForTimeout(200);
          const h0 = await track(); await page.waitForTimeout(400); assert.equal(await track(), h0, 'Coins pause on hover');
          assert.ok(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('a.coin')?.getAttribute('href').startsWith('/terminal'),{x:coinBox.x+coinBox.width/2,y:coinBox.y+coinBox.height/2}), 'Coin opens the terminal');
          await page.mouse.move(0, 0);
        }
        if (width < 650) {
          await page.getByRole('button',{name:'Open menu',exact:true}).click();
          await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeHidden();
        }
        await expect(page.locator('.gate-scene')).toHaveAttribute('data-ready', 'true');
        const canvas = page.locator('.gate-scene canvas');
        const pixels = PNG.sync.read(await canvas.screenshot());
        let dark = 0, light = 0;
        for (let i = 0; i < pixels.data.length; i += 4) { if (pixels.data[i] < 60) dark++; if (pixels.data[i + 2] > 180) light++; }
        assert.ok(dark > 1000 && light > 1000, 'Scene has rendered gate and sky');
        const before = await page.locator('.gate-scene').getAttribute('data-pose');
        await page.evaluate(() => scrollTo(0, 280)); await page.waitForTimeout(250);
        assert.notEqual(await page.locator('.gate-scene').getAttribute('data-pose'), before);
        await page.evaluate(() => scrollTo(0,0)); await page.waitForTimeout(600);
        assert.equal(await page.locator('.gate-scene').getAttribute('data-pose'), before);
        const span = await page.evaluate(() => document.querySelector('.flight').offsetHeight - innerHeight);
        await page.evaluate(y => scrollTo(0, y), Math.round(span * 3 / 7)); await page.waitForTimeout(1400);
        await expect(page.locator('.ch-inside')).toHaveAttribute('data-live', '');
        await expect(page.locator('.ch-hero').first()).not.toHaveAttribute('data-on', '');
        assert.ok(await page.locator('.steps li[data-lit]').count() > 0, 'Steps light while the gate is open');
        await page.screenshot({ path: `${dir}/${width}-inside.png` });
        await page.evaluate(y => scrollTo(0, y), Math.round(span * 5 / 7)); await page.waitForTimeout(1400);
        await expect(page.locator('.ch-fees')).toHaveAttribute('data-live', '');
        assert.equal(await page.locator('.fee-split li').count(), 3, 'Fees split three ways');
        const feeKey = page.getByRole('link', { name: 'How it will work', exact: true }), vb = await feeKey.boundingBox();
        assert.ok(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('a')?.getAttribute('href')==='/docs#fees',{x:vb.x+vb.width/2,y:vb.y+vb.height/2}), 'Chapter key receives pointer input');
        await page.screenshot({ path: `${dir}/${width}-fees-stop.png` });
        await page.getByText('How do I recover a private balance?', { exact: true }).click();
        await expect(page.locator('details[open]')).toHaveCount(1);
      }
      if (route === '/privacy') {
        // no wallet: the holders gate stands in front of the workspace
        await expect(page.locator('.gate-card')).toBeVisible();
        await expect(page.locator('.gate-card').getByRole('button', { name: 'Connect wallet' })).toBeVisible();
        await expect(page.locator('.privacy-workspace')).toHaveCount(0);
      }
    }
    assert.deepEqual(errors, []); await page.close(); report.push({width, passed:true}); console.log(`PASS UI ${width}`);
  }
  // Terminal buy flow with a stand-in wallet: it starts on another chain, its account is the WETH contract (which holds ETH,
  // so the server's dry run is real), and eth_sendTransaction is captured and answered with a fake hash. Nothing is broadcast.
  const buyer = await browser.newPage({ viewport: { width: 1366, height: 800 } });
  const buyErrors = []; buyer.on('pageerror', e => buyErrors.push(e.message));
  await buyer.addInitScript(() => {
    const account = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', listeners = {}; let chainId = '0x1'; window.__calls = [];
    const provider = { request: async ({ method, params }) => {
      window.__calls.push(method);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
      if (method === 'eth_chainId') return chainId;
      if (method === 'wallet_switchEthereumChain') { chainId = params[0].chainId; (listeners.chainChanged || []).forEach(f => f(chainId)); return null; }
      if (method === 'eth_sendTransaction') { window.__sent = params[0]; return '0x' + 'ab'.repeat(32); }
      throw Object.assign(new Error('unsupported ' + method), { code: 4200 });
    }, on: (e, f) => { (listeners[e] ||= []).push(f); }, removeListener() {} };
    window.ethereum = provider;
    const info = { uuid: 'test-wallet', name: 'Test wallet', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E', rdns: 'test.wallet' };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce); announce();
  });
  const buys = [['0x56fa3670e19396c4ee8f7775b49ceaede04a84ef', '0xcaf681a66d020601342297493863e78c959e5cb2', '0x5ae401dc'], ['0xc0d6457c16cc70d6790dd43521c899c87ce02f35', '0x8876789976decbfcbbbe364623c63652db8c0904', '0x3593564c']];
  for (const [i, [token, router, selector]] of buys.entries()) {
    await buyer.goto(base + '/terminal/' + token, { waitUntil: 'domcontentloaded' });
    await buyer.locator('.t-head h2').waitFor({ timeout: 60000 });
    if (i === 0) {
      // The app bar search: "/" focuses it and a name finds a stock while the memes tab is open.
      await buyer.evaluate(() => document.activeElement?.blur());
      await buyer.keyboard.press('/');
      assert.equal(await buyer.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Search coins', '"/" focuses the search');
      await buyer.keyboard.type('meta');
      await expect(buyer.locator('.t-rows .t-row', { hasText: 'META' }).first()).toBeVisible({ timeout: 10000 });
      await buyer.getByLabel('Search coins').fill('');
      await buyer.locator('.dock-wallet').first().click();
      await expect(buyer.locator('.dock-wallet.on').first()).toContainText('0x0bd7', { timeout: 15000 });
      assert.ok((await buyer.evaluate(() => window.__calls)).includes('wallet_switchEthereumChain'), 'Connecting switches the wallet to Robinhood Chain');
    }
    await expect.poll(() => buyer.locator('.t-bal b').first().textContent(), { message: 'ETH balance shows', timeout: 30000 }).not.toBe('—');
    await buyer.getByLabel('Amount of ETH').fill('0.001');
    const go = buyer.locator('.t-go'); await expect(go).toBeEnabled({ timeout: 60000 });
    if ((await go.textContent()) === 'Switch to Robinhood Chain') { await go.click(); await expect(buyer.locator('.t-net')).toContainText('Robinhood Chain'); }
    await expect(go).toHaveText(/^Buy /, { timeout: 60000 }); await expect(go).toBeEnabled();
    await buyer.evaluate(() => { window.__sent = undefined; });
    await go.click();
    await expect.poll(() => buyer.evaluate(() => window.__sent), { message: 'Wallet receives the buy', timeout: 60000 }).toBeTruthy();
    const sentTx = await buyer.evaluate(() => window.__sent);
    assert.equal(sentTx.to.toLowerCase(), router, 'Buy goes to the quoted router');
    assert.equal(sentTx.value, '0x38d7ea4c68000', 'Buy sends exactly 0.001 ETH');
    assert.ok(sentTx.data.startsWith(selector) && /^0x[0-9a-f]+$/i.test(sentTx.gas), 'Router call and dry-run gas');
    await expect(buyer.getByText('Buy sent.')).toBeVisible();
    await buyer.screenshot({ path: `${dir}/terminal-buy-${i}.png` });
  }
  assert.deepEqual(buyErrors, []); await buyer.close();
  console.log('PASS terminal connect, balance, V3 and V4 buys through a stand-in wallet');

  // The holders gate: a stand-in wallet in front of the privacy workspace and a mocked holder reading (a short wallet, then a holder).
  const CA = '0xbe5d432a0b30443987d261b664cc6bb8bccb80d6';
  for (const [width, worth] of [[1366, 12.5], [1366, 4200], [390, 4200]]) {
    const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.ethereum = { request: async ({ method }) => { if (method === 'eth_accounts' || method === 'eth_requestAccounts') return ['0x3333333333333333333333333333333333333333']; if (method === 'eth_chainId') return '0x1237'; if (method === 'eth_getBalance') return '0x0'; throw Object.assign(new Error('unsupported ' + method), { code: 4200 }); }, on() {}, removeListener() {} }; });
    await page.route('**/api/terminal?action=holder*', r => r.fulfill({ json: { account: '0x3333333333333333333333333333333333333333', token: CA, balance: '1', amount: worth / 0.00003, priceUsd: 0.00003, priceSource: 'curve', worthUsd: worth, minUsd: 150, ok: worth >= 150, at: new Date().toISOString() } }));
    await page.goto(base + '/privacy', { waitUntil: 'domcontentloaded' });
    if (worth < 150) {
      await expect(page.locator('.gate-note')).toContainText('Add about $137.50 more');
      assert.equal(await page.locator('.gate-card a.button').getAttribute('href'), '/terminal/' + CA, 'The gate links to buying $OGATE');
      await expect(page.locator('.privacy-workspace')).toHaveCount(0);
    } else {
      await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
      await expect(page.getByLabel('Recipient wallet')).toBeVisible();
      await page.getByLabel('Payment amount').fill('1e3');
      await expect(page.locator('.privacy-form .privacy-error')).toContainText('decimal');
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await expect(page.getByText('No operations in this session')).toBeVisible();
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `gate overflow ${width}`);
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('PASS holders gate: no wallet, a short wallet and a holder in front of the privacy workspace');
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(base + '/vault');
  let sent = 0; page.on('request', req => { if (req.method() === 'POST' || req.method() === 'PUT') sent++; });
  const content = Buffer.from('Onegate browser encryption verification');
  await page.getByLabel('Choose file').setInputFiles({ name: 'test.txt', mimeType: 'text/plain', buffer: content });
  await page.getByLabel('Passphrase', { exact: true }).fill('a strong test passphrase only');
  await page.getByLabel('Confirm passphrase').fill('a strong test passphrase only');
  await page.locator('form').getByRole('button', { name: 'Encrypt file', exact: true }).click();
  await expect(page.getByText('Encrypted file ready')).toBeVisible();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', {name:'Download'}).click();
  const download = await downloadPromise; const path = await download.path();
  await page.getByRole('button', {name:'Decrypt file', exact:true}).click();
  await page.getByLabel('Choose file').setInputFiles({name:'sealed.onegate', mimeType:'application/octet-stream', buffer:readFileSync(path)});
  await page.getByLabel('Passphrase', {exact:true}).fill('a strong test passphrase only');
  await page.locator('form').getByRole('button', {name:'Decrypt file',exact:true}).click();
  await expect(page.getByText('File decrypted', {exact:true})).toBeVisible();
  const secondPromise = page.waitForEvent('download'); await page.getByRole('link',{name:'Download'}).click();
  const second = await secondPromise; assert.deepEqual(readFileSync(await second.path()), content);
  assert.equal(second.suggestedFilename(), 'test.txt'); assert.equal(sent,0);
  await page.getByRole('button',{name:'Clear session'}).click();
  await expect(page.getByLabel('Passphrase',{exact:true})).toHaveValue('');
  await expect(page.getByRole('link',{name:'Download'})).toHaveCount(0); await page.close();
  const reduced = await browser.newPage({reducedMotion:'reduce', viewport:{width:390,height:844}});
  await reduced.goto(base); await reduced.locator('.gate-scene canvas').waitFor();
  await reduced.addStyleTag({ content: '.ch{display:none!important}' }); await reduced.waitForTimeout(200);
  const reducedBefore = await reduced.locator('.gate-scene canvas').screenshot();
  await reduced.waitForTimeout(300);
  assert.ok((await reduced.locator('.gate-scene canvas').screenshot()).equals(reducedBefore), 'Reduced motion keeps the scene still');
  assert.equal(await reduced.evaluate(() => getComputedStyle(document.querySelector('.lane-track')).animationName), 'none', 'Coins stay still under reduced motion');
  assert.equal(await reduced.locator('.ch-first .wordmark-mark').getAttribute('data-ready'), null, 'Reduced motion keeps the plain wordmark');
  await reduced.close();
  const fallback = await browser.newPage({viewport:{width:390,height:844}});
  await fallback.addInitScript(() => { const original=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(type,...args){ if(String(type).includes('webgl')) return null; return original.call(this,type,...args); }; });
  await fallback.goto(base); await expect(fallback.locator('.gate-scene')).toHaveAttribute('data-failed','true');
  await fallback.screenshot({path:`${dir}/fallback.png`});
  await fallback.getByRole('link',{name:'Open privacy workspace',exact:true}).click();
  await expect(fallback.getByRole('heading',{name:'Privacy workspace',exact:true})).toBeVisible(); await fallback.close();
  const context = await browser.newPage(); await context.goto(base); await context.locator('.gate-scene canvas').waitFor();
  await context.evaluate(()=>{const c=document.querySelector('.gate-scene canvas');const gl=c.getContext('webgl2');window.__loss=gl.getExtension('WEBGL_lose_context');window.__loss.loseContext();});
  await expect(context.locator('.gate-scene')).toHaveAttribute('data-failed','true');
  await context.evaluate(()=>window.__loss.restoreContext());
  await expect(context.locator('.gate-scene')).not.toHaveAttribute('data-failed','true');await context.close();
  writeFileSync(`${dir}/report.json`,JSON.stringify({base,report,vaultRoundTrip:true,runningCoins:true,terminalBuys:true,wordmarkParticles:true,zeroFileUploads:true,reducedMotion:true,noWebgl:true,contextRestore:true},null,2));
  console.log('PASS vault round trip, reduced motion, WebGL fallback and context restoration');
} finally { await browser.close(); }
