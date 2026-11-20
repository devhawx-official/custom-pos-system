/* ==========================================================================
   DevHawx POS — sales.js
   Sales history: every completed transaction from localStorage with search,
   date and payment filters, a sale detail view and receipt reprints.
   Nothing is generated here — the view only reads the sales collection.
   ========================================================================== */

(function (window) {
  'use strict';

  var DH = window.DH;
  var icon = DH.icon;
  var format = DH.format;
  var escape = DH.util.escapeHtml;

  var state = {
    query: '',
    range: 'all',
    payment: 'all',
    sort: 'newest'
  };

  var RANGES = [
    { value: 'all', label: 'All time' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'Last 7 days' },
    { value: 'month', label: 'Last 30 days' },
    { value: 'calendar', label: 'This month' }
  ];

  /* ---------- Data helpers ---------- */

  function sales() {
    return DH.store.collection('sales').all();
  }

  function findSale(id) {
    return DH.store.collection('sales').find(id);
  }

  function saleDate(sale) {
    return new Date(sale.createdAt || sale.updatedAt || 0);
  }

  function saleTime(sale) {
    var date = saleDate(sale);
    return isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function paymentMethods() {
    var seen = {};
    var methods = [];

    sales().forEach(function (sale) {
      var method = String(sale.payment || 'Card');
      if (seen[method]) return;
      seen[method] = true;
      methods.push(method);
    });

    return methods.sort();
  }

  function paymentIcon(method) {
    if (method === 'Cash') return 'wallet';
    if (method === 'Card') return 'card';
    return 'more';
  }

  function inRange(sale, range) {
    if (range === 'all') return true;

    var date = saleDate(sale);
    if (isNaN(date.getTime())) return false;

    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (range === 'today') return date.getTime() >= start.getTime();
    if (range === 'week') return date.getTime() >= start.getTime() - 6 * 86400000;
    if (range === 'month') return date.getTime() >= start.getTime() - 29 * 86400000;
    if (range === 'calendar') {
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }

    return true;
  }

  function filteredSales() {
    var query = state.query.trim().toLowerCase();

    var list = sales().filter(function (sale) {
      if (state.payment !== 'all' && String(sale.payment || 'Card') !== state.payment) return false;
      if (!inRange(sale, state.range)) return false;
      if (!query) return true;

      var haystack = [sale.receipt, sale.transactionId, sale.customerName, sale.cashier, sale.payment];
      (Array.isArray(sale.items) ? sale.items : []).forEach(function (item) {
        haystack.push(item.name, item.sku);
      });

      return haystack.some(function (value) {
        return String(value || '').toLowerCase().indexOf(query) !== -1;
      });
    });

    list.sort(function (a, b) {
      if (state.sort === 'oldest') return saleTime(a) - saleTime(b);
      if (state.sort === 'highest') return (Number(b.total) || 0) - (Number(a.total) || 0);
      if (state.sort === 'lowest') return (Number(a.total) || 0) - (Number(b.total) || 0);
      return saleTime(b) - saleTime(a);
    });

    return list;
  }

  function customerStats(customerId) {
    var history = sales().filter(function (sale) {
      return sale.customerId === customerId;
    });

    var spend = history.reduce(function (sum, sale) {
      return sum + (Number(sale.total) || 0);
    }, 0);

    return {
      orders: history.length,
      spend: Math.round(spend * 100) / 100,
      lastVisit: history.length
        ? history.sort(function (a, b) { return saleTime(b) - saleTime(a); })[0].createdAt
        : null
    };
  }

  /* ---------- Markup ---------- */

  function saleRow(sale) {
    var id = String(sale.id || '');
    var items = Array.isArray(sale.items) ? sale.items : [];
    var itemCount = Number(sale.itemCount) || items.reduce(function (sum, item) {
      return sum + (Number(item.quantity) || 0);
    }, 0);

    return '<tr data-sale-row="' + escape(id) + '">' +
      '<td>' +
        '<span class="sale-receipt">' + escape(sale.receipt || '—') + '</span>' +
        (sale.transactionId ? '<span class="sale-transaction">' + escape(sale.transactionId) + '</span>' : '') +
      '</td>' +
      '<td><span class="date-cell"><strong>' + escape(format.date(sale.createdAt, { month: 'short', day: 'numeric', year: 'numeric' })) + '</strong>' +
        '<span>' + escape(format.time(sale.createdAt)) + '</span></span></td>' +
      '<td><span class="sale-customer">' + escape(sale.customerName || 'Walk-in customer') + '</span></td>' +
      '<td class="align-right"><span class="stat-number">' + format.number(itemCount) + '</span></td>' +
      '<td><span class="payment-pill">' + icon(paymentIcon(sale.payment), 12) + escape(sale.payment || 'Card') + '</span></td>' +
      '<td class="align-right"><strong class="amount-cell">' + format.currency(sale.total) + '</strong></td>' +
      '<td class="cell-actions">' +
        '<div class="row-actions">' +
          '<button class="icon-btn row-action" type="button" data-sale-view="' + escape(id) + '" aria-label="View details for ' + escape(sale.receipt || 'sale') + '" title="View sale details">' + icon('receipt', 16) + '</button>' +
          '<button class="icon-btn row-action" type="button" data-sale-print="' + escape(id) + '" aria-label="Print receipt for ' + escape(sale.receipt || 'sale') + '" title="Print receipt">' + icon('printer', 16) + '</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  function rowsMarkup(list) {
    var all = sales();

    if (!list.length) {
      var empty = all.length
        ? DH.ui.emptyState({
            icon: 'search',
            title: 'No transactions match',
            text: 'Try another receipt number, customer or product, or widen the date and payment filters.',
            action: '<button class="btn btn-ghost" type="button" data-clear-filters>' + icon('refresh', 15) + 'Clear filters</button>'
          })
        : DH.ui.emptyState({
            icon: 'sales',
            title: 'No sales recorded yet',
            text: 'Complete a checkout and every receipt will be listed here with its items, customer and payment.'
          });

      return '<tr><td colspan="7" class="table-empty">' + empty + '</td></tr>';
    }

    return list.map(saleRow).join('');
  }

  function kpiMarkup(list, total) {
    var revenue = list.reduce(function (sum, sale) {
      return sum + (Number(sale.total) || 0);
    }, 0);
    var items = list.reduce(function (sum, sale) {
      return sum + (Number(sale.itemCount) || 0);
    }, 0);
    var filtered = list.length !== total;

    return '<div class="stat-grid">' +
      DH.ui.statCard({ label: 'Gross sales', value: format.currency(revenue), hint: filtered ? 'In the current filter' : 'Total value captured', icon: 'dollar', tone: 'blue', trend: filtered ? 'Filtered' : 'All time', trendIcon: 'clock' }) +
      DH.ui.statCard({ label: 'Transactions', value: format.number(list.length), hint: filtered ? 'of ' + total + ' receipts' : 'Completed checkouts', icon: 'receipt', tone: 'cyan', trend: filtered ? 'Filtered' : 'All time', trendIcon: 'trend-up' }) +
      DH.ui.statCard({ label: 'Average basket', value: format.currency(list.length ? revenue / list.length : 0), hint: 'Revenue per sale', icon: 'wallet', tone: 'emerald', trend: 'Basket', trendIcon: 'percent' }) +
      DH.ui.statCard({ label: 'Items sold', value: format.number(items), hint: 'Across every receipt', icon: 'box', tone: 'navy', trend: 'Volume', trendIcon: 'layers' }) +
    '</div>';
  }

  /* ---------- Rendering ---------- */

  function paint(view) {
    var all = sales();
    var list = filteredSales();
    var methods = paymentMethods();

    view.innerHTML =
      '<div class="view-toolbar">' +
        '<div class="toolbar-left">' +
          '<label class="field-search">' + icon('search', 17) +
            '<input id="sale-search" type="search" placeholder="Search receipt, customer or product" aria-label="Search sales" value="' + escape(state.query) + '" autocomplete="off">' +
          '</label>' +
          '<label class="filter-select" for="sale-range">' + icon('calendar', 15) +
            '<select id="sale-range" aria-label="Filter sales by date">' +
              RANGES.map(function (range) {
                return '<option value="' + range.value + '"' + (state.range === range.value ? ' selected' : '') + '>' + escape(range.label) + '</option>';
              }).join('') +
            '</select>' +
            '<span class="filter-chevron" aria-hidden="true">' + icon('chevron-down', 14) + '</span>' +
          '</label>' +
          '<label class="filter-select" for="sale-payment">' + icon('card', 15) +
            '<select id="sale-payment" aria-label="Filter sales by payment method">' +
              '<option value="all"' + (state.payment === 'all' ? ' selected' : '') + '>All payments</option>' +
              methods.map(function (method) {
                return '<option value="' + escape(method) + '"' + (state.payment === method ? ' selected' : '') + '>' + escape(method) + '</option>';
              }).join('') +
            '</select>' +
            '<span class="filter-chevron" aria-hidden="true">' + icon('chevron-down', 14) + '</span>' +
          '</label>' +
          '<label class="filter-select" for="sale-sort">' + icon('filter', 15) +
            '<select id="sale-sort" aria-label="Sort sales">' +
              '<option value="newest"' + (state.sort === 'newest' ? ' selected' : '') + '>Newest first</option>' +
              '<option value="oldest"' + (state.sort === 'oldest' ? ' selected' : '') + '>Oldest first</option>' +
              '<option value="highest"' + (state.sort === 'highest' ? ' selected' : '') + '>Highest total</option>' +
              '<option value="lowest"' + (state.sort === 'lowest' ? ' selected' : '') + '>Lowest total</option>' +
            '</select>' +
            '<span class="filter-chevron" aria-hidden="true">' + icon('chevron-down', 14) + '</span>' +
          '</label>' +
        '</div>' +
        '<div class="toolbar-right">' +
          '<span class="toolbar-count" id="sale-count">' + list.length + ' of ' + all.length + ' transactions</span>' +
        '</div>' +
      '</div>' +

      kpiMarkup(list, all.length) +

      DH.ui.table({
        className: 'sales-table',
        bodyId: 'sale-table-body',
        columns: [
          { label: 'Receipt' },
          { label: 'Date' },
          { label: 'Customer' },
          { label: 'Items', align: 'right' },
          { label: 'Payment' },
          { label: 'Total', align: 'right' },
          { label: '' }
        ],
        body: rowsMarkup(list)
      });

    bindControls(view);
  }

  function refreshTable(view) {
    var all = sales();
    var list = filteredSales();
    var body = view.querySelector('#sale-table-body');
    var counter = view.querySelector('#sale-count');

    if (body) body.innerHTML = rowsMarkup(list);
    if (counter) counter.textContent = list.length + ' of ' + all.length + ' transactions';
  }

  function bindControls(view) {
    var search = view.querySelector('#sale-search');
    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value;
        refreshTable(view);
      });
    }

    var range = view.querySelector('#sale-range');
    if (range) {
      range.addEventListener('change', function () {
        state.range = range.value;
        refreshTable(view);
      });
    }

    var payment = view.querySelector('#sale-payment');
    if (payment) {
      payment.addEventListener('change', function () {
        state.payment = payment.value;
        refreshTable(view);
      });
    }

    var sort = view.querySelector('#sale-sort');
    if (sort) {
      sort.addEventListener('change', function () {
        state.sort = sort.value;
        refreshTable(view);
      });
    }
  }

  /* ---------- Sale detail ---------- */

  function openSaleDetail(sale) {
    var items = Array.isArray(sale.items) ? sale.items : [];
    var customer = sale.customerId ? DH.store.collection('customers').find(sale.customerId) : null;
    var stats = customer ? customerStats(customer.id) : null;

    var itemRows = items.length
      ? items.map(function (item) {
          var quantity = Number(item.quantity) || 0;
          var price = Number(item.price) || 0;
          var lineTotal = typeof item.lineTotal === 'number' ? item.lineTotal : price * quantity;

          return '<tr>' +
            '<td><span class="sale-item-name">' + escape(item.name) + '</span>' +
              (item.sku ? '<span class="sale-item-sku">' + escape(item.sku) + '</span>' : '') + '</td>' +
            '<td class="align-right">' + format.number(quantity) + '</td>' +
            '<td class="align-right">' + format.currency(price) + '</td>' +
            '<td class="align-right"><strong class="amount-cell">' + format.currency(lineTotal) + '</strong></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="4" class="table-empty">' +
        DH.ui.emptyState({ compact: true, icon: 'box', title: 'No items recorded', text: 'This receipt has no line items.' }) +
      '</td></tr>';

    DH.modal.open({
      title: 'Sale ' + (sale.receipt || ''),
      description: format.date(sale.createdAt, { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + format.time(sale.createdAt) +
        (sale.transactionId ? ' · ' + sale.transactionId : ''),
      className: 'modal-lg',
      confirmLabel: 'Done',
      cancelLabel: 'Close',
      body:
        '<div class="customer-detail">' +
          '<div class="customer-stats">' +
            '<div class="customer-stat"><span>Subtotal</span><strong>' + format.currency(sale.subtotal) + '</strong></div>' +
            '<div class="customer-stat"><span>Discount</span><strong>' +
              (sale.discount ? '−' + format.currency(sale.discount) : format.currency(0)) + '</strong></div>' +
            '<div class="customer-stat"><span>Tax (' + format.percent(sale.taxRate) + ')</span><strong>' + format.currency(sale.tax) + '</strong></div>' +
            '<div class="customer-stat"><span>Total</span><strong>' + format.currency(sale.total) + '</strong></div>' +
          '</div>' +

          '<div class="customer-contact">' +
            '<div><span>Customer</span><strong>' + escape(sale.customerName || 'Walk-in customer') + '</strong></div>' +
            '<div><span>Phone</span><strong>' + escape(customer && customer.phone ? customer.phone : '—') + '</strong></div>' +
            '<div><span>Email</span><strong>' + escape(customer && customer.email ? customer.email : '—') + '</strong></div>' +
          '</div>' +

          (stats
            ? '<div class="customer-contact">' +
                '<div><span>Total purchases</span><strong>' + format.number(stats.orders) + '</strong></div>' +
                '<div><span>Total spending</span><strong>' + format.currency(stats.spend) + '</strong></div>' +
                '<div><span>Last visit</span><strong>' +
                  (stats.lastVisit ? escape(format.date(stats.lastVisit, { month: 'short', day: 'numeric', year: 'numeric' })) : '—') + '</strong></div>' +
              '</div>'
            : '') +

          '<p class="detail-title">Purchased products</p>' +
          '<div class="table-wrap">' +
            '<table class="data-table detail-table">' +
              '<thead><tr><th>Product</th><th class="align-right">Qty</th><th class="align-right">Unit price</th><th class="align-right">Line total</th></tr></thead>' +
              '<tbody>' + itemRows + '</tbody>' +
            '</table>' +
          '</div>' +

          '<p class="detail-title">Payment</p>' +
          '<div class="customer-contact">' +
            '<div><span>Method</span><strong>' + escape(sale.payment || 'Card') + '</strong></div>' +
            '<div><span>Amount received</span><strong>' + format.currency(sale.amountReceived === undefined ? sale.total : sale.amountReceived) + '</strong></div>' +
            '<div><span>Change</span><strong>' + format.currency(sale.change || 0) + '</strong></div>' +
          '</div>' +
          '<div class="customer-contact">' +
            '<div><span>Cashier</span><strong>' + escape(sale.cashier || 'Admin') + '</strong></div>' +
            '<div><span>Status</span><strong>' + escape(sale.status || 'paid') + '</strong></div>' +
            '<div><span>Items</span><strong>' + format.number(sale.itemCount || items.length) + '</strong></div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-actions">' +
          '<button class="btn btn-primary" type="button" data-print-sale="' + escape(sale.id) + '">' + icon('printer', 15) + 'Print receipt</button>' +
        '</div>',
      onConfirm: function () { return true; }
    });

    var printButton = document.querySelector('[data-print-sale]');
    if (printButton) {
      printButton.addEventListener('click', function () {
        if (DH.receipt && typeof DH.receipt.open === 'function') {
          DH.receipt.open(sale, { title: 'Receipt ' + (sale.receipt || '') });
        }
      });
    }
  }

  /* ---------- Events ---------- */

  function handleViewClick(event) {
    var view = event.currentTarget;

    var viewButton = event.target.closest('[data-sale-view]');
    if (viewButton) {
      event.preventDefault();
      var sale = findSale(viewButton.getAttribute('data-sale-view'));
      if (sale) openSaleDetail(sale);
      return;
    }

    var printButton = event.target.closest('[data-sale-print]');
    if (printButton) {
      event.preventDefault();
      var toPrint = findSale(printButton.getAttribute('data-sale-print'));
      if (toPrint && DH.receipt && typeof DH.receipt.open === 'function') {
        DH.receipt.open(toPrint, { title: 'Receipt ' + (toPrint.receipt || '') });
      }
      return;
    }

    if (event.target.closest('[data-clear-filters]')) {
      event.preventDefault();
      state.query = '';
      state.range = 'all';
      state.payment = 'all';
      state.sort = 'newest';
      paint(view);
    }
  }

  function renderView(view) {
    if (!view.dataset.salesBound) {
      view.addEventListener('click', handleViewClick);
      view.dataset.salesBound = 'true';
    }
    paint(view);
  }

  DH.views.sales = { id: 'sales', render: renderView };

})(window);
