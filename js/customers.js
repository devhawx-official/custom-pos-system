/* ==========================================================================
   DevHawx POS — customers.js
   Customer directory: searchable table, validated add/edit forms, confirmed
   deletion and a profile view with the customer's purchase history. Every
   change is written to the customers collection in localStorage.
   ========================================================================== */

(function (window) {
  'use strict';

  var DH = window.DH;
  var icon = DH.icon;
  var format = DH.format;
  var escape = DH.util.escapeHtml;

  var TIERS = ['Member', 'Silver', 'Gold', 'Platinum'];

  var state = {
    query: '',
    sort: 'recent'
  };

  /* ---------- Data helpers ---------- */

  function customers() {
    return DH.store.collection('customers').all();
  }

  function sales() {
    return DH.store.collection('sales').all();
  }

  function findCustomer(id) {
    return DH.store.collection('customers').find(id);
  }

  function initial(name) {
    var text = String(name || '?').trim();
    return text ? text.charAt(0).toUpperCase() : '?';
  }

  function tierOf(customer) {
    var tier = String(customer && customer.tier || 'Member');
    return TIERS.indexOf(tier) !== -1 ? tier : 'Member';
  }

  /** Sales grouped by customer, built once per render instead of per row. */
  function salesIndex() {
    var index = {};

    sales().forEach(function (sale) {
      if (!sale.customerId) return;
      var list = index[sale.customerId] || (index[sale.customerId] = []);
      list.push(sale);
    });

    Object.keys(index).forEach(function (key) {
      index[key].sort(function (a, b) {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
    });

    return index;
  }

  /** Sales that belong to a customer, newest first. */
  function salesFor(customerId) {
    return sales().filter(function (sale) {
      return sale.customerId === customerId;
    }).sort(function (a, b) {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }

  /** Purchase stats derived from the completed sales. */
  function statsFor(customer, index) {
    var history = index ? (index[customer.id] || []) : salesFor(customer.id);
    var spend = 0;
    var items = 0;

    history.forEach(function (sale) {
      spend += Number(sale.total) || 0;
      items += Number(sale.itemCount) || 0;
    });

    spend = Math.round(spend * 100) / 100;

    return {
      orders: history.length,
      spend: spend,
      items: items,
      average: history.length ? Math.round((spend / history.length) * 100) / 100 : 0,
      lastVisit: history.length ? history[0].createdAt : (customer.lastVisit || null),
      joined: customer.joinedAt || customer.createdAt || null
    };
  }

  function logActivity(title, detail, tone) {
    DH.store.collection('activity').add({
      type: 'customer',
      title: title,
      detail: detail,
      tone: tone || 'info',
      at: new Date().toISOString()
    });
  }

  function visibleCustomers(index) {
    var query = state.query.trim().toLowerCase();
    var list = customers().filter(function (customer) {
      if (!query) return true;
      return [customer.name, customer.phone, customer.email, customer.tier].some(function (value) {
        return String(value || '').toLowerCase().indexOf(query) !== -1;
      });
    });

    list.sort(function (a, b) {
      var aStats = statsFor(a, index);
      var bStats = statsFor(b, index);

      if (state.sort === 'spend') return bStats.spend - aStats.spend;
      if (state.sort === 'orders') return bStats.orders - aStats.orders;
      if (state.sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));

      var aTime = aStats.lastVisit ? new Date(aStats.lastVisit).getTime() : 0;
      var bTime = bStats.lastVisit ? new Date(bStats.lastVisit).getTime() : 0;
      return bTime - aTime;
    });

    return list;
  }

  /* ---------- Markup ---------- */

  function customerRow(customer, stats) {
    var id = String(customer.id || '');
    var name = String(customer.name || 'Unnamed customer');
    var lastVisit = stats.lastVisit
      ? '<span class="date-cell"><strong>' + escape(format.date(stats.lastVisit, { month: 'short', day: 'numeric' })) + '</strong>' +
        '<span>' + escape(format.time(stats.lastVisit)) + '</span></span>'
      : '<span class="date-cell"><strong>Never</strong><span>No purchases yet</span></span>';

    return '<tr data-customer-row="' + escape(id) + '">' +
      '<td>' +
        '<div class="product-cell">' +
          '<span class="product-avatar" aria-hidden="true">' + escape(initial(name)) + '</span>' +
          '<span class="product-copy">' +
            '<strong>' + escape(name) + '</strong>' +
            '<small>' + escape(tierOf(customer)) + '</small>' +
          '</span>' +
        '</div>' +
      '</td>' +
      '<td><span class="customer-phone">' + escape(customer.phone || '—') + '</span></td>' +
      '<td><span class="customer-email">' + escape(customer.email || '—') + '</span></td>' +
      '<td class="align-right"><span class="stat-number">' + format.number(stats.orders) + '</span></td>' +
      '<td class="align-right"><span class="price-cell is-price">' + format.currency(stats.spend) + '</span></td>' +
      '<td>' + lastVisit + '</td>' +
      '<td class="cell-actions">' +
        '<div class="row-actions">' +
          '<button class="icon-btn row-action" type="button" data-customer-view="' + escape(id) + '" aria-label="View purchase history for ' + escape(name) + '" title="Purchase history">' + icon('receipt', 16) + '</button>' +
          '<button class="icon-btn row-action" type="button" data-customer-edit="' + escape(id) + '" aria-label="Edit ' + escape(name) + '" title="Edit customer">' + icon('edit', 16) + '</button>' +
          '<button class="icon-btn row-action is-danger" type="button" data-customer-delete="' + escape(id) + '" aria-label="Delete ' + escape(name) + '" title="Delete customer">' + icon('trash', 16) + '</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  function rowsMarkup(list, index) {
    var all = customers();

    if (!list.length) {
      var empty = all.length
        ? DH.ui.emptyState({
            icon: 'search',
            title: 'No customers match',
            text: 'Try another name, phone number or email.',
            action: '<button class="btn btn-ghost" type="button" data-clear-filters>' + icon('refresh', 15) + 'Clear filters</button>'
          })
        : DH.ui.emptyState({
            icon: 'customers',
            title: 'No customers yet',
            text: 'Add a profile here or capture a name at checkout. Purchase history and loyalty signals build up automatically.',
            action: '<button class="btn btn-primary" type="button" data-customer-add>' + icon('plus', 16) + 'Add your first customer</button>'
          });

      return '<tr><td colspan="7" class="table-empty">' + empty + '</td></tr>';
    }

    return list.map(function (customer) {
      return customerRow(customer, statsFor(customer, index));
    }).join('');
  }

  function kpiMarkup(all, index) {
    var spend = 0;
    var buyers = 0;

    all.forEach(function (customer) {
      var stats = statsFor(customer, index);
      spend += stats.spend;
      if (stats.orders > 0) buyers += 1;
    });

    return '<div class="stat-grid">' +
      DH.ui.statCard({ label: 'Customers', value: format.number(all.length), hint: 'Profiles saved locally', icon: 'customers', tone: 'blue', trend: 'Directory', trendIcon: 'user' }) +
      DH.ui.statCard({ label: 'Active buyers', value: format.number(buyers), hint: 'With at least one purchase', icon: 'check-circle', tone: 'emerald', trend: 'Loyalty', trendIcon: 'trend-up' }) +
      DH.ui.statCard({ label: 'Customer spend', value: format.currency(spend), hint: 'Across all sales', icon: 'wallet', tone: 'cyan', trend: 'All time', trendIcon: 'dollar' }) +
      DH.ui.statCard({ label: 'Avg. per customer', value: format.currency(all.length ? spend / all.length : 0), hint: 'Lifetime value estimate', icon: 'trend-up', tone: 'navy', trend: 'LTV', trendIcon: 'reports' }) +
    '</div>';
  }

  /* ---------- Rendering ---------- */

  function paint(view) {
    var all = customers();
    var index = salesIndex();
    var list = visibleCustomers(index);

    view.innerHTML =
      '<div class="view-toolbar">' +
        '<div class="toolbar-left">' +
          '<label class="field-search">' + icon('search', 17) +
            '<input id="customer-search" type="search" placeholder="Search by name, phone or email" aria-label="Search customers" value="' + escape(state.query) + '" autocomplete="off">' +
          '</label>' +
          '<label class="filter-select" for="customer-sort">' + icon('filter', 15) +
            '<select id="customer-sort" aria-label="Sort customers">' +
              '<option value="recent"' + (state.sort === 'recent' ? ' selected' : '') + '>Recent activity</option>' +
              '<option value="spend"' + (state.sort === 'spend' ? ' selected' : '') + '>Top spenders</option>' +
              '<option value="orders"' + (state.sort === 'orders' ? ' selected' : '') + '>Most purchases</option>' +
              '<option value="name"' + (state.sort === 'name' ? ' selected' : '') + '>Name A–Z</option>' +
            '</select>' +
            '<span class="filter-chevron" aria-hidden="true">' + icon('chevron-down', 14) + '</span>' +
          '</label>' +
        '</div>' +
        '<div class="toolbar-right">' +
          '<span class="toolbar-count" id="customer-count">' + list.length + ' of ' + all.length + ' customers</span>' +
          '<button class="btn btn-primary" id="add-customer" type="button" data-customer-add>' + icon('plus', 17) + 'Add customer</button>' +
        '</div>' +
      '</div>' +

      kpiMarkup(all, index) +

      DH.ui.table({
        className: 'customers-table',
        bodyId: 'customer-table-body',
        columns: [
          { label: 'Customer' },
          { label: 'Phone' },
          { label: 'Email' },
          { label: 'Purchases', align: 'right' },
          { label: 'Total spending', align: 'right' },
          { label: 'Last visit' },
          { label: '' }
        ],
        body: rowsMarkup(list, index)
      });

    bindControls(view);
  }

  function refreshTable(view) {
    var all = customers();
    var index = salesIndex();
    var list = visibleCustomers(index);
    var body = view.querySelector('#customer-table-body');
    var counter = view.querySelector('#customer-count');

    if (body) body.innerHTML = rowsMarkup(list, index);
    if (counter) counter.textContent = list.length + ' of ' + all.length + ' customers';
  }

  function bindControls(view) {
    var search = view.querySelector('#customer-search');
    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value;
        refreshTable(view);
      });
    }

    var sort = view.querySelector('#customer-sort');
    if (sort) {
      sort.addEventListener('change', function () {
        state.sort = sort.value;
        refreshTable(view);
      });
    }
  }

  /* ---------- Add / edit ---------- */

  function openCustomerForm(view, customer) {
    var editing = !!customer;
    var values = {
      name: customer ? customer.name : '',
      phone: customer ? customer.phone : '',
      email: customer ? customer.email : '',
      tier: tierOf(customer)
    };

    DH.modal.open({
      title: editing ? 'Edit customer' : 'Add customer',
      description: editing
        ? 'Update contact details for this profile.'
        : 'Create a customer profile you can link to sales.',
      className: 'modal-lg',
      confirmLabel: editing ? 'Save changes' : 'Add customer',
      danger: false,
      body:
        '<div id="customer-panel">' +
          DH.ui.formField({
            id: 'customer-name', name: 'name', label: 'Customer name', value: values.name,
            required: true, full: true, placeholder: 'e.g. Amelia Hart'
          }) +
          DH.ui.formField({
            id: 'customer-phone-field', name: 'phone', label: 'Phone number', value: values.phone,
            required: true, placeholder: '+1 (555) 010-2030', inputmode: 'tel'
          }) +
          DH.ui.formField({
            id: 'customer-email-field', name: 'email', label: 'Email', value: values.email,
            type: 'email', placeholder: 'Optional', inputmode: 'email'
          }) +
          DH.ui.formField({
            id: 'customer-tier', name: 'tier', label: 'Loyalty tier', value: values.tier,
            type: 'select', options: TIERS.map(function (tier) { return { value: tier, label: tier }; })
          }) +
          '<p class="product-form-note">' + icon('shield', 14) + 'Customer data is stored locally in this browser.</p>' +
        '</div>',
      onConfirm: function () {
        var panel = document.getElementById('customer-panel');
        if (!panel) return false;

        var failed = false;
        function fail(name, message) {
          DH.ui.setFieldError(panel, name, message);
          failed = true;
        }

        DH.ui.clearFieldErrors(panel);

        var name = String(panel.querySelector('[name="name"]').value || '').trim();
        var phone = String(panel.querySelector('[name="phone"]').value || '').trim();
        var email = String(panel.querySelector('[name="email"]').value || '').trim();
        var tier = String(panel.querySelector('[name="tier"]').value || 'Member');

        if (!name) fail('name', 'Customer name is required.');
        else if (name.length > 60) fail('name', 'Keep the customer name under 60 characters.');

        if (!phone) fail('phone', 'Phone number is required.');
        else if (phone.replace(/\D/g, '').length < 5) fail('phone', 'Enter a valid phone number.');

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          fail('email', 'Enter a valid email address.');
        } else if (email && customers().some(function (other) {
          return other.id !== (customer ? customer.id : null) &&
            String(other.email || '').toLowerCase() === email.toLowerCase();
        })) {
          fail('email', 'This email is already used by another customer.');
        }

        if (TIERS.indexOf(tier) === -1) fail('tier', 'Choose a valid loyalty tier.');

        if (failed) {
          var first = panel.querySelector('.is-invalid');
          if (first) first.focus();
          return false;
        }

        var payload = { name: name, phone: phone, email: email, tier: tier };

        if (editing) {
          DH.store.collection('customers').update(customer.id, payload);
          logActivity('Customer updated', name + ' · ' + tier, 'neutral');
          DH.toast(name + ' updated.', 'success');
        } else {
          DH.store.collection('customers').add(Object.assign({
            tier: 'Member',
            orders: 0,
            visits: 0,
            totalSpent: 0,
            joinedAt: new Date().toISOString(),
            lastVisit: null
          }, payload));
          logActivity('New customer', name + ' · ' + tier, 'success');
          DH.toast(name + ' added to the directory.', 'success');
        }

        paint(view);
        return true;
      }
    });

    var panel = document.getElementById('customer-panel');
    if (panel) {
      var first = panel.querySelector('[name="name"]');
      if (first) window.setTimeout(function () { first.focus(); }, 60);
    }
  }

  /* ---------- Profile with purchase history ---------- */

  function openCustomerDetail(view, customer) {
    var index = salesIndex();
    var stats = statsFor(customer, index);
    var history = index[customer.id] || [];

    var rows = history.length
      ? history.map(function (sale) {
          return '<tr>' +
            '<td><span class="date-cell"><strong>' + escape(format.date(sale.createdAt, { month: 'short', day: 'numeric' })) + '</strong>' +
              '<span>' + escape(format.time(sale.createdAt)) + '</span></span></td>' +
            '<td><button class="text-link receipt-link" type="button" data-receipt-sale="' + escape(sale.id) + '">' +
              escape(sale.receipt || 'Receipt') + '</button></td>' +
            '<td>' + format.number(sale.itemCount || 0) + '</td>' +
            '<td><span class="payment-pill">' + icon('receipt', 12) + escape(sale.payment || 'Card') + '</span></td>' +
            '<td class="align-right"><strong class="amount-cell">' + format.currency(sale.total) + '</strong></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="5" class="table-empty">' +
        DH.ui.emptyState({
          compact: true,
          icon: 'receipt',
          title: 'No purchases yet',
          text: 'Sales linked to this customer will appear here.'
        }) +
      '</td></tr>';

    DH.modal.open({
      title: customer.name,
      description: tierOf(customer) + ' customer · joined ' + format.date(stats.joined, { month: 'short', day: 'numeric', year: 'numeric' }),
      className: 'modal-lg',
      confirmLabel: 'Done',
      cancelLabel: 'Close',
      body:
        '<div class="customer-detail">' +
          '<div class="customer-stats">' +
            '<div class="customer-stat"><span>Total purchases</span><strong>' + format.number(stats.orders) + '</strong></div>' +
            '<div class="customer-stat"><span>Total spending</span><strong>' + format.currency(stats.spend) + '</strong></div>' +
            '<div class="customer-stat"><span>Average basket</span><strong>' + format.currency(stats.average) + '</strong></div>' +
            '<div class="customer-stat"><span>Items bought</span><strong>' + format.number(stats.items) + '</strong></div>' +
          '</div>' +
          '<div class="customer-contact">' +
            '<div><span>Phone</span><strong>' + escape(customer.phone || '—') + '</strong></div>' +
            '<div><span>Email</span><strong>' + escape(customer.email || '—') + '</strong></div>' +
            '<div><span>Last visit</span><strong>' + (stats.lastVisit ? escape(format.date(stats.lastVisit, { month: 'short', day: 'numeric', year: 'numeric' })) : '—') + '</strong></div>' +
          '</div>' +
          '<p class="detail-title">Purchase history</p>' +
          '<div class="table-wrap">' +
            '<table class="data-table detail-table">' +
              '<thead><tr><th>Date</th><th>Receipt</th><th>Items</th><th>Payment</th><th class="align-right">Total</th></tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
        '<div class="detail-actions">' +
          '<button class="btn btn-ghost" type="button" data-customer-edit="' + escape(customer.id) + '">' + icon('edit', 15) + 'Edit details</button>' +
          '<button class="btn btn-danger" type="button" data-customer-delete="' + escape(customer.id) + '">' + icon('trash', 15) + 'Delete customer</button>' +
        '</div>',
      onConfirm: function () { return true; }
    });

    var receiptButtons = document.querySelectorAll('[data-receipt-sale]');
    Array.prototype.forEach.call(receiptButtons, function (button) {
      button.addEventListener('click', function () {
        var sale = DH.store.collection('sales').find(button.getAttribute('data-receipt-sale'));
        if (sale && DH.receipt && typeof DH.receipt.open === 'function') {
          DH.receipt.open(sale, { title: 'Receipt ' + (sale.receipt || '') });
        }
      });
    });
  }

  /* ---------- Delete ---------- */

  function confirmDelete(view, customer) {
    var history = salesIndex()[customer.id] || [];

    DH.modal.open({
      title: 'Delete customer?',
      description: '“' + customer.name + '” will be removed from the directory.' +
        (history.length
          ? ' Their ' + history.length + ' receipt' + (history.length === 1 ? '' : 's') + ' stay in the sales history without a customer link.'
          : ''),
      confirmLabel: 'Delete customer',
      cancelLabel: 'Keep customer',
      onConfirm: function () {
        var salesCollection = DH.store.collection('sales');

        history.forEach(function (sale) {
          salesCollection.update(sale.id, { customerId: null });
        });

        DH.store.collection('customers').remove(customer.id);
        logActivity('Customer deleted', customer.name, 'warning');
        paint(view);
        DH.toast(customer.name + ' deleted from the directory.', 'success');
        return true;
      }
    });
  }

  /* ---------- Events ---------- */

  function handleViewClick(event) {
    var view = event.currentTarget;

    if (event.target.closest('[data-customer-add]')) {
      event.preventDefault();
      openCustomerForm(view, null);
      return;
    }

    if (event.target.closest('[data-clear-filters]')) {
      event.preventDefault();
      state.query = '';
      state.sort = 'recent';
      paint(view);
      return;
    }

    var viewButton = event.target.closest('[data-customer-view]');
    if (viewButton) {
      event.preventDefault();
      var profile = findCustomer(viewButton.getAttribute('data-customer-view'));
      if (profile) openCustomerDetail(view, profile);
      return;
    }

    var editButton = event.target.closest('[data-customer-edit]');
    if (editButton) {
      event.preventDefault();
      var toEdit = findCustomer(editButton.getAttribute('data-customer-edit'));
      if (toEdit) openCustomerForm(view, toEdit);
      return;
    }

    var deleteButton = event.target.closest('[data-customer-delete]');
    if (deleteButton) {
      event.preventDefault();
      var toDelete = findCustomer(deleteButton.getAttribute('data-customer-delete'));
      if (toDelete) confirmDelete(view, toDelete);
    }
  }

  function renderView(view) {
    if (!view.dataset.customersBound) {
      view.addEventListener('click', handleViewClick);
      view.dataset.customersBound = 'true';
    }
    paint(view);
  }

  DH.views.customers = { id: 'customers', render: renderView };

})(window);
