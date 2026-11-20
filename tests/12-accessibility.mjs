import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
mkdirSync(SHOTS, { recursive: true });

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const BASE = process.env.DH_BASE || 'http://127.0.0.1:4780/';
const profileDir = mkdtempSync(path.join(tmpdir(), 'dh-a11y-'));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--window-size=1440,900', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 60; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    version = await res.json();
    break;
  } catch { await sleep(250); }
}
if (!version) throw new Error('no chrome');

const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
};
function send(method, params = {}) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression: `(function(){${expression}})()`, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function navigate(route, n) {
  await send('Page.navigate', { url: `${BASE}?a=${n}#/${route}` });
  const start = Date.now();
  while (Date.now() - start < 12000) {
    const ok = await evaluate('return document.readyState === "complete" && !!window.DH && !!document.querySelector(".view")');
    if (ok) break;
    await sleep(120);
  }
  await sleep(260);
}

await send('Page.enable');
await send('Runtime.enable');

const routes = ['dashboard', 'pos', 'products', 'inventory', 'customers', 'sales', 'reports', 'settings'];
let issues = 0;
for (let i = 0; i < routes.length; i += 1) {
  await navigate(routes[i], i + 1);
  const report = await evaluate(`
    var scope = document.querySelector('.view');
    var root = document;
    function labelFor(el) {
      if (el.getAttribute('aria-label')) return true;
      if (el.getAttribute('aria-labelledby')) return true;
      if (el.closest('label')) return true;
      if (el.id && root.querySelector('label[for="' + el.id + '"]')) return true;
      return false;
    }
    var unnamedButtons = Array.prototype.filter.call(root.querySelectorAll('button'), function (b) {
      return !b.textContent.trim() && !labelFor(b) && !b.getAttribute('title');
    }).map(function (b) { return b.id || b.className; });
    var unnamedFields = Array.prototype.filter.call(root.querySelectorAll('input, select, textarea'), function (f) {
      return !labelFor(f) && !f.getAttribute('placeholder');
    }).map(function (f) { return f.id || f.name || f.type; });
    var unnamedLinks = Array.prototype.filter.call(root.querySelectorAll('a[href]'), function (a) {
      return !a.textContent.trim() && !labelFor(a);
    }).map(function (a) { return a.getAttribute('href'); });
    var ids = Array.prototype.map.call(root.querySelectorAll('[id]'), function (el) { return el.id; });
    var dupes = ids.filter(function (id, index) { return ids.indexOf(id) !== index; });
    var h1s = root.querySelectorAll('h1').length;
    var headings = Array.prototype.map.call(scope.querySelectorAll('h1,h2,h3,h4'), function (h) { return h.tagName + ':' + h.textContent.trim().slice(0, 40); });
    var imgs = Array.prototype.filter.call(root.querySelectorAll('img'), function (img) { return !img.hasAttribute('alt'); }).length;
    return {
      unnamedButtons: unnamedButtons, unnamedFields: unnamedFields, unnamedLinks: unnamedLinks,
      dupes: Array.from(new Set(dupes)), h1s: h1s, headings: headings, imgs: imgs,
      lang: document.documentElement.lang, title: document.title
    };
  `);
  const bad = report.unnamedButtons.length + report.unnamedFields.length + report.unnamedLinks.length + report.dupes.length + report.imgs + (report.h1s !== 1 ? 1 : 0) + (report.lang ? 0 : 1);
  issues += bad;
  console.log(`${bad ? 'WARN' : 'OK  '} ${routes[i]} Â· h1=${report.h1s} Â· headings=${report.headings.length}${bad ? ' Â· ' + JSON.stringify({ buttons: report.unnamedButtons, fields: report.unnamedFields, links: report.unnamedLinks, dupes: report.dupes, imgs: report.imgs, lang: report.lang }) : ''}`);
}

console.log('\nconsole/exceptions: ' + (errors.length ? JSON.stringify(errors) : 'none'));
console.log('a11y issues: ' + issues);
ws.close();
chrome.kill();
try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
process.exit(0);
