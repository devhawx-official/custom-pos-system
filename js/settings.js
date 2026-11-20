/* ==========================================================================
   DevHawx POS — settings.js
   Store settings: profile, checkout rules and receipt details. Every value
   is persisted to localStorage through DH.store and applied to the whole
   application immediately, plus a storage inspector and a guarded reset.
   ========================================================================== */

(function (window) {
  'use strict';

  var DH = window.DH;
  var icon = DH.icon;
  var escape = DH.util.escapeHtml;

  var CURRENCIES = [
    ['USD', 'US Dollar'],
    ['EUR', 'Euro'],
    ['GBP', 'British Pound'],
    ['AUD', 'Australian Dollar'],
    ['CAD', 'Canadian Dollar'],
    ['NGN', 'Nigerian Naira'],
    ['ZAR', 'South African Rand'],
    ['INR', 'Indian Rupee'],
    ['AED', 'UAE Dirham'],
    ['JPY', 'Japanese Yen']
  ];

  var KEY_LABELS = {
    meta: 'Workspace meta',
    store: 'Store information',
    settings: 'Store settings',
    preferences: 'Workspace preferences',
    categories: 'Categories',
    products: 'Products',
    inventory: 'Inventory movements',
    customers: 'Customers',
    sales: 'Sales',
    cart: 'Active cart',
    cartDiscount: 'Cart discount',
    activity: 'Activity log'
  };

  function formatBytes(bytes) {
    var size = Number(bytes) || 0;
    if (size < 1024) return size + ' B';
    return (size / 1024).toFixed(1) + ' KB';
  }

  function describeRow(row) {
    if (!row.exists) return 'empty';
    if (row.corrupt) return 'corrupted';
    if (row.type === 'array') return row.count + (row.count === 1 ? ' record' : ' records');
    if (row.type === 'object') return row.count + (row.count === 1 ? ' field' : ' fields');
    return row.type;
  }

  function field(name, label, value, options) {
    var config = options || {};
    var control;

    if (config.type === 'textarea') {
      control = '<textarea id="field-' + name + '" name="' + name + '" rows="3">' + escape(value) + '</textarea>';
    } else if (config.type === 'select') {
      control = '<select id="field-' + name + '" name="' + name + '">' +
        CURRENCIES.map(function (currency) {
          return '<option value="' + escape(currency[0]) + '"' + (currency[0] === value ? ' selected' : '') + '>' +
            escape(currency[0]) + ' — ' + escape(currency[1]) + '</option>';
        }).join('') +
      '</select>';
    } else if (config.type === 'switch') {
      control = '<label class="switch">' +
        '<input type="checkbox" id="field-' + name + '" name="' + name + '"' + (value ? ' checked' : '') + '>' +
        '<span class="switch-track" aria-hidden="true"></span>' +
        '<span class="switch-label">' + escape(config.switchLabel || '') + '</span>' +
      '</label>';
    } else {
      control = '<input id="field-' + name + '" name="' + name + '" type="' + (config.type || 'text') + '"' +
        (config.step ? ' step="' + config.step + '"' : '') +
        (config.min !== undefined ? ' min="' + config.min + '"' : '') +
        (config.max !== undefined ? ' max="' + config.max + '"' : '') +
        (config.required ? ' required' : '') +
        ' value="' + escape(value) + '">';
    }

    return '<div class="form-field' + (config.full ? ' is-full' : '') + '">' +
      (config.type === 'switch'
        ? '<span class="form-field-label">' + escape(label) + '</span>'
        : '<label for="field-' + name + '">' + escape(label) + (config.required ? '<span class="req" aria-hidden="true">*</span>' : '') + '</label>') +
      control +
      '<p class="field-error" id="error-field-' + name + '" data-error="' + name + '" aria-live="polite"></p>' +
    '</div>';
  }

  /* ---------- Storage inspector ---------- */

  function renderStorage() {
    var rows = DH.store.inspect();
    var corrupt = DH.store.getCorruptKeys();

    var warning = '';
    if (corrupt.length) {
      warning =
        '<div class="storage-warning" role="status">' +
          icon('alert-triangle', 16) +
          '<div>' +
            '<strong>Corrupted data recovered</strong>' +
            '<p><code>' + escape(corrupt.join(', ')) + '</code> could not be parsed. ' +
              'A backup was kept under <code>devhawx.pos.corrupt.*</code> and the workspace fell back to safe defaults.</p>' +
            '<button class="btn btn-ghost" id="clear-corrupt" type="button">' + icon('check', 15) + 'Clear backups</button>' +
          '</div>' +
        '</div>';
    }

    return '<section class="card table-card">' +
      '<header class="card-head table-card-head">' +
        '<div><h3>Local storage</h3><p>Everything this workspace remembers</p></div>' +
        '<span class="chip">' + icon('shield', 13) + (DH.store.isAvailable() ? 'localStorage' : 'memory') + '</span>' +
      '</header>' +
      warning +
      '<div class="storage-list">' +
        rows.map(function (row) {
          return '<div class="storage-row' + (row.corrupt ? ' is-corrupt' : '') + '">' +
            '<span><strong>' + escape(KEY_LABELS[row.key] || row.key) + '</strong> ' +
              '<code>' + escape(row.storageKey.replace('devhawx.pos.', '')) + '</code></span>' +
            '<span class="storage-meta">' + describeRow(row) +
              ' · ' + formatBytes(row.bytes) + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<p class="storage-meta storage-note">' + icon('info', 14) +
        'Data never leaves this browser. Clearing site data resets the demo.</p>' +
    '</section>';
  }

  /* ---------- Receipt preview ---------- */

  function sampleSale() {
    var config = DH.store.getSettings();
    var product = DH.store.collection('products').all()[0];
    var price = product ? Number(product.price) || 0 : 0;
    var quantity = 2;
    var subtotal = Math.round(price * quantity * 100) / 100;
    var tax = Math.round(subtotal * (Number(config.taxRate) || 0) / 100 * 100) / 100;

    return {
      transactionId: 'TXN-PREVIEW',
      receipt: (config.receiptPrefix || 'INV') + '-PREVIEW',
      customerId: null,
      customerName: 'Preview customer',
      items: product ? [{
        productId: product.id,
        name: product.name,
        sku: product.sku,
        price: price,
        quantity: quantity,
        lineTotal: subtotal
      }] : [],
      itemCount: quantity,
      subtotal: subtotal,
      discount: 0,
      discountPercent: 0,
      tax: tax,
      taxRate: Number(config.taxRate) || 0,
      total: Math.round((subtotal + tax) * 100) / 100,
      payment: 'Cash',
      amountReceived: Math.round((subtotal + tax) * 100) / 100,
      change: 0,
      status: 'preview',
      cashier: config.cashierName || 'Admin',
      createdAt: new Date().toISOString()
    };
  }

  function renderPreview() {
    var store = DH.store.getStore();

    return '<section class="card">' +
      '<header class="card-head">' +
        '<div><h3>Receipt preview</h3><p>See the printed receipt before you print</p></div>' +
        '<span class="chip">' + icon('printer', 13) + '58 / 80 mm</span>' +
      '</header>' +
      '<div class="preview-card">' +
        '<strong>' + escape(store.name) + '</strong>' +
        (store.address ? '<span>' + escape(store.address) + '</span>' : '') +
        (store.phone ? '<span>' + escape(store.phone) + '</span>' : '') +
        (store.email ? '<span>' + escape(store.email) + '</span>' : '') +
        (store.receiptFooter ? '<em>' + escape(store.receiptFooter) + '</em>' : '') +
      '</div>' +
      '<button class="btn btn-ghost btn-block" type="button" id="preview-receipt">' + icon('printer', 16) + 'Preview receipt</button>' +
    '</section>';
  }

  /* ---------- View ---------- */

  function render(view) {
    var config = DH.store.getSettings();
    var store = DH.store.getStore();

    view.innerHTML =
      '<div class="settings-grid">' +
        '<form id="store-settings-form" class="settings-main" novalidate>' +
          '<section class="card">' +
            '<header class="card-head">' +
              '<div><h3>Store profile</h3><p>Used on receipts and across the workspace</p></div>' +
              '<span class="chip">' + icon('store', 13) + escape(store.name) + '</span>' +
            '</header>' +
            '<div class="form-grid">' +
              field('storeName', 'Store name', config.storeName, { required: true, full: true }) +
              field('legalName', 'Legal / trading name', config.legalName) +
              field('email', 'Contact email', config.email, { type: 'email' }) +
              field('phone', 'Phone number', config.phone) +
              field('address', 'Store address', config.address, { type: 'textarea', full: true }) +
              field('receiptFooter', 'Receipt footer message', config.receiptFooter, { type: 'textarea', full: true }) +
            '</div>' +
          '</section>' +

          '<section class="card">' +
            '<header class="card-head">' +
              '<div><h3>Checkout &amp; inventory</h3><p>Tax, currency, discounts and stock rules</p></div>' +
              '<span class="chip">' + icon('card', 13) + escape(config.currency) + '</span>' +
            '</header>' +
            '<div class="form-grid">' +
              field('currency', 'Currency', config.currency, { type: 'select' }) +
              field('taxRate', 'Tax rate (%)', config.taxRate, { type: 'number', step: '0.1', min: 0, max: 100 }) +
              field('lowStockThreshold', 'Low stock threshold', config.lowStockThreshold, { type: 'number', step: '1', min: 0 }) +
              field('cashierName', 'Default cashier', config.cashierName) +
              field('defaultDiscount', 'Default discount (%)', config.defaultDiscount, { type: 'number', step: '0.5', min: 0, max: 100 }) +
              field('applyDefaultDiscount', 'Apply default discount', config.applyDefaultDiscount, {
                type: 'switch',
                switchLabel: 'Start every new sale with this discount'
              }) +
            '</div>' +
            '<p class="form-note settings-note">' + icon('info', 14) +
              'Changes save to this browser and apply to the register, receipts, dashboard and inventory straight away.</p>' +
          '</section>' +

          '<div class="form-foot settings-foot">' +
            '<span class="form-note">Changes save instantly to this browser.</span>' +
            '<button class="btn btn-ghost" type="reset">Discard</button>' +
            '<button class="btn btn-primary" type="submit">' + icon('check', 16) + 'Save changes</button>' +
          '</div>' +
        '</form>' +

        '<div class="settings-side">' +
          renderPreview() +
          renderStorage() +
          '<section class="card danger-card">' +
            '<header class="card-head">' +
              '<div><h3>Reset demo</h3><p>Restore the sample dataset</p></div>' +
              '<span class="chip chip-muted">' + icon('alert-triangle', 13) + 'Careful</span>' +
            '</header>' +
            '<p>Clears your local changes and restores the sample catalog, customers, sales and preferences. This cannot be undone.</p>' +
            '<button class="btn btn-danger" id="reset-demo" type="button">' + icon('trash', 16) + 'Reset demo data</button>' +
          '</section>' +
        '</div>' +
      '</div>';

    bindForm(view);
    bindActions(view);
  }

  function bindForm(view) {
    var form = view.querySelector('#store-settings-form');
    if (!form) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var data = new FormData(form);
      var failed = false;

      function fail(name, message) {
        DH.ui.setFieldError(form, name, message);
        failed = true;
      }

      DH.ui.clearFieldErrors(form);

      var storeName = String(data.get('storeName') || '').trim();
      var legalName = String(data.get('legalName') || '').trim();
      var email = String(data.get('email') || '').trim();
      var phone = String(data.get('phone') || '').trim();
      var address = String(data.get('address') || '').trim();
      var receiptFooter = String(data.get('receiptFooter') || '').trim();
      var currency = String(data.get('currency') || 'USD');
      var cashierName = String(data.get('cashierName') || '').trim() || 'Admin';

      var taxRate = Number(data.get('taxRate'));
      var threshold = Number(data.get('lowStockThreshold'));
      var defaultDiscount = Number(data.get('defaultDiscount'));
      var applyDefaultDiscount = form.querySelector('[name="applyDefaultDiscount"]').checked;

      if (!storeName) fail('storeName', 'Store name is required.');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('email', 'Enter a valid email address.');
      if (phone && phone.replace(/\D/g, '').length < 5) fail('phone', 'Enter a valid phone number.');
      if (!isFinite(taxRate) || taxRate < 0 || taxRate > 100) fail('taxRate', 'Tax rate must be between 0 and 100.');
      if (!isFinite(threshold) || threshold < 0) fail('lowStockThreshold', 'Low stock threshold must be 0 or more.');
      if (!isFinite(defaultDiscount) || defaultDiscount < 0 || defaultDiscount > 100) fail('defaultDiscount', 'Default discount must be between 0 and 100.');

      if (failed) {
        var first = form.querySelector('.is-invalid');
        if (first) first.focus();
        DH.toast('Please correct the highlighted fields.', 'error');
        return;
      }

      DH.store.saveSettings({
        storeName: storeName,
        legalName: legalName,
        email: email,
        phone: phone,
        address: address,
        receiptFooter: receiptFooter,
        currency: currency,
        taxRate: Math.min(100, Math.max(0, taxRate)),
        lowStockThreshold: Math.max(0, Math.round(threshold)),
        cashierName: cashierName,
        defaultDiscount: Math.min(100, Math.max(0, defaultDiscount)),
        applyDefaultDiscount: applyDefaultDiscount
      });

      DH.toast('Settings saved — applied across the register.', 'success');
    });

    form.addEventListener('input', function (event) {
      var target = event.target;
      if (target && target.name) DH.ui.setFieldError(form, target.name, '');
    });
  }

  function bindActions(view) {
    var preview = view.querySelector('#preview-receipt');
    if (preview) {
      preview.addEventListener('click', function () {
        if (DH.receipt && typeof DH.receipt.open === 'function') {
          DH.receipt.open(sampleSale(), { title: 'Receipt preview' });
        }
      });
    }

    var clearCorrupt = view.querySelector('#clear-corrupt');
    if (clearCorrupt) {
      clearCorrupt.addEventListener('click', function () {
        DH.store.clearCorruptBackups();
        DH.toast('Corrupted value backups cleared.', 'info');
        DH.router.refresh();
      });
    }

    var resetButton = view.querySelector('#reset-demo');
    if (resetButton) {
      resetButton.addEventListener('click', function () {
        DH.modal.open({
          title: 'Reset demo data?',
          description: 'This clears your local changes and restores the sample catalog, customers and sales.',
          confirmLabel: 'Reset workspace',
          cancelLabel: 'Keep my data',
          onConfirm: function () {
            DH.store.resetDemoData();
            DH.toast('Demo workspace restored with fresh sample data.', 'success');
            DH.router.refresh();
          }
        });
      });
    }
  }

  DH.views.settings = { id: 'settings', render: render };

})(window);
