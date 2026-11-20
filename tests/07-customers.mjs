import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-cus-cdp-'));

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
  const url = `${BASE}?k=${navCount}#/${route}`;
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

  step('directory');
  await navigate('dashboard');
  await evaluate('localStorage.clear(); return true;');
  await navigate('customers');
  await sleep(450);

  const seeded = await evaluate(`
    var customers = DH.store.collection('customers').all();
    var sales = DH.store.collection('sales').all();
    var ameliaSales = sales.filter(function (s) { return s.customerId === 'cus_amelia'; });
    var ameliaSpend = ameliaSales.reduce(function (sum, s) { return sum + (Number(s.total) || 0); }, 0);
    var ameliaRow = Array.prototype.find.call(document.querySelectorAll('#customer-table-body tr'), function (tr) {
      return tr.textContent.indexOf('Amelia Hart') !== -1;
    });
    return {
      rows: document.querySelectorAll('#customer-table-body tr').length,
      customers: customers.length,
      columns: Array.prototype.map.call(document.querySelectorAll('.customers-table thead th'), function (th) { return th.textContent; }),
      kpis: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
        return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
      }),
      counter: document.getElementById('customer-count').textContent,
      ameliaOrders: ameliaSales.length,
      ameliaSpend: ameliaSpend,
      ameliaSpendText: DH.format.currency(ameliaSpend),
      ameliaRow: ameliaRow ? ameliaRow.textContent : null,
      phones: Array.prototype.map.call(document.querySelectorAll('.customer-phone'), function (p) { return p.textContent; }),
      emails: Array.prototype.map.call(document.querySelectorAll('.customer-email'), function (p) { return p.textContent; })
    };
  `);
  check('Directory lists every customer with contact details',
    seeded.rows === 8 && seeded.customers === 8 && seeded.phones.length === 8 &&
    seeded.phones.indexOf('+1 (555) 014-2201') !== -1 && seeded.emails.indexOf('amelia.hart@example.com') !== -1, seeded);
  check('Columns cover purchases and spending',
    JSON.stringify(seeded.columns) === JSON.stringify(['Customer', 'Phone', 'Email', 'Purchases', 'Total spending', 'Last visit', '']), seeded.columns);
  check('Purchase count and spend come from the sales records',
    seeded.ameliaOrders > 0 && seeded.ameliaRow.indexOf(String(seeded.ameliaOrders)) !== -1 &&
    seeded.ameliaRow.indexOf(seeded.ameliaSpendText) !== -1, { ameliaOrders: seeded.ameliaOrders, ameliaSpendText: seeded.ameliaSpendText, row: seeded.ameliaRow });
  check('KPI strip summarises the directory', seeded.kpis.length === 4 && /Customers=8/.test(seeded.kpis.join('|')) && seeded.counter === '8 of 8 customers', seeded);
  await shot('step09-customers-1440');

  step('search');
  const searched = await evaluate(`
    function search(value) {
      var input = document.getElementById('customer-search');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        rows: document.querySelectorAll('#customer-table-body tr').length,
        names: Array.prototype.map.call(document.querySelectorAll('#customer-table-body .product-copy strong'), function (n) { return n.textContent; }),
        counter: document.getElementById('customer-count').textContent,
        empty: (document.querySelector('.empty-state h3') || {}).textContent || null
      };
    }
    return {
      byName: search('amelia'),
      byPhone: search('014-2203'),
      byEmail: search('noah.bennett'),
      missing: search('zzz-nobody')
    };
  `);
  check('Search matches name, phone and email',
    searched.byName.rows === 1 && searched.byName.names[0] === 'Amelia Hart' &&
    searched.byPhone.rows === 1 && searched.byEmail.rows === 1, searched);
  check('Search shows a filtered empty state', searched.missing.empty === 'No customers match' && searched.missing.counter === '0 of 8 customers', searched.missing);

  const cleared = await evaluate(`
    document.querySelector('[data-clear-filters]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          rows: document.querySelectorAll('#customer-table-body tr').length,
          value: document.getElementById('customer-search').value
        });
      }, 180);
    });
  `);
  check('Clear filters restores the directory', cleared.rows === 8 && cleared.value === '', cleared);

  step('sorting');
  const sorted = await evaluate(`
    var sort = document.getElementById('customer-sort');
    function pick(value) {
      sort.value = value;
      sort.dispatchEvent(new Event('change', { bubbles: true }));
      return Array.prototype.map.call(document.querySelectorAll('#customer-table-body .product-copy strong'), function (n) { return n.textContent; });
    }
    var spend = pick('spend');
    var orders = pick('orders');
    var name = pick('name');
    sort.value = 'recent';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    return { spend: spend, orders: orders, name: name };
  `);
  const bestSpend = await evaluate(`
    var customers = DH.store.collection('customers').all();
    var best = customers.map(function (c) {
      var spend = DH.store.collection('sales').all().filter(function (s) { return s.customerId === c.id; })
        .reduce(function (sum, s) { return sum + (Number(s.total) || 0); }, 0);
      return { name: c.name, spend: spend };
    }).sort(function (a, b) { return b.spend - a.spend; })[0];
    return best;
  `);
  check('Customers sort by spend, purchases and name',
    sorted.spend[0] === bestSpend.name && sorted.name[0] === 'Amelia Hart' && sorted.orders.length === 8, { sorted: sorted, bestSpend: bestSpend });

  step('add customer');
  const formOpen = await evaluate(`
    document.getElementById('add-customer').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var panel = document.getElementById('customer-panel');
        resolve({
          modal: document.getElementById('modal-root').classList.contains('is-open'),
          title: (document.getElementById('modal-title') || {}).textContent,
          fields: Array.prototype.map.call(panel.querySelectorAll('[name]'), function (f) { return f.name; }),
          tiers: Array.prototype.map.call(panel.querySelectorAll('[name="tier"] option'), function (o) { return o.value; })
        });
      }, 240);
    });
  `);
  check('Add customer opens a complete form', formOpen.modal && formOpen.title === 'Add customer' &&
    JSON.stringify(formOpen.fields) === JSON.stringify(['name', 'phone', 'email', 'tier']) && formOpen.tiers.length === 4, formOpen);

  const invalid = await evaluate(`
    document.querySelector('[data-modal-confirm]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var errors = Array.prototype.map.call(document.querySelectorAll('.field-error'), function (hint) {
          return { field: hint.getAttribute('data-error'), text: hint.textContent };
        }).filter(function (item) { return !!item.text; });
        resolve({
          errors: errors,
          open: document.getElementById('modal-root').classList.contains('is-open'),
          count: DH.store.collection('customers').count()
        });
      }, 220);
    });
  `);
  check('Name and phone are required', invalid.errors.length === 2 &&
    invalid.errors[0].field === 'name' && invalid.errors[1].field === 'phone' && invalid.open && invalid.count === 8, invalid);

  const badEmail = await evaluate(`
    document.querySelector('#customer-panel [name="name"]').value = 'Test Buyer';
    document.querySelector('#customer-panel [name="phone"]').value = '+1 (555) 019-0000';
    document.querySelector('#customer-panel [name="email"]').value = 'not-an-email';
    document.querySelector('[data-modal-confirm]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var emailError = document.querySelector('[data-error="email"]').textContent;
        document.querySelector('#customer-panel [name="email"]').value = 'amelia.hart@example.com';
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          resolve({
            emailError: emailError,
            duplicateError: document.querySelector('[data-error="email"]').textContent,
            count: DH.store.collection('customers').count(),
            open: document.getElementById('modal-root').classList.contains('is-open')
          });
        }, 220);
      }, 220);
    });
  `);
  check('Email format and uniqueness are validated',
    /valid email/.test(badEmail.emailError) && /already used/.test(badEmail.duplicateError) &&
    badEmail.count === 8 && badEmail.open, badEmail);

  const created = await evaluate(`
    document.querySelector('#customer-panel [name="email"]').value = 'test.buyer@example.com';
    document.querySelector('#customer-panel [name="phone"]').value = '123';
    document.querySelector('[data-modal-confirm]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var phoneError = document.querySelector('[data-error="phone"]').textContent;
        document.querySelector('#customer-panel [name="phone"]').value = '+1 (555) 019-0000';
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var customer = DH.store.collection('customers').all().filter(function (c) { return c.name === 'Test Buyer'; })[0];
          resolve({
            phoneError: phoneError,
            customer: customer,
            count: DH.store.collection('customers').count(),
            rows: document.querySelectorAll('#customer-table-body tr').length,
            modal: document.getElementById('modal-root').classList.contains('is-open'),
            stored: JSON.parse(localStorage.getItem('devhawx.pos.customers')).length,
            names: Array.prototype.map.call(document.querySelectorAll('#customer-table-body .product-copy strong'), function (n) { return n.textContent; })
          });
        }, 420);
      }, 220);
    });
  `);
  check('Customer is created and persisted',
    /valid phone/.test(created.phoneError) && created.customer && created.count === 9 && created.stored === 9 &&
    created.rows === 9 && !created.modal && created.names.indexOf('Test Buyer') !== -1, created);
  const testId = created.customer.id;

  step('edit customer');
  const edited = await evaluate(`
    document.querySelector('[data-customer-edit="' + ${JSON.stringify(testId)} + '"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var panel = document.getElementById('customer-panel');
        var prefilled = {
          name: panel.querySelector('[name="name"]').value,
          phone: panel.querySelector('[name="phone"]').value,
          email: panel.querySelector('[name="email"]').value,
          tier: panel.querySelector('[name="tier"]').value
        };
        panel.querySelector('[name="name"]').value = 'Test Buyer Gold';
        panel.querySelector('[name="phone"]').value = '+1 (555) 019-1234';
        panel.querySelector('[name="tier"]').value = 'Gold';
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var customer = DH.store.collection('customers').find(${JSON.stringify(testId)});
          resolve({
            prefilled: prefilled,
            customer: customer,
            rows: document.querySelectorAll('#customer-table-body tr').length,
            names: Array.prototype.map.call(document.querySelectorAll('#customer-table-body .product-copy strong'), function (n) { return n.textContent; })
          });
        }, 420);
      }, 260);
    });
  `);
  check('Edit form is prefilled and updates the customer',
    edited.prefilled.name === 'Test Buyer' && edited.prefilled.phone === '+1 (555) 019-0000' &&
    edited.prefilled.email === 'test.buyer@example.com' &&
    edited.customer.name === 'Test Buyer Gold' && edited.customer.phone === '+1 (555) 019-1234' &&
    edited.customer.tier === 'Gold' && edited.names.indexOf('Test Buyer Gold') !== -1, edited);

  step('purchase history');
  const linked = await evaluate(`
    DH.store.collection('sales').add({
      receipt: 'INV-TEST1', transactionId: 'TXN-TEST1', customerId: ${JSON.stringify(testId)},
      customerName: 'Test Buyer Gold', items: [{ productId: 'prd_espresso', name: 'Aurora Espresso Blend', sku: 'BEV-1042', price: 18.5, quantity: 1, lineTotal: 18.5 }],
      itemCount: 1, subtotal: 18.5, tax: 1.57, taxRate: 8.5, total: 20.07, payment: 'Cash',
      status: 'paid', cashier: 'Admin', createdAt: new Date().toISOString()
    });
    return true;
  `);
  check('Test sale linked to the customer', linked === true, linked);

  await navigate('customers');
  const detail = await evaluate(`
    document.querySelector('[data-customer-view="' + ${JSON.stringify(testId)} + '"]').click();
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
          historyRows: document.querySelectorAll('.detail-table tbody tr').length,
          receipts: Array.prototype.map.call(document.querySelectorAll('.detail-table .receipt-link'), function (r) { return r.textContent; }),
          actions: Array.prototype.map.call(document.querySelectorAll('.detail-actions .btn'), function (b) { return b.textContent.trim(); })
        });
      }, 300);
    });
  `);
  check('Profile shows purchase history and totals',
    detail.title === 'Test Buyer Gold' && detail.historyRows === 1 && detail.receipts[0] === 'INV-TEST1' &&
    detail.stats.join('|').indexOf('Total purchases=1') !== -1 &&
    detail.stats.join('|').indexOf('Total spending=$20.07') !== -1, detail);
  check('Profile lists contact details and actions', detail.contact.length === 3 && detail.actions.length === 2, detail);

  const receiptOpen = await evaluate(`
    document.querySelector('.detail-table .receipt-link').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var receipt = document.getElementById('print-receipt');
        resolve({
          open: document.getElementById('modal-root').classList.contains('is-open'),
          exists: !!receipt,
          text: receipt ? receipt.textContent : ''
        });
      }, 400);
    });
  `);
  check('Linked sale opens its thermal receipt', receiptOpen.open && receiptOpen.exists && /INV-TEST1/.test(receiptOpen.text), receiptOpen);
  await evaluate(`document.querySelector('[data-modal-close]').click(); return true;`);

  step('delete customer');
  const deleted = await evaluate(`
    var row = Array.prototype.find.call(document.querySelectorAll('#customer-table-body tr'), function (tr) {
      return tr.textContent.indexOf('Test Buyer Gold') !== -1;
    });
    row.querySelector('[data-customer-delete]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var title = (document.getElementById('modal-title') || {}).textContent;
        document.querySelector('[data-modal-confirm]').click();
        setTimeout(function () {
          var sale = DH.store.collection('sales').all().filter(function (s) { return s.receipt === 'INV-TEST1'; })[0];
          resolve({
            title: title,
            gone: !DH.store.collection('customers').find(${JSON.stringify(testId)}),
            count: DH.store.collection('customers').count(),
            rows: document.querySelectorAll('#customer-table-body tr').length,
            saleKept: !!sale,
            saleCustomerId: sale ? sale.customerId : null,
            saleName: sale ? sale.customerName : null,
            stored: JSON.parse(localStorage.getItem('devhawx.pos.customers')).length
          });
        }, 420);
      }, 260);
    });
  `);
  check('Delete removes the customer but keeps the sale history',
    deleted.title === 'Delete customer?' && deleted.gone && deleted.count === 8 && deleted.stored === 8 &&
    deleted.rows === 8 && deleted.saleKept && deleted.saleCustomerId === null && deleted.saleName === 'Test Buyer Gold', deleted);

  step('persistence and responsive');
  await navigate('customers');
  const persisted = await evaluate(`
    return {
      rows: document.querySelectorAll('#customer-table-body tr').length,
      stored: JSON.parse(localStorage.getItem('devhawx.pos.customers')).length,
      names: Array.prototype.map.call(document.querySelectorAll('#customer-table-body .product-copy strong'), function (n) { return n.textContent; })
    };
  `);
  check('Customer directory persists across refreshes', persisted.rows === 8 && persisted.stored === 8 &&
    persisted.names.indexOf('Test Buyer Gold') === -1, persisted);

  for (const width of [360, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate('customers');
    await sleep(260);
    const info = await evaluate(`
      var search = document.getElementById('customer-search').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rows: document.querySelectorAll('#customer-table-body tr').length,
        searchRight: Math.round(search.right),
        viewport: document.documentElement.clientWidth
      };
    `);
    check(`Customer view fits at ${width}px`, info.overflow <= 1 && info.rows === 8 && info.searchRight <= info.viewport + 1, info);
    if (width === 360) await shot('step09-customers-360');
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('customers');

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
