/* ==========================================================================
   DevHawx POS — inventory.js
   Inventory management: live stock overview, low-stock and out-of-stock
   alerts, stock in / out / adjustment forms and the movement history.

   The catalog record is the single source of truth for stock: every change
   here updates the product and writes a movement to the inventory log, and
   stock edited from the Products module is picked up automatically.
   ========================================================================== */

(function (window) {
  'use strict';

  var DH = window.DH;
  var icon = DH.icon;
  var format = DH.format;
  var escape = DH.util.escapeHtml;

  var state = {
    query: '',
    filter: 'all'
  };

  var MODES = {
    in: {
      title: 'Stock in',
      description: 'Receive units into the catalog.',
      label: 'Quantity received',
      confirm: 'Add stock',
      type: 'restock',
      defaultNote: 'Stock received'
    },
    out: {
      title: 'Stock out',
      description: 'Issue units out of the catalog.',
      label: 'Quantity issued',
      confirm: 'Remove stock',
      type: 'issue',
      defaultNote: 'Stock issued'
    },
    adjust: {
      title: 'Adjust stock',
      description: 'Set the exact quantity on hand after a count.',
      label: 'New quantity on hand',
      confirm: 'Save adjustment',
      type: 'adjustment',
      defaultNote: 'Stock adjusted'
    }
  };

  var MOVEMENT_TYPES = {
    restock: { label: 'Stock in', tone: 'is-in' },
    issue: { label: 'Stock out', tone: 'is-out' },
    adjustment: { label: 'Adjustment', tone: 'is-adjust' }
  };

  /* ---------- Helpers ---------- */

  function settings() {
    return DH.store.getSettings();
  }

  function defaultThreshold() {
    return Number(settings().lowStockThreshold) || 10;
  }

  function products() {
    return DH.store.collection('products').all();
  }

  function movements() {
    return DH.store.collection('inventory').all();
  }

  function stockOf(product) {
    return Math.max(0, Math.round(Number(product && product.stock) || 0));
  }

  /** The store-wide reorder point from Settings is the single source of truth. */
  function reorderPoint() {
    return defaultThreshold();
  }

  function isOut(product) {
    return stockOf(product) === 0;
  }

  function isLow(product) {
    var stock = stockOf(product);
    return stock > 0 && stock <= reorderPoint();
  }

  function sortedProducts(list) {
    return (list || products()).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function movementTime(movement) {
    return new Date(movement.at || movement.createdAt || 0).getTime() || 0;
  }

  function productNameFor(movement) {
    if (movement.productName) return movement.productName;
    var product = DH.store.collection('products').find(movement.productId);
    return product ? product.name : 'Removed product';
  }

  function logActivity(title, detail, tone) {
    DH.store.collection('activity').add({
      type: 'stock',
      title: title,
      detail: detail,
      tone: tone || 'info',
      at: new Date().toISOString()
    });
  }

  /**
   * Keeps the movement log in step with the catalog. When a product is
   * edited somewhere else (for example in Product management) the stock
   * difference is recorded as a synchronised adjustment.
   */
  function syncFromProducts() {
    var productCollection = DH.store.collection('products');
    var movementCollection = DH.store.collection('inventory');
    var byProduct = {};

    movements().forEach(function (movement) {
      if (!movement.productId) return;
      var list = byProduct[movement.productId] || (byProduct[movement.productId] = []);
      list.push(movement);
    });

    var synced = 0;

    productCollection.all().forEach(function (product) {
      var list = byProduct[product.id];
      if (!list || !list.length) return;

      list.sort(function (a, b) { return movementTime(b) - movementTime(a); });
      var last = list[0];
      if (typeof last.stockAfter !== 'number') return;

      var current = Math.max(0, Math.round(Number(product.stock) || 0));
      if (current === last.stockAfter) return;

      movementCollection.add({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        type: 'adjustment',
        quantity: current - last.stockAfter,
        stockBefore: last.stockAfter,
        stockAfter: current,
        note: 'Synchronised from the product catalog',
        synced: true,
        at: new Date().toISOString()
      });

      synced += 1;
    });

    return synced;
  }

  function visibleProducts() {
    var query = state.query.trim().toLowerCase();

    return products().filter(function (product) {
      if (state.filter === 'low' && !isLow(product)) return false;
      if (state.filter === 'out' && !isOut(product)) return false;
      if (!query) return true;
      return [product.name, product.sku, product.category].some(function (value) {
        return String(value || '').toLowerCase().indexOf(query) !== -1;
      });
    }).sort(function (a, b) {
      return stockOf(a) - stockOf(b) || String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  /* ---------- Markup ---------- */

  function stockStatus(product) {
    if (isOut(product)) return '<span class="stock-status is-out">Out of stock</span>';
    if (isLow(product)) return '<span class="stock-status is-low">Low stock</span>';
    return '<span class="stock-status is-ok">In stock</span>';
  }

  function stockCell(product) {
    var stock = stockOf(product);
    var tone = stock === 0 ? ' is-out' : (stock <= reorderPoint() ? ' is-low' : '');
    var flag = stock === 0 ? 'Out' : (stock <= reorderPoint() ? 'Low' : '');
    return '<span class="stock-value' + tone + '">' + format.number(stock) +
      (flag ? '<span class="stock-flag">' + flag + '</span>' : '') + '</span>';
  }

  function stockRow(product) {
    var id = String(product.id || '');
    var name = String(product.name || 'Untitled product');

    return '<tr data-stock-row="' + escape(id) + '">' +
      '<td>' +
        '<div class="product-cell">' +
          '<span class="product-avatar" aria-hidden="true">' + escape((name.charAt(0) || '?').toUpperCase()) + '</span>' +
          '<span class="product-copy">' +
            '<strong>' + escape(name) + '</strong>' +
            '<small>' + escape(product.category || 'Uncategorised') + '</small>' +
          '</span>' +
        '</div>' +
      '</td>' +
      '<td><span class="sku-code">' + escape(product.sku || '—') + '</span></td>' +
      '<td class="align-right">' + stockCell(product) + '</td>' +
      '<td class="align-right"><span class="reorder-cell">' + format.number(reorderPoint()) + '</span></td>' +
      '<td>' + stockStatus(product) + '</td>' +
      '<td class="cell-actions">' +
        '<div class="row-actions">' +
          '<button class="icon-btn row-action" type="button" data-stock-in="' + escape(id) + '" aria-label="Stock in ' + escape(name) + '" title="Stock in">' + icon('plus', 16) + '</button>' +
          '<button class="icon-btn row-action" type="button" data-stock-out="' + escape(id) + '" aria-label="Stock out ' + escape(name) + '" title="Stock out">' + icon('minus', 16) + '</button>' +
          '<button class="icon-btn row-action" type="button" data-stock-adjust="' + escape(id) + '" aria-label="Adjust stock for ' + escape(name) + '" title="Adjust stock">' + icon('sliders', 16) + '</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  function stockRowsMarkup(list, total) {
    if (!list.length) {
      return '<tr><td colspan="6" class="table-empty">' +
        DH.ui.emptyState({
          icon: 'inventory',
          title: total ? 'No stock matches this filter' : 'No products in the catalog',
          text: total
            ? 'Try another search term or switch the stock filter.'
            : 'Add a product first, then stock levels and movements will appear here.',
          action: total
            ? '<button class="btn btn-ghost" type="button" data-clear-filters>' + icon('refresh', 15) + 'Clear filters</button>'
            : '<button class="btn btn-primary" type="button" data-go="products">' + icon('products', 16) + 'Go to products</button>'
        }) +
      '</td></tr>';
    }

    return list.map(stockRow).join('');
  }

  function stockTableMarkup(list, total) {
    return '<section class="card table-card">' +
      '<header class="card-head table-card-head">' +
        '<div><h3>Stock levels</h3><p>Live quantities for every catalog item</p></div>' +
        '<span class="chip" id="stock-table-count">' + icon('box', 13) + list.length + ' of ' + total + '</span>' +
      '</header>' +
      '<div class="table-wrap">' +
        '<table class="data-table inventory-table">' +
          '<thead><tr>' +
            '<th>Product</th><th>SKU</th><th class="align-right">On hand</th>' +
            '<th class="align-right">Reorder at</th><th>Status</th><th></th>' +
          '</tr></thead>' +
          '<tbody id="stock-table-body">' + stockRowsMarkup(list, total) + '</tbody>' +
        '</table>' +
      '</div>' +
    '</section>';
  }

  function alertList(products_, emptyTitle, emptyText) {
    if (!products_.length) {
      return DH.ui.emptyState({ compact: true, icon: 'check-circle', title: emptyTitle, text: emptyText });
    }

    return products_.map(function (product) {
      var out = isOut(product);
      var id = String(product.id || '');
      return '<div class="stock-alert-item">' +
        '<span class="low-stock-thumb' + (out ? ' is-out' : '') + '">' +
          icon(out ? 'x-circle' : 'alert-triangle', 17) +
        '</span>' +
        '<span class="low-stock-copy">' +
          '<strong>' + escape(product.name) + '</strong>' +
          '<span>' + escape(product.sku || 'No SKU') + ' · ' + escape(product.category || 'Uncategorised') + '</span>' +
        '</span>' +
        '<span class="stock-pill' + (out ? ' is-out' : '') + '">' + (out ? 'Out' : stockOf(product) + ' left') + '</span>' +
        '<button class="btn btn-ghost stock-alert-action" type="button" data-stock-in="' + escape(id) + '" aria-label="Restock ' + escape(product.name) + '">Restock</button>' +
      '</div>';
    }).join('');
  }

  function movementRow(movement) {
    var delta = Number(movement.quantity) || 0;
    var type = movement.synced ? 'synced' : (MOVEMENT_TYPES[movement.type] ? movement.type : 'adjustment');
    var meta = type === 'synced'
      ? { label: 'Synced', tone: 'is-synced' }
      : MOVEMENT_TYPES[type];
    var tone = delta > 0 ? 'is-in' : (delta < 0 ? 'is-out' : 'is-flat');
    var sign = delta > 0 ? '+' : (delta < 0 ? '−' : '');
    var when = movement.at || movement.createdAt;

    return '<tr>' +
      '<td><span class="date-cell"><strong>' + escape(format.date(when, { month: 'short', day: 'numeric' })) + '</strong>' +
        '<span>' + escape(format.time(when)) + '</span></span></td>' +
      '<td><span class="product-copy"><strong>' + escape(productNameFor(movement)) + '</strong>' +
        '<span>' + escape(movement.sku || 'No SKU') + '</span></span></td>' +
      '<td><span class="movement-type ' + meta.tone + '">' + escape(meta.label) + '</span></td>' +
      '<td class="align-right"><span class="movement-change ' + tone + '">' + sign + format.number(Math.abs(delta)) + '</span></td>' +
      '<td class="align-right"><span class="movement-stock">' +
        (typeof movement.stockAfter === 'number' ? format.number(movement.stockAfter) : '—') + '</span></td>' +
      '<td><span class="movement-note">' + escape(movement.note || '—') + '</span></td>' +
    '</tr>';
  }

  function movementHistoryMarkup(list) {
    var recent = list.slice().sort(function (a, b) {
      return movementTime(b) - movementTime(a);
    });
    var shown = recent.slice(0, 12);

    var body = shown.length
      ? shown.map(movementRow).join('')
      : '<tr><td colspan="6" class="table-empty">' +
        DH.ui.emptyState({
          icon: 'receipt',
          title: 'No stock movements yet',
          text: 'Receive, issue or adjust stock and every change is logged here.'
        }) +
      '</td></tr>';

    return '<section class="card table-card">' +
      '<header class="card-head table-card-head">' +
        '<div><h3>Inventory movement history</h3><p>Every receipt, issue and adjustment</p></div>' +
        '<span class="chip">' + icon('clock', 13) + recent.length + ' movement' + (recent.length === 1 ? '' : 's') + '</span>' +
      '</header>' +
      '<div class="table-wrap">' +
        '<table class="data-table movement-table">' +
          '<thead><tr>' +
            '<th>Date</th><th>Product</th><th>Type</th><th class="align-right">Change</th>' +
            '<th class="align-right">On hand</th><th>Note</th>' +
          '</tr></thead>' +
          '<tbody>' + body + '</tbody>' +
        '</table>' +
      '</div>' +
      (recent.length > shown.length
        ? '<p class="movement-more">+' + (recent.length - shown.length) + ' older movements in the log</p>'
        : '') +
    '</section>';
  }

  function kpiMarkup(all, threshold) {
    var units = all.reduce(function (sum, product) { return sum + stockOf(product); }, 0);
    var value = all.reduce(function (sum, product) {
      return sum + (stockOf(product) * (Number(product.cost) || 0));
    }, 0);
    var low = all.filter(isLow).length;
    var out = all.filter(isOut).length;

    return '<div class="stat-grid">' +
      DH.ui.statCard({ label: 'Units on hand', value: format.number(units), hint: 'Across ' + all.length + ' products', icon: 'layers', tone: 'blue', trend: 'On hand', trendIcon: 'box' }) +
      DH.ui.statCard({ label: 'Stock value', value: format.currency(value), hint: 'Based on cost price', icon: 'wallet', tone: 'cyan', trend: 'Cost basis', trendIcon: 'dollar' }) +
      DH.ui.statCard({ label: 'Low stock', value: format.number(low), hint: 'At or below ' + threshold + ' units', icon: 'alert-triangle', tone: 'amber', trend: 'Reorder', trendIcon: 'trend-down' }) +
      DH.ui.statCard({ label: 'Out of stock', value: format.number(out), hint: 'Needs restocking', icon: 'x-circle', tone: 'navy', trend: 'Blocked', trendIcon: 'alert-triangle' }) +
    '</div>';
  }

  /* ---------- Rendering ---------- */

  function paint(view) {
    syncFromProducts();

    var all = products();
    var threshold = defaultThreshold();
    var list = visibleProducts();
    var low = all.filter(isLow).sort(function (a, b) { return stockOf(a) - stockOf(b); });
    var out = all.filter(isOut).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

    view.innerHTML =
      '<div class="view-toolbar">' +
        '<div class="toolbar-left">' +
          '<label class="field-search">' + icon('search', 17) +
            '<input id="stock-search" type="search" placeholder="Search stock by product or SKU" aria-label="Search inventory" value="' + escape(state.query) + '" autocomplete="off">' +
          '</label>' +
          '<label class="filter-select" for="stock-filter">' + icon('filter', 15) +
            '<select id="stock-filter" aria-label="Filter stock levels">' +
              '<option value="all"' + (state.filter === 'all' ? ' selected' : '') + '>All stock</option>' +
              '<option value="low"' + (state.filter === 'low' ? ' selected' : '') + '>Low stock</option>' +
              '<option value="out"' + (state.filter === 'out' ? ' selected' : '') + '>Out of stock</option>' +
            '</select>' +
            '<span class="filter-chevron" aria-hidden="true">' + icon('chevron-down', 14) + '</span>' +
          '</label>' +
        '</div>' +
        '<div class="toolbar-right">' +
          '<button class="btn btn-primary" type="button" data-stock-open="in">' + icon('plus', 17) + 'Stock in</button>' +
          '<button class="btn btn-ghost" type="button" data-stock-open="out">' + icon('minus', 17) + 'Stock out</button>' +
          '<button class="btn btn-ghost" type="button" data-stock-open="adjust">' + icon('sliders', 17) + 'Adjust stock</button>' +
        '</div>' +
      '</div>' +

      kpiMarkup(all, threshold) +

      '<div class="inventory-grid">' +
        stockTableMarkup(list, all.length) +
        '<div class="inventory-side">' +
          '<section class="card low-stock-card">' +
            '<header class="card-head">' +
              '<div><h3>Low stock alerts</h3><p>Reorder before you run out</p></div>' +
              '<span class="chip' + (low.length ? ' chip-warning' : '') + '">' +
                icon(low.length ? 'alert-triangle' : 'check-circle', 13) +
                (low.length ? low.length + ' items' : 'All clear') +
              '</span>' +
            '</header>' +
            '<div class="low-stock-list">' + alertList(low, 'All stocked up', 'Every product is above the reorder point.') + '</div>' +
          '</section>' +
          '<section class="card out-stock-card">' +
            '<header class="card-head">' +
              '<div><h3>Out of stock</h3><p>Products that cannot be sold</p></div>' +
              '<span class="chip' + (out.length ? ' chip-danger' : '') + '">' +
                icon(out.length ? 'x-circle' : 'check-circle', 13) +
                (out.length ? out.length + ' product' + (out.length === 1 ? '' : 's') : 'None') +
              '</span>' +
            '</header>' +
            '<div class="low-stock-list">' + alertList(out, 'Nothing is out of stock', 'Every product has units available.') + '</div>' +
          '</section>' +
        '</div>' +
      '</div>' +

      movementHistoryMarkup(movements());

    bindControls(view);
  }

  function refreshTable(view) {
    var all = products();
    var list = visibleProducts();
    var body = view.querySelector('#stock-table-body');
    var counter = view.querySelector('#stock-table-count');

    if (body) body.innerHTML = stockRowsMarkup(list, all.length);
    if (counter) {
      counter.innerHTML = icon('box', 13) + list.length + ' of ' + all.length;
    }
  }

  function bindControls(view) {
    var search = view.querySelector('#stock-search');
    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value;
        refreshTable(view);
      });
    }

    var filter = view.querySelector('#stock-filter');
    if (filter) {
      filter.addEventListener('change', function () {
        state.filter = filter.value;
        refreshTable(view);
      });
    }
  }

  /* ---------- Stock actions ---------- */

  function openStockModal(view, mode, productId) {
    var config = MODES[mode] || MODES.adjust;
    var list = sortedProducts();

    if (!list.length) {
      DH.toast('Add a product before changing stock.', 'warning');
      return;
    }

    var selected = productId || list[0].id;
    var options = list.map(function (product) {
      return { value: product.id, label: product.name + ' — ' + stockOf(product) + ' in stock' };
    });

    DH.modal.open({
      title: config.title,
      description: config.description,
      className: 'modal-lg',
      confirmLabel: config.confirm,
      danger: false,
      body:
        '<form id="stock-form" class="form-grid product-form" novalidate>' +
          DH.ui.formField({
            id: 'stock-product', name: 'product', label: 'Product', value: selected, required: true,
            type: 'select', options: options, full: true
          }) +
          DH.ui.formField({
            id: 'stock-quantity', name: 'quantity', label: config.label, value: '', required: true,
            type: 'number', step: '1', min: mode === 'adjust' ? 0 : 1, inputmode: 'numeric',
            placeholder: mode === 'adjust' ? 'Current quantity' : 'Units'
          }) +
          DH.ui.formField({
            id: 'stock-note', name: 'note', label: 'Reason / reference', value: '', full: true,
            placeholder: 'Optional, e.g. PO-2090 or damaged goods'
          }) +
          '<p class="stock-preview" id="stock-preview"></p>' +
          '<button class="sr-only" type="submit" tabindex="-1" aria-hidden="true">Save stock change</button>' +
        '</form>',
      onConfirm: function () {
        var form = document.getElementById('stock-form');
        if (!form) return false;
        var result = validateStock(form, mode);
        if (!result.valid) return false;
        applyStock(view, result);
        return true;
      }
    });

    var form = document.getElementById('stock-form');
    if (!form) return;

    function refreshPreview() {
      var preview = document.getElementById('stock-preview');
      if (!preview) return;
      var data = new FormData(form);
      var product = DH.store.collection('products').find(String(data.get('product') || ''));
      var quantity = Number(data.get('quantity'));
      if (!product || !isFinite(quantity)) {
        preview.innerHTML = icon('info', 15) + 'Pick a product and enter a quantity to preview the new stock level.';
        return;
      }

      var before = stockOf(product);
      var after = mode === 'in' ? before + quantity : (mode === 'out' ? before - quantity : quantity);
      var invalid = after < 0;

      preview.innerHTML = icon(invalid ? 'alert-triangle' : 'layers', 15) +
        '<span>New stock level <strong>' + (invalid ? '—' : format.number(after)) + '</strong>' +
        (invalid ? ' · stock cannot go below zero' : ' units') + '</span>' +
        '<span class="stock-preview-from">from ' + format.number(before) + ' on hand</span>';
      preview.classList.toggle('is-invalid', invalid);
    }

    form.addEventListener('input', function (event) {
      var field = event.target;
      if (field && field.name) DH.ui.setFieldError(form, field.name, '');
      refreshPreview();
    });
    form.addEventListener('change', refreshPreview);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var confirm = document.querySelector('[data-modal-confirm]');
      if (confirm) confirm.click();
    });

    refreshPreview();
    var quantityField = form.querySelector('[name="quantity"]');
    if (quantityField) window.setTimeout(function () { quantityField.focus(); }, 60);
  }

  function validateStock(form, mode) {
    var data = new FormData(form);
    var failed = false;

    function fail(name, message) {
      DH.ui.setFieldError(form, name, message);
      failed = true;
    }

    DH.ui.clearFieldErrors(form);

    var productId = String(data.get('product') || '');
    var product = DH.store.collection('products').find(productId);
    if (!product) fail('product', 'Choose a product.');

    var raw = String(data.get('quantity') || '').trim();
    var quantity = Number(raw);

    if (!raw) fail('quantity', 'Enter a quantity.');
    else if (!isFinite(quantity)) fail('quantity', 'Enter a valid quantity.');
    else if (!Number.isInteger(quantity)) fail('quantity', 'Quantity must be a whole number.');
    else if (mode === 'adjust' && quantity < 0) fail('quantity', 'Stock cannot be negative.');
    else if (mode !== 'adjust' && quantity <= 0) fail('quantity', 'Quantity must be at least 1.');

    var current = product ? stockOf(product) : 0;
    if (product && isFinite(quantity)) {
      if (mode === 'out' && quantity > current) {
        fail('quantity', 'Only ' + current + ' units are on hand.');
      }
      if (mode === 'in' && current + quantity > 100000) {
        fail('quantity', 'That quantity is too large for this catalog.');
      }
    }

    if (failed) {
      var first = form.querySelector('.is-invalid');
      if (first) first.focus();
      return { valid: false };
    }

    var after = mode === 'in' ? current + quantity : (mode === 'out' ? current - quantity : quantity);
    if (after < 0) {
      fail('quantity', 'Stock cannot go below zero.');
      return { valid: false };
    }

    return {
      valid: true,
      mode: mode,
      product: product,
      quantity: quantity,
      note: String(data.get('note') || '').trim(),
      before: current,
      after: after
    };
  }

  function applyStock(view, result) {
    var config = MODES[result.mode];
    var product = result.product;

    DH.store.collection('products').update(product.id, { stock: result.after });

    DH.store.collection('inventory').add({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      type: config.type,
      quantity: result.after - result.before,
      stockBefore: result.before,
      stockAfter: result.after,
      note: result.note || config.defaultNote,
      at: new Date().toISOString()
    });

    var delta = result.after - result.before;
    var sign = delta > 0 ? '+' : '−';
    logActivity(
      config.title,
      product.name + ' · ' + sign + Math.abs(delta) + ' units',
      delta > 0 ? 'success' : (delta < 0 ? 'warning' : 'neutral')
    );

    paint(view);

    DH.toast(
      product.name + ' · ' + sign + Math.abs(delta) + ' units (' + format.number(result.after) + ' on hand)',
      'success'
    );
  }

  function handleViewClick(event) {
    var view = event.currentTarget;

    var opener = event.target.closest('[data-stock-open]');
    if (opener) {
      event.preventDefault();
      openStockModal(view, opener.getAttribute('data-stock-open'), null);
      return;
    }

    var stockIn = event.target.closest('[data-stock-in]');
    if (stockIn) {
      event.preventDefault();
      openStockModal(view, 'in', stockIn.getAttribute('data-stock-in'));
      return;
    }

    var stockOut = event.target.closest('[data-stock-out]');
    if (stockOut) {
      event.preventDefault();
      openStockModal(view, 'out', stockOut.getAttribute('data-stock-out'));
      return;
    }

    var adjust = event.target.closest('[data-stock-adjust]');
    if (adjust) {
      event.preventDefault();
      openStockModal(view, 'adjust', adjust.getAttribute('data-stock-adjust'));
      return;
    }

    if (event.target.closest('[data-clear-filters]')) {
      event.preventDefault();
      state.query = '';
      state.filter = 'all';
      paint(view);
    }
  }

  /* ---------- View entry ---------- */

  function render(view) {
    if (!view.dataset.inventoryBound) {
      view.addEventListener('click', handleViewClick);
      view.dataset.inventoryBound = 'true';
    }
    paint(view);
  }

  DH.views.inventory = { id: 'inventory', render: render };

})(window);
