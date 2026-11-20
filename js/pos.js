/* ==========================================================================
   DevHawx POS — pos.js
   Point of sale terminal: tappable product grid on the left, live cart and
   checkout summary on the right. The cart lives in localStorage so a sale
   survives a refresh, and completing a sale writes the receipt, the stock
   movements and the activity feed.
   ========================================================================== */

(function (window) {
  'use strict';

  var DH = window.DH;
  var icon = DH.icon;
  var format = DH.format;
  var escape = DH.util.escapeHtml;

  var state = {
    query: '',
    category: 'all'
  };

  /* Guards against a double submit creating the same transaction twice. */
  var submitting = false;

  var PAYMENTS = [
    { value: 'Cash', label: 'Cash', icon: 'wallet' },
    { value: 'Card', label: 'Card', icon: 'card' },
    { value: 'Other', label: 'Other', icon: 'more' }
  ];

  /* ---------- Data helpers ---------- */

  function settings() {
    return DH.store.getSettings();
  }

  function taxRate() {
    return Number(settings().taxRate) || 0;
  }

  function products() {
    return DH.store.collection('products').all();
  }

  function activeProducts() {
    return products().filter(function (product) {
      return String(product.status || 'active').toLowerCase() === 'active';
    });
  }

  function findProduct(id) {
    return DH.store.collection('products').find(id);
  }

  function stockOf(product) {
    return Math.max(0, Math.round(Number(product && product.stock) || 0));
  }

  function categoryNames() {
    var names = [];
    var seen = {};

    DH.store.collection('categories').all().forEach(function (category) {
      var name = String(category.name || '').trim();
      if (!name || seen[name.toLowerCase()]) return;
      seen[name.toLowerCase()] = true;
      names.push(name);
    });

    activeProducts().forEach(function (product) {
      var name = String(product.category || '').trim();
      if (!name || seen[name.toLowerCase()]) return;
      seen[name.toLowerCase()] = true;
      names.push(name);
    });

    return names;
  }

  function cartItems() {
    var items = DH.store.collection('cart').all();
    if (!Array.isArray(items)) return [];

    /* Drop lines whose product no longer exists in the catalog. */
    return items.filter(function (item) {
      return item && item.productId && findProduct(item.productId);
    });
  }

  function saveCart(items) {
    DH.store.collection('cart').replaceAll(items);
  }

  function discountPercent() {
    var value = Number(DH.store.getData(DH.store.KEYS.cartDiscount, 0));
    if (!isFinite(value) || value <= 0) return 0;
    return Math.min(100, Math.round(value * 100) / 100);
  }

  function setDiscount(percent) {
    var value = Number(percent);
    if (!isFinite(value) || value < 0) value = 0;
    DH.store.saveData(DH.store.KEYS.cartDiscount, Math.min(100, Math.round(value * 100) / 100));
  }

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function cartTotals(items) {
    var subtotal = 0;
    var units = 0;

    items.forEach(function (item) {
      subtotal += (Number(item.price) || 0) * (Number(item.quantity) || 0);
      units += Number(item.quantity) || 0;
    });

    subtotal = round2(subtotal);

    var percent = discountPercent();
    var discountAmount = round2(subtotal * (percent / 100));
    var taxable = round2(subtotal - discountAmount);
    var tax = round2(taxable * (taxRate() / 100));
    var total = round2(taxable + tax);

    return {
      subtotal: subtotal,
      percent: percent,
      discount: discountAmount,
      taxable: taxable,
      tax: tax,
      total: total,
      units: units,
      lines: items.length
    };
  }

  /* ---------- Markup ---------- */

  function categoriesMarkup() {
    var names = categoryNames();

    return '<button class="chip-btn' + (state.category === 'all' ? ' is-active' : '') + '" type="button" data-category="all">All items</button>' +
      names.map(function (name) {
        return '<button class="chip-btn' + (state.category === name ? ' is-active' : '') +
          '" type="button" data-category="' + escape(name) + '">' + escape(name) + '</button>';
      }).join('');
  }

  function tileMarkup(product) {
    var stock = stockOf(product);
    var out = stock === 0;
    var low = !out && stock <= 10;
    var stockLabel = out ? 'Out' : (low ? stock + ' left' : stock + ' in stock');

    return '<button class="pos-tile' + (out ? ' is-disabled' : '') + '" type="button" ' +
        'data-add-product="' + escape(product.id) + '"' +
        (out ? ' aria-disabled="true"' : '') +
        ' aria-label="Add ' + escape(product.name) + ' to the cart">' +
      '<span class="pos-tile-top">' +
        '<span class="pos-tile-name">' + escape(product.name) + '</span>' +
        '<span class="pos-tile-stock' + (out ? ' is-out' : (low ? ' is-low' : '')) + '">' + escape(stockLabel) + '</span>' +
      '</span>' +
      '<span class="pos-tile-sku">' + escape(product.sku || 'No SKU') + '</span>' +
      '<span class="pos-tile-foot">' +
        '<span class="pos-tile-price">' + format.currency(product.price) + '</span>' +
        '<span class="pos-tile-add" aria-hidden="true">' + icon('plus', 15) + '</span>' +
      '</span>' +
    '</button>';
  }

  function visibleProducts() {
    var query = state.query.trim().toLowerCase();
    var category = state.category.toLowerCase();

    return activeProducts().filter(function (product) {
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

  function gridMarkup() {
    var list = visibleProducts();

    if (!list.length) {
      return '<div class="pos-empty">' +
        DH.ui.emptyState({
          icon: 'search',
          title: 'No products found',
          text: 'Try another search term or pick a different category.'
        }) +
      '</div>';
    }

    return list.map(tileMarkup).join('');
  }

  function cartItemMarkup(item) {
    var product = findProduct(item.productId);
    var available = product ? stockOf(product) : 0;
    var quantity = Number(item.quantity) || 0;

    return '<li class="cart-item" data-cart-item="' + escape(item.productId) + '">' +
      '<div class="cart-item-row">' +
        '<span class="cart-item-copy">' +
          '<strong>' + escape(item.name || (product ? product.name : 'Removed product')) + '</strong>' +
          '<span>' + escape(item.sku || 'No SKU') + ' · ' + format.currency(item.price) + ' each' +
            (available ? ' · ' + available + ' in stock' : '') +
          '</span>' +
        '</span>' +
        '<button class="icon-btn cart-item-remove" type="button" data-cart-remove="' + escape(item.productId) +
          '" aria-label="Remove ' + escape(item.name || 'product') + ' from the cart" title="Remove">' + icon('trash', 15) + '</button>' +
      '</div>' +
      '<div class="cart-item-row">' +
        '<span class="qty-stepper">' +
          '<button class="qty-btn" type="button" data-cart-dec="' + escape(item.productId) + '" aria-label="Decrease quantity of ' + escape(item.name || 'product') + '">' + icon('minus', 14) + '</button>' +
          '<span class="qty-value">' + format.number(quantity) + '</span>' +
          '<button class="qty-btn" type="button" data-cart-inc="' + escape(item.productId) + '" aria-label="Increase quantity of ' + escape(item.name || 'product') + '"' +
            (available && quantity >= available ? ' disabled' : '') + '>' + icon('plus', 14) + '</button>' +
        '</span>' +
        '<span class="cart-item-total">' + format.currency((Number(item.price) || 0) * quantity) + '</span>' +
      '</div>' +
    '</li>';
  }

  function cartItemsMarkup(items) {
    if (!items.length) {
      return '<div class="cart-empty">' +
        '<span class="empty-icon">' + icon('pos', 24) + '</span>' +
        '<h3>Cart is empty</h3>' +
        '<p>Tap a product to start this sale.</p>' +
      '</div>';
    }

    return '<ul class="cart-list">' + items.map(cartItemMarkup).join('') + '</ul>';
  }

  function totalsMarkup(totals) {
    return '<div class="cart-row"><span>Subtotal (' + format.number(totals.units) + ' items)</span>' +
        '<span>' + format.currency(totals.subtotal) + '</span></div>' +
      (totals.percent
        ? '<div class="cart-row discount"><span>Discount (' + format.percent(totals.percent) + ')</span>' +
          '<span>−' + format.currency(totals.discount) + '</span></div>'
        : '') +
      '<div class="cart-row"><span>Tax (' + escape(format.percent(taxRate())) + ')</span>' +
        '<span>' + format.currency(totals.tax) + '</span></div>' +
      '<div class="cart-row total"><span>Total</span><span>' + format.currency(totals.total) + '</span></div>';
  }

  /* ---------- Rendering ---------- */

  function refreshCatalog(view) {
    var grid = view.querySelector('#pos-grid');
    var counter = view.querySelector('#pos-result-count');
    var list = visibleProducts();

    if (grid) grid.innerHTML = gridMarkup();
    if (counter) {
      counter.textContent = list.length + (list.length === 1 ? ' product' : ' products');
    }
  }

  function refreshCart(view) {
    var items = cartItems();
    var totals = cartTotals(items);

    var list = view.querySelector('#cart-items');
    var totalsBox = view.querySelector('#cart-totals');
    var count = view.querySelector('#cart-count');
    var charge = view.querySelector('#charge-sale');
    var chargeLabel = view.querySelector('#charge-label');
    var clear = view.querySelector('#clear-cart');
    var input = view.querySelector('#discount-input');

    if (list) list.innerHTML = cartItemsMarkup(items);
    if (totalsBox) totalsBox.innerHTML = totalsMarkup(totals);
    if (count) count.textContent = totals.units + (totals.units === 1 ? ' item' : ' items');
    if (charge) charge.disabled = !items.length;
    if (chargeLabel) chargeLabel.textContent = 'Charge ' + format.currency(totals.total);
    if (clear) clear.disabled = !items.length;

    if (input && document.activeElement !== input) input.value = totals.percent;

    view.querySelectorAll('.discount-chip').forEach(function (chip) {
      var value = Number(chip.getAttribute('data-discount'));
      chip.classList.toggle('is-active', Math.abs(value - totals.percent) < 0.001);
    });
  }

  function paint(view) {
    view.innerHTML =
      '<div class="pos-layout">' +
        '<section class="card pos-catalog" aria-label="Product catalog">' +
          '<div class="pos-search-row">' +
            '<label class="field-search">' + icon('search', 17) +
              '<input id="pos-search" type="search" placeholder="Search by product name, SKU or barcode" aria-label="Search products for the sale" autocomplete="off" value="' + escape(state.query) + '">' +
            '</label>' +
            '<span class="pos-result-count" id="pos-result-count"></span>' +
          '</div>' +
          '<div class="chip-row" id="pos-categories" role="group" aria-label="Product categories">' + categoriesMarkup() + '</div>' +
          '<div class="pos-grid" id="pos-grid"></div>' +
        '</section>' +

        '<aside class="card pos-cart" aria-label="Current sale">' +
          '<div class="cart-head">' +
            '<h3>Current sale</h3>' +
            '<span class="chip chip-muted" id="cart-count">0 items</span>' +
          '</div>' +
          '<div class="cart-items" id="cart-items"></div>' +
          '<div class="cart-summary">' +
            '<div class="cart-discount">' +
              '<div class="cart-row">' +
                '<span>Discount</span>' +
                '<span class="discount-input-wrap">' +
                  '<input class="discount-input" id="discount-input" type="number" min="0" max="100" step="1" inputmode="numeric" aria-label="Discount percentage">' +
                  '<span class="discount-suffix">%</span>' +
                  '<button class="btn btn-ghost discount-apply" id="discount-apply" type="button">Apply</button>' +
                '</span>' +
              '</div>' +
              '<div class="discount-chips" role="group" aria-label="Quick discounts">' +
                '<button class="discount-chip" type="button" data-discount="0">None</button>' +
                '<button class="discount-chip" type="button" data-discount="5">5%</button>' +
                '<button class="discount-chip" type="button" data-discount="10">10%</button>' +
                '<button class="discount-chip" type="button" data-discount="15">15%</button>' +
                '<button class="discount-chip" type="button" data-discount="20">20%</button>' +
              '</div>' +
            '</div>' +
            '<div class="cart-totals" id="cart-totals"></div>' +
          '</div>' +
          '<div class="cart-actions">' +
            '<button class="btn btn-primary btn-block" id="charge-sale" type="button" disabled>' + icon('card', 17) + '<span id="charge-label">Charge $0.00</span></button>' +
            '<button class="btn btn-ghost btn-block" id="clear-cart" type="button" disabled>' + icon('trash', 16) + 'Clear cart</button>' +
          '</div>' +
        '</aside>' +
      '</div>';

    refreshCatalog(view);
    refreshCart(view);

    var search = view.querySelector('#pos-search');
    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value;
        refreshCatalog(view);
      });
      search.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        var list = visibleProducts();
        if (list.length) addToCart(view, list[0].id);
      });
    }

    var apply = view.querySelector('#discount-apply');
    if (apply) {
      apply.addEventListener('click', function () {
        var input = view.querySelector('#discount-input');
        setDiscount(input ? input.value : 0);
        refreshCart(view);
      });
    }

    var discountInput = view.querySelector('#discount-input');
    if (discountInput) {
      discountInput.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        setDiscount(discountInput.value);
        refreshCart(view);
      });
    }
  }

  /* ---------- Cart actions ---------- */

  function addToCart(view, productId) {
    var product = findProduct(productId);
    if (!product) return;

    var available = stockOf(product);
    var items = cartItems();
    var line = null;

    for (var i = 0; i < items.length; i += 1) {
      if (items[i].productId === productId) { line = items[i]; break; }
    }

    var quantity = line ? Number(line.quantity) || 0 : 0;

    if (available <= 0) {
      DH.toast(product.name + ' is out of stock.', 'warning');
      return;
    }
    if (quantity + 1 > available) {
      DH.toast('Only ' + available + ' unit' + (available === 1 ? '' : 's') + ' of ' + product.name + ' left.', 'warning');
      return;
    }

    /* A brand new sale starts with the store's default discount, if enabled. */
    if (!items.length) {
      var config = settings();
      if (config.applyDefaultDiscount) {
        setDiscount(Number(config.defaultDiscount) || 0);
      }
    }

    if (line) {
      line.quantity = quantity + 1;
    } else {
      items.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        price: Number(product.price) || 0,
        cost: Number(product.cost) || 0,
        quantity: 1
      });
    }

    saveCart(items);
    refreshCart(view);
    flashTile(view, productId);
  }

  function changeQuantity(view, productId, delta) {
    var items = cartItems();
    var line = null;

    for (var i = 0; i < items.length; i += 1) {
      if (items[i].productId === productId) { line = items[i]; break; }
    }
    if (!line) return;

    var product = findProduct(productId);
    var available = product ? stockOf(product) : 0;
    var quantity = Number(line.quantity) || 0;

    if (delta > 0) {
      if (quantity + 1 > available) {
        DH.toast('Only ' + available + ' unit' + (available === 1 ? '' : 's') + ' of ' + (product ? product.name : 'this product') + ' left.', 'warning');
        return;
      }
      line.quantity = quantity + 1;
    } else {
      if (quantity <= 1) {
        items = items.filter(function (item) { return item.productId !== productId; });
      } else {
        line.quantity = quantity - 1;
      }
    }

    saveCart(items);
    refreshCart(view);
  }

  function removeLine(view, productId) {
    var items = cartItems().filter(function (item) {
      return item.productId !== productId;
    });
    saveCart(items);
    refreshCart(view);
  }

  function clearCart(view) {
    var items = cartItems();
    if (!items.length) return;

    DH.modal.open({
      title: 'Clear the cart?',
      description: 'This removes all ' + items.length + ' line' + (items.length === 1 ? '' : 's') + ' from the current sale.',
      confirmLabel: 'Clear cart',
      cancelLabel: 'Keep sale',
      onConfirm: function () {
        saveCart([]);
        setDiscount(0);
        refreshCart(view);
        DH.toast('Cart cleared.', 'info');
        return true;
      }
    });
  }

  function flashTile(view, productId) {
    var tile = view.querySelector('[data-add-product="' + productId + '"]');
    if (!tile) return;
    tile.classList.add('is-added');
    window.setTimeout(function () { tile.classList.remove('is-added'); }, 380);
  }

  /* ---------- Checkout ---------- */

  function pad(value, length) {
    var text = String(value);
    while (text.length < length) text = '0' + text;
    return text;
  }

  function nextReceiptNumber() {
    var prefix = settings().receiptPrefix || 'INV';
    var highest = 0;
    var taken = {};

    DH.store.collection('sales').all().forEach(function (sale) {
      var receipt = String(sale.receipt || '');
      taken[receipt] = true;
      var match = receipt.match(/(\d+)\s*$/);
      if (match) {
        var value = Number(match[1]);
        if (value > highest) highest = value;
      }
    });

    var counter = highest + 1;
    var receipt;
    do {
      receipt = prefix + '-' + counter;
      counter += 1;
    } while (taken[receipt]);

    return receipt;
  }

  /** Unique, human readable transaction id for the sale record. */
  function nextTransactionId() {
    var sales = DH.store.collection('sales').all();
    var taken = {};

    sales.forEach(function (sale) {
      if (sale.transactionId) taken[sale.transactionId] = true;
    });

    var counter = sales.length + 1;
    var id;
    do {
      id = 'TXN-' + pad(counter, 5);
      counter += 1;
    } while (taken[id]);

    return id;
  }

  /** Lines that no longer have enough stock to be sold. */
  function stockIssues(items) {
    var issues = [];

    items.forEach(function (item) {
      var product = findProduct(item.productId);
      var wanted = Number(item.quantity) || 0;
      var available = product ? stockOf(product) : 0;

      if (!product) {
        issues.push({ name: item.name || 'Removed product', wanted: wanted, available: 0 });
        return;
      }
      if (wanted > available) {
        issues.push({ name: product.name, wanted: wanted, available: available });
      }
    });

    return issues;
  }

  function createCustomer(name, phone, email) {
    var now = new Date().toISOString();
    return DH.store.collection('customers').add({
      name: name,
      email: email || '',
      phone: phone || '',
      tier: 'Member',
      orders: 0,
      visits: 0,
      totalSpent: 0,
      joinedAt: now,
      lastVisit: null
    });
  }

  function openChargeModal(view) {
    var items = cartItems();
    if (!items.length) return;

    var totals = cartTotals(items);
    var customers = DH.store.collection('customers').all();

    DH.modal.open({
      title: 'Charge ' + format.currency(totals.total),
      description: 'Choose a payment method and confirm who the sale is for.',
      className: 'modal-lg',
      confirmLabel: 'Complete sale',
      danger: false,
      body:
        '<div id="charge-panel">' +
          '<p class="charge-alert" id="charge-alert" hidden></p>' +
          '<div class="charge-summary">' +
            '<div class="charge-lines">' +
              items.map(function (item) {
                return '<div class="charge-line">' +
                  '<span>' + escape(item.name) + ' × ' + format.number(item.quantity) + '</span>' +
                  '<span>' + format.currency((Number(item.price) || 0) * (Number(item.quantity) || 0)) + '</span>' +
                '</div>';
              }).join('') +
            '</div>' +
            '<div class="charge-totals">' +
              '<div class="cart-row"><span>Subtotal</span><span>' + format.currency(totals.subtotal) + '</span></div>' +
              (totals.percent
                ? '<div class="cart-row discount"><span>Discount (' + format.percent(totals.percent) + ')</span><span>−' + format.currency(totals.discount) + '</span></div>'
                : '') +
              '<div class="cart-row"><span>Tax (' + escape(format.percent(taxRate())) + ')</span><span>' + format.currency(totals.tax) + '</span></div>' +
              '<div class="cart-row total"><span>Total</span><span>' + format.currency(totals.total) + '</span></div>' +
            '</div>' +
          '</div>' +

          '<p class="charge-label">Payment method</p>' +
          '<div class="pay-options" role="group" aria-label="Payment method">' +
            PAYMENTS.map(function (method, index) {
              return '<button class="pay-option' + (index === 0 ? ' is-active' : '') + '" type="button" data-payment="' + method.value + '" aria-pressed="' + (index === 0) + '">' +
                icon(method.icon, 18) + '<span>' + method.label + '</span></button>';
            }).join('') +
          '</div>' +

          '<div class="cash-block" id="cash-block">' +
            DH.ui.formField({
              id: 'cash-received', name: 'cashReceived', label: 'Amount received', value: '', required: true,
              type: 'number', step: '0.01', min: 0, inputmode: 'decimal', placeholder: '0.00'
            }) +
            '<p class="cash-change" id="cash-change"></p>' +
          '</div>' +

          DH.ui.formField({
            id: 'charge-customer', name: 'customer', label: 'Customer', value: '', type: 'select', full: true,
            options: [{ value: '', label: 'Walk-in customer' }]
              .concat(customers.map(function (customer) {
                return { value: customer.id, label: customer.name };
              }))
              .concat([{ value: '__new__', label: '＋ Add walk-in customer…' }])
          }) +

          '<div class="new-customer-block" id="new-customer-block" hidden>' +
            DH.ui.formField({
              id: 'new-customer-name', name: 'customerName', label: 'Customer name', value: '',
              required: true, placeholder: 'e.g. Jordan Lee'
            }) +
            DH.ui.formField({
              id: 'new-customer-phone', name: 'customerPhone', label: 'Phone', value: '', inputmode: 'tel',
              placeholder: 'Optional'
            }) +
            DH.ui.formField({
              id: 'new-customer-email', name: 'customerEmail', label: 'Email', value: '', type: 'email',
              placeholder: 'Optional'
            }) +
          '</div>' +
        '</div>',
      onConfirm: function () {
        if (submitting) return false;

        var panel = document.getElementById('charge-panel');
        /* A second submit after the dialog closed must never run again. */
        if (!panel) return false;

        var active = document.querySelector('.pay-option.is-active');
        var payment = active ? active.getAttribute('data-payment') : 'Cash';
        var customerSelect = document.getElementById('charge-customer');
        var customerId = customerSelect ? customerSelect.value : '';

        var failed = false;
        var alert = document.getElementById('charge-alert');

        function fail(name, message) {
          DH.ui.setFieldError(panel, name, message);
          failed = true;
        }

        DH.ui.clearFieldErrors(panel);
        if (alert) { alert.hidden = true; alert.textContent = ''; }

        var issues = stockIssues(items);
        if (issues.length) {
          var message = issues.map(function (issue) {
            return issue.name + ' (' + issue.available + ' left, ' + issue.wanted + ' needed)';
          }).join(', ');
          if (alert) {
            alert.hidden = false;
            alert.textContent = 'Not enough stock to complete this sale: ' + message + '.';
          }
          DH.toast('Not enough stock to complete this sale.', 'error');
          failed = true;
        }

        var received = 0;
        var amountField = document.getElementById('cash-received');
        if (payment === 'Cash') {
          var raw = amountField ? String(amountField.value).trim() : '';
          received = Number(raw);
          if (!raw) fail('cashReceived', 'Enter the amount received.');
          else if (!isFinite(received) || received < 0) fail('cashReceived', 'Enter a valid amount.');
          else if (round2(received) < totals.total) {
            fail('cashReceived', 'Amount received is less than the total due (' + format.currency(totals.total) + ').');
          }
        }

        var newCustomer = null;
        if (customerId === '__new__') {
          var nameField = document.getElementById('new-customer-name');
          var phoneField = document.getElementById('new-customer-phone');
          var emailField = document.getElementById('new-customer-email');
          var name = nameField ? nameField.value.trim() : '';
          var phone = phoneField ? phoneField.value.trim() : '';
          var email = emailField ? emailField.value.trim() : '';

          if (!name) fail('customerName', 'Enter the customer name.');
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('customerEmail', 'Enter a valid email address.');
          if (!failed) newCustomer = { name: name, phone: phone, email: email };
        }

        if (failed) {
          var first = panel.querySelector('.is-invalid');
          if (first) first.focus();
          return false;
        }

        submitting = true;
        try {
          completeSale(view, payment, customerId, newCustomer, received);
        } finally {
          submitting = false;
        }
        return true;
      }
    });

    var options = document.querySelectorAll('.pay-option');
    var cashBlock = document.getElementById('cash-block');
    var amountInput = document.getElementById('cash-received');
    var changeOutput = document.getElementById('cash-change');
    var customerSelect = document.getElementById('charge-customer');
    var newCustomerBlock = document.getElementById('new-customer-block');

    function updateChange() {
      if (!changeOutput || !amountInput) return;
      var raw = String(amountInput.value).trim();
      var received = Number(raw);

      if (!raw) {
        changeOutput.classList.remove('is-invalid');
        changeOutput.innerHTML = 'Enter the amount handed over to calculate the change.';
        return;
      }
      if (!isFinite(received) || round2(received) < totals.total) {
        changeOutput.classList.add('is-invalid');
        changeOutput.innerHTML = 'Amount received is less than the total due (' + format.currency(totals.total) + ').';
        return;
      }
      changeOutput.classList.remove('is-invalid');
      changeOutput.innerHTML = 'Change due <strong>' + format.currency(round2(received - totals.total)) + '</strong>';
    }

    function applyPayment(method) {
      var cash = method === 'Cash';
      if (cashBlock) cashBlock.hidden = !cash;
      if (cash && amountInput) {
        if (!amountInput.value) amountInput.value = totals.total.toFixed(2);
        updateChange();
      }
    }

    Array.prototype.forEach.call(options, function (option) {
      option.addEventListener('click', function () {
        Array.prototype.forEach.call(options, function (other) {
          other.classList.toggle('is-active', other === option);
          other.setAttribute('aria-pressed', String(other === option));
        });
        applyPayment(option.getAttribute('data-payment'));
      });
    });

    if (amountInput) {
      amountInput.addEventListener('input', updateChange);
    }

    if (customerSelect) {
      customerSelect.addEventListener('change', function () {
        var isNew = customerSelect.value === '__new__';
        if (newCustomerBlock) newCustomerBlock.hidden = !isNew;
        if (isNew) {
          var nameField = document.getElementById('new-customer-name');
          if (nameField) nameField.focus();
        }
      });
    }

    var activeOption = document.querySelector('.pay-option.is-active');
    applyPayment(activeOption ? activeOption.getAttribute('data-payment') : 'Cash');
  }

  function completeSale(view, payment, customerId, newCustomer, amountReceived) {
    var items = cartItems();
    if (!items.length) {
      DH.toast('The cart is empty — nothing to charge.', 'error');
      return;
    }

    var totals = cartTotals(items);
    var now = new Date().toISOString();
    var receipt = nextReceiptNumber();
    var transactionId = nextTransactionId();

    var customer = customerId && customerId !== '__new__'
      ? DH.store.collection('customers').find(customerId)
      : null;

    if (newCustomer) {
      customer = createCustomer(newCustomer.name, newCustomer.phone, newCustomer.email);
    }

    var change = payment === 'Cash' ? round2((Number(amountReceived) || 0) - totals.total) : 0;

    var sale = {
      transactionId: transactionId,
      receipt: receipt,
      customerId: customer ? customer.id : null,
      customerName: customer ? customer.name : 'Walk-in customer',
      items: items.map(function (item) {
        return {
          productId: item.productId,
          name: item.name,
          sku: item.sku,
          price: Number(item.price) || 0,
          quantity: Number(item.quantity) || 0,
          lineTotal: round2((Number(item.price) || 0) * (Number(item.quantity) || 0))
        };
      }),
      itemCount: totals.units,
      subtotal: totals.subtotal,
      discount: totals.discount,
      discountPercent: totals.percent,
      tax: totals.tax,
      taxRate: taxRate(),
      total: totals.total,
      payment: payment,
      amountReceived: payment === 'Cash' ? round2(amountReceived) : totals.total,
      change: change,
      status: 'paid',
      cashier: settings().cashierName || 'Admin',
      createdAt: now,
      updatedAt: now
    };

    DH.store.collection('sales').add(sale);

    items.forEach(function (item) {
      var product = findProduct(item.productId);
      if (!product) return;

      var before = stockOf(product);
      var after = Math.max(0, before - (Number(item.quantity) || 0));

      DH.store.collection('products').update(product.id, { stock: after });
      DH.store.collection('inventory').add({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        type: 'issue',
        quantity: after - before,
        stockBefore: before,
        stockAfter: after,
        note: 'Sale ' + receipt,
        at: now
      });
    });

    if (customer) {
      DH.store.collection('customers').update(customer.id, {
        orders: (Number(customer.orders) || 0) + 1,
        visits: (Number(customer.visits) || 0) + 1,
        totalSpent: round2((Number(customer.totalSpent) || 0) + totals.total),
        lastVisit: now
      });
    }

    DH.store.collection('activity').add({
      type: 'sale',
      title: 'Sale completed',
      detail: receipt + ' · ' + sale.customerName,
      tone: 'success',
      at: now
    });

    saveCart([]);
    setDiscount(0);
    refreshCart(view);
    refreshCatalog(view);

    DH.toast('Sale ' + receipt + ' completed · ' + format.currency(totals.total), 'success');
    window.setTimeout(function () { showReceipt(sale); }, 80);
  }

  function showReceipt(sale) {
    if (DH.receipt && typeof DH.receipt.open === 'function') {
      DH.receipt.open(sale, {
        title: 'Sale completed',
        description: 'Receipt ' + sale.receipt + ' · ' + sale.payment
      });
      return;
    }

    DH.modal.open({
      title: 'Sale completed',
      description: 'Receipt ' + sale.receipt + ' · ' + sale.payment,
      confirmLabel: 'New sale',
      cancelLabel: 'Close',
      body:
        '<div class="receipt-card" id="print-receipt">' +
          sale.items.map(function (item) {
            return '<div class="receipt-row"><span>' + escape(item.name) + ' × ' + format.number(item.quantity) + '</span>' +
              '<span>' + format.currency(item.lineTotal) + '</span></div>';
          }).join('') +
          '<div class="receipt-row total"><span>Total</span><span>' + format.currency(sale.total) + '</span></div>' +
        '</div>',
      onConfirm: function () { return true; }
    });
  }

  /* ---------- Events ---------- */

  function handleViewClick(event) {
    var view = event.currentTarget;

    var tile = event.target.closest('[data-add-product]');
    if (tile) {
      event.preventDefault();
      addToCart(view, tile.getAttribute('data-add-product'));
      return;
    }

    var category = event.target.closest('[data-category]');
    if (category) {
      event.preventDefault();
      state.category = category.getAttribute('data-category');
      var chips = view.querySelector('#pos-categories');
      if (chips) {
        chips.innerHTML = categoriesMarkup();
      }
      refreshCatalog(view);
      return;
    }

    var increase = event.target.closest('[data-cart-inc]');
    if (increase) {
      event.preventDefault();
      changeQuantity(view, increase.getAttribute('data-cart-inc'), 1);
      return;
    }

    var decrease = event.target.closest('[data-cart-dec]');
    if (decrease) {
      event.preventDefault();
      changeQuantity(view, decrease.getAttribute('data-cart-dec'), -1);
      return;
    }

    var remove = event.target.closest('[data-cart-remove]');
    if (remove) {
      event.preventDefault();
      removeLine(view, remove.getAttribute('data-cart-remove'));
      return;
    }

    var discount = event.target.closest('[data-discount]');
    if (discount) {
      event.preventDefault();
      setDiscount(discount.getAttribute('data-discount'));
      refreshCart(view);
      return;
    }

    if (event.target.closest('#clear-cart')) {
      event.preventDefault();
      clearCart(view);
      return;
    }

    if (event.target.closest('#charge-sale')) {
      event.preventDefault();
      openChargeModal(view);
    }
  }

  function renderView(view) {
    if (!view.dataset.posBound) {
      view.addEventListener('click', handleViewClick);
      view.dataset.posBound = 'true';
    }
    paint(view);
  }

  DH.views.pos = { id: 'pos', render: renderView };

})(window);
