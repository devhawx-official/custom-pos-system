/* =====================================================================
 * NEXUS SUPERSTORE — Shared Sidebar Navigation
 * ---------------------------------------------------------------------
 * Usage (place as the FIRST child of <body> on every page):
 *   <script src="assets/nexus-sidebar.js" data-module="pos"></script>
 *
 * data-module : dashboard | pos | inventory | erp | crm
 *
 * Optional hook on the page (used for in-place tab switching so the
 * cart / state is not lost when clicking a tab of the CURRENT module):
 *   window.NEXUS_ROUTE_TAB = function (tabId) { switchTab(tabId); };
 * ===================================================================== */
(function () {
  'use strict';

  var scriptEl = document.currentScript;
  var currentModule = (scriptEl && scriptEl.getAttribute('data-module')) || 'dashboard';

  var MODULES = [
    {
      key: 'dashboard', label: 'Dashboard & Analytics', icon: 'fa-gauge-high',
      href: 'index.html', accent: '#94a3b8',
      tabs: [
        { id: 'overview', label: 'Overview & Live Metrics', icon: 'fa-gauge-high' },
        { id: 'sales',    label: 'Shift & Sales Audit', icon: 'fa-cash-register' },
        { id: 'velocity', label: 'Fast / Slow Velocity', icon: 'fa-fire' },
        { id: 'margins',  label: 'Profitability & Margins', icon: 'fa-scale-balanced' },
        { id: 'tax',      label: 'Tax, FBR & Expiry', icon: 'fa-receipt' }
      ]
    },
    {
      key: 'pos', label: 'Billing & POS', icon: 'fa-cash-register',
      href: 'pos-terminal.html', accent: '#22d3ee',
      tabs: [
        { id: 'billing', label: 'Billing Terminal', icon: 'fa-cash-register' },
        { id: 'returns', label: 'Returns & Refunds', icon: 'fa-rotate-left' },
        { id: 'shift',   label: 'Shift & Cash Drawer', icon: 'fa-vault' }
      ]
    },
    {
      key: 'inventory', label: 'Inventory OS', icon: 'fa-boxes-stacked',
      href: 'inventory-os.html', accent: '#38bdf8',
      tabs: [
        { id: 'catalog',  label: 'Master Catalog', icon: 'fa-boxes-stacked' },
        { id: 'movement', label: 'Stock Levels & Audit', icon: 'fa-chart-line' },
        { id: 'barcodes', label: 'Barcode & Label Studio', icon: 'fa-print' },
        { id: 'orders',   label: 'PO & GRN Inward', icon: 'fa-truck-ramp-box' }
      ]
    },
    {
      key: 'erp', label: 'Vendors & Payables', icon: 'fa-truck-field',
      href: 'vendors-payables.html', accent: '#34d399',
      tabs: [
        { id: 'vendors', label: 'Vendor Directory', icon: 'fa-truck-field' },
        { id: 'ledger',  label: 'AP Ledger & Bills', icon: 'fa-book-journal-whills' }
      ]
    },
    {
      key: 'crm', label: 'CRM & Settings', icon: 'fa-users-gear',
      href: 'crm-settings.html', accent: '#a78bfa',
      tabs: [
        { id: 'crm',      label: 'Customers & Khata', icon: 'fa-users' },
        { id: 'rbac',     label: 'RBAC & Roles', icon: 'fa-user-shield' },
        { id: 'hardware', label: 'Hardware & Devices', icon: 'fa-print' },
        { id: 'store',    label: 'Store & Receipts', icon: 'fa-store' }
      ]
    }
  ];

  /* ------------------------------------------------------------------ */
  /* STYLES                                                             */
  /* ------------------------------------------------------------------ */
  var css = ''
  + '#nx-sidebar{position:fixed;top:0;left:0;bottom:0;width:264px;z-index:40;'
  + '  background:linear-gradient(180deg,#0B0F19 0%,#060911 100%);'
  + '  border-right:1px solid rgba(255,255,255,.07);'
  + '  display:flex;flex-direction:column;font-family:Inter,sans-serif;color:#cbd5e1;'
  + '  box-shadow:4px 0 24px rgba(0,0,0,.35)}'
  + '#nx-sidebar *{box-sizing:border-box}'
  + '.nx-brand{display:flex;align-items:center;gap:10px;padding:16px 16px 14px;'
  + '  border-bottom:1px solid rgba(255,255,255,.06)}'
  + '.nx-logo{width:40px;height:40px;border-radius:12px;flex:0 0 auto;'
  + '  background:linear-gradient(135deg,#06b6d4,#10b981);color:#060911;'
  + '  display:flex;align-items:center;justify-content:center;font-size:18px;'
  + '  box-shadow:0 6px 18px rgba(6,182,212,.35)}'
  + '.nx-title{font-weight:800;font-size:15px;letter-spacing:.4px;color:#fff;line-height:1.1}'
  + '.nx-title span{color:#22d3ee}'
  + '.nx-sub{font-size:10.5px;color:#64748b;margin-top:3px;display:flex;align-items:center;gap:5px}'
  + '.nx-dot{width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block;'
  + '  box-shadow:0 0 8px #10b981;animation:nxPulse 2s infinite}'
  + '@keyframes nxPulse{0%,100%{opacity:1}50%{opacity:.35}}'
  + '.nx-scroll{flex:1;overflow-y:auto;padding:12px 10px 18px}'
  + '.nx-scroll::-webkit-scrollbar{width:5px}'
  + '.nx-scroll::-webkit-scrollbar-thumb{background:#1e293b;border-radius:4px}'
  + '.nx-heading{font-size:9.5px;text-transform:uppercase;letter-spacing:1.4px;'
  + '  color:#475569;font-weight:700;padding:6px 10px 8px}'
  + '.nx-group{margin-bottom:2px}'
  + '.nx-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;'
  + '  color:#94a3b8;font-size:12.5px;font-weight:600;text-decoration:none;cursor:pointer;'
  + '  transition:background .15s,color .15s;border-left:2px solid transparent}'
  + '.nx-item:hover{background:rgba(255,255,255,.045);color:#e2e8f0}'
  + '.nx-item .nx-ico{width:18px;text-align:center;font-size:13px;color:var(--nx-accent);opacity:.85}'
  + '.nx-item .nx-label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.nx-caret{font-size:9px;color:#475569;transition:transform .2s}'
  + '.nx-group.nx-expanded .nx-caret{transform:rotate(90deg)}'
  + '.nx-item.nx-active{background:rgba(255,255,255,.06);color:#fff;'
  + '  border-left-color:var(--nx-accent)}'
  + '.nx-tabs{display:none;padding:3px 0 6px 20px}'
  + '.nx-group.nx-expanded .nx-tabs{display:block}'
  + '.nx-tab{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;'
  + '  font-size:11.5px;color:#94a3b8;text-decoration:none;cursor:pointer;'
  + '  border-left:1px solid rgba(255,255,255,.07);margin-left:8px;transition:all .15s}'
  + '.nx-tab i{font-size:10px;width:13px;text-align:center;opacity:.7}'
  + '.nx-tab:hover{color:#e2e8f0;background:rgba(255,255,255,.04)}'
  + '.nx-tab.nx-active{color:var(--nx-accent);background:rgba(255,255,255,.05);'
  + '  border-left-color:var(--nx-accent);font-weight:700}'
  + '.nx-tab.nx-active i{opacity:1}'
  + '.nx-footer{padding:12px;border-top:1px solid rgba(255,255,255,.06);'
  + '  display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.25)}'
  + '.nx-avatar{width:34px;height:34px;border-radius:10px;flex:0 0 auto;'
  + '  background:rgba(99,102,241,.18);border:1px solid rgba(99,102,241,.35);color:#a5b4fc;'
  + '  display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px}'
  + '.nx-user{font-size:12px;font-weight:700;color:#e2e8f0;line-height:1.2}'
  + '.nx-role{font-size:10px;color:#10b981;margin-top:2px}'
  + '#nx-burger{position:fixed;top:12px;left:12px;z-index:45;width:40px;height:40px;'
  + '  border-radius:11px;background:#111827;border:1px solid rgba(255,255,255,.1);'
  + '  color:#e2e8f0;align-items:center;justify-content:center;cursor:pointer;display:none}'
  + '#nx-backdrop{position:fixed;inset:0;background:rgba(2,6,15,.65);z-index:39}'
  /* --- responsive --- */
  + '@media (min-width:1024px){ body{padding-left:264px} }'
  + '@media (max-width:1023.98px){'
  + '  #nx-burger{display:flex}'
  + '  #nx-sidebar{transform:translateX(-100%);transition:transform .25s ease}'
  + '  #nx-sidebar.nx-open{transform:translateX(0)}'
  + '  body>header{padding-left:64px !important}'
  + '}'
  /* --- never print the chrome --- */
  + '@media print{ #nx-sidebar,#nx-burger,#nx-backdrop{display:none !important}'
  + '  body{padding-left:0 !important} }';

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ------------------------------------------------------------------ */
  /* MARKUP                                                             */
  /* ------------------------------------------------------------------ */
  var html = '<aside id="nx-sidebar" aria-label="Primary navigation">'
    + '<div class="nx-brand">'
    +   '<div class="nx-logo"><i class="fa-solid fa-bolt"></i></div>'
    +   '<div>'
    +     '<div class="nx-title">NEXUS<span>SUPERSTORE</span></div>'
    +     '<div class="nx-sub"><span class="nx-dot"></span> Main Branch &bull; Online</div>'
    +   '</div>'
    + '</div>'
    + '<div class="nx-scroll">'
    +   '<div class="nx-heading">Workspace</div>';

  MODULES.forEach(function (m) {
    html += '<div class="nx-group" data-key="' + m.key + '" style="--nx-accent:' + m.accent + '">';
    html += '<a class="nx-item" href="' + m.href + '" title="' + m.label + '">'
          +   '<i class="fa-solid ' + m.icon + ' nx-ico"></i>'
          +   '<span class="nx-label">' + m.label + '</span>'
          +   (m.tabs ? '<i class="fa-solid fa-chevron-right nx-caret"></i>' : '')
          + '</a>';
    if (m.tabs) {
      html += '<div class="nx-tabs">';
      m.tabs.forEach(function (t) {
        html += '<a class="nx-tab" data-tab="' + t.id + '" href="' + m.href + '#' + t.id + '">'
              +   '<i class="fa-solid ' + t.icon + '"></i><span>' + t.label + '</span>'
              + '</a>';
      });
      html += '</div>';
    }
    html += '</div>';
  });

  html += '</div>'
    + '<div class="nx-footer">'
    +   '<div class="nx-avatar">JD</div>'
    +   '<div>'
    +     '<div class="nx-user">John Doe</div>'
    +     '<div class="nx-role"><i class="fa-solid fa-circle" style="font-size:6px"></i> Cashier &bull; Shift #SH-8842</div>'
    +   '</div>'
    + '</div>'
    + '</aside>'
    + '<div id="nx-backdrop" hidden></div>'
    + '<button id="nx-burger" aria-label="Open menu"><i class="fa-solid fa-bars"></i></button>';

  document.body.insertAdjacentHTML('afterbegin', html);

  var sidebar = document.getElementById('nx-sidebar');
  var backdrop = document.getElementById('nx-backdrop');
  var burger = document.getElementById('nx-burger');

  /* ------------------------------------------------------------------ */
  /* BEHAVIOUR                                                          */
  /* ------------------------------------------------------------------ */
  function currentFile() {
    return location.pathname.split('/').pop() || 'index.html';
  }

  function openMobile() {
    sidebar.classList.add('nx-open');
    backdrop.hidden = false;
  }
  function closeMobile() {
    sidebar.classList.remove('nx-open');
    backdrop.hidden = true;
  }

  function sync(moduleKey, tabId) {
    var groups = sidebar.querySelectorAll('.nx-group');
    Array.prototype.forEach.call(groups, function (g) {
      var isActive = g.getAttribute('data-key') === moduleKey;
      g.classList.toggle('nx-expanded', isActive);
      g.querySelector('.nx-item').classList.toggle('nx-active', isActive);
      Array.prototype.forEach.call(g.querySelectorAll('.nx-tab'), function (t) {
        t.classList.toggle('nx-active', isActive && t.getAttribute('data-tab') === tabId);
      });
    });
  }

  /* clicks */
  sidebar.addEventListener('click', function (e) {
    var tabEl = e.target.closest('.nx-tab');
    var itemEl = e.target.closest('.nx-item');
    var target = tabEl || itemEl;
    if (!target) return;

    var group = target.closest('.nx-group');
    var key = group ? group.getAttribute('data-key') : 'dashboard';

    /* clicking the module you are ALREADY on => switch tab in place
       (keeps POS cart / state alive, no page reload) */
    if (key === currentModule) {
      e.preventDefault();
      var tabId = tabEl ? tabEl.getAttribute('data-tab') : null;
      if (tabId && typeof window.NEXUS_ROUTE_TAB === 'function') {
        window.NEXUS_ROUTE_TAB(tabId);
      }
      closeMobile();
    }
  });

  burger.addEventListener('click', function () {
    sidebar.classList.contains('nx-open') ? closeMobile() : openMobile();
  });
  backdrop.addEventListener('click', closeMobile);

  /* collapse sidebar when a tab link is opened via keyboard */
  sidebar.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMobile();
  });

  /* ------------------------------------------------------------------ */
  /* INITIAL STATE                                                      */
  /* ------------------------------------------------------------------ */
  var hashTab = (location.hash || '').replace('#', '');
  sync(currentModule, hashTab);

  window.NexusNav = { sync: sync, open: openMobile, close: closeMobile };
})();
