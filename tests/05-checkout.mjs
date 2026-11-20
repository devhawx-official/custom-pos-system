import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9339;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-pay-cdp-'));

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

  step('setup');
  await navigate('dashboard');
  await evaluate('localStorage.clear(); return true;');
  await navigate('pos');
  await sleep(450);

  await evaluate(`document.querySelector('[data-add-product="prd_espresso"]').click(); return true;`);
  await sleep(200);

  step('payment methods');
  const methods = await evaluate(`
    document.getElementById('charge-sale').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var cashBlock = document.getElementById('cash-block');
        var amount = document.getElementById('cash-received');
        resolve({
          open: document.getElementById('modal-root').classList.contains('is-open'),
          options: Array.prototype.map.call(document.querySelectorAll('.pay-option'), function (p) { return p.getAttribute('data-payment'); }),
          active: (document.querySelector('.pay-option.is-active') || {}).getAttribute('data-payment'),
          cashVisible: !cashBlock.hidden,
          amount: amount ? amount.value : null,
          change: (document.getElementById('cash-change') || {}).textContent,
          customerOptions: Array.prototype.map.call(document.querySelectorAll('#charge-customer option'), function (o) { return o.value; })
        });
      }, 260);
    });
  `);
  check('Cash, Card and Other payment methods are offered',
    methods.options.join(',') === 'Cash,Card,Other' && methods.active === 'Cash', methods);
  check('Cash payment asks for the amount received',
    methods.cashVisible === true && methods.amount === '20.07' && /Change due/.test(methods.change || ''), methods);
  check('Customer list offers walk-in, existing customers and a new walk-in',
    methods.customerOptions[0] === '' && methods.customerOptions.indexOf('__new__') !== -1 && methods.customerOptions.length === 10, methods.customerOptions);

  step('change calculation');
  const changeCalc = await evaluate(`
    var amount = document.getElementById('cash-received');
    amount.value = '50';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        var output = document.getElementById('cash-change');
        var exact = output.textContent;
        amount.value = '10';
        amount.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(function () {
          resolve({
            exact: exact,
            invalidClass: output.classList.contains('is-invalid'),
            shortText: output.textContent
          });
        }, 140);
      }, 140);
    });
  `);
  check('Change is calculated automatically', changeCalc.exact.indexOf('$29.93') !== -1, changeCalc);
  check('Underpayment is flagged before checkout', changeCalc.invalidClass && /less than the total/.test(changeCalc.shortText), changeCalc);

  step('payment validation');
  const validation = await evaluate(`
    var amount = document.getElementById('cash-received');
    amount.value = '10';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-modal-confirm]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var shortError = document.querySelector('[data-error="cashReceived"]').textContent;
        var stillOpen = document.getElementById('modal-root').classList.contains('is-open');
        amount.value = '';
        amount.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          resolve({
            shortError: shortError,
            stillOpen: stillOpen,
            emptyError: document.querySelector('[data-error="cashReceived"]').textContent,
            sales: DH.store.collection('sales').count(),
            modalOpen: document.getElementById('modal-root').classList.contains('is-open')
          });
        }, 200);
      }, 200);
    });
  `);
  check('Cash payment is validated',
    /less than the total/.test(validation.shortError) && validation.stillOpen &&
    /Enter the amount received/.test(validation.emptyError) && validation.sales === 162 && validation.modalOpen,
    validation);

  step('cash checkout');
  const cashSale = await evaluate(`
    var amount = document.getElementById('cash-received');
    amount.value = '50';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-modal-confirm]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var sale = DH.store.collection('sales').all().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })[0];
        var receipt = document.getElementById('print-receipt');
        resolve({
          sale: sale,
          sales: DH.store.collection('sales').count(),
          receiptOpen: !!receipt,
          receiptText: receipt ? receipt.textContent : '',
          printButton: !!document.querySelector('[data-print-receipt]'),
          title: (document.getElementById('modal-title') || {}).textContent,
          stock: DH.store.collection('products').find('prd_espresso').stock,
          movement: DH.store.collection('inventory').all().filter(function (m) { return m.note === 'Sale ' + sale.receipt; })[0],
          cart: JSON.parse(localStorage.getItem('devhawx.pos.cart')),
          stored: JSON.parse(localStorage.getItem('devhawx.pos.sales')).length,
          transactionIds: DH.store.collection('sales').all().map(function (s) { return s.transactionId; }).filter(Boolean)
        });
      }, 800);
    });
  `);
  check('Cash sale is saved with the amount received and change',
    cashSale.sales === 163 && cashSale.sale.payment === 'Cash' && cashSale.sale.amountReceived === 50 &&
    Math.abs(cashSale.sale.change - 29.93) < 0.001 && cashSale.sale.total === 20.07 &&
    cashSale.sale.receipt === 'INV-4363' && cashSale.sale.transactionId === 'TXN-00163', cashSale.sale);
  check('Sale is persisted in localStorage', cashSale.stored === 163, { stored: cashSale.stored });
  check('Stock is deducted and the movement logged',
    cashSale.stock === 33 && cashSale.movement && cashSale.movement.type === 'issue' &&
    cashSale.movement.stockBefore === 34 && cashSale.movement.stockAfter === 33, cashSale.movement);
  check('Cart is cleared after a successful checkout', cashSale.cart.length === 0, cashSale.cart);
  check('Printable receipt is shown',
    cashSale.receiptOpen && cashSale.printButton && cashSale.title === 'Sale completed' &&
    /Aurora Espresso Blend/.test(cashSale.receiptText) && /INV-4363/.test(cashSale.receiptText) &&
    /TXN-00163/.test(cashSale.receiptText) && /29.93/.test(cashSale.receiptText), cashSale.title);
  await shot('step07-receipt-1440');

  const printCss = await evaluate(`
    var found = Array.prototype.some.call(document.styleSheets, function (sheet) {
      try {
        return Array.prototype.some.call(sheet.cssRules, function (rule) {
          return rule.type === 4 && rule.conditionText && rule.conditionText.indexOf('print') !== -1;
        });
      } catch (error) { return false; }
    });
    return { found: found, receiptId: !!document.getElementById('print-receipt') };
  `);
  check('A print stylesheet targets the receipt', printCss.found && printCss.receiptId, printCss);

  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);
  await sleep(200);

  step('walk-in customer');
  const walkIn = await evaluate(`
    document.querySelector('[data-add-product="prd_matcha"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        document.getElementById('charge-sale').click();
        setTimeout(function () {
          var select = document.getElementById('charge-customer');
          select.value = '__new__';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          var blockVisible = !document.getElementById('new-customer-block').hidden;
          document.querySelector('[data-modal-confirm]').click();
          setTimeout(function () {
            var nameError = document.querySelector('[data-error="customerName"]').textContent;
            document.getElementById('new-customer-name').value = 'Jordan Lee';
            document.getElementById('new-customer-phone').value = '+1 (555) 017-8842';
            document.querySelector('[data-modal-confirm]').click();
            setTimeout(function () {
              var customer = DH.store.collection('customers').all().filter(function (c) { return c.name === 'Jordan Lee'; })[0];
              var sale = DH.store.collection('sales').all().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })[0];
              resolve({
                blockVisible: blockVisible,
                nameError: nameError,
                customer: customer,
                customerCount: DH.store.collection('customers').count(),
                sale: sale,
                sales: DH.store.collection('sales').count()
              });
            }, 800);
          }, 220);
        }, 260);
      }, 200);
    });
  `);
  check('Walk-in customer form opens and validates the name',
    walkIn.blockVisible && /Enter the customer name/.test(walkIn.nameError), walkIn);
  check('Walk-in customer is created and linked to the sale',
    walkIn.customer && walkIn.customerCount === 9 && walkIn.customer.orders === 1 &&
    walkIn.sale.customerId === walkIn.customer.id && walkIn.sale.customerName === 'Jordan Lee' &&
    walkIn.sale.transactionId === 'TXN-00164', { customer: walkIn.customer, sale: walkIn.sale });

  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);
  await sleep(200);

  step('insufficient stock');
  const blocked = await evaluate(`
    document.querySelector('[data-add-product="prd_granola"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        DH.store.collection('products').update('prd_granola', { stock: 0 });
        document.getElementById('charge-sale').click();
        setTimeout(function () {
          document.querySelector('[data-modal-confirm]').click();
          setTimeout(function () {
            var alert = document.getElementById('charge-alert');
            resolve({
              alert: alert ? alert.textContent : '',
              alertVisible: alert ? !alert.hidden : false,
              open: document.getElementById('modal-root').classList.contains('is-open'),
              sales: DH.store.collection('sales').count(),
              cart: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length,
              stock: DH.store.collection('products').find('prd_granola').stock
            });
          }, 300);
        }, 260);
      }, 200);
    });
  `);
  check('Checkout is blocked when stock is insufficient',
    blocked.alertVisible && /Not enough stock/.test(blocked.alert) && blocked.open &&
    blocked.sales === 164 && blocked.cart === 1 && blocked.stock === 0, blocked);

  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);
  await sleep(200);

  step('duplicate transactions');
  const duplicates = await evaluate(`
    DH.store.collection('products').update('prd_granola', { stock: 20 });
    document.getElementById('charge-sale').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var before = DH.store.collection('sales').count();
        var button = document.querySelector('[data-modal-confirm]');
        button.click();
        button.click();
        setTimeout(function () {
          var sales = DH.store.collection('sales').all();
          var ids = sales.map(function (s) { return s.transactionId; }).filter(Boolean);
          var receipts = sales.map(function (s) { return s.receipt; });
          resolve({
            before: before,
            after: sales.length,
            uniqueIds: ids.length === new Set(ids).size,
            uniqueReceipts: receipts.length === new Set(receipts).size,
            cart: JSON.parse(localStorage.getItem('devhawx.pos.cart')).length
          });
        }, 900);
      }, 260);
    });
  `);
  check('A double submit never creates two transactions',
    duplicates.after === duplicates.before + 1 && duplicates.uniqueIds && duplicates.uniqueReceipts && duplicates.cart === 0, duplicates);

  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);
  await sleep(200);

  step('card and other payments');
  const other = await evaluate(`
    document.querySelector('[data-add-product="prd_chocolate"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        document.getElementById('charge-sale').click();
        setTimeout(function () {
          Array.prototype.find.call(document.querySelectorAll('.pay-option'), function (p) { return p.getAttribute('data-payment') === 'Other'; }).click();
          var cashHidden = document.getElementById('cash-block').hidden;
          document.getElementById('charge-customer').value = 'cus_noah';
          document.querySelector('[data-modal-confirm]').click();
          setTimeout(function () {
            var sale = DH.store.collection('sales').all().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })[0];
            resolve({
              cashHidden: cashHidden,
              payment: sale.payment,
              customer: sale.customerName,
              customerId: sale.customerId,
              amountReceived: sale.amountReceived,
              change: sale.change,
              total: sale.total
            });
          }, 800);
        }, 260);
      }, 200);
    });
  `);
  check('Other payment skips the cash step and keeps the customer',
    other.cashHidden && other.payment === 'Other' && other.customer === 'Noah Bennett' &&
    other.customerId === 'cus_noah' && other.amountReceived === other.total && other.change === 0, other);

  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);
  await sleep(200);

  step('responsive');
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: true });
  await navigate('pos');
  await sleep(260);
  const mobile = await evaluate(`
    document.querySelector('[data-add-product="prd_espresso"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        document.getElementById('charge-sale').click();
        setTimeout(function () {
          var select = document.getElementById('charge-customer');
          select.value = '__new__';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          var card = document.querySelector('.modal-card').getBoundingClientRect();
          var block = document.getElementById('new-customer-block');
          resolve({
            left: Math.round(card.left),
            right: Math.round(card.right),
            top: Math.round(card.top),
            bottom: Math.round(card.bottom),
            viewportW: document.documentElement.clientWidth,
            viewportH: document.documentElement.clientHeight,
            columns: getComputedStyle(block).gridTemplateColumns.split(' ').length,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
          });
        }, 320);
      }, 220);
    });
  `);
  check('Checkout dialog fits a 360px viewport',
    mobile.left >= 0 && mobile.right <= mobile.viewportW + 1 && mobile.top >= 0 && mobile.bottom <= mobile.viewportH &&
    mobile.columns === 1 && mobile.overflow <= 1, mobile);
  await shot('step07-checkout-360');

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('pos');

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
