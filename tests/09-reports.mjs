import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9343;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-rep-cdp-'));

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
const downloads = [];

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
  if (msg.method === 'Browser.downloadWillBegin') {
    downloads.push({ url: msg.params.url, filename: msg.params.suggestedFilename });
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
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: 'C:\\Users\\Admin\\AppData\\Local\\Temp\\opencode\\dh-shots' });

  step('seed');
  await navigate('dashboard');
  await evaluate('localStorage.clear(); return true;');
  await navigate('reports');
  await sleep(500);

  const report = await evaluate(`
    var sales = DH.store.collection('sales').all();
    var revenue = sales.reduce(function (sum, s) { return sum + (Number(s.total) || 0); }, 0);
    var items = sales.reduce(function (sum, s) { return sum + (Number(s.itemCount) || 0); }, 0);
    var kpis = Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
      return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
    });
    return {
      sales: sales.length,
      kpis: kpis,
      expectedRevenue: DH.format.currency(revenue),
      expectedAverage: DH.format.currency(Math.round((revenue / sales.length) * 100) / 100),
      expectedItems: DH.format.number(items),
      cards: Array.prototype.map.call(document.querySelectorAll('.report-card h3, .report-chart-card h3'), function (h) { return h.textContent; }),
      chartBars: document.querySelectorAll('.report-bar').length,
      chartLabels: document.querySelectorAll('.report-chart-labels span').length,
      sparkCards: document.querySelectorAll('.mini-bars').length,
      listRows: document.querySelectorAll('.report-row').length,
      exportDisabled: document.getElementById('export-report').disabled,
      stored: JSON.parse(localStorage.getItem('devhawx.pos.sales')).length
    };
  `);
  check('Report totals come from the stored sales',
    report.sales === 162 && report.kpis.indexOf('Total revenue=' + report.expectedRevenue) !== -1 &&
    report.kpis.indexOf('Total transactions=162') !== -1 &&
    report.kpis.indexOf('Average order value=' + report.expectedAverage) !== -1 &&
    report.kpis.indexOf('Items sold=' + report.expectedItems) !== -1, report);
  check('Every report surface is present',
    ['Sales chart', 'Daily sales', 'Weekly sales', 'Monthly sales', 'Best-selling products', 'Payment method breakdown', 'Sales by category']
      .every(function (title) { return report.cards.indexOf(title) !== -1; }), report.cards);
  check('Charts and lists are drawn from the data',
    report.chartBars > 0 && report.chartLabels > 0 && report.sparkCards === 3 && report.listRows > 0 && !report.exportDisabled, report);
  await shot('step11-reports-1440');

  step('date range filters');
  const ranges = await evaluate(`
    var select = document.getElementById('report-range');
    function pick(value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        kpis: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
          return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
        }),
        from: document.getElementById('report-from').value,
        to: document.getElementById('report-to').value,
        count: document.getElementById('report-range').value
      };
    }
    var today = pick('today');
    var week = pick('week');
    var month = pick('month');
    var all = pick('all');
    return { today: today, week: week, month: month, all: all };
  `);
  const expected = await evaluate(`
    var sales = DH.store.collection('sales').all();
    function inRange(days) {
      var now = new Date();
      var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setDate(start.getDate() - (days - 1));
      return sales.filter(function (s) { return new Date(s.createdAt) >= start; });
    }
    var today = sales.filter(function (s) { return new Date(s.createdAt).toDateString() === new Date().toDateString(); });
    function revenue(list) { return DH.format.currency(list.reduce(function (sum, s) { return sum + (Number(s.total) || 0); }, 0)); }
    return {
      today: { count: today.length, revenue: revenue(today) },
      week: { count: inRange(7).length, revenue: revenue(inRange(7)) },
      month: { count: inRange(30).length, revenue: revenue(inRange(30)) }
    };
  `);
  check('Date presets narrow the report to real ranges',
    ranges.today.kpis.indexOf('Total transactions=' + expected.today.count) !== -1 &&
    ranges.today.kpis.indexOf('Total revenue=' + expected.today.revenue) !== -1 &&
    ranges.week.kpis.indexOf('Total transactions=' + expected.week.count) !== -1 &&
    ranges.month.kpis.indexOf('Total transactions=' + expected.month.count) !== -1 &&
    ranges.all.kpis.indexOf('Total transactions=162') !== -1, { ranges: ranges, expected: expected });
  check('Preset selection fills the date inputs',
    ranges.today.from.length === 10 && ranges.today.to.length === 10 && ranges.today.from === ranges.today.to, ranges.today);

  const custom = await evaluate(`
    var from = document.getElementById('report-from');
    var to = document.getElementById('report-to');
    from.value = '2026-10-20';
    from.dispatchEvent(new Event('change', { bubbles: true }));
    to.value = '2026-10-26';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        var sales = DH.store.collection('sales').all().filter(function (s) {
          var d = new Date(s.createdAt);
          return d >= new Date('2026-10-20T00:00:00') && d <= new Date('2026-10-26T23:59:59');
        });
        resolve({
          range: document.getElementById('report-range').value,
          kpis: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
            return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
          }),
          expectedCount: sales.length,
          expectedRevenue: DH.format.currency(sales.reduce(function (sum, s) { return sum + (Number(s.total) || 0); }, 0)),
          chartBars: document.querySelectorAll('.report-bar').length
        });
      }, 200);
    });
  `);
  check('Custom date range filters the report',
    custom.range === 'custom' && custom.expectedCount > 0 &&
    custom.kpis.indexOf('Total transactions=' + custom.expectedCount) !== -1 &&
    custom.kpis.indexOf('Total revenue=' + custom.expectedRevenue) !== -1, custom);

  await evaluate(`
    var select = document.getElementById('report-range');
    select.value = 'all';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `);
  await sleep(200);

  step('chart granularity');
  const granularity = await evaluate(`
    var buttons = document.querySelectorAll('[data-granularity]');
    buttons[1].click();
    var weekBars = document.querySelectorAll('.report-bar').length;
    buttons[2].click();
    var monthBars = document.querySelectorAll('.report-bar').length;
    buttons[0].click();
    return { weekBars: weekBars, monthBars: monthBars, dayBars: document.querySelectorAll('.report-bar').length };
  `);
  check('Chart switches between days, weeks and months',
    granularity.weekBars > 0 && granularity.monthBars > 0 && granularity.dayBars > 0 &&
    granularity.weekBars !== granularity.dayBars, granularity);

  step('breakdown lists');
  const breakdown = await evaluate(`
    var payments = Array.prototype.map.call(document.querySelectorAll('.report-card'), function (card) {
      return card.querySelector('h3').textContent;
    });
    function rowsOf(title) {
      var card = Array.prototype.find.call(document.querySelectorAll('.report-card'), function (c) { return c.querySelector('h3').textContent === title; });
      if (!card) return [];
      return Array.prototype.map.call(card.querySelectorAll('.report-row'), function (row) {
        return {
          label: row.querySelector('.report-row-copy strong').textContent,
          meta: row.querySelector('.report-row-copy span').textContent,
          value: row.querySelector('.report-value').textContent,
          width: row.querySelector('.report-fill').style.width
        };
      });
    }
    return {
      payments: payments,
      best: rowsOf('Best-selling products'),
      mix: rowsOf('Payment method breakdown'),
      categories: rowsOf('Sales by category')
    };
  `);
  check('Best sellers are ranked from the sold items',
    breakdown.best.length === 6 && /unit/.test(breakdown.best[0].meta) && /\$/.test(breakdown.best[0].value), breakdown.best);
  check('Payment breakdown lists every method with a share',
    breakdown.mix.length >= 3 && breakdown.mix.every((row) => /%/.test(row.meta) && /\$/.test(row.value)), breakdown.mix);
  check('Category performance is computed', breakdown.categories.length > 0 && /\$/.test(breakdown.categories[0].value), breakdown.categories);

  step('csv export');
  const exported = await evaluate(`
    var captured = null;
    var originalCreate = URL.createObjectURL;
    var originalBlob = window.Blob;
    var originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function (blob) {
      captured = blob;
      return 'blob:stub';
    };
    window.Blob = function (parts, options) { return { parts: parts, options: options }; };
    HTMLAnchorElement.prototype.click = function () {};
    document.getElementById('export-report').click();
    URL.createObjectURL = originalCreate;
    window.Blob = originalBlob;
    HTMLAnchorElement.prototype.click = originalClick;
    var text = captured ? captured.parts.join('') : '';
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var lines = text.split(String.fromCharCode(13, 10));
    return {
      type: captured ? captured.options.type : null,
      lines: lines.length,
      header: lines[0],
      first: lines[1],
      last: lines[lines.length - 1]
    };
  `);
  const csvChecks = {
    c1: !!exported.type,
    c2: String(exported.type || '').indexOf('text/csv') !== -1,
    c3: String(exported.header || '').indexOf('Receipt,Transaction,Date,Time,Customer,Payment,Items,Subtotal,Discount,Tax,Total') === 0,
    c4: exported.lines === 163,
    c5: /INV-/.test(String(exported.first || ''))
  };
  check('CSV export builds a header and one row per transaction',
    csvChecks.c1 && csvChecks.c2 && csvChecks.c3 && csvChecks.c4 && csvChecks.c5,
    { checks: csvChecks, header: exported.header, lines: exported.lines, first: exported.first });

  step('no hardcoded figures');
  const live = await evaluate(`
    var sales = DH.store.collection('sales').all();
    sales.forEach(function (sale, index) {
      if (index > 40) return;
    });
    DH.store.collection('sales').update(sales[0].id, { total: 999.99 });
    var report = document.getElementById('view-root');
    return new Promise(function (resolve) {
      setTimeout(function () {
        var kpis = Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
          return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
        });
        resolve({ kpis: kpis });
      }, 200);
    });
  `);
  await navigate('reports');
  await sleep(400);
  const recomputed = await evaluate(`
    var sales = DH.store.collection('sales').all();
    var revenue = sales.reduce(function (sum, s) { return sum + (Number(s.total) || 0); }, 0);
    return {
      kpis: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
        return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
      }),
      expected: DH.format.currency(revenue)
    };
  `);
  check('Figures follow the data after an edit',
    recomputed.kpis.indexOf('Total revenue=' + recomputed.expected) !== -1, recomputed);

  step('empty range');
  const empty = await evaluate(`
    var from = document.getElementById('report-from');
    var to = document.getElementById('report-to');
    from.value = '2020-01-01';
    from.dispatchEvent(new Event('change', { bubbles: true }));
    to.value = '2020-01-05';
    to.dispatchEvent(new Event('change', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          kpis: Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
            return card.querySelector('.stat-label').textContent + '=' + card.querySelector('.stat-value').textContent;
          }),
          emptyStates: document.querySelectorAll('.report-empty').length,
          exportDisabled: document.getElementById('export-report').disabled
        });
      }, 220);
    });
  `);
  check('An empty range reports zero and disables the export',
    empty.kpis.indexOf('Total revenue=$0.00') !== -1 && empty.kpis.indexOf('Total transactions=0') !== -1 &&
    empty.emptyStates >= 3 && empty.exportDisabled, empty);

  step('responsive');
  for (const width of [360, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate('reports');
    await sleep(280);
    const info = await evaluate(`
      var select = document.getElementById('report-range').getBoundingClientRect();
      var from = document.getElementById('report-from').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        selectRight: Math.round(select.right),
        fromRight: Math.round(from.right),
        viewport: document.documentElement.clientWidth,
        bars: document.querySelectorAll('.report-bar').length,
        cards: document.querySelectorAll('.report-card').length
      };
    `);
    check(`Reports fit at ${width}px`, info.overflow <= 1 && info.selectRight <= info.viewport + 1 &&
      info.fromRight <= info.viewport + 1 && info.bars > 0 && info.cards === 6, info);
    if (width === 360) await shot('step11-reports-360');
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('reports');

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
