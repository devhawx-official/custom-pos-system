import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9344;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-set-cdp-'));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-extensions',
  '--force-device-scale-factor=1',
  '--window-size=1440,900',
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let navCount = 0;

async function json(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

let version;
for (let i = 0; i < 60; i += 1) {
  try { version = await json(`http://127.0.0.1:${PORT}/json/version`); break; }
  catch { await sleep(250); }
}
if (!version) throw new Error('Chrome did not start');

const tab = await json(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let id = 0;
const pending = new Map();
const consoleErrors = [];
const exceptions = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
};

function send(method, params = {}, ms = 20000) {
  const messageId = ++id;
  return Promise.race([
    new Promise((resolve, reject) => {
      pending.set(messageId, { resolve, reject });
      ws.send(JSON.stringify({ id: messageId, method, params }));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('CDP timeout: ' + method)), ms))
  ]);
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression: `(function(){${expression}})()`,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  }, 10000);
  if (result.exceptionDetails) {
    throw new Error('Eval failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text) + '\n' + expression.slice(0, 240));
  }
  return result.result.value;
}

async function until(expression, timeout = 8000, label = expression.slice(0, 60)) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await evaluate(expression)) return true; } catch { /* keep polling */ }
    await sleep(120);
  }
  throw new Error('Timed out waiting for: ' + label);
}

async function navigate(route) {
  navCount += 1;
  const url = `${BASE}?c=${navCount}#/${route}`;
  await send('Page.navigate', { url }, 20000);
  await until('return document.readyState === "complete" && !!window.DH && !!document.querySelector(".view")', 12000, url);
  await sleep(260);
}

