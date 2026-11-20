import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-cdp-'));

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
  }, 8000);
  if (result.exceptionDetails) {
    throw new Error('Eval failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text) + '\n' + expression.slice(0, 200));
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
  await sleep(220);
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
  await sleep(500);

  const seed = await evaluate(`
    var s = window.DH.store;
    var midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    var todays = s.collection('sales').all().filter(function (sale) {
      return new Date(sale.createdAt) >= midnight;
    }).sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    return {
      products: s.collection('products').count(),
      categories: s.collection('categories').count(),
      customers: s.collection('customers').count(),
      sales: s.collection('sales').count(),
      activity: s.collection('activity').count(),
      inventory: s.collection('inventory').count(),
      meta: s.get('meta', null),
      prefs: s.get('preferences', null),
      store: s.getStore(),
      settings: s.getSettings(),
      rawStore: JSON.parse(localStorage.getItem('devhawx.pos.store')),
      rawSettings: JSON.parse(localStorage.getItem('devhawx.pos.settings')),
      productCategoryIds: s.collection('products').all().every(function (p) { return !!p.categoryId; }),
      todayCount: todays.length,
      todayFirst: todays.length ? todays[0].createdAt : null,
      todayLast: todays.length ? todays[todays.length - 1].createdAt : null,
      now: new Date().toISOString()
    };
  `);
  check('Seed created demo data', seed.products === 14 && seed.categories === 5 && seed.customers === 8 && seed.sales > 80 && seed.meta?.seeded === true, seed);
  check('Seed created store, settings and category links',
    seed.store.name === 'DevHawx Demo Store' && seed.rawStore.name === 'DevHawx Demo Store' &&
    seed.rawSettings.currency === 'USD' && seed.rawSettings.storeName === undefined &&
    seed.productCategoryIds && seed.settings.storeName === seed.store.name,
    { store: seed.store, rawSettings: seed.rawSettings, categoryLinks: seed.productCategoryIds });
  console.log('  meta: ' + JSON.stringify(seed.meta));
  const todayTimes = seed.todayFirst && seed.todayLast ? { first: seed.todayFirst, last: seed.todayLast, now: seed.now, count: seed.todayCount } : null;
  const todayValid = todayTimes && new Date(todayTimes.first) < new Date(todayTimes.last) && new Date(todayTimes.last) <= new Date(todayTimes.now) && seed.todayCount >= 4;
  check('Today sales fall inside opening hours', todayValid, todayTimes);

  step('data layer');
  const api = await evaluate(`
    var s = window.DH.storage;
    var before = s.collection('products').count();
    var init = s.initializeDemoData();
    var after = s.collection('products').count();

    var id1 = s.generateId('qa');
    var id2 = s.generateId('qa');

    var saved = s.saveData('qa_scratch', [{ id: 'qa_1', value: 1 }]);
    s.updateData('qa_scratch', { id: 'qa_2', value: 2 });
    s.updateData('qa_scratch', { id: 'qa_1', value: 10 });
    var afterUpdate = s.getData('qa_scratch', []);
    var removed = s.deleteData('qa_scratch', 'qa_1');
    var afterDelete = s.getData('qa_scratch', []);

    s.saveData('qa_object', { a: 1 });
    s.updateData('qa_object', { b: 2 });
    var mergedObject = s.getData('qa_object', null);
    var missingFallback = s.getData('qa_missing', { fallback: true });

    s.deleteData('qa_scratch');
    s.deleteData('qa_object');
    var scratchGone = localStorage.getItem('devhawx.pos.qa_scratch') === null &&
      localStorage.getItem('devhawx.pos.qa_object') === null;

    return {
      before: before, after: after, init: init,
      id1: id1, id2: id2, same: id1 === id2, prefixed: /^qa_/.test(id1),
      saved: saved,
      updateCount: afterUpdate.length,
      updatedValue: afterUpdate.filter(function (r) { return r.id === 'qa_1'; })[0]?.value,
      insertedValue: afterUpdate.filter(function (r) { return r.id === 'qa_2'; })[0]?.value,
      removed: removed,
      deleteCount: afterDelete.length,
      mergedObject: mergedObject,
      missingFallback: missingFallback,
      scratchGone: scratchGone
    };
  `);
  check('generateId returns unique prefixed ids', api.prefixed && !api.same && api.id1.length > 10, { id1: api.id1, id2: api.id2 });
  check('saveData / updateData merge and insert records', api.saved === true && api.updateCount === 2 && api.updatedValue === 10 && api.insertedValue === 2, api);
  check('deleteData removes a record', api.removed === true && api.deleteCount === 1 && api.scratchGone, api);
  check('updateData merges singleton objects', api.mergedObject && api.mergedObject.a === 1 && api.mergedObject.b === 2 && !!api.mergedObject.updatedAt, api.mergedObject);
  check('getData returns fallback for missing keys', api.missingFallback && api.missingFallback.fallback === true, api.missingFallback);
  check('initializeDemoData never overwrites existing data', api.init.seeded === false && api.init.reason === 'existing-data' && api.before === 14 && api.after === 14, api.init);

  const corruptApi = await evaluate(`
    var s = window.DH.storage;
    localStorage.setItem('devhawx.pos.qa_corrupt', '{this is not json');
    var fallback = s.getData('qa_corrupt', { safe: true });
    var backup = localStorage.getItem('devhawx.pos.corrupt.qa_corrupt');
    var removed = localStorage.getItem('devhawx.pos.qa_corrupt') === null;
    var listed = s.getCorruptKeys().indexOf('qa_corrupt') !== -1;
    s.clearCorruptBackups();
    return {
      fallback: fallback,
      backup: backup,
      removed: removed,
      listed: listed,
      cleared: s.getCorruptKeys().length === 0 && localStorage.getItem('devhawx.pos.corrupt.qa_corrupt') === null
    };
  `);
  check('Corrupted JSON falls back and keeps a backup', corruptApi.fallback.safe === true && corruptApi.backup === '{this is not json' && corruptApi.removed, corruptApi);
  check('Corruption diagnostics and backup cleanup work', corruptApi.listed === true && corruptApi.cleared === true, corruptApi);

  step('dashboard');
  const dash = await evaluate(`
    var cards = Array.prototype.map.call(document.querySelectorAll('.stat-card'), function (card) {
      return {
        label: card.querySelector('.stat-label').textContent,
        value: card.querySelector('.stat-value').textContent,
        hint: card.querySelector('.stat-hint').textContent,
        trend: card.querySelector('.stat-trend') ? card.querySelector('.stat-trend').textContent : null,
        link: card.getAttribute('href')
      };
    });
    var line = document.querySelector('.chart-line');
    return {
      cards: cards,
      chartPath: line ? line.getAttribute('d').length : 0,
      chartLabels: document.querySelectorAll('.chart-x span').length,
      lowStock: document.querySelectorAll('.low-stock-item').length,
      lowStockItems: Array.prototype.map.call(document.querySelectorAll('.low-stock-item strong'), function (n) { return n.textContent; }),
      recentRows: document.querySelectorAll('.recent-table tbody tr').length,
      firstReceipt: (document.querySelector('.recent-table .receipt-code') || {}).textContent,
      title: document.title,
      h1: document.querySelector('.page-head h1').textContent
    };
  `);
  check('Dashboard shows four KPI cards', dash.cards.length === 4, dash.cards.map((c) => c.label));
  check('KPI values are populated', dash.cards.every((c) => c.value && c.value !== '0' && c.value !== '$0.00'), dash.cards.map((c) => c.value));
  check('KPI cards link onward', dash.cards.every((c) => !!c.link), dash.cards.map((c) => c.link));
  check('Dashboard chart has a drawn line', dash.chartPath > 100 && dash.chartLabels === 7, { path: dash.chartPath, labels: dash.chartLabels });
  check('Low-stock alerts listed', dash.lowStock > 0 && dash.lowStock <= 4, dash.lowStockItems);
  check('Recent transactions populated', dash.recentRows === 6, { rows: dash.recentRows, first: dash.firstReceipt });
  check('Dashboard page title/heading', dash.h1.toLowerCase().includes('dashboard'), { h1: dash.h1 });
  await shot('verify-dashboard-1440');

  step('chart');
  const chartToggle = await evaluate(`
    var buttons = document.querySelectorAll('[data-chart-range]');
    buttons[1].click();
    return {
      pressed: Array.prototype.map.call(document.querySelectorAll('[data-chart-range]'), function (b) { return b.getAttribute('aria-pressed'); }),
      labels: Array.prototype.map.call(document.querySelectorAll('.chart-x span'), function (s) { return s.textContent; }),
      summary: document.querySelector('.chart-summary strong').textContent,
      path: document.querySelector('.chart-line').getAttribute('d').length
    };
  `);
  check('Chart 30-day toggle re-renders', chartToggle.pressed.join(',') === 'false,true' && chartToggle.labels.length >= 6 && chartToggle.path > 500, chartToggle);

  const hover = await evaluate(`
    var body = document.querySelector('.chart-body');
    var rect = body.getBoundingClientRect();
    body.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + rect.width * 0.6, clientY: rect.top + rect.height * 0.5, bubbles: true }));
    var tip = document.querySelector('.chart-tooltip');
    return { hidden: tip.hidden, text: tip.textContent, dotHidden: document.querySelector('.chart-hover-dot').hidden };
  `);
  check('Chart hover tooltip works', !hover.hidden && /\$/.test(hover.text) && !hover.dotHidden, hover);
  await evaluate('document.querySelectorAll("[data-chart-range]")[0].click(); return true;');

  step('search');
  const quickSearch = await evaluate(`
    var input = document.getElementById('global-search');
    input.focus();
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    return {
      hidden: document.getElementById('search-results').hidden,
      kinds: Array.prototype.map.call(document.querySelectorAll('.search-result-kind'), function (n) { return n.textContent; }),
      metas: Array.prototype.map.call(document.querySelectorAll('.search-result-copy span'), function (n) { return n.textContent; })
    };
  `);
  check('Search opens quick links', !quickSearch.hidden && quickSearch.kinds.join(',') === 'Page,Page,Page,Page' && quickSearch.metas.every(Boolean), quickSearch);

  const found = await evaluate(`
    var input = document.getElementById('global-search');
    input.value = 'espresso';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          count: document.querySelectorAll('.search-result').length,
          first: (document.querySelector('.search-result-copy strong') || {}).textContent,
          head: (document.querySelector('.search-count') || {}).textContent
        });
      }, 300);
    });
  `);
  check('Search finds products', found.count >= 1 && /Espresso/i.test(found.first || ''), found);

  const empty = await evaluate(`
    var input = document.getElementById('global-search');
    input.value = 'zzzz-nothing';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(!!document.querySelector('.search-empty')); }, 300);
    });
  `);
  check('Search shows empty state', empty === true, empty);

  const escSearch = await evaluate(`
    var input = document.getElementById('global-search');
    input.value = 'sourdough';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { hidden: document.getElementById('search-results').hidden };
  `);
  check('Escape closes search results', escSearch.hidden === true, escSearch);

  step('notifications');
  const notif = await evaluate(`
    var btn = document.getElementById('notifications-btn');
    var dotBefore = btn.classList.contains('has-dot');
    btn.click();
    var panel = document.getElementById('notifications-panel');
    return {
      dotBefore: dotBefore,
      open: !panel.hidden,
      items: panel.querySelectorAll('.popover-item').length,
      unread: panel.querySelectorAll('.popover-item.is-unread').length,
      expanded: btn.getAttribute('aria-expanded'),
      times: Array.prototype.map.call(panel.querySelectorAll('.popover-time'), function (n) { return n.textContent; })
    };
  `);
  check('Notifications popover opens', notif.open && notif.items >= 4 && notif.expanded === 'true' && notif.dotBefore === true, notif);
  await shot('verify-notifications-1440');

  const markRead = await evaluate(`
    document.getElementById('mark-notifications-read').click();
    var btn = document.getElementById('notifications-btn');
    return {
      dot: btn.classList.contains('has-dot'),
      unread: document.querySelectorAll('#notifications-panel .popover-item.is-unread').length,
      seen: JSON.parse(localStorage.getItem('devhawx.pos.preferences')).notificationsSeenAt
    };
  `);
  check('Mark all read clears unread state', markRead.dot === false && markRead.unread === 0 && !!markRead.seen, markRead);

  step('profile');
  const profile = await evaluate(`
    document.getElementById('topbar-user').click();
    var panel = document.getElementById('profile-panel');
    return {
      open: !panel.hidden,
      items: Array.prototype.map.call(panel.querySelectorAll('.menu-item'), function (n) { return n.textContent.trim(); }),
      linked: Array.prototype.map.call(panel.querySelectorAll('a.menu-item'), function (a) { return a.getAttribute('href'); }),
      notifClosed: document.getElementById('notifications-panel').hidden
    };
  `);
  check('Profile popover opens with links', profile.open && profile.items.length >= 4 && profile.linked.length === 3 && profile.notifClosed, profile);
  await shot('verify-profile-1440');

  step('sidebar');
  const collapse = await evaluate(`
    document.getElementById('profile-panel').hidden = true;
    var menu = document.getElementById('menu-btn');
    menu.click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var shell = document.querySelector('.app-shell');
        var prefs = JSON.parse(localStorage.getItem('devhawx.pos.preferences'));
        resolve({
          collapsed: shell.classList.contains('is-collapsed'),
          pref: prefs.sidebarCollapsed,
          label: menu.getAttribute('aria-label'),
          width: Math.round(document.getElementById('sidebar').getBoundingClientRect().width),
          mainLeft: Math.round(document.querySelector('.app-main').getBoundingClientRect().left),
          labelsHidden: getComputedStyle(document.querySelector('.nav-link-label')).display === 'none'
        });
      }, 420);
    });
  `);
  check('Desktop sidebar collapses', collapse.collapsed === true && collapse.pref === true && /Expand/.test(collapse.label) && collapse.width === 88 && collapse.mainLeft === 88 && collapse.labelsHidden, collapse);
  await shot('verify-collapsed-1440');

  await navigate('dashboard');
  const persisted = await evaluate(`
    var shell = document.querySelector('.app-shell');
    return {
      collapsed: shell.classList.contains('is-collapsed'),
      width: Math.round(document.getElementById('sidebar').getBoundingClientRect().width),
      mainLeft: Math.round(document.querySelector('.app-main').getBoundingClientRect().left)
    };
  `);
  check('Collapsed state persists after reload', persisted.collapsed === true && persisted.width === 88 && persisted.mainLeft === 88, persisted);

  const expand = await evaluate(`
    document.getElementById('menu-btn').click();
    return {
      collapsed: document.querySelector('.app-shell').classList.contains('is-collapsed'),
      pref: JSON.parse(localStorage.getItem('devhawx.pos.preferences')).sidebarCollapsed
    };
  `);
  check('Sidebar expands again', expand.collapsed === false && expand.pref === false, expand);

  step('routes');
  const ROUTES = ['dashboard', 'pos', 'products', 'inventory', 'customers', 'sales', 'reports', 'settings'];
  const routeInfo = [];
  for (const route of ROUTES) {
    await navigate(route);
    const info = await evaluate(`
      return {
        hash: location.hash,
        h1: (document.querySelector('.page-head h1') || {}).textContent,
        title: document.title,
        navActive: (document.querySelector('.nav-link.is-active') || {}).getAttribute ? document.querySelector('.nav-link.is-active').getAttribute('data-route') : null,
        viewChildren: document.querySelector('.view').children.length,
        crash: !!document.querySelector('.error-card'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    `);
    routeInfo.push({ route, ...info });
    check(`Route ${route} renders`, info.hash === '#/' + route && info.navActive === route && info.viewChildren > 0 && info.h1 && !info.crash, info);
  }

  step('settings');
  await navigate('settings');
  const settingsCheck = await evaluate(`
    var form = document.getElementById('store-settings-form');
    form.querySelector('[name="storeName"]').value = 'Hawx Corner Store';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        var stored = JSON.parse(localStorage.getItem('devhawx.pos.store'));
        var settings = JSON.parse(localStorage.getItem('devhawx.pos.settings'));
        resolve({
          stored: stored.name,
          legacyField: settings.storeName,
          flat: window.DH.store.getSettings().storeName,
          chip: (document.querySelector('.settings-grid .card-head .chip') || {}).textContent,
          storageRows: document.querySelectorAll('.storage-row').length,
          keys: Array.prototype.map.call(document.querySelectorAll('.storage-row strong'), function (r) { return r.textContent; }),
          summaries: Array.prototype.map.call(document.querySelectorAll('.storage-row .storage-meta'), function (r) { return r.textContent; })
        });
      }, 350);
    });
  `);
  check('Settings save persists and re-renders',
    settingsCheck.stored === 'Hawx Corner Store' && settingsCheck.legacyField === undefined &&
    settingsCheck.flat === 'Hawx Corner Store' && /Hawx Corner Store/.test(settingsCheck.chip || '') &&
    settingsCheck.storageRows === 12,
    settingsCheck);
  check('Storage inspector labels store and categories', ['Store information', 'Categories', 'Store settings', 'Cart discount'].every(function (label) {
    return settingsCheck.keys.indexOf(label) !== -1;
  }), settingsCheck.keys);

  await navigate('dashboard');
  const persistedStore = await evaluate(`
    return {
      store: window.DH.store.getStore().name,
      setting: window.DH.store.getSettings().storeName,
      raw: JSON.parse(localStorage.getItem('devhawx.pos.store')).name
    };
  `);
  check('Edits survive a page refresh', persistedStore.store === 'Hawx Corner Store' && persistedStore.setting === 'Hawx Corner Store' && persistedStore.raw === 'Hawx Corner Store', persistedStore);

  step('mobile 390');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await navigate('dashboard');
  await sleep(400);

  const mobile = await evaluate(`
    var overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    var toggle = document.getElementById('search-toggle');
    var menu = document.getElementById('menu-btn');
    var searchVisible = getComputedStyle(toggle).display !== 'none';
    menu.click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var sidebarBox = document.getElementById('sidebar').getBoundingClientRect();
        resolve({
          overflow: overflow,
          searchVisible: searchVisible,
          drawerOpen: document.body.classList.contains('nav-open'),
          scrim: getComputedStyle(document.getElementById('sidebar-scrim')).display,
          sidebarLeft: Math.round(sidebarBox.left),
          sidebarWidth: Math.round(sidebarBox.width),
          statCols: getComputedStyle(document.querySelector('.stat-grid')).gridTemplateColumns
        });
      }, 420);
    });
  `);
  check('Mobile layout has no horizontal overflow', mobile.overflow <= 1, mobile);
  check('Mobile drawer opens over the content', mobile.drawerOpen && mobile.sidebarLeft === 0 && mobile.sidebarWidth > 200 && mobile.scrim !== 'none', mobile);
  await shot('verify-mobile-drawer-390');

  const mobileSearch = await evaluate(`
    document.getElementById('sidebar-close').click();
    document.getElementById('search-toggle').click();
    var wrap = document.getElementById('search-wrap');
    var input = document.getElementById('global-search');
    input.value = 'amelia';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        var box = document.getElementById('search-results').getBoundingClientRect();
        resolve({
          open: wrap.classList.contains('is-open'),
          results: document.querySelectorAll('.search-result').length,
          first: (document.querySelector('.search-result-copy strong') || {}).textContent,
          boxLeft: Math.round(box.left),
          boxRight: Math.round(box.right),
          viewport: document.documentElement.clientWidth,
          position: getComputedStyle(wrap).position
        });
      }, 320);
    });
  `);
  check('Mobile search overlay works', mobileSearch.open && mobileSearch.results >= 1 && mobileSearch.position === 'fixed' && mobileSearch.boxRight <= mobileSearch.viewport + 1, mobileSearch);

  const tapThrough = await evaluate(`
    document.querySelector('#search-results .search-result').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          hash: location.hash,
          wrapOpen: document.getElementById('search-wrap').classList.contains('is-open'),
          resultsHidden: document.getElementById('search-results').hidden
        });
      }, 320);
    });
  `);
  check('Mobile search result navigates and closes', tapThrough.hash === '#/customers' && !tapThrough.wrapOpen && tapThrough.resultsHidden, tapThrough);

  step('tablet / desktop widths');
  for (const width of [360, 768, 1024, 1280, 1440, 1600]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate('dashboard');
    await sleep(260);
    const info = await evaluate(`
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cards: document.querySelectorAll('.stat-card').length,
        chart: !!document.querySelector('.chart-line'),
        cardsPerRow: getComputedStyle(document.querySelector('.stat-grid')).gridTemplateColumns.split(' ').length,
        rail: getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w').trim()
      };
    `);
    check(`No overflow at ${width}px`, info.overflow <= 1 && info.cards === 4 && info.chart, info);
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('dashboard');

  step('layout audit');
  const layout = await evaluate(`
    function box(el) {
      var r = el.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    }
    var cards = Array.prototype.map.call(document.querySelectorAll('.stat-card'), box);
    var heights = cards.map(function (c) { return c.h; });
    var topbar = document.querySelector('.topbar-actions');
    var kids = Array.prototype.filter.call(topbar.children, function (el) {
      return getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    }).map(box).sort(function (a, b) { return a.l - b.l; });
    var overlap = kids.some(function (k, i) { return i > 0 && k.l < kids[i - 1].r - 1; });
    var chart = box(document.querySelector('.chart-card'));
    var low = box(document.querySelector('.low-stock-card'));
    var wrap = box(document.querySelector('.table-wrap'));
    var table = box(document.querySelector('.recent-table'));
    return {
      cardTops: cards.map(function (c) { return c.t; }),
      cardHeights: heights,
      sameTop: new Set(cards.map(function (c) { return c.t; })).size === 1,
      equalHeights: Math.max.apply(null, heights) - Math.min.apply(null, heights) <= 1,
      chartHeight: chart.h,
      lowStockHeight: low.h,
      gridAligned: Math.abs(chart.t - low.t) <= 1,
      tableOverflow: table.w - wrap.w,
      topbarOverlap: overlap,
      topbarEdge: kids[kids.length - 1].r,
      viewport: document.documentElement.clientWidth
    };
  `);
  check('KPI cards align and match height', layout.sameTop && layout.equalHeights, layout);
  check('Dashboard grid columns align', layout.gridAligned && Math.abs(layout.chartHeight - layout.lowStockHeight) <= 1, layout);
  check('Recent table fits its container', layout.tableOverflow <= 1, { overflow: layout.tableOverflow });
  check('Topbar actions do not collide', !layout.topbarOverlap && layout.topbarEdge <= layout.viewport, layout);

  const tooltipBounds = await evaluate(`
    function box(el) { var r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }; }
    var body = document.querySelector('.chart-body');
    var rect = body.getBoundingClientRect();
    body.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.right - 2, clientY: rect.top + rect.height * 0.5, bubbles: true }));
    var tip = box(document.querySelector('.chart-tooltip'));
    var card = box(document.querySelector('.chart-card'));
    return { tip: tip, card: card, inside: tip.l >= card.l && tip.r <= card.r && tip.t >= card.t && tip.b <= card.b };
  `);
  check('Chart tooltip stays inside the card', tooltipBounds.inside, tooltipBounds);

  step('corruption recovery in settings');
  await evaluate(`
    localStorage.removeItem('devhawx.pos.corrupt.customers');
    localStorage.setItem('devhawx.pos.customers', '{"broken": [}');
    return true;
  `);
  await navigate('settings');
  const corruptBoot = await evaluate(`
    var banner = document.querySelector('.storage-warning');
    var customers = window.DH.store.collection('customers');
    return {
      banner: !!banner,
      text: banner ? banner.textContent : '',
      backup: localStorage.getItem('devhawx.pos.corrupt.customers'),
      customers: customers.count(),
      raw: localStorage.getItem('devhawx.pos.customers'),
      listed: window.DH.store.getCorruptKeys()
    };
  `);
  check('Corrupted data key recovers on boot with a backup',
    corruptBoot.banner && /customers/i.test(corruptBoot.text) && corruptBoot.backup === '{"broken": [}' &&
    corruptBoot.customers === 0 && corruptBoot.raw === '[]' && corruptBoot.listed.indexOf('customers') !== -1,
    corruptBoot);

  const clearBackups = await evaluate(`
    document.getElementById('clear-corrupt').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          banner: !!document.querySelector('.storage-warning'),
          backup: localStorage.getItem('devhawx.pos.corrupt.customers'),
          listed: window.DH.store.getCorruptKeys()
        });
      }, 400);
    });
  `);
  check('Settings can clear corruption backups', !clearBackups.banner && !clearBackups.backup && clearBackups.listed.length === 0, clearBackups);

  step('reset flow');
  const reset = await evaluate(`
    var s = window.DH.store;
    var beforeCancel = s.getStore().name;
    document.getElementById('topbar-user').click();
    document.getElementById('profile-reset').click();
    var modalOpen = document.getElementById('modal-root').classList.contains('is-open');
    document.querySelector('[data-modal-close]').click();
    var cancelClosed = !document.getElementById('modal-root').classList.contains('is-open');
    var kept = s.getStore().name === beforeCancel && s.collection('products').count() === 14;

    document.getElementById('topbar-user').click();
    document.getElementById('profile-reset').click();
    document.querySelector('[data-modal-confirm]').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          modalOpen: modalOpen,
          cancelClosed: cancelClosed,
          kept: kept,
          storeName: s.getSettings().storeName,
          sales: s.collection('sales').count(),
          products: s.collection('products').count(),
          customers: s.collection('customers').count(),
          categories: s.collection('categories').count(),
          storeRaw: JSON.parse(localStorage.getItem('devhawx.pos.store')).name,
          prefs: s.get('preferences', null),
          collapsed: document.querySelector('.app-shell').classList.contains('is-collapsed'),
          dot: document.getElementById('notifications-btn').classList.contains('has-dot'),
          modalClosed: !document.getElementById('modal-root').classList.contains('is-open'),
          toast: !!document.querySelector('.toast')
        });
      }, 500);
    });
  `);
  check('Reset confirmation can be cancelled', reset.modalOpen && reset.cancelClosed && reset.kept, reset);
  check('Reset restores the seeded workspace',
    reset.storeName === 'DevHawx Demo Store' && reset.storeRaw === 'DevHawx Demo Store' &&
    reset.sales > 80 && reset.products === 14 && reset.customers === 8 && reset.categories === 5 &&
    reset.prefs.sidebarCollapsed === false && reset.collapsed === false && reset.dot === true && reset.modalClosed,
    reset);

  step('console');
  check('No uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 3));
  check('No console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5));
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
