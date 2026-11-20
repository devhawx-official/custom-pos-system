import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-prod-cdp-'));

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
  const url = `${BASE}?p=${navCount}#/${route}`;
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
  await navigate('products');
  await sleep(450);

  const seed = await evaluate(`
    var all = DH.store.collection('products').all();
    return {
      products: all.length,
      barcodes: all.filter(function (p) { return !!p.barcode; }).length,
      seedVersion: DH.store.getData('meta', null).seedVersion,
      rows: document.querySelectorAll('#product-table-body tr').length,
      columns: document.querySelectorAll('.products-table thead th').length,
      kpi: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
        return { label: card.querySelector('.stat-label').textContent, value: card.querySelector('.stat-value').textContent };
      }),
      firstName: (document.querySelector('.product-copy strong') || {}).textContent,
      count: document.getElementById('product-count').textContent,
      filterOptions: Array.prototype.map.call(document.querySelectorAll('#product-filter option'), function (o) { return o.value; })
    };
  `);
  check('Seed includes products with barcodes', seed.products === 14 && seed.barcodes === 14 && seed.seedVersion === 5, seed);
  check('Product table renders every product', seed.rows === 14 && seed.columns === 8 && seed.firstName === 'Aurora Espresso Blend', seed);
  check('Catalog KPIs and category filter populate', seed.kpi.length === 4 && seed.count === '14 products' && seed.filterOptions.length === 6, seed);
  await shot('step04-products-1440');

  step('search');
  async function runSearch(value) {
    return evaluate(`
      var input = document.getElementById('product-search');
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({
            rows: document.querySelectorAll('#product-table-body tr').length,
            names: Array.prototype.map.call(document.querySelectorAll('.product-copy strong'), function (n) { return n.textContent; }),
            count: document.getElementById('product-count').textContent,
            empty: (document.querySelector('.empty-state h3') || {}).textContent || null
          });
        }, 180);
      });
    `);
  }

  const byName = await runSearch('espresso');
  check('Search matches product name', byName.rows === 1 && byName.names[0] === 'Aurora Espresso Blend' && byName.count === '1 of 14 products', byName);

  const bySku = await runSearch('SNK-4007');
  check('Search matches SKU', bySku.rows === 1 && bySku.names[0] === 'Sea Salt Dark Chocolate', bySku);

  const byBarcode = await runSearch('5061234505019');
  check('Search matches barcode', byBarcode.rows === 1 && byBarcode.names[0] === 'Cedar Hand Soap', byBarcode);

  const noMatch = await runSearch('zzzz-missing');
  check('Search shows a filtered empty state', noMatch.rows === 1 && noMatch.empty === 'No products match' && noMatch.count === '0 of 14 products', noMatch);

  const cleared = await evaluate(`
    document.querySelector('[data-clear-filters]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          rows: document.querySelectorAll('#product-table-body tr').length,
          value: document.getElementById('product-search').value,
          count: document.getElementById('product-count').textContent
        });
      }, 180);
    });
  `);
  check('Clear filters restores the catalog', cleared.rows === 14 && cleared.value === '' && cleared.count === '14 products', cleared);

  step('category filter');
  const bakery = await evaluate(`
    var filter = document.getElementById('product-filter');
    filter.value = 'Bakery';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          rows: document.querySelectorAll('#product-table-body tr').length,
          names: Array.prototype.map.call(document.querySelectorAll('.product-copy strong'), function (n) { return n.textContent; }),
          count: document.getElementById('product-count').textContent
        });
      }, 180);
    });
  `);
  check('Category filter shows only that category', bakery.rows === 3 && bakery.names.every((n) => ['Sourdough Loaf', 'Butter Croissant', 'Cinnamon Danish'].includes(n)) && bakery.count === '3 of 14 products', bakery);

  const combo = await evaluate(`
    var search = document.getElementById('product-search');
    search.value = 'croissant';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        var rows = document.querySelectorAll('#product-table-body tr').length;
        var name = (document.querySelector('.product-copy strong') || {}).textContent;
        var filter = document.getElementById('product-filter');
        filter.value = 'all';
        filter.dispatchEvent(new Event('change', { bubbles: true }));
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(function () {
          resolve({
            rows: rows,
            name: name,
            restored: document.querySelectorAll('#product-table-body tr').length,
            filter: document.getElementById('product-filter').value,
            query: document.getElementById('product-search').value
          });
        }, 180);
      }, 180);
    });
  `);
  check('Category and search filters combine', combo.rows === 1 && combo.name === 'Butter Croissant' && combo.restored === 14 && combo.filter === 'all' && combo.query === '', combo);

  step('add validation');
  const addOpen = await evaluate(`
    document.getElementById('add-product').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var form = document.getElementById('product-form');
        resolve({
          modal: document.getElementById('modal-root').classList.contains('is-open'),
          title: (document.getElementById('modal-title') || {}).textContent,
          fields: Array.prototype.map.call(form.querySelectorAll('[name]'), function (f) { return f.name; }),
          labels: Array.prototype.map.call(form.querySelectorAll('label'), function (l) { return l.getAttribute('for'); }),
          described: Array.prototype.every.call(form.querySelectorAll('[name]'), function (f) { return !!f.getAttribute('aria-describedby'); })
        });
      }, 200);
    });
  `);
  check('Add product opens a complete form', addOpen.modal && addOpen.title === 'Add product' &&
    JSON.stringify(addOpen.fields) === JSON.stringify(['name', 'sku', 'barcode', 'category', 'cost', 'price', 'stock', 'status']) &&
    addOpen.labels.length === 8 && addOpen.described, addOpen);

  const requiredErrors = await evaluate(`
    document.querySelector('[data-modal-confirm]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          modal: document.getElementById('modal-root').classList.contains('is-open'),
          errors: Array.prototype.map.call(document.querySelectorAll('.field-error'), function (hint) {
            return { field: hint.getAttribute('data-error'), text: hint.textContent };
          }).filter(function (item) { return !!item.text; }),
          invalid: Array.prototype.map.call(document.querySelectorAll('.is-invalid'), function (f) { return f.name; })
        });
      }, 180);
    });
  `);
  const errorFields = requiredErrors.errors.map((e) => e.field).sort();
  check('Required product fields are validated', requiredErrors.modal && JSON.stringify(errorFields) === JSON.stringify(['cost', 'name', 'price', 'sku', 'stock']) && requiredErrors.invalid.length === 5, requiredErrors);

  step('create product');
  const created = await evaluate(`
    function set(name, value, change) {
      var field = document.querySelector('#product-form [name="' + name + '"]');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      if (change) field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    set('name', 'Test Widget');
    set('sku', 'TST-9001');
    set('barcode', '9990001112223');
    set('category', 'Household', true);
    set('cost', '5.50');
    set('price', '12.99');
    set('stock', '7');
    set('status', 'draft', true);
    document.querySelector('[data-modal-confirm]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var all = DH.store.collection('products').all();
        var product = all.filter(function (p) { return p.sku === 'TST-9001'; })[0];
        var row = Array.prototype.find.call(document.querySelectorAll('#product-table-body tr'), function (tr) {
          return tr.textContent.indexOf('Test Widget') !== -1;
        });
        resolve({
          modal: document.getElementById('modal-root').classList.contains('is-open'),
          count: all.length,
          product: product,
          rows: document.querySelectorAll('#product-table-body tr').length,
          rowText: row ? row.textContent : null,
          kpiTotal: document.querySelector('.stat-card .stat-value').textContent,
          toolbarCount: document.getElementById('product-count').textContent,
          toast: !!document.querySelector('.toast')
        });
      }, 420);
    });
  `);
  check('New product persists with every field',
    !created.modal && created.count === 15 && created.product &&
    created.product.name === 'Test Widget' && created.product.sku === 'TST-9001' &&
    created.product.barcode === '9990001112223' && created.product.category === 'Household' &&
    created.product.categoryId === 'cat_household' && created.product.cost === 5.5 &&
    created.product.price === 12.99 && created.product.stock === 7 && created.product.status === 'draft' &&
    created.rows === 15 && /Draft/.test(created.rowText) && created.kpiTotal === '15' &&
    created.toolbarCount === '15 products',
    created);
  check('Create shows immediate feedback', created.toast === true, created);
  const testId = created.product.id;

  step('persistence');
  await navigate('products');
  const persisted = await evaluate(`
    var product = DH.store.collection('products').find(${JSON.stringify(testId)});
    var input = document.getElementById('product-search');
    input.value = '9990001112223';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          product: product,
          names: Array.prototype.map.call(document.querySelectorAll('.product-copy strong'), function (n) { return n.textContent; }),
          count: document.getElementById('product-count').textContent
        });
      }, 200);
    });
  `);
  check('Created product survives a refresh', persisted.product && persisted.product.name === 'Test Widget' && persisted.names[0] === 'Test Widget' && persisted.count === '1 of 15 products', persisted);

  step('edit product');
  await navigate('products');
  const editValues = await evaluate(`
    var row = Array.prototype.find.call(document.querySelectorAll('#product-table-body tr'), function (tr) {
      return tr.textContent.indexOf('Test Widget') !== -1;
    });
    row.querySelector('[data-product-edit]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        function value(name) { return document.querySelector('#product-form [name="' + name + '"]').value; }
        resolve({
          title: (document.getElementById('modal-title') || {}).textContent,
          confirm: (document.querySelector('[data-modal-confirm]') || {}).textContent,
          values: ['name', 'sku', 'barcode', 'category', 'cost', 'price', 'stock', 'status'].map(value)
        });
      }, 200);
    });
  `);
  check('Edit form is prefilled from the product',
    editValues.title === 'Edit product' && editValues.confirm === 'Save changes' &&
    JSON.stringify(editValues.values) === JSON.stringify(['Test Widget', 'TST-9001', '9990001112223', 'Household', '5.5', '12.99', '7', 'draft']),
    editValues);

  const edited = await evaluate(`
    function set(name, value, change) {
      var field = document.querySelector('#product-form [name="' + name + '"]');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      if (change) field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    set('name', 'Test Widget Pro');
    set('barcode', '9990001112224');
    set('price', '15.50');
    set('stock', '20');
    set('status', 'active', true);
    document.querySelector('[data-modal-confirm]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var product = DH.store.collection('products').find(${JSON.stringify(testId)});
        var row = Array.prototype.find.call(document.querySelectorAll('#product-table-body tr'), function (tr) {
          return tr.textContent.indexOf('Test Widget Pro') !== -1;
        });
        resolve({
          product: product,
          rowText: row ? row.textContent : null,
          count: DH.store.collection('products').count(),
          activeKpi: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
            return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
          })
        });
      }, 420);
    });
  `);
  check('Edited product updates in storage and UI',
    edited.product && edited.product.name === 'Test Widget Pro' && edited.product.barcode === '9990001112224' &&
    edited.product.price === 15.5 && edited.product.stock === 20 && edited.product.status === 'active' &&
    edited.count === 15 && /Active/.test(edited.rowText) && edited.activeKpi.indexOf('Active=15') !== -1,
    edited);

  step('duplicate validation');
  const duplicates = await evaluate(`
    var row = Array.prototype.find.call(document.querySelectorAll('#product-table-body tr'), function (tr) {
      return tr.textContent.indexOf('Test Widget Pro') !== -1;
    });
    row.querySelector('[data-product-edit]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        function set(name, value, change) {
          var field = document.querySelector('#product-form [name="' + name + '"]');
          field.value = value;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          if (change) field.dispatchEvent(new Event('change', { bubbles: true }));
        }
        set('sku', 'BEV-1042');
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var skuError = document.querySelector('[data-error="sku"]').textContent;
          set('sku', 'TST-9001');
          set('barcode', '5061234501042');
          document.querySelector('[data-modal-confirm]').click();
          setTimeout(function () {
            resolve({
              modal: document.getElementById('modal-root').classList.contains('is-open'),
              skuError: skuError,
              barcodeError: document.querySelector('[data-error="barcode"]').textContent,
              count: DH.store.collection('products').count()
            });
          }, 180);
        }, 180);
      }, 200);
    });
  `);
  check('Duplicate SKU and barcode are rejected', duplicates.modal && /already used/.test(duplicates.skuError) && /already assigned/.test(duplicates.barcodeError) && duplicates.count === 15, duplicates);
  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);

  step('delete flow');
  const deleteCancel = await evaluate(`
    var row = Array.prototype.find.call(document.querySelectorAll('#product-table-body tr'), function (tr) {
      return tr.textContent.indexOf('Test Widget Pro') !== -1;
    });
    row.querySelector('[data-product-delete]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var open = document.getElementById('modal-root').classList.contains('is-open');
        var title = (document.getElementById('modal-title') || {}).textContent;
        document.querySelector('[data-modal-close]').click();
        setTimeout(function () {
          resolve({
            open: open,
            title: title,
            stillThere: !!DH.store.collection('products').find(${JSON.stringify(testId)}),
            modalClosed: !document.getElementById('modal-root').classList.contains('is-open')
          });
        }, 160);
      }, 180);
    });
  `);
  check('Delete asks for confirmation and can be cancelled', deleteCancel.open && deleteCancel.title === 'Delete product?' && deleteCancel.stillThere && deleteCancel.modalClosed, deleteCancel);

  const deleted = await evaluate(`
    var row = Array.prototype.find.call(document.querySelectorAll('#product-table-body tr'), function (tr) {
      return tr.textContent.indexOf('Test Widget Pro') !== -1;
    });
    row.querySelector('[data-product-delete]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          resolve({
            count: DH.store.collection('products').count(),
            gone: !DH.store.collection('products').find(${JSON.stringify(testId)}),
            rows: document.querySelectorAll('#product-table-body tr').length,
            found: !!Array.prototype.find.call(document.querySelectorAll('#product-table-body tr'), function (tr) {
              return tr.textContent.indexOf('Test Widget Pro') !== -1;
            }),
            toast: !!document.querySelector('.toast')
          });
        }, 420);
      }, 180);
    });
  `);
  check('Confirmed delete removes the product everywhere', deleted.count === 14 && deleted.gone && deleted.rows === 14 && !deleted.found && deleted.toast, deleted);

  const afterDelete = await evaluate(`
    var input = document.getElementById('product-search');
    input.value = 'TST-9001';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        var empty = (document.querySelector('.empty-state h3') || {}).textContent;
        document.querySelector('[data-clear-filters]').click();
        setTimeout(function () {
          resolve({ empty: empty, restored: document.querySelectorAll('#product-table-body tr').length });
        }, 180);
      }, 180);
    });
  `);
  check('Deleted product is searchable nowhere and catalog restores', afterDelete.empty === 'No products match' && afterDelete.restored === 14, afterDelete);

  step('responsive');
  for (const width of [360, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate('products');
    await sleep(260);
    const info = await evaluate(`
      var search = document.getElementById('product-search').getBoundingClientRect();
      var filter = document.getElementById('product-filter').closest('.filter-select').getBoundingClientRect();
      var viewport = document.documentElement.clientWidth;
      var wrap = document.querySelector('.table-wrap');
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rows: document.querySelectorAll('#product-table-body tr').length,
        searchRight: Math.round(search.right),
        filterRight: Math.round(filter.right),
        viewport: viewport,
        tableScrolls: wrap.scrollWidth > wrap.clientWidth,
        controlsFit: search.right <= viewport + 1 && filter.right <= viewport + 1
      };
    `);
    check(`Product view fits at ${width}px`, info.overflow <= 1 && info.rows === 14 && info.controlsFit, info);
    if (width === 360) {
      const modal = await evaluate(`
        document.getElementById('add-product').click();
        return new Promise(function (resolve) {
          setTimeout(function () {
            var card = document.querySelector('.modal-card').getBoundingClientRect();
            var form = document.getElementById('product-form');
            resolve({
              left: Math.round(card.left),
              right: Math.round(card.right),
              top: Math.round(card.top),
              bottom: Math.round(card.bottom),
              viewportW: document.documentElement.clientWidth,
              viewportH: document.documentElement.clientHeight,
              columns: getComputedStyle(form).gridTemplateColumns.split(' ').length,
              scrollable: document.querySelector('.modal-body').scrollHeight >= document.querySelector('.modal-body').clientHeight
            });
          }, 220);
        });
      `);
      check('Product form modal fits a 360px viewport', modal.left >= 0 && modal.right <= modal.viewportW + 1 && modal.top >= 0 && modal.bottom <= modal.viewportH && modal.columns === 1, modal);
      await shot('step04-product-modal-360');
      await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);
    }
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('products');

  step('accessibility structure');
  const a11y = await evaluate(`
    var formReady = true;
    document.getElementById('add-product').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var form = document.getElementById('product-form');
        Array.prototype.forEach.call(form.querySelectorAll('[name]'), function (field) {
          var label = form.querySelector('label[for="' + field.id + '"]');
          if (!label || !field.getAttribute('aria-describedby')) formReady = false;
        });
        var dialog = document.querySelector('.modal-card');
        var heading = document.getElementById('modal-title');
        resolve({
          labelled: !!dialog && dialog.getAttribute('aria-labelledby') === 'modal-title' && !!heading,
          modal: dialog && dialog.getAttribute('role') === 'dialog' && dialog.getAttribute('aria-modal') === 'true',
          formReady: formReady,
          rowActions: Array.prototype.every.call(document.querySelectorAll('.row-action'), function (button) {
            return !!button.getAttribute('aria-label');
          }),
          statuses: document.querySelectorAll('.status-pill').length
        });
      }, 200);
    });
  `);
  check('Product management is accessible', a11y.labelled && a11y.modal && a11y.formReady && a11y.rowActions && a11y.statuses === 14, a11y);
  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);
  await shot('step04-products-final-1440');

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