async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(result.data, 'base64'));
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} Â· ${name}${detail === undefined ? '' : ' Â· ' + JSON.stringify(detail)}`);
  if (!ok) console.log('  â†³ detail: ' + JSON.stringify(detail));
}
function step(name) { console.log('\nâ–¸ ' + name); }

try {
  await send('Page.enable');
  await send('Runtime.enable');

  step('seed');
  await navigate('dashboard');
  await evaluate('localStorage.clear(); return true;');
  await navigate('settings');
  await sleep(450);

  const form = await evaluate(`
    var form = document.getElementById('store-settings-form');
    return {
      fields: Array.prototype.map.call(form.querySelectorAll('[name]'), function (f) { return f.name; }),
      values: {
        storeName: form.querySelector('[name="storeName"]').value,
        email: form.querySelector('[name="email"]').value,
        phone: form.querySelector('[name="phone"]').value,
        address: form.querySelector('[name="address"]').value,
        footer: form.querySelector('[name="receiptFooter"]').value,
        currency: form.querySelector('[name="currency"]').value,
        tax: form.querySelector('[name="taxRate"]').value,
        threshold: form.querySelector('[name="lowStockThreshold"]').value,
        cashier: form.querySelector('[name="cashierName"]').value,
        discount: form.querySelector('[name="defaultDiscount"]').value,
        applyDefault: form.querySelector('[name="applyDefaultDiscount"]').checked
      },
      currencies: Array.prototype.map.call(form.querySelectorAll('[name="currency"] option'), function (o) { return o.value; }),
      switchReady: !!form.querySelector('.switch-track'),
      preview: (document.querySelector('.preview-card') || {}).textContent,
      storageRows: document.querySelectorAll('.storage-row').length
    };
  `);
  check('Settings form exposes every store field',
    ['storeName', 'legalName', 'email', 'phone', 'address', 'receiptFooter', 'currency', 'taxRate', 'lowStockThreshold', 'cashierName', 'defaultDiscount', 'applyDefaultDiscount']
      .every(function (name) { return form.fields.indexOf(name) !== -1; }), form.fields);
  check('Form is prefilled from localStorage',
    form.values.storeName === 'DevHawx Demo Store' && form.values.currency === 'USD' &&
    form.values.tax === '8.5' && form.values.threshold === '10' &&
    form.values.footer.indexOf('Thank you') !== -1 && form.values.applyDefault === false, form.values);
  check('Currency list and discount switch are ready',
    form.currencies.length >= 8 && form.switchReady && form.storageRows === 12, form);
  await shot('step12-settings-1440');

  step('validation');
  const invalid = await evaluate(`
    var form = document.getElementById('store-settings-form');
    function set(name, value) {
      var field = form.querySelector('[name="' + name + '"]');
      if (field.type === 'checkbox') { field.checked = value; } else { field.value = value; }
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    set('storeName', '');
    set('email', 'not-an-email');
    set('taxRate', '150');
    set('defaultDiscount', '200');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        var errors = Array.prototype.map.call(document.querySelectorAll('.field-error'), function (hint) {
          return { field: hint.getAttribute('data-error'), text: hint.textContent };
        }).filter(function (item) { return !!item.text; });
        resolve({
          errors: errors,
          storeName: JSON.parse(localStorage.getItem('devhawx.pos.store')).name,
          tax: JSON.parse(localStorage.getItem('devhawx.pos.settings')).taxRate,
          toast: (document.querySelector('.toast') || {}).textContent || ''
        });
      }, 220);
    });
  `);
  check('Invalid settings are rejected before saving',
    invalid.errors.length === 4 && invalid.storeName === 'DevHawx Demo Store' && invalid.tax === 8.5 &&
    /correct/i.test(invalid.toast), invalid);

  step('save');
  const saved = await evaluate(`
    var form = document.getElementById('store-settings-form');
    function set(name, value) {
      var field = form.querySelector('[name="' + name + '"]');
      if (field.type === 'checkbox') { field.checked = value; } else { field.value = value; }
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    set('storeName', 'Harbour Point Store');
    set('address', '9 Quay Street\\nHarbour Point');
    set('phone', '+1 (555) 017-0000');
    set('email', 'hello@harbourpoint.test');
    set('receiptFooter', 'Thanks for shopping at Harbour Point!');
    set('currency', 'EUR');
    set('taxRate', '12.5');
    set('lowStockThreshold', '5');
    set('cashierName', 'Sam');
    set('defaultDiscount', '10');
    set('applyDefaultDiscount', true);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          store: JSON.parse(localStorage.getItem('devhawx.pos.store')),
          settings: JSON.parse(localStorage.getItem('devhawx.pos.settings')),
          flat: DH.store.getSettings(),
          chip: (document.querySelector('.settings-main .card-head .chip') || {}).textContent,
          preview: (document.querySelector('.preview-card') || {}).textContent,
          toast: (function () {
            var toasts = document.querySelectorAll('.toast');
            return toasts.length ? toasts[toasts.length - 1].textContent : '';
          })()
        });
      }, 400);
    });
  `);
  check('Store details are saved to localStorage',
    saved.store.name === 'Harbour Point Store' && saved.store.phone === '+1 (555) 017-0000' &&
    saved.store.email === 'hello@harbourpoint.test' && saved.store.address.indexOf('Quay Street') !== -1 &&
    saved.store.receiptFooter === 'Thanks for shopping at Harbour Point!', saved.store);
  check('Checkout settings are saved to localStorage',
    saved.settings.currency === 'EUR' && saved.settings.taxRate === 12.5 && saved.settings.lowStockThreshold === 5 &&
    saved.settings.defaultDiscount === 10 && saved.settings.applyDefaultDiscount === true && saved.settings.cashierName === 'Sam', saved.settings);
  check('Settings view refreshes with the new values',
    /Harbour Point Store/.test(saved.chip || '') && /Harbour Point Store/.test(saved.preview || '') &&
    /Harbour Point!/.test(saved.preview || '') && /applied across/.test(saved.toast), saved);

  step('applied immediately');
  await navigate('pos');
  await sleep(300);
  const posState = await evaluate(`
    document.querySelector('[data-add-product="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          totals: Array.prototype.map.call(document.querySelectorAll('#cart-totals .cart-row'), function (r) {
            return r.querySelector('span').textContent + '=' + r.querySelectorAll('span')[1].textContent;
          }),
          discountInput: document.getElementById('discount-input').value,
          activeChip: (document.querySelector('.discount-chip.is-active') || {}).textContent,
          currency: document.querySelector('#cart-totals .cart-row span:last-child').textContent
        });
      }, 250);
    });
  `);
  check('POS uses the new tax rate and currency',
    posState.totals.join('|').indexOf('Tax (12.5%)') !== -1 && posState.currency.indexOf('â‚¬') !== -1, posState);
  check('Default discount applies to a new sale',
    posState.totals.join('|').indexOf('Discount (10.0%)') !== -1 && posState.discountInput === '10' &&
    posState.activeChip === '10%', posState);

  await navigate('dashboard');
  await sleep(300);
  const dash = await evaluate(`
    var cards = Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
      return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
    });
    return { cards: cards, intro: (document.querySelector('.dash-intro-copy') || {}).textContent };
  `);
  check('Dashboard picks up the new currency and store name',
    dash.cards.join('|').indexOf('â‚¬') !== -1 && /Harbour Point Store/.test(dash.intro || ''), dash);

  await navigate('inventory');
  await sleep(300);
  const inventory = await evaluate(`
    var cards = Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
      return {
        label: card.querySelector('.stat-label').textContent,
        value: card.querySelector('.stat-value').textContent,
        hint: card.querySelector('.stat-hint').textContent
      };
    });
    var low = cards.filter(function (c) { return c.label === 'Low stock'; })[0];
    return { cards: cards, low: low };
  `);
  check('Inventory uses the new low stock threshold',
    /Low stock=2/.test(inventory.cards.map(function (c) { return c.label + '=' + c.value; }).join('|')) &&
    /5 units/.test(inventory.low.hint || ''), inventory);

  step('receipt preview');
  await navigate('settings');
  await sleep(250);
  const preview = await evaluate(`
    document.getElementById('preview-receipt').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var receipt = document.getElementById('print-receipt');
        resolve({
          open: document.getElementById('modal-root').classList.contains('is-open'),
          text: receipt ? receipt.textContent : ''
        });
      }, 400);
    });
  `);
  check('Receipt preview reflects the saved store settings',
    preview.open && /Harbour Point Store/.test(preview.text) && /Quay Street/.test(preview.text) &&
    /\+1 \(555\) 017-0000/.test(preview.text) && /hello@harbourpoint.test/.test(preview.text) &&
    /Thanks for shopping at Harbour Point!/.test(preview.text) && /Tax \(12.5%\)/.test(preview.text), preview.text.slice(0, 200));
  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);

  step('persistence');
  await navigate('settings');
  await sleep(300);
  const persisted = await evaluate(`
    var form = document.getElementById('store-settings-form');
    return {
      name: form.querySelector('[name="storeName"]').value,
      currency: form.querySelector('[name="currency"]').value,
      tax: form.querySelector('[name="taxRate"]').value,
      discount: form.querySelector('[name="defaultDiscount"]').value,
      applyDefault: form.querySelector('[name="applyDefaultDiscount"]').checked,
      stored: JSON.parse(localStorage.getItem('devhawx.pos.settings')).defaultDiscount
    };
  `);
  check('Settings survive a refresh', persisted.name === 'Harbour Point Store' && persisted.currency === 'EUR' &&
    persisted.tax === '12.5' && persisted.discount === '10' && persisted.applyDefault === true &&
    persisted.stored === 10, persisted);

  step('responsive');
  for (const width of [360, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate('settings');
    await sleep(280);
    const info = await evaluate(`
      var main = document.querySelector('.settings-main').getBoundingClientRect();
      var form = document.getElementById('store-settings-form');
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mainWidth: Math.round(main.width),
        viewport: document.documentElement.clientWidth,
        columns: getComputedStyle(form.querySelector('.form-grid')).gridTemplateColumns.split(' ').length,
        fields: form.querySelectorAll('[name]').length,
        switchVisible: getComputedStyle(document.querySelector('.switch-track')).display !== 'none'
      };
    `);
    check(`Settings fit at ${width}px`, info.overflow <= 1 && info.mainWidth <= info.viewport && info.switchVisible && info.fields === 12, info);
    if (width === 360) await shot('step12-settings-360');
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('settings');

  step('console');
  check('No uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 3));
  check('No console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5));

  await evaluate('DH.store.resetDemoData(); return true;');
} catch (error) {
  console.log('\nâœ– SCRIPT ERROR: ' + error.message);
  results.push({ name: 'script completed', ok: false });
} finally {
  const passed = results.filter((r) => r.ok).length;
  console.log('\n' + passed + '/' + results.length + ' checks passed');
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  if (failed.length) console.log('FAILED: ' + failed.join(' | '));
  try { ws.close(); } catch {}
  chrome.kill();
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
  process.exit(failed.length ? 1 : 0);
}
