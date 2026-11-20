/* ==========================================================================
   DevHawx POS — receipt.js
   Thermal receipt renderer. Builds a monospace receipt that fits 58 mm and
   80 mm paper, shows it in a modal with a paper-width switch and sends it to
   the printer with print-specific CSS.
   ========================================================================== */

(function (window) {
  'use strict';

  var DH = window.DH;
  var icon = DH.icon;
  var format = DH.format;
  var escape = DH.util.escapeHtml;

  var PAPERS = {
    '58': { label: '58 mm', page: 'paper58' },
    '80': { label: '80 mm', page: 'paper80' }
  };

  function storeProfile() {
    return DH.store.getStore ? DH.store.getStore() : { name: 'DevHawx Demo Store' };
  }

  function row(label, value, className) {
    return '<div class="receipt-row' + (className ? ' ' + className : '') + '">' +
      '<span>' + escape(label) + '</span><span>' + escape(value) + '</span>' +
    '</div>';
  }

  /** Decorative scannable strip printed under the totals. */
  function barcode(value) {
    var text = String(value || '');
    var html = '<div class="receipt-barcode" aria-hidden="true">';

    for (var i = 0; i < 34; i += 1) {
      var code = text.charCodeAt(i % Math.max(text.length, 1)) || 48;
      var width = 1 + (code % 3);
      html += '<i style="width:' + width + 'px"></i>';
    }

    return html + '</div>' +
      '<div class="receipt-barcode-label">' + escape(text) + '</div>';
  }

  function itemsOf(sale) {
    return Array.isArray(sale && sale.items) ? sale.items : [];
  }

  /**
   * Renders the receipt markup for a completed sale.
   * options.paper — '58' or '80' (defaults to 80).
   */
  function render(sale, options) {
    var config = options || {};
    var paper = config.paper === '58' ? '58' : '80';
    var store = storeProfile();
    var items = itemsOf(sale);
    var units = items.reduce(function (sum, item) {
      return sum + (Number(item.quantity) || 0);
    }, 0);
    var when = sale.createdAt;

    var html = '<article class="receipt receipt--' + paper + '" id="print-receipt" data-paper="' + paper + '">';

    /* Store header */
    html += '<div class="receipt-center">';
    html += '<div class="receipt-store-name">' + escape(store.name) + '</div>';
    if (store.legalName && store.legalName !== store.name) {
      html += '<div class="receipt-store-lines">' + escape(store.legalName) + '</div>';
    }
    if (store.address) {
      html += '<div class="receipt-store-lines">' + escape(store.address) + '</div>';
    }
    var contact = [];
    if (store.phone) contact.push(escape(store.phone));
    if (store.email) contact.push(escape(store.email));
    if (contact.length) {
      html += '<div class="receipt-store-lines">' + contact.join(' · ') + '</div>';
    }
    html += '</div>';
    html += '<div class="receipt-rule"></div>';

    /* Sale meta */
    html += row('Receipt', sale.receipt || '—');
    if (sale.transactionId) html += row('Transaction', sale.transactionId);
    html += row('Date', format.date(when, { month: 'short', day: 'numeric', year: 'numeric' }));
    html += row('Time', format.time(when));
    html += row('Cashier', sale.cashier || 'Admin');
    html += row('Customer', sale.customerName || 'Walk-in customer');
    html += row('Items', format.number(units));
    html += '<div class="receipt-rule"></div>';

    /* Line items */
    items.forEach(function (item) {
      var quantity = Number(item.quantity) || 0;
      var price = Number(item.price) || 0;
      var lineTotal = typeof item.lineTotal === 'number' ? item.lineTotal : price * quantity;

      html += '<div class="receipt-item">';
      html += '<div class="receipt-item-name">' + escape(item.name) + '</div>';
      html += '<div class="receipt-item-line">' +
        '<span>' + format.number(quantity) + ' x ' + format.currency(price) + '</span>' +
        '<span>' + format.currency(lineTotal) + '</span>' +
      '</div>';
      if (item.sku) html += '<div class="receipt-item-sku">' + escape(item.sku) + '</div>';
      html += '</div>';
    });

    html += '<div class="receipt-rule"></div>';

    /* Totals */
    html += row('Subtotal', format.currency(sale.subtotal));
    if (sale.discount) {
      html += row(
        'Discount' + (sale.discountPercent ? ' (' + format.percent(sale.discountPercent) + ')' : ''),
        '-' + format.currency(sale.discount),
        'is-discount'
      );
    }
    html += row('Tax (' + format.percent(sale.taxRate) + ')', format.currency(sale.tax));
    html += '<div class="receipt-rule is-solid"></div>';
    html += row('TOTAL', format.currency(sale.total), 'is-total');
    html += '<div class="receipt-rule"></div>';

    /* Payment */
    html += row('Payment', sale.payment || '—');
    if (sale.payment === 'Cash' || Number(sale.change) > 0) {
      html += row('Amount received', format.currency(sale.amountReceived));
      html += row('Change', format.currency(sale.change));
    }
    html += '<div class="receipt-rule"></div>';

    /* Footer */
    html += barcode(sale.receipt);
    html += '<div class="receipt-center receipt-thanks">Thank you for shopping with us!</div>';
    if (store.receiptFooter) {
      html += '<div class="receipt-center receipt-foot">' + escape(store.receiptFooter) + '</div>';
    }

    html += '</article>';
    return html;
  }

  /**
   * Opens the receipt in a modal with a paper-width switch and a print button.
   */
  function open(sale, options) {
    var config = options || {};
    var paper = config.paper === '58' ? '58' : '80';

    DH.modal.open({
      title: config.title || ('Receipt ' + (sale.receipt || '')),
      description: config.description || ('Thermal receipt · ' + PAPERS[paper].label + ' paper'),
      className: 'modal-receipt',
      confirmLabel: 'Done',
      cancelLabel: 'Close',
      body:
        '<div class="receipt-bar">' +
          '<span class="receipt-bar-meta">' +
            '<strong>' + escape(sale.receipt || 'Receipt') + '</strong>' +
            '<span>' + escape((sale.transactionId ? sale.transactionId + ' · ' : '') + PAPERS[paper].label + ' paper') + '</span>' +
          '</span>' +
          '<span class="receipt-bar-actions">' +
            '<button class="btn btn-primary" type="button" data-print-receipt>' + icon('printer', 16) + 'Print</button>' +
            '<button class="btn btn-ghost" type="button" data-receipt-close>Close</button>' +
            '<button class="btn btn-ghost" type="button" data-receipt-done>Done</button>' +
          '</span>' +
        '</div>' +
        '<div class="receipt-controls">' +
          '<div class="paper-toggle" role="group" aria-label="Paper width">' +
            '<button class="paper-btn' + (paper === '58' ? ' is-active' : '') + '" type="button" data-paper="58" aria-pressed="' + (paper === '58') + '">58 mm</button>' +
            '<button class="paper-btn' + (paper === '80' ? ' is-active' : '') + '" type="button" data-paper="80" aria-pressed="' + (paper === '80') + '">80 mm</button>' +
          '</div>' +
          '<span class="receipt-hint">' + icon('chevron-down', 13) + 'Scroll for the full receipt</span>' +
        '</div>' +
        '<div class="receipt-stage" id="receipt-stage">' + render(sale, { paper: paper }) + '</div>',
      onConfirm: function () { return true; }
    });

    var stage = document.getElementById('receipt-stage');
    var buttons = document.querySelectorAll('.paper-btn');

    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function () {
        var next = button.getAttribute('data-paper');
        if (stage) stage.innerHTML = render(sale, { paper: next });
        Array.prototype.forEach.call(buttons, function (other) {
          other.classList.toggle('is-active', other === button);
          other.setAttribute('aria-pressed', String(other === button));
        });
        if (typeof config.onPaper === 'function') config.onPaper(next);
      });
    });

    var printButton = document.querySelector('[data-print-receipt]');
    if (printButton) {
      printButton.addEventListener('click', function () {
        DH.toast('Opening the print dialog…', 'info');
        window.print();
      });
    }

    var closeButton = document.querySelector('[data-receipt-close]');
    if (closeButton) {
      closeButton.addEventListener('click', function () { DH.modal.close(); });
    }

    var doneButton = document.querySelector('[data-receipt-done]');
    if (doneButton) {
      doneButton.addEventListener('click', function () {
        DH.modal.close();
        if (typeof config.onDone === 'function') config.onDone();
      });
    }
  }

  DH.receipt = {
    render: render,
    open: open
  };

})(window);
