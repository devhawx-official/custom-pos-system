import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9340;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-rec-cdp-'));

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
  const url = `${BASE}?r=${navCount}#/${route}`;
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

  await evaluate(`
    document.querySelector('[data-add-product="prd_espresso"]').click();
    document.querySelector('[data-add-product="prd_matcha"]').click();
    return true;
  `);
  await sleep(220);
  await evaluate(`
    document.querySelector('[data-discount="10"]').click();
    document.getElementById('charge-sale').click();
    return true;
  `);
  await sleep(260);
  await evaluate(`
    var amount = document.getElementById('cash-received');
    amount.value = '60';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('charge-customer').value = 'cus_amelia';
    document.querySelector('[data-modal-confirm]').click();
    return true;
  `);
  await sleep(900);

  step('receipt content');
  const receipt = await evaluate(`
    var node = document.getElementById('print-receipt');
    var text = node ? node.textContent : '';
    var rows = Array.prototype.map.call(node.querySelectorAll('.receipt-row'), function (r) {
      return r.querySelector('span').textContent + '=' + r.querySelectorAll('span')[1].textContent;
    });
    var items = Array.prototype.map.call(node.querySelectorAll('.receipt-item'), function (item) {
      return {
        name: item.querySelector('.receipt-item-name').textContent,
        line: item.querySelector('.receipt-item-line').textContent,
        sku: (item.querySelector('.receipt-item-sku') || {}).textContent
      };
    });
    var sale = DH.store.collection('sales').all().sort(function (a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })[0];
    return {
      exists: !!node,
      paper: node ? node.getAttribute('data-paper') : null,
      className: node ? node.className : '',
      width: node ? Math.round(node.getBoundingClientRect().width) : 0,
      text: text,
      rows: rows,
      items: items,
      barcode: node ? node.querySelectorAll('.receipt-barcode i').length : 0,
      thanks: node ? (node.querySelector('.receipt-thanks') || {}).textContent : null,
      controls: !!document.querySelector('.receipt-controls'),
      bar: !!document.querySelector('.receipt-bar'),
      printButton: !!document.querySelector('[data-print-receipt]'),
      paperButtons: Array.prototype.map.call(document.querySelectorAll('.paper-btn'), function (b) {
        return { value: b.getAttribute('data-paper'), active: b.classList.contains('is-active') };
      }),
      sale: sale,
      itemChecks: sale.items.map(function (item, index) {
        var rendered = items[index];
        if (!rendered) return false;
        return rendered.name === item.name &&
          rendered.line.indexOf(DH.format.number(item.quantity) + ' x ' + DH.format.currency(item.price)) !== -1 &&
          rendered.line.indexOf(DH.format.currency(item.lineTotal)) !== -1 &&
          rendered.sku === item.sku;
      }),
      expected: {
        subtotal: 'Subtotal=' + DH.format.currency(sale.subtotal),
        discount: 'Discount (' + DH.format.percent(sale.discountPercent) + ')=-?'.replace('=?', '') + DH.format.currency(sale.discount),
        tax: 'Tax (' + DH.format.percent(sale.taxRate) + ')=' + DH.format.currency(sale.tax),
        total: 'TOTAL=' + DH.format.currency(sale.total),
        payment: 'Payment=' + sale.payment,
        received: 'Amount received=' + DH.format.currency(sale.amountReceived),
        change: 'Change=' + DH.format.currency(sale.change),
        firstLine: sale.items[0].name + '1 x ' + DH.format.currency(sale.items[0].price) + DH.format.currency(sale.items[0].lineTotal),
        sku: sale.items[0].sku
      }
    };
  `);
  const rowText = receipt.rows.join('|');
  check('Receipt renders for the completed sale', receipt.exists && receipt.paper === '80' && receipt.className.indexOf('receipt--80') !== -1, receipt);
  check('Store identity and contact details are printed',
    /DevHawx Demo Store/.test(receipt.text) && /Harbour Street/.test(receipt.text) &&
    /010-2030/.test(receipt.text) && /hello@devhawx.dev/.test(receipt.text), receipt.text.slice(0, 200));
  check('Receipt, transaction, date, time, cashier and customer are printed',
    rowText.indexOf('Receipt=' + receipt.sale.receipt) !== -1 && rowText.indexOf('Transaction=' + receipt.sale.transactionId) !== -1 &&
    /Date=/.test(rowText) && /Time=/.test(rowText) &&
    rowText.indexOf('Cashier=Admin') !== -1 && rowText.indexOf('Customer=Amelia Hart') !== -1, receipt.rows);
  check('Line items show name, quantity, unit price and total',
    receipt.itemChecks.length === 2 && receipt.itemChecks.every(Boolean), receipt.itemChecks);
  check('Totals include subtotal, discount, tax and grand total',
    rowText.indexOf(receipt.expected.subtotal) !== -1 && rowText.indexOf(receipt.expected.tax) !== -1 &&
    rowText.indexOf(receipt.expected.total) !== -1 && /Discount \(10\.0%\)/.test(rowText), receipt.rows);
  check('Payment, amount received and change are printed',
    rowText.indexOf(receipt.expected.payment) !== -1 && rowText.indexOf(receipt.expected.received) !== -1 &&
    rowText.indexOf(receipt.expected.change) !== -1, receipt.rows);
  check('Thank you message, barcode and paper switch are present',
    /Thank you for shopping/i.test(receipt.thanks || '') && receipt.barcode > 20 &&
    receipt.controls && receipt.bar && receipt.printButton && receipt.paperButtons.length === 2, receipt);
  await shot('step08-receipt-80mm');

  step('paper widths');
  const widths = await evaluate(`
    document.querySelector('.paper-btn[data-paper="58"]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var node = document.getElementById('print-receipt');
        resolve({
          paper: node.getAttribute('data-paper'),
          className: node.className,
          width: Math.round(node.getBoundingClientRect().width),
          active: (document.querySelector('.paper-btn.is-active') || {}).getAttribute('data-paper'),
          overflow: node.scrollWidth - node.clientWidth
        });
      }, 200);
    });
  `);
  check('58 mm paper layout is available and fits its width',
    widths.paper === '58' && widths.className.indexOf('receipt--58') !== -1 &&
    widths.width >= 214 && widths.width <= 222 && widths.active === '58' && widths.overflow <= 1, widths);
  await shot('step08-receipt-58mm');

  step('print stylesheet');
  const printRules = await evaluate(`
    var rules = { pages: [], hasPageProperty: false };
    function walk(list) {
      Array.prototype.forEach.call(list, function (rule) {
        if (rule.type === 6) {
          rules.pages.push(rule.selectorText || rule.conditionText || 'page');
        }
        if (rule.type === 4 && /print/.test(rule.conditionText || '') && /page: *paper/.test(rule.cssText || '')) {
          rules.hasPageProperty = true;
        }
        if (rule.cssRules) {
          try { walk(rule.cssRules); } catch (error) { /* ignore */ }
        }
      });
    }
    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      try { walk(sheet.cssRules); } catch (error) { /* ignore */ }
    });
    return rules;
  `);
  check('Named page sizes exist for 58 mm and 80 mm paper',
    printRules.pages.some((p) => /paper58/.test(p)) && printRules.pages.some((p) => /paper80/.test(p)) &&
    printRules.hasPageProperty, printRules);

  await send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(200);
  const printView = await evaluate(`
    var shell = document.querySelector('.app-shell');
    var receipt = document.getElementById('print-receipt');
    var tools = document.querySelector('.receipt-controls');
    var bar = document.querySelector('.receipt-bar');
    var card = document.querySelector('.modal-card');
    return {
      shellHidden: getComputedStyle(shell).display === 'none',
      toolsHidden: getComputedStyle(tools).display === 'none',
      barHidden: getComputedStyle(bar).display === 'none',
      receiptVisible: getComputedStyle(receipt).display !== 'none',
      receiptWidth: Math.round(receipt.getBoundingClientRect().width),
      cardWidth: Math.round(card.getBoundingClientRect().width),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      shadow: getComputedStyle(receipt).boxShadow
    };
  `);
  check('Print view hides the application chrome', printView.shellHidden && printView.toolsHidden && printView.barHidden && printView.receiptVisible, printView);
  check('Printed receipt is a narrow strip without shadows',
    printView.receiptWidth >= 214 && printView.receiptWidth <= 310 && printView.overflow <= 1 &&
    (printView.shadow === 'none' || printView.shadow === ''), printView);
  await shot('step08-print-preview');
  await send('Emulation.setEmulatedMedia', { media: '' });

  step('thermal print output');
  const pdf58 = await send('Page.printToPDF', {
    printBackground: true,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    paperWidth: 2.283, paperHeight: 5.5,
    preferCSSPageSize: true
  });
  const pdfText = Buffer.from(pdf58.data, 'base64').toString('latin1');
  const match = pdfText.match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)/);
  const widthPt = match ? Number(match[1]) : null;
  writeFileSync(path.join(SHOTS, 'step08-receipt-58mm.pdf'), Buffer.from(pdf58.data, 'base64'));
  check('Printing produces a 58 mm wide page',
    widthPt !== null && Math.abs(widthPt - 164.41) < 3, { widthPt: widthPt, bytes: pdf58.data.length });

  await evaluate(`document.querySelector('.paper-btn[data-paper="80"]').click(); return true;`);
  await sleep(250);
  const pdf80 = await send('Page.printToPDF', {
    printBackground: true,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    paperWidth: 3.15, paperHeight: 5.5,
    preferCSSPageSize: true
  });
  const pdf80Text = Buffer.from(pdf80.data, 'base64').toString('latin1');
  const match80 = pdf80Text.match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)/);
  const widthPt80 = match80 ? Number(match80[1]) : null;
  writeFileSync(path.join(SHOTS, 'step08-receipt-80mm.pdf'), Buffer.from(pdf80.data, 'base64'));
  check('Printing produces an 80 mm wide page',
    widthPt80 !== null && Math.abs(widthPt80 - 226.77) < 3, { widthPt: widthPt80, bytes: pdf80.data.length });

  step('action bar and scrolling');
  const actions = await evaluate(`
    var bar = document.querySelector('.receipt-bar');
    var foot = document.querySelector('.modal-foot');
    var stage = document.getElementById('receipt-stage');
    var card = document.querySelector('.modal-card');
    var root = document.getElementById('modal-root');
    return {
      diag: {
        rootChildren: root ? root.children.length : -1,
        rootHtmlLength: root ? root.innerHTML.length : -1,
        hasBar: !!bar, hasStage: !!stage, hasFoot: !!foot, hasCard: !!card
      },
      buttons: bar ? Array.prototype.map.call(bar.querySelectorAll('.btn'), function (b) { return b.textContent.trim(); }) : [],
      barVisible: !!bar && getComputedStyle(bar).display !== 'none',
      footHidden: !foot || getComputedStyle(foot).display === 'none',
      barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
      modalHeight: card ? Math.round(card.getBoundingClientRect().height) : null,
      viewportH: document.documentElement.clientHeight,
      scrollable: !!stage && stage.scrollHeight > stage.clientHeight,
      overflowY: stage ? getComputedStyle(stage).overflowY : null,
      stageHeight: stage ? stage.clientHeight : null,
      contentHeight: stage ? stage.scrollHeight : null,
      hint: (document.querySelector('.receipt-hint') || {}).textContent
    };
  `);
  check('Print, Close and Done sit in the top action bar',
    actions.buttons.join(',') === 'Print,Close,Done' && actions.barVisible && actions.footHidden, actions);
  check('The dialog fits the viewport and scrolls only when needed',
    actions.overflowY === 'auto' && actions.modalHeight <= actions.viewportH, actions);

  const longReceipt = await evaluate(`
    var items = [];
    for (var i = 0; i < 30; i += 1) {
      items.push({ productId: 'prd_espresso', name: 'Aurora Espresso Blend ' + (i + 1), sku: 'BEV-1042', price: 18.5, quantity: 1, lineTotal: 18.5 });
    }
    DH.receipt.open({
      transactionId: 'TXN-09999', receipt: 'INV-9999', customerId: 'cus_amelia', customerName: 'Amelia Hart',
      items: items, itemCount: 30, subtotal: 555, discount: 55.5, discountPercent: 10, tax: 42.48, taxRate: 8.5,
      total: 541.98, payment: 'Cash', amountReceived: 600, change: 58.02, status: 'paid', cashier: 'Admin',
      createdAt: new Date().toISOString()
    }, { paper: '80' });
    var root = document.getElementById('modal-root');
    var immediate = {
      rootChildren: root ? root.children.length : -1,
      rootHtmlLength: root ? root.innerHTML.length : -1,
      hasStage: !!document.getElementById('receipt-stage'),
      open: root ? root.classList.contains('is-open') : false
    };
    return new Promise(function (resolve) {
      setTimeout(function () {
        var stage = document.getElementById('receipt-stage');
        var bar = document.querySelector('.receipt-bar');
        var card = document.querySelector('.modal-card');
        var before = bar ? bar.getBoundingClientRect().top : null;
        if (stage) stage.scrollTop = stage.scrollHeight;
        setTimeout(function () {
          resolve({
            immediate: immediate,
            later: {
              rootChildren: root ? root.children.length : -1,
              rootHtmlLength: root ? root.innerHTML.length : -1,
              hasStage: !!stage,
              hasBar: !!bar
            },
            scrollable: !!stage && stage.scrollHeight > stage.clientHeight,
            overflowY: stage ? getComputedStyle(stage).overflowY : 'missing',
            stageHeight: stage ? stage.clientHeight : null,
            contentHeight: stage ? stage.scrollHeight : null,
            scrolled: !!stage && stage.scrollTop > 0,
            barTopBefore: before === null ? null : Math.round(before),
            barTopAfter: bar ? Math.round(bar.getBoundingClientRect().top) : null,
            modalHeight: card ? Math.round(card.getBoundingClientRect().height) : null,
            viewportH: document.documentElement.clientHeight,
            receiptHeight: document.getElementById('print-receipt') ? Math.round(document.getElementById('print-receipt').getBoundingClientRect().height) : null,
            hint: (document.querySelector('.receipt-hint') || {}).textContent
          });
        }, 200);
      }, 420);
    });
  `);
  check('A long receipt scrolls inside the dialog',
    longReceipt.scrollable && longReceipt.overflowY === 'auto' && longReceipt.scrolled &&
    longReceipt.contentHeight > longReceipt.stageHeight, longReceipt);
  check('The action bar stays visible while the receipt scrolls',
    Math.abs(longReceipt.barTopAfter - longReceipt.barTopBefore) <= 8 &&
    longReceipt.barTopAfter >= 0 && longReceipt.barTopAfter < longReceipt.viewportH &&
    longReceipt.modalHeight <= longReceipt.viewportH, longReceipt);
  check('The scroll hint is shown for long receipts', /Scroll for the full receipt/.test(longReceipt.hint || ''), longReceipt.hint);
  await shot('step08-long-receipt');

  await send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(200);
  const printBar = await evaluate(`
    var bar = document.querySelector('.receipt-bar');
    var controls = document.querySelector('.receipt-controls');
    var root = document.getElementById('modal-root');
    return {
      diag: {
        rootChildren: root ? root.children.length : -1,
        rootHtmlLength: root ? root.innerHTML.length : -1,
        hasBar: !!bar, hasControls: !!controls,
        open: root ? root.classList.contains('is-open') : false
      },
      bar: bar ? getComputedStyle(bar).display : 'missing',
      controls: controls ? getComputedStyle(controls).display : 'missing',
      stage: document.getElementById('receipt-stage') ? getComputedStyle(document.getElementById('receipt-stage')).overflow : 'missing'
    };
  `);
  check('Top buttons and controls stay out of the printed receipt',
    printBar.bar === 'none' && printBar.controls === 'none' && printBar.stage.indexOf('visible') !== -1, printBar);
  await send('Emulation.setEmulatedMedia', { media: '' });

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
