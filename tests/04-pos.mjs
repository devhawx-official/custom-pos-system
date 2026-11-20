import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9338;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-pos-cdp-'));

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

  step('terminal');
  await navigate('dashboard');
  await evaluate('localStorage.clear(); return true;');
  await navigate('pos');
  await sleep(450);

  const initial = await evaluate(`
    return {
      tiles: document.querySelectorAll('.pos-tile').length,
      chips: Array.prototype.map.call(document.querySelectorAll('#pos-categories .chip-btn'), function (c) { return c.textContent; }),
      empty: !!document.querySelector('.cart-empty'),
      count: document.getElementById('cart-count').textContent,
      chargeDisabled: document.getElementById('charge-sale').disabled,
      clearDisabled: document.getElementById('clear-cart').disabled,
      label: document.getElementById('charge-label').textContent,
      results: document.getElementById('pos-result-count').textContent,
      tile: (document.querySelector('.pos-tile') || {}).textContent
    };
  `);
  check('Terminal renders the catalog and an empty cart',
    initial.tiles === 14 && initial.chips.length === 6 && initial.empty && initial.count === '0 items' &&
    initial.chargeDisabled && initial.clearDisabled && initial.label.indexOf('Charge $0.00') !== -1, initial);
  check('Product tiles show price and stock', initial.tile.indexOf('$') !== -1 && /stock|left/i.test(initial.tile), initial.tile);
  await shot('step06-pos-1440');

  step('search and categories');
  const searched = await evaluate(`
    function search(value) {
      var input = document.getElementById('pos-search');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        tiles: document.querySelectorAll('.pos-tile').length,
        names: Array.prototype.map.call(document.querySelectorAll('.pos-tile-name'), function (n) { return n.textContent; }),
        counter: document.getElementById('pos-result-count').textContent
      };
    }
    var byName = search('espresso');
    var bySku = search('SNK-4007');
    var cleared = search('');
    return { byName: byName, bySku: bySku, cleared: cleared };
  `);
  check('Search matches product name and SKU',
    searched.byName.tiles === 1 && searched.byName.names[0] === 'Aurora Espresso Blend' &&
    searched.bySku.tiles === 1 && searched.bySku.names[0] === 'Sea Salt Dark Chocolate' &&
    searched.cleared.tiles === 14, searched);

  const filtered = await evaluate(`
    var chip = Array.prototype.find.call(document.querySelectorAll('#pos-categories .chip-btn'), function (c) { return c.textContent === 'Bakery'; });
    chip.click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var tiles = document.querySelectorAll('.pos-tile').length;
        var names = Array.prototype.map.call(document.querySelectorAll('.pos-tile-name'), function (n) { return n.textContent; });
        var all = Array.prototype.find.call(document.querySelectorAll('#pos-categories .chip-btn'), function (c) { return c.textContent === 'All items'; });
        all.click();
        setTimeout(function () {
          resolve({ tiles: tiles, names: names, restored: document.querySelectorAll('.pos-tile').length });
        }, 120);
      }, 120);
    });
  `);
  check('Category chips filter the grid', filtered.tiles === 3 && filtered.restored === 14, filtered);

  step('add to cart');
  const added = await evaluate(`
    document.querySelector('[data-add-product="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        function totals() {
          var rows = Array.prototype.map.call(document.querySelectorAll('#cart-totals .cart-row'), function (r) {
            return { label: r.querySelector('span').textContent, value: r.querySelectorAll('span')[1].textContent };
          });
          return rows;
        }
        resolve({
          lines: document.querySelectorAll('.cart-item').length,
          qty: (document.querySelector('.qty-value') || {}).textContent,
          count: document.getElementById('cart-count').textContent,
          totals: totals(),
          charge: document.getElementById('charge-label').textContent,
          chargeEnabled: !document.getElementById('charge-sale').disabled,
          stored: JSON.parse(localStorage.getItem('devhawx.pos.cart')),
          toast: !!document.querySelector('.toast')
        });
      }, 220);
    });
  `);
  const subtotal = parseFloat(added.totals[0].value.replace(/[^0-9.]/g, ''));
  const tax = parseFloat(added.totals[1].value.replace(/[^0-9.]/g, ''));
  const total = parseFloat(added.totals[2].value.replace(/[^0-9.]/g, ''));
  check('Product tile adds a line to the cart',
    added.lines === 1 && added.qty === '1' && added.count === '1 item' && added.chargeEnabled &&
    Math.abs(subtotal - 18.5) < 0.001 && Math.abs(tax - 1.57) < 0.01 && Math.abs(total - 20.07) < 0.01,
    added);
  check('Cart persists to localStorage',
    Array.isArray(added.stored) && added.stored.length === 1 && added.stored[0].productId === 'prd_espresso' &&
    added.stored[0].quantity === 1 && added.stored[0].price === 18.5, added.stored);

  step('quantity controls');
  const quantities = await evaluate(`
    document.querySelector('[data-cart-inc="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var afterInc = {
          qty: document.querySelector('.qty-value').textContent,
          subtotal: document.querySelector('#cart-totals .cart-row span:last-child').textContent,
          stored: JSON.parse(localStorage.getItem('devhawx.pos.cart'))[0].quantity
        };
        document.querySelector('[data-cart-dec="prd_espresso"]').click();
        setTimeout(function () {
          var afterDec = document.querySelector('.qty-value').textContent;
          document.querySelector('[data-cart-dec="prd_espresso"]').click();
          setTimeout(function () {
            resolve({
              afterInc: afterInc,
              afterDec: afterDec,
              lines: document.querySelectorAll('.cart-item').length,
              empty: !!document.querySelector('.cart-empty'),
              chargeDisabled: document.getElementById('charge-sale').disabled,
              stored: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length
            });
          }, 160);
        }, 160);
      }, 160);
    });
  `);
  check('Quantity increases and decreases',
    quantities.afterInc.qty === '2' && quantities.afterInc.stored === 2 &&
    quantities.afterDec === '1' && quantities.lines === 0 && quantities.empty && quantities.chargeDisabled &&
    quantities.stored === 0, quantities);

  step('stock limit');
  const limited = await evaluate(`
    for (var i = 0; i < 4; i += 1) {
      document.querySelector('[data-add-product="prd_face-mist"]').click();
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          qty: document.querySelector('.qty-value').textContent,
          stock: DH.store.collection('products').find('prd_face-mist').stock,
          incDisabled: document.querySelector('[data-cart-inc="prd_face-mist"]').disabled,
          toast: (document.querySelector('.toast') || {}).textContent || '',
          stored: JSON.parse(localStorage.getItem('devhawx.pos.cart'))[0].quantity
        });
      }, 260);
    });
  `);
  check('Cart cannot exceed available stock', limited.qty === '3' && limited.stored === 3 && limited.incDisabled && /left/.test(limited.toast), limited);

  step('discount');
  const discounted = await evaluate(`
    document.querySelector('[data-cart-remove="prd_face-mist"]').click();
    document.querySelector('[data-add-product="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        document.querySelector('[data-discount="10"]').click();
        setTimeout(function () {
          function rows() {
            return Array.prototype.map.call(document.querySelectorAll('#cart-totals .cart-row'), function (r) {
              return { label: r.querySelector('span').textContent, value: r.querySelectorAll('span')[1].textContent };
            });
          }
          var afterChip = { rows: rows(), active: document.querySelector('.discount-chip.is-active').textContent };
          var input = document.getElementById('discount-input');
          input.value = '25';
          document.getElementById('discount-apply').click();
          setTimeout(function () {
            resolve({
              afterChip: afterChip,
              afterCustom: rows(),
              stored: JSON.parse(localStorage.getItem('devhawx.pos.cartDiscount')),
              active: (document.querySelector('.discount-chip.is-active') || {}).textContent
            });
          }, 160);
        }, 160);
      }, 200);
    });
  `);
  const chipRows = discounted.afterChip.rows;
  const chipSub = parseFloat(chipRows[0].value.replace(/[^0-9.]/g, ''));
  const chipDiscount = parseFloat(chipRows[1].value.replace(/[^0-9.]/g, ''));
  const chipTax = parseFloat(chipRows[2].value.replace(/[^0-9.]/g, ''));
  const chipTotal = parseFloat(chipRows[3].value.replace(/[^0-9.]/g, ''));
  const customRows = discounted.afterCustom;
  const customSub = parseFloat(customRows[0].value.replace(/[^0-9.]/g, ''));
  const customDiscount = parseFloat(customRows[1].value.replace(/[^0-9.]/g, ''));
  const customTax = parseFloat(customRows[2].value.replace(/[^0-9.]/g, ''));
  const customTotal = parseFloat(customRows[3].value.replace(/[^0-9.]/g, ''));
  check('Quick discount applies to the subtotal',
    chipRows.length === 4 && Math.abs(chipSub - 18.5) < 0.001 && Math.abs(chipDiscount - 1.85) < 0.01 &&
    Math.abs(chipTax - 1.42) < 0.02 && Math.abs(chipTotal - 18.07) < 0.02 && discounted.afterChip.active === '10%',
    discounted.afterChip);
  check('Custom discount recalculates tax and total',
    Math.abs(customSub - 18.5) < 0.001 && Math.abs(customDiscount - 4.63) < 0.02 &&
    Math.abs(customTax - 1.18) < 0.02 && Math.abs(customTotal - 15.05) < 0.02 && discounted.stored === 25,
    discounted);

  step('clear cart');
  const cleared = await evaluate(`
    document.getElementById('clear-cart').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var title = (document.getElementById('modal-title') || {}).textContent;
        document.querySelector('[data-modal-close]').click();
        setTimeout(function () {
          var kept = {
            lines: document.querySelectorAll('.cart-item').length,
            stored: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length
          };
          document.getElementById('clear-cart').click();
          setTimeout(function () {
            document.querySelector('[data-modal-confirm]').click();
            setTimeout(function () {
              resolve({
                title: title,
                kept: kept,
                lines: document.querySelectorAll('.cart-item').length,
                stored: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length,
                discount: JSON.parse(localStorage.getItem('devhawx.pos.cartDiscount')),
                empty: !!document.querySelector('.cart-empty')
              });
            }, 260);
          }, 180);
        }, 180);
      }, 180);
    });
  `);
  check('Clear cart asks for confirmation', cleared.title === 'Clear the cart?' && cleared.kept.lines === 1 && cleared.kept.stored === 1, cleared);
  check('Confirmed clear empties the cart and discount', cleared.lines === 0 && cleared.stored === 0 && cleared.discount === 0 && cleared.empty, cleared);

  step('checkout');
  const charged = await evaluate(`
    var before = DH.store.collection('customers').find('cus_amelia');
    document.querySelector('[data-add-product="prd_espresso"]').click();
    document.querySelector('[data-add-product="prd_matcha"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        document.getElementById('charge-sale').click();
        setTimeout(function () {
          var modal = {
            open: document.getElementById('modal-root').classList.contains('is-open'),
            title: (document.getElementById('modal-title') || {}).textContent,
            payments: Array.prototype.map.call(document.querySelectorAll('.pay-option'), function (p) { return p.getAttribute('data-payment'); }),
            active: (document.querySelector('.pay-option.is-active') || {}).getAttribute('data-payment'),
            customers: document.querySelectorAll('#charge-customer option').length
          };
          Array.prototype.find.call(document.querySelectorAll('.pay-option'), function (p) { return p.getAttribute('data-payment') === 'Card'; }).click();
          document.getElementById('charge-customer').value = 'cus_amelia';
          document.querySelector('[data-modal-confirm]').click();
          setTimeout(function () {
            var sales = DH.store.collection('sales').all();
            var sale = sales.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })[0];
            var movements = DH.store.collection('inventory').all().filter(function (m) { return m.note === 'Sale ' + sale.receipt; });
            var receiptModal = {
              open: document.getElementById('modal-root').classList.contains('is-open'),
              title: (document.getElementById('modal-title') || {}).textContent
            };
            resolve({
              modal: modal,
              sale: sale,
              salesCount: sales.length,
              espresso: DH.store.collection('products').find('prd_espresso').stock,
              matcha: DH.store.collection('products').find('prd_matcha').stock,
              movements: movements,
              cart: JSON.parse(localStorage.getItem('devhawx.pos.cart')),
              discount: JSON.parse(localStorage.getItem('devhawx.pos.cartDiscount')),
              lines: document.querySelectorAll('.cart-item').length,
              receiptModal: receiptModal,
              customer: DH.store.collection('customers').find('cus_amelia'),
              before: before
            });
          }, 700);
        }, 260);
      }, 220);
    });
  `);
  check('Charge dialog collects payment and customer',
    charged.modal.open && /Charge/.test(charged.modal.title) && charged.modal.payments.join(',') === 'Cash,Card,Other' &&
    charged.modal.active === 'Cash' && charged.modal.customers === 10, charged.modal);
  check('Completing a sale records the receipt',
    charged.salesCount === 163 && charged.sale.receipt === 'INV-4363' && charged.sale.payment === 'Card' &&
    charged.sale.transactionId === 'TXN-00163' &&
    charged.sale.customerId === 'cus_amelia' && charged.sale.customerName === 'Amelia Hart' &&
    charged.sale.itemCount === 2 && charged.sale.items.length === 2 &&
    charged.sale.total > 0 && charged.sale.subtotal === 35.25, charged.sale);
  check('Completing a sale reduces stock and logs movements',
    charged.espresso === 33 && charged.matcha === 17 && charged.movements.length === 2 &&
    charged.movements[0].type === 'issue' && charged.movements[0].stockBefore === 34 && charged.movements[0].stockAfter === 33,
    { espresso: charged.espresso, matcha: charged.matcha, movements: charged.movements });
  check('Completing a sale clears the cart and updates the customer',
    charged.cart.length === 0 && charged.discount === 0 && charged.lines === 0 &&
    charged.customer.orders === charged.before.orders + 1 &&
    Math.abs(charged.customer.totalSpent - (charged.before.totalSpent + charged.sale.total)) < 0.01, { customer: charged.customer, before: charged.before });
  check('A receipt is shown after checkout',
    charged.receiptModal.open && charged.receiptModal.title === 'Sale completed', charged.receiptModal);
  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);

  step('persistence');
  await navigate('pos');
  const persisted = await evaluate(`
    document.querySelector('[data-add-product="prd_chocolate"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          stored: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length,
          lines: document.querySelectorAll('.cart-item').length
        });
      }, 200);
    });
  `);
  check('Cart survives a refresh', persisted.stored === 1 && persisted.lines === 1, persisted);
  await navigate('pos');
  const afterReload = await evaluate(`
    return {
      stored: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length,
      lines: document.querySelectorAll('.cart-item').length
    };
  `);
  check('Cart is still there after another refresh', afterReload.stored === 1 && afterReload.lines === 1, afterReload);
  await evaluate(`DH.store.collection('cart').replaceAll([]); DH.store.saveData('cartDiscount', 0); return true;`);

  step('dashboard sync');
  await navigate('dashboard');
  const dash = await evaluate(`
    var cards = Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
      return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
    });
    return { cards: cards };
  `);
  check('Dashboard counts the new sale', dash.cards.indexOf('Total orders=163') !== -1, dash.cards);

  step('responsive');
  for (const width of [360, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate('pos');
    await sleep(280);
    const info = await evaluate(`
      var layout = document.querySelector('.pos-layout');
      var tiles = document.querySelectorAll('.pos-tile').length;
      var search = document.getElementById('pos-search').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tiles: tiles,
        columns: getComputedStyle(layout).gridTemplateColumns.split(' ').length,
        searchRight: Math.round(search.right),
        viewport: document.documentElement.clientWidth,
        cartVisible: !!document.querySelector('.pos-cart'),
        gridColumns: getComputedStyle(document.querySelector('.pos-grid')).gridTemplateColumns.split(' ').length
      };
    `);
    check(`POS fits at ${width}px`, info.overflow <= 1 && info.tiles === 14 && info.cartVisible && info.searchRight <= info.viewport + 1, info);
    if (width === 360) await shot('step06-pos-360');
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('pos');
  await sleep(250);
  await shot('step06-pos-final-1440');

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
