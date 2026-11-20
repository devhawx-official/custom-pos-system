/* ==========================================================================
   DevHawx POS — products.js
   Catalog management: searchable, filterable product table with validated
   add/edit forms and confirmed deletion. Every operation persists through
   DH.store and re-renders the view immediately.
   ========================================================================== */

(function (window) {
  'use strict';

  var DH = window.DH;
  var icon = DH.icon;
  var format = DH.format;
  var escape = DH.util.escapeHtml;

  var STATUSES = [
    { value: 'active', label: 'Active' },
    { value: 'draft', label: 'Draft' },
    { value: 'archived', label: 'Archived' }
  ];

  var STATUS_LABELS = { active: 'Active', draft: 'Draft', archived: 'Archived' };

  var state = {
    query: '',
    category: 'all'
  };

  /* ---------- Small helpers ---------- */

  function settings() {
    return DH.store.getSettings();
  }

  function threshold() {
    return Number(settings().lowStockThreshold) || 10;
  }

  function products() {
    return DH.store.collection('products').all();
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function initial(name) {
    var text = String(name || '?').trim();
    return text ? text.charAt(0).toUpperCase() : '?';
  }

  function statusKey(status) {
    var value = String(status || 'active').toLowerCase();
    return STATUS_LABELS[value] ? value : 'active';
  }

  function statusPill(status) {
    var key = statusKey(status);
    return '<span class="status-pill status-' + key + '">' + STATUS_LABELS[key] + '</span>';
  }

  function categoryNames() {
    var names = [];
    var seen = {};

    function push(value) {
      var name = String(value || '').trim();
      if (!name) return;
      var key = name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      names.push(name);
    }

    DH.store.collection('categories').all().forEach(function (category) {
      push(category.name);
    });
    products().forEach(function (product) {
      push(product.category);
    });

    return names.sort(function (a, b) {
      return a.localeCompare(b);
    });
  }

  function categoryRecord(name) {
    var wanted = String(name || '').trim().toLowerCase();
    var list = DH.store.collection('categories').all();
    for (var i = 0; i < list.length; i += 1) {
      if (String(list[i].name || '').trim().toLowerCase() === wanted) return list[i];
    }
    return null;
  }

  function categoryColor(name) {
    var category = categoryRecord(name);
    return category && category.color ? category.color : '#2F6BFF';
  }

  function ensureCategory(name) {
    var existing = categoryRecord(name);
    if (existing) return existing;

    var label = String(name || 'General').trim() || 'General';
    return DH.store.collection('categories').add({
      name: label,
      slug: slugify(label) || 'general',
      description: '',
      color: '#2F6BFF'
    });
  }

  function logActivity(title, detail, tone) {
    DH.store.collection('activity').add({
      type: 'product',
      title: title,
      detail: detail,
      tone: tone || 'info',
      at: new Date().toISOString()
    });
  }

  function emptyRow(total) {
    if (!total) {
      return '<tr><td colspan="8" class="table-empty">' +
        DH.ui.emptyState({
          icon: 'products',
          title: 'No products yet',
          text: 'Add your first catalog item to start selling. Pricing, stock and status are saved in this browser.',
          action: '<button class="btn btn-primary" type="button" data-product-add>' + icon('plus', 16) + 'Add your first product</button>'
        }) +
      '</td></tr>';
    }

    return '<tr><td colspan="8" class="table-empty">' +
      DH.ui.emptyState({
        icon: 'search',
        title: 'No products match',
        text: 'Try a different search term or category filter.',
        action: '<button class="btn btn-ghost" type="button" data-clear-filters>' + icon('refresh', 15) + 'Clear filters</button>'
      }) +
    '</td></tr>';
  }

  function productRow(product, limit) {
    var id = String(product.id || '');
    var name = String(product.name || 'Untitled product');
    var stock = Math.max(0, Math.round(Number(product.stock) || 0));
    var stockTone = stock === 0 ? ' is-out' : (stock <= limit ? ' is-low' : '');
    var stockFlag = stock === 0 ? 'Out' : (stock <= limit ? 'Low' : '');

    return '<tr data-product-row="' + escape(id) + '">' +
      '<td>' +
        '<div class="product-cell">' +
          '<span class="product-avatar" aria-hidden="true">' + escape(initial(name)) + '</span>' +
          '<span class="product-copy">' +
            '<strong>' + escape(name) + '</strong>' +
            '<small>' + icon('barcode', 12) + (product.barcode ? escape(product.barcode) : 'No barcode') + '</small>' +
          '</span>' +
        '</div>' +
      '</td>' +
      '<td><span class="sku-code">' + escape(product.sku || '—') + '</span></td>' +
      '<td><span class="category-chip"><span class="category-dot" style="background:' + escape(categoryColor(product.category)) + '"></span>' +
        escape(product.category || 'Uncategorised') + '</span></td>' +
      '<td class="align-right"><span class="price-cell">' + format.currency(product.cost) + '</span></td>' +
      '<td class="align-right"><span class="price-cell is-price">' + format.currency(product.price) + '</span></td>' +
      '<td class="align-right"><span class="stock-value' + stockTone + '">' + format.number(stock) +
        (stockFlag ? '<span class="stock-flag">' + stockFlag + '</span>' : '') + '</span></td>' +
      '<td>' + statusPill(product.status) + '</td>' +
      '<td class="cell-actions">' +
        '<div class="row-actions">' +
          '<button class="icon-btn row-action" type="button" data-product-edit="' + escape(id) + '" aria-label="Edit ' + escape(name) + '" title="Edit product">' + icon('edit', 16) + '</button>' +
          '<button class="icon-btn row-action is-danger" type="button" data-product-delete="' + escape(id) + '" aria-label="Delete ' + escape(name) + '" title="Delete product">' + icon('trash', 16) + '</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  function visibleProducts(all) {
    var query = state.query.trim().toLowerCase();
    var category = state.category.toLowerCase();

    return all.filter(function (product) {
      if (category !== 'all' && String(product.category || '').trim().toLowerCase() !== category) {
        return false;
      }
      if (!query) return true;
      return [product.name, product.sku, product.barcode].some(function (value) {
        return String(value || '').toLowerCase().indexOf(query) !== -1;
      });
    }).sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function countText(visible, total) {
    if (!total) return 'No products';
    if (visible === total) return total + (total === 1 ? ' product' : ' products');
    return visible + ' of ' + total + ' products';
  }

  function tableBody(list, total) {
    if (!list.length) return emptyRow(total);
    var limit = threshold();
    return list.map(function (product) {
      return productRow(product, limit);
    }).join('');
  }

  function filterOptions(selected) {
    return '<option value="all"' + (selected === 'all' ? ' selected' : '') + '>All categories</option>' +
      categoryNames().map(function (name) {
        return '<option value="' + escape(name) + '"' + (name === selected ? ' selected' : '') + '>' + escape(name) + '</option>';
      }).join('');
  }

  /* ---------- Catalog rendering ---------- */

  function paint(view) {
    var all = products();
    var names = categoryNames();
    var limit = threshold();

    if (state.category !== 'all' && names.indexOf(state.category) === -1) {
      state.category = 'all';
    }

    var list = visibleProducts(all);
    var active = all.filter(function (product) {
      return statusKey(product.status) === 'active';
    }).length;
    var lowStock = all.filter(function (product) {
      var stock = Number(product.stock) || 0;
      return stock > 0 && stock <= limit;
    }).length;

    view.innerHTML =
      '<div class="view-toolbar products-toolbar">' +
        '<div class="toolbar-left">' +
          '<label class="field-search products-search">' + icon('search', 17) +
            '<input id="product-search" type="search" placeholder="Search name, SKU or barcode" aria-label="Search products" value="' + escape(state.query) + '" autocomplete="off">' +
          '</label>' +
          '<label class="filter-select" for="product-filter">' + icon('filter', 15) +
            '<select id="product-filter" aria-label="Filter products by category">' + filterOptions(state.category) + '</select>' +
            '<span class="filter-chevron" aria-hidden="true">' + icon('chevron-down', 14) + '</span>' +
          '</label>' +
        '</div>' +
        '<div class="toolbar-right">' +
          '<span class="toolbar-count" id="product-count">' + countText(list.length, all.length) + '</span>' +
          '<button class="btn btn-primary" id="add-product" type="button" data-product-add>' + icon('plus', 17) + 'Add product</button>' +
        '</div>' +
      '</div>' +

      '<div class="stat-grid">' +
        DH.ui.statCard({ label: 'Total products', value: format.number(all.length), hint: 'Every item in the catalog', icon: 'products', tone: 'blue', trend: 'Catalog', trendIcon: 'box' }) +
        DH.ui.statCard({ label: 'Active', value: format.number(active), hint: 'Available for checkout', icon: 'check-circle', tone: 'emerald', trend: 'Live', trendIcon: 'check' }) +
        DH.ui.statCard({ label: 'Low stock', value: format.number(lowStock), hint: 'At or below ' + limit + ' units', icon: 'alert-triangle', tone: 'amber', trend: 'Watchlist', trendIcon: 'trend-down' }) +
        DH.ui.statCard({ label: 'Categories', value: format.number(names.length), hint: 'Used for filters', icon: 'tag', tone: 'cyan', trend: 'Grouping', trendIcon: 'layers' }) +
      '</div>' +

      DH.ui.table({
        className: 'products-table',
        bodyId: 'product-table-body',
        columns: [
          { label: 'Product' },
          { label: 'SKU' },
          { label: 'Category' },
          { label: 'Cost', align: 'right' },
          { label: 'Price', align: 'right' },
          { label: 'Stock', align: 'right' },
          { label: 'Status' },
          { label: '' }
        ],
        body: tableBody(list, all.length)
      });

    bindControls(view);
  }

  function refreshTable(view) {
    var all = products();
    var list = visibleProducts(all);
    var body = view.querySelector('#product-table-body');
    var count = view.querySelector('#product-count');

    if (body) body.innerHTML = tableBody(list, all.length);
    if (count) count.textContent = countText(list.length, all.length);
  }

  function bindControls(view) {
    var search = view.querySelector('#product-search');
    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value;
        refreshTable(view);
      });
    }

    var filter = view.querySelector('#product-filter');
    if (filter) {
      filter.addEventListener('change', function () {
        state.category = filter.value;
        refreshTable(view);
      });
    }
  }

  function handleViewClick(event) {
    var view = event.currentTarget;

    if (event.target.closest('[data-product-add]')) {
      event.preventDefault();
      openProductForm(view, null);
      return;
    }

    if (event.target.closest('[data-clear-filters]')) {
      event.preventDefault();
      state.query = '';
      state.category = 'all';
      paint(view);
      return;
    }

    var edit = event.target.closest('[data-product-edit]');
    if (edit) {
      event.preventDefault();
      var product = DH.store.collection('products').find(edit.getAttribute('data-product-edit'));
      if (product) openProductForm(view, product);
      return;
    }

    var remove = event.target.closest('[data-product-delete]');
    if (remove) {
      event.preventDefault();
      var target = DH.store.collection('products').find(remove.getAttribute('data-product-delete'));
      if (target) confirmDelete(view, target);
    }
  }

  /* ---------- Product form ---------- */

  function setError(form, name, message) {
    DH.ui.setFieldError(form, name, message);
  }

  function clearErrors(form) {
    DH.ui.clearFieldErrors(form);
  }

  function validateProduct(form, currentId) {
    var data = new FormData(form);
    var all = products();
    var failed = false;

    function fail(name, message) {
      setError(form, name, message);
      failed = true;
    }

    clearErrors(form);

    var name = String(data.get('name') || '').trim();
    var sku = String(data.get('sku') || '').trim();
    var barcode = String(data.get('barcode') || '').trim();
    var category = String(data.get('category') || '').trim();
    var costRaw = String(data.get('cost') || '').trim();
    var priceRaw = String(data.get('price') || '').trim();
    var stockRaw = String(data.get('stock') || '').trim();
    var status = String(data.get('status') || 'active').toLowerCase();

    if (!name) fail('name', 'Product name is required.');
    else if (name.length > 80) fail('name', 'Keep the product name under 80 characters.');

    if (!sku) fail('sku', 'SKU is required.');
    else if (all.some(function (product) {
      return product.id !== currentId && String(product.sku || '').trim().toLowerCase() === sku.toLowerCase();
    })) {
      fail('sku', 'This SKU is already used by another product.');
    }

    if (barcode && all.some(function (product) {
      return product.id !== currentId && String(product.barcode || '').trim().toLowerCase() === barcode.toLowerCase();
    })) {
      fail('barcode', 'This barcode is already assigned to another product.');
    }

    if (!category) fail('category', 'Choose a product category.');

    var cost = Number(costRaw);
    if (!costRaw) fail('cost', 'Purchase price is required.');
    else if (!isFinite(cost) || cost < 0) fail('cost', 'Enter a purchase price of 0 or more.');

    var price = Number(priceRaw);
    if (!priceRaw) fail('price', 'Selling price is required.');
    else if (!isFinite(price) || price < 0) fail('price', 'Enter a selling price of 0 or more.');

    var stock = Number(stockRaw);
    if (!stockRaw) fail('stock', 'Stock quantity is required.');
    else if (!isFinite(stock) || stock < 0) fail('stock', 'Enter a stock quantity of 0 or more.');
    else if (!Number.isInteger(stock)) fail('stock', 'Stock must be a whole number.');

    if (!STATUS_LABELS[status]) fail('status', 'Choose a valid product status.');

    if (failed) {
      var first = form.querySelector('.is-invalid');
      if (first) first.focus();
      return { valid: false };
    }

    return {
      valid: true,
      values: {
        name: name,
        sku: sku,
        barcode: barcode,
        category: category,
        cost: cost,
        price: price,
        stock: stock,
        status: status
      }
    };
  }

  function saveProduct(view, values, editingId) {
    var collection = DH.store.collection('products');
    var category = ensureCategory(values.category);
    var payload = {
      name: values.name,
      sku: values.sku,
      barcode: values.barcode,
      category: category.name,
      categoryId: category.id,
      cost: values.cost,
      price: values.price,
      stock: values.stock,
      status: values.status
    };

    if (editingId) {
      collection.update(editingId, payload);
      logActivity('Product updated', values.name + ' · ' + values.sku, 'neutral');
      DH.toast('“' + values.name + '” updated.', 'success');
    } else {
      collection.add(payload);
      logActivity('Product added', values.name + ' · ' + values.sku, 'success');
      DH.toast('“' + values.name + '” added to the catalog.', 'success');
    }

    paint(view);
  }

  function openProductForm(view, product) {
    var editing = !!product;
    var names = categoryNames();
    if (!names.length) names = ['General'];

    var selectedCategory = product && product.category ? product.category : names[0];
    if (names.indexOf(selectedCategory) === -1) names.push(selectedCategory);

    var values = {
      name: product ? product.name : '',
      sku: product ? product.sku : '',
      barcode: product ? product.barcode : '',
      category: selectedCategory,
      cost: product && product.cost !== undefined ? product.cost : '',
      price: product && product.price !== undefined ? product.price : '',
      stock: product && product.stock !== undefined ? product.stock : '',
      status: statusKey(product && product.status)
    };

    DH.modal.open({
      title: editing ? 'Edit product' : 'Add product',
      description: editing
        ? 'Update catalog details, pricing or stock. Changes save to this browser.'
        : 'Create a catalog item with pricing, stock and availability.',
      className: 'modal-lg',
      confirmLabel: editing ? 'Save changes' : 'Add product',
      danger: false,
      body:
        '<form id="product-form" class="form-grid product-form" novalidate>' +
          DH.ui.formField({ id: 'product-name', name: 'name', label: 'Product name', value: values.name, required: true, full: true, placeholder: 'e.g. Aurora Espresso Blend' }) +
          DH.ui.formField({ id: 'product-sku', name: 'sku', label: 'SKU', value: values.sku, required: true, placeholder: 'BEV-1042' }) +
          DH.ui.formField({ id: 'product-barcode', name: 'barcode', label: 'Barcode', value: values.barcode, placeholder: 'Optional', inputmode: 'numeric' }) +
          DH.ui.formField({ id: 'product-category', name: 'category', label: 'Category', value: values.category, required: true, type: 'select',
            options: names.map(function (name) { return { value: name, label: name }; }) }) +
          DH.ui.formField({ id: 'product-cost', name: 'cost', label: 'Purchase price', value: values.cost, required: true, type: 'number', step: '0.01', min: 0, inputmode: 'decimal' }) +
          DH.ui.formField({ id: 'product-price', name: 'price', label: 'Selling price', value: values.price, required: true, type: 'number', step: '0.01', min: 0, inputmode: 'decimal' }) +
          DH.ui.formField({ id: 'product-stock', name: 'stock', label: 'Stock quantity', value: values.stock, required: true, type: 'number', step: '1', min: 0, inputmode: 'numeric' }) +
          DH.ui.formField({ id: 'product-status', name: 'status', label: 'Product status', value: values.status, type: 'select', options: STATUSES }) +
          '<p class="product-form-note">' + icon('shield', 14) + 'All product data is stored locally in this browser.</p>' +
          '<button class="sr-only" type="submit" tabindex="-1" aria-hidden="true">Save product</button>' +
        '</form>',
      onConfirm: function () {
        var form = document.getElementById('product-form');
        if (!form) return false;
        var result = validateProduct(form, editing ? product.id : null);
        if (!result.valid) return false;
        saveProduct(view, result.values, editing ? product.id : null);
        return true;
      }
    });

    var form = document.getElementById('product-form');
    if (!form) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var confirm = document.querySelector('[data-modal-confirm]');
      if (confirm) confirm.click();
    });

    function clearFieldError(event) {
      var field = event.target;
      if (field && field.name) setError(form, field.name, '');
    }
    form.addEventListener('input', clearFieldError);
    form.addEventListener('change', clearFieldError);

    var first = form.querySelector('[name="name"]');
    if (first) window.setTimeout(function () { first.focus(); }, 60);
  }

  function confirmDelete(view, product) {
    var name = String(product.name || 'this product');
    DH.modal.open({
      title: 'Delete product?',
      description: '“' + name + '” will be removed from the catalog. Past sales keep their receipt history.',
      confirmLabel: 'Delete product',
      cancelLabel: 'Keep product',
      onConfirm: function () {
        DH.store.collection('products').remove(product.id);
        logActivity('Product deleted', name + ' · ' + (product.sku || 'no SKU'), 'warning');
        paint(view);
        DH.toast('“' + name + '” deleted from the catalog.', 'success');
        return true;
      }
    });
  }

  /* ---------- View entry ---------- */

  function render(view) {
    if (!view.dataset.productsBound) {
      view.addEventListener('click', handleViewClick);
      view.dataset.productsBound = 'true';
    }
    paint(view);
  }

  DH.views.products = { id: 'products', render: render };

})(window);
