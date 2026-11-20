import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9347;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-audit-cdp-'));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
  '--force-device-scale-factor=1', '--window-size=1440,900', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let navCount = 0;

async function json(url, options) { const res = await fetch(url, options); return res.json(); }

let version;
for (let i = 0; i < 60; i += 1) {
  try { version = await json(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); }
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
    expression: `(function(){${expression}})()`, returnByValue: true, awaitPromise: true, userGesture: true
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
  const url = `${BASE}?a=${navCount}#/${route}`;
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

  step('baseline');
  await navigate('dashboard');
  await evaluate('localStorage.clear(); return true;');
  await navigate('dashboard');
  await sleep(420);

  step('1 Â· navigation links');
  const navLinks = await evaluate(`
    return Array.prototype.map.call(document.querySelectorAll('.nav-link'), function (link) {
      return { route: link.getAttribute('data-route'), href: link.getAttribute('href'), label: link.textContent.trim() };
    });
  `);
  check('Sidebar exposes every route', navLinks.length === 8 &&
    ['dashboard', 'pos', 'products', 'inventory', 'customers', 'sales', 'reports', 'settings'].every(function (r) {
      return navLinks.some(function (l) { return l.route === r; });
    }), navLinks.map((l) => l.route));

  const routeResults = [];
  for (const link of navLinks) {
    await navigate('dashboard');
    const opened = await evaluate(`
      var link = document.querySelector('.nav-link[data-route="${link.route}"]');
      link.click();
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({
            hash: location.hash,
            title: document.title,
            h1: (document.querySelector('.page-head h1') || {}).textContent,
            active: (document.querySelector('.nav-link.is-active') || {}).getAttribute('data-route'),
            children: document.querySelector('.view').children.length,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
          });
        }, 260);
      });
    `);
    routeResults.push({ route: link.route, ...opened });
  }
  check('Every navigation link opens its view',
    routeResults.every((r) => r.hash === '#/' + r.route && r.active === r.route && r.children > 0 && r.overflow <= 1),
    routeResults.map((r) => ({ route: r.route, hash: r.hash, children: r.children, overflow: r.overflow })));

  step('2 Â· product CRUD');
  await navigate('products');
  const created = await evaluate(`
    document.getElementById('add-product').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var form = document.getElementById('product-form');
        function set(name, value) {
          var field = form.querySelector('[name="' + name + '"]');
          field.value = value;
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
        set('name', 'Audit Widget');
        set('sku', 'AUD-0001');
        set('barcode', '5012345678900');
        set('category', 'Household', true);
        set('cost', '4.25');
        set('price', '9.99');
        set('stock', '12');
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var product = DH.store.collection('products').all().filter(function (p) { return p.sku === 'AUD-0001'; })[0];
          resolve({
            product: product,
            count: DH.store.collection('products').count(),
            rows: document.querySelectorAll('#product-table-body tr').length,
            stored: JSON.parse(localStorage.getItem('devhawx.pos.products')).length,
            rowText: (function () {
              var row = Array.prototype.find.call(document.querySelectorAll('#product-table-body tr'), function (tr) { return tr.textContent.indexOf('Audit Widget') !== -1; });
              return row ? row.textContent : null;
            })()
          });
        }, 420);
      }, 240);
    });
  `);
  check('Product create persists and renders',
    created.product && created.count === 15 && created.stored === 15 && created.rows === 15 &&
    created.product.price === 9.99 && created.product.stock === 12 && created.product.categoryId === 'cat_household', created);
  const auditId = created.product.id;

  const edited = await evaluate(`
    document.querySelector('[data-product-edit="${auditId}"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var form = document.getElementById('product-form');
        form.querySelector('[name="price"]').value = '14.50';
        form.querySelector('[name="stock"]').value = '30';
        form.querySelector('[name="status"]').value = 'draft';
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var product = DH.store.collection('products').find('${auditId}');
          resolve({ product: product, rowText: (function () {
            var row = document.querySelector('[data-product-row="${auditId}"]');
            return row ? row.textContent : null;
          })() });
        }, 420);
      }, 240);
    });
  `);
  check('Product edit updates storage and row',
    edited.product.price === 14.5 && edited.product.stock === 30 && edited.product.status === 'draft' &&
    /Draft/.test(edited.rowText), edited);

  step('3 Â· inventory synchronisation');
  await navigate('products');
  const syncEdit = await evaluate(`
    document.querySelector('[data-product-edit="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var form = document.getElementById('product-form');
        form.querySelector('[name="stock"]').value = '40';
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          resolve({ stock: DH.store.collection('products').find('prd_espresso').stock });
        }, 420);
      }, 240);
    });
  `);

  await navigate('inventory');
  const synced = await evaluate(`
    return {
      stock: DH.store.collection('products').find('prd_espresso').stock,
      rowStock: (function () {
        var row = Array.prototype.find.call(document.querySelectorAll('#stock-table-body tr'), function (tr) { return tr.textContent.indexOf('Aurora Espresso Blend') !== -1; });
        return row ? row.textContent : null;
      })(),
      movements: DH.store.collection('inventory').all().filter(function (m) { return m.productId === 'prd_espresso'; }),
      newProductMovements: DH.store.collection('inventory').all().filter(function (m) { return m.productId === '${auditId}'; }).length
    };
  `);
  const syncMovement = synced.movements[synced.movements.length - 1];
  check('Inventory mirrors the catalog stock',
    syncEdit.stock === 40 && synced.stock === 40 && synced.rowStock && synced.rowStock.indexOf('40') !== -1, synced.rowStock);
  check('Catalog stock change is logged as a sync movement',
    syncMovement && syncMovement.synced === true && syncMovement.stockBefore === 34 && syncMovement.stockAfter === 40 &&
    syncMovement.quantity === 6, syncMovement);

  const restocked = await evaluate(`
    document.querySelector('[data-stock-in="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var field = document.querySelector('#stock-form [name="quantity"]');
        field.value = '20';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          resolve({
            product: DH.store.collection('products').find('prd_espresso'),
            movements: DH.store.collection('inventory').all().filter(function (m) { return m.productId === 'prd_espresso'; }).length
          });
        }, 420);
      }, 240);
    });
  `);
  check('Stock in updates the product and logs a movement',
    restocked.product.stock === 60 && restocked.movements === 3, restocked);

  const stockOut = await evaluate(`
    document.querySelector('[data-stock-out="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var field = document.querySelector('#stock-form [name="quantity"]');
        field.value = '5';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          resolve({ stock: DH.store.collection('products').find('prd_espresso').stock });
        }, 420);
      }, 240);
    });
  `);
  check('Stock out reduces the product', stockOut.stock === 55, stockOut);

  step('4 Â· cart calculations');
  await navigate('pos');
  const cart = await evaluate(`
    document.querySelector('[data-add-product="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        function totals() {
          return Array.prototype.map.call(document.querySelectorAll('#cart-totals .cart-row'), function (r) {
            return r.querySelector('span').textContent + '=' + r.querySelectorAll('span')[1].textContent;
          });
        }
        var one = totals();
        document.querySelector('[data-cart-inc="prd_espresso"]').click();
        setTimeout(function () {
          var two = totals();
          document.querySelector('[data-cart-dec="prd_espresso"]').click();
          setTimeout(function () {
            resolve({ one: one, two: two, stored: JSON.parse(localStorage.getItem('devhawx.pos.cart'))[0].quantity });
          }, 200);
        }, 200);
      }, 250);
    });
  `);
  check('Cart subtotal and tax follow the quantity',
    cart.one[0].indexOf('$18.50') !== -1 && cart.one[1].indexOf('$1.57') !== -1 && cart.one[2].indexOf('$20.07') !== -1 &&
    cart.two[0].indexOf('$37.00') !== -1 && cart.two[1].indexOf('$3.15') !== -1 && cart.two[2].indexOf('$40.15') !== -1 &&
    cart.stored === 1, cart);

  step('5 Â· discounts and tax');
  const discount = await evaluate(`
    document.querySelector('[data-discount="10"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var rows = Array.prototype.map.call(document.querySelectorAll('#cart-totals .cart-row'), function (r) {
          return r.querySelector('span').textContent + '=' + r.querySelectorAll('span')[1].textContent;
        });
        resolve({ rows: rows, stored: JSON.parse(localStorage.getItem('devhawx.pos.cartDiscount')) });
      }, 220);
    });
  `);
  check('Discount reduces the taxable amount',
    discount.rows[0].indexOf('$18.50') !== -1 && discount.rows[1].indexOf('$1.85') !== -1 &&
    discount.rows[2].indexOf('$1.42') !== -1 && discount.rows[3].indexOf('$18.07') !== -1 && discount.stored === 10, discount);

  step('6 Â· checkout');
  const checkout = await evaluate(`
    var stockBefore = DH.store.collection('products').find('prd_espresso').stock;
    document.getElementById('charge-sale').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var amount = document.getElementById('cash-received');
        amount.value = '20';
        amount.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var sales = DH.store.collection('sales').all();
          var sale = sales.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })[0];
          resolve({
            sale: sale,
            sales: sales.length,
            stockBefore: stockBefore,
            espresso: DH.store.collection('products').find('prd_espresso').stock,
            movements: DH.store.collection('inventory').all().filter(function (m) { return m.note === 'Sale ' + sale.receipt; }).length,
            cart: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length,
            discount: JSON.parse(localStorage.getItem('devhawx.pos.cartDiscount'))
          });
        }, 800);
      }, 300);
    });
  `);
  check('Checkout records the sale, stock and movement',
    checkout.sales === 163 && checkout.sale.receipt === 'INV-4363' && checkout.sale.payment === 'Cash' &&
    checkout.sale.amountReceived === 20 && Math.abs(checkout.sale.change - 1.93) < 0.01 &&
    checkout.espresso === checkout.stockBefore - 1 && checkout.movements === 1, checkout);
  check('Cart and discount clear after checkout', checkout.cart === 0 && checkout.discount === 0, checkout);

  step('7 Â· payment validation');
  const payment = await evaluate(`
    document.querySelector('[data-add-product="prd_matcha"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        document.getElementById('charge-sale').click();
        setTimeout(function () {
          var amount = document.getElementById('cash-received');
          amount.value = '1';
          amount.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('[data-modal-confirm]').click();
          setTimeout(function () {
            var error = document.querySelector('[data-error="cashReceived"]').textContent;
            var open = document.getElementById('modal-root').classList.contains('is-open');
            var sales = DH.store.collection('sales').count();
            document.querySelector('[data-modal-close]').click();
            setTimeout(function () {
              resolve({ error: error, open: open, sales: sales, cart: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length });
            }, 200);
          }, 250);
        }, 300);
      }, 250);
    });
  `);
  check('Underpayment is blocked and no sale is recorded',
    /less than the total/.test(payment.error) && payment.open && payment.sales === 163 && payment.cart === 1, payment);

  step('8 Â· receipt printing');
  const receipt = await evaluate(`
    document.getElementById('charge-sale').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var amount = document.getElementById('cash-received');
        amount.value = '50';
        amount.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var node = document.getElementById('print-receipt');
          var hasPrintRules = Array.prototype.some.call(document.styleSheets, function (sheet) {
            try {
              return Array.prototype.some.call(sheet.cssRules, function (rule) {
                return rule.type === 4 && /print/.test(rule.conditionText || '');
              });
            } catch (error) { return false; }
          });
          resolve({
            exists: !!node,
            text: node ? node.textContent : '',
            printButton: !!document.querySelector('[data-print-receipt]'),
            hasPrintRules: hasPrintRules,
            paper: node ? node.getAttribute('data-paper') : null
          });
        }, 800);
      }, 300);
    });
  `);
  check('Receipt prints with every required field',
    receipt.exists && receipt.printButton && receipt.hasPrintRules && receipt.paper === '80' &&
    /INV-4364/.test(receipt.text) && /TOTAL/.test(receipt.text) && /Payment/.test(receipt.text) &&
    /Amount received/.test(receipt.text) && /Change/.test(receipt.text) && /Thank you/i.test(receipt.text), receipt.text.slice(0, 160));
  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);

  step('9 Â· customer management');
  await navigate('customers');
  const customer = await evaluate(`
    document.getElementById('add-customer').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var panel = document.getElementById('customer-panel');
        panel.querySelector('[name="name"]').value = 'Audit Buyer';
        panel.querySelector('[name="phone"]').value = '+1 (555) 090-0000';
        panel.querySelector('[name="email"]').value = 'audit@example.com';
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var created = DH.store.collection('customers').all().filter(function (c) { return c.name === 'Audit Buyer'; })[0];
          resolve({ created: created, count: DH.store.collection('customers').count(), rows: document.querySelectorAll('#customer-table-body tr').length });
        }, 420);
      }, 240);
    });
  `);
  check('Customer create persists', customer.created && customer.count === 9 && customer.rows === 9, customer);

  step('10 Â· sales history');
  await navigate('sales');
  const salesView = await evaluate(`
    return {
      rows: document.querySelectorAll('#sale-table-body tr').length,
      counter: document.getElementById('sale-count').textContent,
      newest: (document.querySelector('#sale-table-body .sale-receipt') || {}).textContent,
      kpis: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
        return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
      })
    };
  `);
  check('Sales history lists the new transactions',
    salesView.rows === 164 && /164 of 164/.test(salesView.counter) && salesView.newest === 'INV-4364' &&
    /Transactions=164/.test(salesView.kpis.join('|')), salesView);

  step('11 Â· reports');
  await navigate('reports');
  const reports = await evaluate(`
    return {
      kpis: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
        return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
      }),
      bars: document.querySelectorAll('.report-bar').length,
      sellers: document.querySelectorAll('.report-row').length
    };
  `);
  check('Reports reflect the new sales',
    /transactions=164/.test(reports.kpis.join('|')) && reports.bars > 0 && reports.sellers > 0, reports);

  step('12 Â· persistence and refresh');
  await navigate('customers');
  const beforeRefresh = await evaluate(`
    return {
      customers: DH.store.collection('customers').count(),
      products: DH.store.collection('products').count(),
      sales: DH.store.collection('sales').count(),
      cart: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length
    };
  `);
  await navigate('customers');
  const afterRefresh = await evaluate(`
    return {
      customers: DH.store.collection('customers').count(),
      products: DH.store.collection('products').count(),
      sales: DH.store.collection('sales').count(),
      rows: document.querySelectorAll('#customer-table-body tr').length
    };
  `);
  check('Data survives a refresh without duplication',
    beforeRefresh.customers === afterRefresh.customers && beforeRefresh.products === afterRefresh.products &&
    beforeRefresh.sales === afterRefresh.sales && afterRefresh.rows === afterRefresh.customers, { beforeRefresh, afterRefresh });

  step('13 Â· demo reset');
  const reset = await evaluate(`
    DH.store.resetDemoData();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          customers: DH.store.collection('customers').count(),
          products: DH.store.collection('products').count(),
          sales: DH.store.collection('sales').count(),
          cart: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length,
          stored: JSON.parse(localStorage.getItem('devhawx.pos.customers')).length
        });
      }, 300);
    });
  `);
  check('Reset restores the demo workspace',
    reset.customers === 8 && reset.products === 14 && reset.sales === 162 && reset.cart === 0 && reset.stored === 8, reset);

  step('14 Â· mobile responsiveness');
  const ROUTES = ['dashboard', 'pos', 'products', 'inventory', 'customers', 'sales', 'reports', 'settings'];
  for (const width of [360, 414, 768]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
    const issues = [];
    for (const route of ROUTES) {
      await navigate(route);
      const info = await evaluate(`
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          children: document.querySelector('.view').children.length,
          crash: !!document.querySelector('.error-card')
        };
      `);
      if (info.overflow > 1 || !info.children || info.crash) issues.push({ route, ...info });
    }
    check(`All routes fit at ${width}px`, issues.length === 0, issues);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await navigate('pos');
  await shot('step13-pos-mobile');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  step('15 Â· console health');
  check('No uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 5));
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
