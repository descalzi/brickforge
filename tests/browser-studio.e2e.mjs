// Chromium check of the Describe & build studio: load, build an example, export.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {createReadStream, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const mime = new Map([['.html', 'text/html'], ['.js', 'text/javascript'], ['.json', 'application/json'], ['.css', 'text/css'], ['.svg', 'image/svg+xml']]);
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root, '.' + pathname);
  if (!target.startsWith(root + path.sep) && target !== root) { res.writeHead(403).end(); return; }
  if (!existsSync(target)) { res.writeHead(404).end('Not found'); return; }
  res.setHeader('Content-Type', mime.get(path.extname(target)) || 'application/octet-stream');
  createReadStream(target).pipe(res);
});
await new Promise(resolve => server.listen(4176, '127.0.0.1', resolve));
const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
try {
  const page = await browser.newPage({acceptDownloads: true}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:4176/studio.html?example=cottage&run=1', {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => ['planned', 'blocked'].includes(document.querySelector('#engine-status')?.dataset.state), null, {timeout: 60000});
  const message = await page.locator('#engine-status').innerText();
  assert.equal(await page.locator('#engine-status').getAttribute('data-state'), 'planned', 'Studio did not build: ' + message + '; errors: ' + errors.join(' | '));
  assert.ok(Number(await page.locator('#stat-parts').innerText()) > 50, 'Cottage should use real parts');
  assert.match(await page.locator('#report-summary').innerText(), /Shape match \d+%/);
  assert.match(await page.locator('#report-summary').innerText(), /33 degree slopes/);
  // The viewer renders every part.
  const parts = await page.locator('#studio-viewport canvas, #studio-viewport svg').first().getAttribute('data-parts');
  assert.equal(parts, await page.locator('#stat-parts').innerText());
  // Step slider shows a step description.
  await page.locator('#step-slider').fill('1');
  assert.match(await page.locator('#step-detail').innerText(), /^Step 1:/);
  // LDraw export contains one line per part.
  const [ldraw] = await Promise.all([page.waitForEvent('download'), page.locator('#download-ldraw').click()]);
  const text = await (await ldraw.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString());
  assert.equal(text.split('\n').filter(line => line.startsWith('1 ')).length, Number(await page.locator('#stat-parts').innerText()));
  // The booklet renders in its worker.
  const [pdf] = await Promise.all([page.waitForEvent('download', {timeout: 120000}), page.locator('#download-pdf').click()]);
  const bytes = Buffer.concat(await (await pdf.createReadStream()).toArray());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  // Review and refine through a gateway: it receives the intent, the report and three
  // rendered views, and its revised intent is built.
  const current = JSON.parse(await page.locator('#intent-input').inputValue());
  let received = null;
  await page.route('**/review-gateway', async route => {
    received = JSON.parse(route.request().postData());
    await route.fulfill({json: {...current, assumptions: [...(current.assumptions || []), 'Review: chimney a little taller.']}});
  });
  await page.locator('#interpretation-provider').selectOption('gateway');
  await page.locator('#interpretation-endpoint').fill('http://127.0.0.1:4176/review-gateway');
  await page.locator('#review').click();
  await page.waitForFunction(() => /Revised intent received|invalid|error/i.test(document.querySelector('#review-status').textContent), null, {timeout: 30000});
  assert.match(await page.locator('#review-status').innerText(), /Review: chimney a little taller\./);
  assert.equal(received.kind, 'review');
  assert.equal(received.current_intent.name, current.name);
  assert.ok(received.build_report.parts > 50);
  if (await page.locator('#studio-viewport canvas').count()) assert.ok(received.image?.data_base64?.length > 1000, 'views image sent');
  await page.waitForFunction(() => document.querySelector('#engine-status')?.dataset.state === 'planned', null, {timeout: 60000});
  await page.locator('#interpretation-provider').selectOption('copy');
  // The copy-prompt route needs no provider.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.locator('#interpret').click();
  await page.waitForFunction(() => /Prompt copied|Clipboard unavailable/.test(document.querySelector('#provider-status').textContent), null, {timeout: 15000});
  assert.deepEqual(errors.filter(e => !/clipboard/i.test(e)), []);
  console.log('Studio e2e passed:', message);
} finally {
  await browser.close();
  server.close();
}
