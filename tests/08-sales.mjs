import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9342;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-sales-cdp-'));

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
  const url = `${BASE}?s=${navCount}#/${route}`;
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
  await navigate('dashboard');
  await sleep(420);

  const before = await evaluate(`
    var raw = localStorage.getItem('devhawx.pos.sales');
    var sales = JSON.parse(raw);
    return { count: sales.length, receipts: sales.map(function (s) { return s.receipt; }).sort().join(',').length, digest: sales.length + ':' + sales.map(function (s) { return s.receipt; }).sort().join(',') };
  `);

  await navigate('sales');
  await sleep(500);

  const view = await evaluate(`
    var sales = DH.store.collection('sales').all();
    var raw = JSON.parse(localStorage.getItem('devhawx.pos.sales'));
    var rows = document.querySelectorAll('#sale-table-body tr');
    var receipts = Array.prototype.map.call(document.querySelectorAll('#sale-table-body .sale-receipt'), function (n) { return n.textContent; });
    return {
      rows: rows.length,
      stored: raw.length,
      collection: sales.length,
      counter: document.getElementById('sale-count').textContent,
      columns: Array.prototype.map.call(document.querySelectorAll('.sales-table thead th'), function (th) { return th.textContent; }),
      kpis: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
        return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
      }),
      firstReceipt: receipts[0],
      knownReceipts: receipts.every(function (r) { return sales.some(function (s) { return s.receipt === r; }); }),
      digest: raw.length + ':' + raw.map(function (s) { return s.receipt; }).sort().join(',')
    };
  `);
  check('Every stored transaction is listed', view.rows === before.count && view.stored === before.count && view.collection === before.count, { rows: view.rows, stored: view.stored });
  check('Rows map to real receipts only', view.knownReceipts === true && /INV-/.test(view.firstReceipt), view.firstReceipt);
  check('Opening the page never writes fake sales', view.digest === before.digest, { before: before.digest.length, after: view.digest.length });
  check('Columns cover receipt, customer, payment and total',
    JSON.stringify(view.columns) === JSON.stringify(['Receipt', 'Date', 'Customer', 'Items', 'Payment', 'Total', '']), view.columns);
  check('KPIs summarise the stored sales',
    view.kpis.length === 4 && /Transactions=162/.test(view.kpis.join('|')) && view.counter === '162 of 162 transactions', view.kpis);
  await shot('step10-sales-1440');

  step('search');
  const searched = await evaluate(`
    function search(value) {
      var input = document.getElementById('sale-search');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        rows: document.querySelectorAll('#sale-table-body tr').length,
        receipts: Array.prototype.map.call(document.querySelectorAll('#sale-table-body .sale-receipt'), function (n) { return n.textContent; }),
        customers: Array.prototype.map.call(document.querySelectorAll('#sale-table-body .sale-customer'), function (n) { return n.textContent; }),
        counter: document.getElementById('sale-count').textContent
      };
    }
    var byReceipt = search('INV-4362');
    var byCustomer = search('Amelia Hart');
    var byProduct = search('Espresso');
    var missing = search('INV-DOES-NOT-EXIST');
    return { byReceipt: byReceipt, byCustomer: byCustomer, byProduct: byProduct, missing: missing };
  `);
  check('Search finds a receipt number', searched.byReceipt.rows === 1 && searched.byReceipt.receipts[0] === 'INV-4362', searched.byReceipt);
  check('Search also matches customer and product',
    searched.byCustomer.rows > 0 && searched.byCustomer.rows < 162 && searched.byProduct.rows > 0, searched);
  check('No match shows the filtered empty state', searched.missing.rows === 1 && searched.missing.counter === '0 of 162 transactions', searched.missing);

  const cleared = await evaluate(`
    document.querySelector('[data-clear-filters]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          rows: document.querySelectorAll('#sale-table-body tr').length,
          value: document.getElementById('sale-search').value
        });
      }, 180);
    });
  `);
  check('Clear filters restores every transaction', cleared.rows === 162 && cleared.value === '', cleared);

  step('date and payment filters');
  const filters = await evaluate(`
    var range = document.getElementById('sale-range');
    var payment = document.getElementById('sale-payment');
    var sales = DH.store.collection('sales').all();

    function pickRange(value) {
      range.value = value;
      range.dispatchEvent(new Event('change', { bubbles: true }));
      return document.querySelectorAll('#sale-table-body tr').length;
    }
    function pickPayment(value) {
      payment.value = value;
      payment.dispatchEvent(new Event('change', { bubbles: true }));
      return document.querySelectorAll('#sale-table-body tr').length;
    }

    var options = Array.prototype.map.call(payment.options, function (o) { return o.value; });
    var today = pickRange('today');
    var week = pickRange('week');
    var all = pickRange('all');
    var card = pickPayment('Card');
    var cash = pickPayment('Cash');
    var other = pickPayment('Other');
    payment.value = 'all';
    payment.dispatchEvent(new Event('change', { bubbles: true }));

    var expected = {
      today: sales.filter(function (s) { var d = new Date(s.createdAt); var n = new Date(); return d.toDateString() === n.toDateString(); }).length,
      card: sales.filter(function (s) { return s.payment === 'Card'; }).length,
      cash: sales.filter(function (s) { return s.payment === 'Cash'; }).length,
      other: sales.filter(function (s) { return s.payment === 'Other'; }).length
    };
    return { options: options, today: today, week: week, all: all, card: card, cash: cash, other: other, expected: expected };
  `);
  check('Date filter narrows the list to real ranges',
    filters.today === filters.expected.today && filters.today > 0 && filters.today < filters.all && filters.week > filters.today, filters);
  check('Payment filter matches the stored payments',
    filters.card === filters.expected.card && filters.cash === filters.expected.cash &&
    filters.options.indexOf('Card') !== -1 && filters.options.indexOf('Cash') !== -1, filters);

  step('sorting');
  const sorted = await evaluate(`
    var sort = document.getElementById('sale-sort');
    function pick(value) {
      sort.value = value;
      sort.dispatchEvent(new Event('change', { bubbles: true }));
      return Array.prototype.map.call(document.querySelectorAll('#sale-table-body tr'), function (tr) {
        return { receipt: tr.querySelector('.sale-receipt').textContent, total: tr.querySelector('.amount-cell').textContent, date: tr.querySelector('.date-cell strong').textContent };
      });
    }
    var highest = pick('highest');
    var newest = pick('newest');
    sort.value = 'newest';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    return { highest: highest[0], newest: newest[0] };
  `);
  const totals = await evaluate(`
    var sales = DH.store.collection('sales').all();
    var max = sales.reduce(function (a, b) { return (Number(b.total) || 0) > (Number(a.total) || 0) ? b : a; });
    var latest = sales.reduce(function (a, b) { return new Date(b.createdAt) > new Date(a.createdAt) ? b : a; });
    return { maxReceipt: max.receipt, maxTotal: DH.format.currency(max.total), latestReceipt: latest.receipt };
  `);
  check('Sales sort by total and by date',
    sorted.highest.receipt === totals.maxReceipt && sorted.highest.total === totals.maxTotal &&
    sorted.newest.receipt === totals.latestReceipt, { sorted: sorted, totals: totals });

  step('sale details');
  const detail = await evaluate(`
    var target = DH.store.collection('sales').all().filter(function (s) { return s.customerId === 'cus_amelia'; })[0];
    document.querySelector('[data-sale-view="' + target.id + '"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          title: (document.getElementById('modal-title') || {}).textContent,
          stats: Array.prototype.map.call(document.querySelectorAll('.customer-stat'), function (s) {
            return s.querySelector('span').textContent + '=' + s.querySelector('strong').textContent;
          }),
          contact: Array.prototype.map.call(document.querySelectorAll('.customer-contact div'), function (d) {
            return d.querySelector('span').textContent + '=' + d.querySelector('strong').textContent;
          }),
          itemRows: document.querySelectorAll('.detail-table tbody tr').length,
          itemNames: Array.prototype.map.call(document.querySelectorAll('.sale-item-name'), function (n) { return n.textContent; }),
          skus: Array.prototype.map.call(document.querySelectorAll('.sale-item-sku'), function (n) { return n.textContent; }),
          printButton: !!document.querySelector('[data-print-sale]'),
          target: target,
          expected: {
            subtotal: DH.format.currency(target.subtotal),
            tax: DH.format.currency(target.tax),
            taxRate: DH.format.percent(target.taxRate),
            total: DH.format.currency(target.total)
          }
        });
      }, 320);
    });
  `);
  const statText = detail.stats.join('|');
  const contactText = detail.contact.join('|');
  check('Sale detail shows the receipt, totals and payment',
    detail.title === 'Sale ' + detail.target.receipt &&
    statText.indexOf('Subtotal=' + detail.expected.subtotal) !== -1 &&
    statText.indexOf('Tax (' + detail.expected.taxRate + ')=' + detail.expected.tax) !== -1 &&
    statText.indexOf('Total=' + detail.expected.total) !== -1 &&
    contactText.indexOf('Method=' + detail.target.payment) !== -1 &&
    contactText.indexOf('Cashier=' + (detail.target.cashier || 'Admin')) !== -1, detail);
  check('Sale detail lists the purchased products',
    detail.itemRows === detail.target.items.length &&
    detail.itemNames[0] === detail.target.items[0].name &&
    detail.skus[0] === detail.target.items[0].sku, detail);
  check('Sale detail shows customer information and history',
    contactText.indexOf('Customer=Amelia Hart') !== -1 &&
    contactText.indexOf('Phone=+1 (555) 014-2201') !== -1 &&
    contactText.indexOf('Email=amelia.hart@example.com') !== -1 &&
    contactText.indexOf('Total purchases=') !== -1, detail);

  step('print previous receipt');
  const printed = await evaluate(`
    document.querySelector('[data-print-sale]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var receipt = document.getElementById('print-receipt');
        resolve({
          open: document.getElementById('modal-root').classList.contains('is-open'),
          exists: !!receipt,
          text: receipt ? receipt.textContent : '',
          printButton: !!document.querySelector('[data-print-receipt]')
        });
      }, 400);
    });
  `);
  check('A stored sale can be reprinted as a thermal receipt',
    printed.open && printed.exists && printed.printButton &&
    printed.text.indexOf(detail.target.receipt) !== -1 &&
    printed.text.indexOf(detail.target.items[0].name) !== -1, printed);
  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);

  step('row print action');
  const rowPrint = await evaluate(`
    var row = document.querySelector('#sale-table-body tr');
    row.querySelector('[data-sale-print]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var receipt = document.getElementById('print-receipt');
        resolve({ open: document.getElementById('modal-root').classList.contains('is-open'), exists: !!receipt });
      }, 400);
    });
  `);
  check('Every row has a print action', rowPrint.open && rowPrint.exists, rowPrint);
  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);

  step('persistence');
  await navigate('sales');
  const persisted = await evaluate(`
    var raw = JSON.parse(localStorage.getItem('devhawx.pos.sales'));
    return {
      rows: document.querySelectorAll('#sale-table-body tr').length,
      stored: raw.length,
      digest: raw.length + ':' + raw.map(function (s) { return s.receipt; }).sort().join(','),
      counter: document.getElementById('sale-count').textContent
    };
  `);
  check('Sales view never mutates the stored transactions',
    persisted.stored === before.count && persisted.digest === before.digest && persisted.rows === 162, persisted);

  step('responsive');
  for (const width of [360, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate('sales');
    await sleep(280);
    const info = await evaluate(`
      var search = document.getElementById('sale-search').getBoundingClientRect();
      var filters = Array.prototype.map.call(document.querySelectorAll('.filter-select'), function (f) {
        return Math.round(f.getBoundingClientRect().right);
      });
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rows: document.querySelectorAll('#sale-table-body tr').length,
        searchRight: Math.round(search.right),
        filtersRight: filters,
        viewport: document.documentElement.clientWidth
      };
    `);
    check(`Sales view fits at ${width}px`, info.overflow <= 1 && info.rows === 162 && info.searchRight <= info.viewport + 1 &&
      info.filtersRight.every((r) => r <= info.viewport + 1), info);
    if (width === 360) await shot('step10-sales-360');
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('sales');

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
