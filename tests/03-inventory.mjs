import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-inv-cdp-'));

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

function send(method, params = {}, ms = 15000) {
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
    throw new Error('Eval failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text) + '\n' + expression.slice(0, 220));
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
  const url = `${BASE}?i=${navCount}#/${route}`;
  await send('Page.navigate', { url }, 20000);
  await until('return document.readyState === "complete" && !!window.DH && !!document.querySelector(".view")', 12000, url);
  await sleep(240);
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
  await navigate('inventory');
  await sleep(500);

  const seeded = await evaluate(`
    var all = DH.store.collection('products').all();
    var units = all.reduce(function (sum, p) { return sum + (Number(p.stock) || 0); }, 0);
    var value = all.reduce(function (sum, p) { return sum + (Number(p.stock) || 0) * (Number(p.cost) || 0); }, 0);
    return {
      rows: document.querySelectorAll('#stock-table-body tr').length,
      units: units,
      value: value,
      kpi: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
        return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
      }),
      movements: DH.store.collection('inventory').count(),
      movementRows: document.querySelectorAll('.movement-table tbody tr').length,
      lowItems: document.querySelectorAll('.low-stock-card .stock-alert-item').length,
      outItems: document.querySelectorAll('.out-stock-card .stock-alert-item').length,
      lowChip: (document.querySelector('.low-stock-card .chip') || {}).textContent,
      outChip: (document.querySelector('.out-stock-card .chip') || {}).textContent
    };
  `);
  check('Stock overview reflects the catalog', seeded.rows === 14 && seeded.units === 205 && seeded.kpi.indexOf('Units on hand=205') !== -1, seeded);
  check('Stock value uses the cost basis', seeded.kpi.join('|').indexOf('Stock value=$1,209.90') !== -1, seeded.kpi);
  check('Low stock and out of stock alerts populate', seeded.kpi.indexOf('Low stock=6') !== -1 && seeded.kpi.indexOf('Out of stock=1') !== -1 && seeded.lowItems === 6 && seeded.outItems === 1, seeded);
  check('Seeded movement history loads without phantom sync rows', seeded.movements === 6 && seeded.movementRows === 6, seeded);
  await shot('step05-inventory-1440');

  step('stock in');
  const stockIn = await evaluate(`
    document.querySelector('[data-stock-in="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var form = document.getElementById('stock-form');
        resolve({
          modal: document.getElementById('modal-root').classList.contains('is-open'),
          title: (document.getElementById('modal-title') || {}).textContent,
          product: form.querySelector('[name="product"]').value,
          preview: document.getElementById('stock-preview').textContent,
          fields: Array.prototype.map.call(form.querySelectorAll('[name]'), function (f) { return f.name; })
        });
      }, 200);
    });
  `);
  check('Stock in form opens on the chosen product', stockIn.modal && stockIn.title === 'Stock in' && stockIn.product === 'prd_espresso' && /New stock level/.test(stockIn.preview) && JSON.stringify(stockIn.fields) === JSON.stringify(['product', 'quantity', 'note']), stockIn);

  const afterStockIn = await evaluate(`
    function set(name, value) {
      var field = document.querySelector('#stock-form [name="' + name + '"]');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    set('quantity', '10');
    var preview = document.getElementById('stock-preview').textContent;
    document.querySelector('[data-modal-confirm]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var product = DH.store.collection('products').find('prd_espresso');
        var movement = DH.store.collection('inventory').all().filter(function (m) { return m.productId === 'prd_espresso'; })
          .sort(function (a, b) { return new Date(b.at).getTime() - new Date(a.at).getTime(); })[0];
        resolve({
          preview: preview,
          modal: document.getElementById('modal-root').classList.contains('is-open'),
          stock: product.stock,
          movement: movement,
          movements: DH.store.collection('inventory').count(),
          units: document.querySelector('.stat-card .stat-value').textContent,
          toast: !!document.querySelector('.toast')
        });
      }, 420);
    });
  `);
  check('Stock in updates the product and logs a movement',
    /44/.test(afterStockIn.preview) && !afterStockIn.modal && afterStockIn.stock === 44 &&
    afterStockIn.movement && afterStockIn.movement.type === 'restock' && afterStockIn.movement.quantity === 10 &&
    afterStockIn.movement.stockBefore === 34 && afterStockIn.movement.stockAfter === 44 &&
    afterStockIn.movements === 7 && afterStockIn.units === '215' && afterStockIn.toast,
    afterStockIn);

  step('stock out');
  const stockOut = await evaluate(`
    document.querySelector('[data-stock-out="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var field = document.querySelector('#stock-form [name="quantity"]');
        field.value = '5';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var product = DH.store.collection('products').find('prd_espresso');
          var movement = DH.store.collection('inventory').all().filter(function (m) { return m.productId === 'prd_espresso'; })
            .sort(function (a, b) { return new Date(b.at).getTime() - new Date(a.at).getTime(); })[0];
          resolve({
            stock: product.stock,
            movement: movement,
            modal: document.getElementById('modal-root').classList.contains('is-open'),
            type: movement ? movement.type : null
          });
        }, 420);
      }, 200);
    });
  `);
  check('Stock out reduces the product and logs the movement',
    stockOut.stock === 39 && stockOut.type === 'issue' && stockOut.movement.quantity === -5 && !stockOut.modal, stockOut);

  step('negative stock guard');
  const guard = await evaluate(`
    document.querySelector('[data-stock-out="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var field = document.querySelector('#stock-form [name="quantity"]');
        field.value = '500';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        var preview = document.getElementById('stock-preview').textContent;
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          resolve({
            preview: preview,
            error: document.querySelector('[data-error="quantity"]').textContent,
            modal: document.getElementById('modal-root').classList.contains('is-open'),
            stock: DH.store.collection('products').find('prd_espresso').stock,
            movements: DH.store.collection('inventory').count()
          });
        }, 220);
      }, 200);
    });
  `);
  check('Stock out cannot exceed the units on hand', /cannot go below zero/.test(guard.preview) && /Only 39 units are on hand/.test(guard.error) && guard.modal && guard.stock === 39 && guard.movements === 8, guard);
  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);

  step('adjust stock');
  const adjusted = await evaluate(`
    document.querySelector('[data-stock-adjust="prd_croissant"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var field = document.querySelector('#stock-form [name="quantity"]');
        field.value = '25';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var product = DH.store.collection('products').find('prd_croissant');
          var movement = DH.store.collection('inventory').all().filter(function (m) { return m.productId === 'prd_croissant'; })
            .sort(function (a, b) { return new Date(b.at).getTime() - new Date(a.at).getTime(); })[0];
          resolve({
            stock: product.stock,
            movement: movement,
            lowItems: document.querySelectorAll('.low-stock-card .stock-alert-item').length,
            modal: document.getElementById('modal-root').classList.contains('is-open')
          });
        }, 420);
      }, 200);
    });
  `);
  check('Adjust sets the exact quantity and records the difference',
    adjusted.stock === 25 && adjusted.movement.type === 'adjustment' && adjusted.movement.stockBefore === 4 &&
    adjusted.movement.stockAfter === 25 && adjusted.movement.quantity === 21 &&
    adjusted.lowItems === 5 && !adjusted.modal, adjusted);

  const negativeAdjust = await evaluate(`
    document.querySelector('[data-stock-adjust="prd_croissant"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var field = document.querySelector('#stock-form [name="quantity"]');
        field.value = '-4';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          resolve({
            error: document.querySelector('[data-error="quantity"]').textContent,
            modal: document.getElementById('modal-root').classList.contains('is-open'),
            stock: DH.store.collection('products').find('prd_croissant').stock
          });
        }, 220);
      }, 200);
    });
  `);
  check('Adjust rejects a negative quantity', /negative/i.test(negativeAdjust.error) && negativeAdjust.modal && negativeAdjust.stock === 25, negativeAdjust);
  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);

  step('out of stock alert');
  const outOfStock = await evaluate(`
    document.querySelector('[data-stock-adjust="prd_croissant"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var field = document.querySelector('#stock-form [name="quantity"]');
        field.value = '0';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          resolve({
            stock: DH.store.collection('products').find('prd_croissant').stock,
            outItems: document.querySelectorAll('.out-stock-card .stock-alert-item').length,
            outChip: (document.querySelector('.out-stock-card .chip') || {}).textContent,
            status: (document.querySelector('[data-stock-row="prd_croissant"] .stock-status') || {}).textContent,
            restockButton: !!document.querySelector('.out-stock-card [data-stock-in]')
          });
        }, 420);
      }, 200);
    });
  `);
  check('Out of stock products are flagged and restockable', outOfStock.stock === 0 && outOfStock.outItems === 2 && /2 products/.test(outOfStock.outChip) && /Out of stock/.test(outOfStock.status) && outOfStock.restockButton, outOfStock);

  const restocked = await evaluate(`
    document.querySelector('.out-stock-card [data-stock-in]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var form = document.getElementById('stock-form');
        var selected = form.querySelector('[name="product"]').value;
        var field = form.querySelector('[name="quantity"]');
        field.value = '12';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          resolve({
            selected: selected,
            product: DH.store.collection('products').find(selected),
            outItems: document.querySelectorAll('.out-stock-card .stock-alert-item').length
          });
        }, 420);
      }, 200);
    });
  `);
  check('Restock from the alert list works', restocked.selected && restocked.product.stock === 12 && restocked.outItems === 1, restocked);

  step('catalog synchronisation');
  await evaluate(`DH.store.collection('products').update('prd_chocolate', { stock: 50 }); return true;`);
  await navigate('inventory');
  await sleep(300);
  const synced = await evaluate(`
    var list = DH.store.collection('inventory').all().filter(function (m) { return m.productId === 'prd_chocolate'; });
    var latest = list.sort(function (a, b) { return new Date(b.at).getTime() - new Date(a.at).getTime(); })[0];
    return {
      movements: DH.store.collection('inventory').count(),
      latest: latest,
      stock: DH.store.collection('products').find('prd_chocolate').stock,
      syncedPills: document.querySelectorAll('.movement-type.is-synced').length
    };
  `);
  check('Stock edited elsewhere is synchronised into the log', synced.latest.synced === true && synced.latest.quantity === 8 && synced.latest.stockBefore === 42 && synced.latest.stockAfter === 50 && synced.syncedPills === 1, synced);

  await navigate('inventory');
  await sleep(300);
  const noDuplicate = await evaluate(`
    return {
      movements: DH.store.collection('inventory').count(),
      syncedPills: document.querySelectorAll('.movement-type.is-synced').length
    };
  `);
  check('Synchronisation never duplicates movements', noDuplicate.movements === synced.movements && noDuplicate.syncedPills === 1, noDuplicate);

  step('history, search and filters');
  const history = await evaluate(`
    var rows = document.querySelectorAll('.movement-table tbody tr');
    var first = rows[0];
    return {
      rows: rows.length,
      firstType: (first.querySelector('.movement-type') || {}).textContent,
      firstChange: (first.querySelector('.movement-change') || {}).textContent,
      firstProduct: (first.querySelector('.product-copy strong') || {}).textContent,
      chip: (document.querySelector('.movement-table') ? '' : '') + (document.querySelectorAll('.card-head .chip')[document.querySelectorAll('.card-head .chip').length - 1] || {}).textContent
    };
  `);
  check('Movement history lists the newest change first', history.rows >= 9 && /Synced|Stock in|Stock out|Adjustment/.test(history.firstType) && /^[+âˆ’]/.test(history.firstChange), history);

  const search = await evaluate(`
    var input = document.getElementById('stock-search');
    input.value = 'espresso';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          rows: document.querySelectorAll('#stock-table-body tr').length,
          name: (document.querySelector('#stock-table-body .product-copy strong') || {}).textContent,
          counter: (document.getElementById('stock-table-count') || {}).textContent
        });
      }, 180);
    });
  `);
  check('Stock search filters the table', search.rows === 1 && search.name === 'Aurora Espresso Blend' && /1 of 14/.test(search.counter), search);

  const lowFilter = await evaluate(`
    var input = document.getElementById('stock-search');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    var filter = document.getElementById('stock-filter');
    filter.value = 'low';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        var rows = document.querySelectorAll('#stock-table-body tr').length;
        var statuses = Array.prototype.map.call(document.querySelectorAll('#stock-table-body .stock-status'), function (s) { return s.textContent; });
        var outRows = Array.prototype.map.call(document.querySelectorAll('#stock-table-body .stock-status.is-out'), function (s) { return s.textContent; });
        filter.value = 'out';
        filter.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(function () {
          resolve({
            lowRows: rows,
            lowStatuses: statuses,
            outRows: document.querySelectorAll('#stock-table-body tr').length,
            outStatus: Array.prototype.map.call(document.querySelectorAll('#stock-table-body .stock-status'), function (s) { return s.textContent; })
          });
        }, 180);
      }, 180);
    });
  `);
  check('Stock filters isolate low and out of stock items', lowFilter.lowRows === 5 && lowFilter.lowStatuses.every((s) => /Low stock/.test(s)) && lowFilter.outRows === 1 && /Out of stock/.test(lowFilter.outStatus[0]), lowFilter);

  await evaluate(`
    var filter = document.getElementById('stock-filter');
    filter.value = 'all';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `);

  step('persistence');
  await navigate('inventory');
  const persisted = await evaluate(`
    return {
      movements: DH.store.collection('inventory').count(),
      espresso: DH.store.collection('products').find('prd_espresso').stock,
      chocolate: DH.store.collection('products').find('prd_chocolate').stock,
      croissant: DH.store.collection('products').find('prd_croissant').stock,
      stored: JSON.parse(localStorage.getItem('devhawx.pos.inventory')).length
    };
  `);
  check('Stock and movements persist in localStorage', persisted.movements === 12 && persisted.stored === 12 && persisted.espresso === 39 && persisted.chocolate === 50 && persisted.croissant === 12, persisted);

  step('dashboard sync');
  await navigate('dashboard');
  const dash = await evaluate(`
    var hint = Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
      return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-hint').textContent;
    });
    return { hint: hint };
  `);
  check('Dashboard reflects the new stock levels', /5 items low/.test(dash.hint.join('|')) && /1 out of stock/.test(dash.hint.join('|')), dash.hint);

  step('responsive');
  for (const width of [360, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate('inventory');
    await sleep(260);
    const info = await evaluate(`
      var grid = document.querySelector('.inventory-grid');
      var side = document.querySelector('.inventory-side').getBoundingClientRect();
      var table = document.querySelector('.inventory-table').closest('.table-wrap');
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rows: document.querySelectorAll('#stock-table-body tr').length,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        sideWidth: Math.round(side.width),
        viewport: document.documentElement.clientWidth,
        tableScrolls: table.scrollWidth > table.clientWidth,
        movements: document.querySelectorAll('.movement-table tbody tr').length
      };
    `);
    check(`Inventory view fits at ${width}px`, info.overflow <= 1 && info.rows === 14 && info.movements >= 9 && info.sideWidth <= info.viewport, info);
    if (width === 360) {
      const modal = await evaluate(`
        document.querySelector('[data-stock-open="in"]').click();
        return new Promise(function (resolve) {
          setTimeout(function () {
            var card = document.querySelector('.modal-card').getBoundingClientRect();
            resolve({
              left: Math.round(card.left),
              right: Math.round(card.right),
              top: Math.round(card.top),
              bottom: Math.round(card.bottom),
              viewportW: document.documentElement.clientWidth,
              viewportH: document.documentElement.clientHeight,
              columns: getComputedStyle(document.getElementById('stock-form')).gridTemplateColumns.split(' ').length,
              preview: !!document.getElementById('stock-preview')
            });
          }, 220);
        });
      `);
      check('Stock form fits a 360px viewport', modal.left >= 0 && modal.right <= modal.viewportW + 1 && modal.top >= 0 && modal.bottom <= modal.viewportH && modal.columns === 1 && modal.preview, modal);
      await shot('step05-stock-modal-360');
      await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);
    }
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('inventory');
  await shot('step05-inventory-final-1440');

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
