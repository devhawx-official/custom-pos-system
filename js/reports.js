/* ==========================================================================
   DevHawx POS — reports.js
   Sales analytics computed from the completed sales in localStorage:
   daily / weekly / monthly sales, totals, average order value, best selling
   products, payment mix, category performance and a sales chart. Nothing is
   hardcoded — every figure comes from the sales collection.
   ========================================================================== */

(function (window) {
  'use strict';

  var DH = window.DH;
  var icon = DH.icon;
  var format = DH.format;
  var escape = DH.util.escapeHtml;

  var state = {
    range: 'all',
    from: '',
    to: '',
    granularity: 'day'
  };

  var RANGES = [
    { value: 'all', label: 'All time' },
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'week', label: 'Last 7 days' },
    { value: 'month', label: 'Last 30 days' },
    { value: 'calendar', label: 'This month' },
    { value: 'lastmonth', label: 'Last month' },
    { value: 'year', label: 'This year' },
    { value: 'custom', label: 'Custom range' }
  ];

  var GRIDANULARITY = [
    { value: 'day', label: 'Days' },
    { value: 'week', label: 'Weeks' },
    { value: 'month', label: 'Months' }
  ];

  /* ---------- Date helpers ---------- */

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function isoDate(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function startOfDay(date) {
    var day = new Date(date);
    day.setHours(0, 0, 0, 0);
    return day;
  }

  function endOfDay(date) {
    var day = new Date(date);
    day.setHours(23, 59, 59, 999);
    return day;
  }

  function addDays(date, days) {
    var day = new Date(date);
    day.setDate(day.getDate() + days);
    return day;
  }

  function weekStart(date) {
    var day = startOfDay(date);
    var offset = (day.getDay() + 6) % 7;
    return addDays(day, -offset);
  }

  function dayKey(date) {
    return isoDate(date);
  }

  function weekKey(date) {
    return isoDate(weekStart(date));
  }

  function monthKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1);
  }

  function keyFor(date, unit) {
    if (unit === 'week') return weekKey(date);
    if (unit === 'month') return monthKey(date);
    return dayKey(date);
  }

  /* ---------- Range handling ---------- */

  function presetRange(value) {
    var now = new Date();
    var today = startOfDay(now);

    if (value === 'today') return { from: today, to: endOfDay(today) };
    if (value === 'yesterday') {
      var yesterday = addDays(today, -1);
      return { from: yesterday, to: endOfDay(yesterday) };
    }
    if (value === 'week') return { from: startOfDay(addDays(today, -6)), to: endOfDay(today) };
    if (value === 'month') return { from: startOfDay(addDays(today, -29)), to: endOfDay(today) };
    if (value === 'calendar') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(today) };
    if (value === 'lastmonth') {
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))
      };
    }
    if (value === 'year') return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(today) };

    return { from: null, to: null };
  }

  function resolveRange() {
    if (state.range === 'custom') {
      var from = state.from ? new Date(state.from + 'T00:00:00') : null;
      var to = state.to ? new Date(state.to + 'T23:59:59') : null;
      return { from: from, to: to, label: 'Custom range' };
    }

    var preset = presetRange(state.range);
    var label = RANGES.filter(function (range) { return range.value === state.range; })[0];
    return { from: preset.from, to: preset.to, label: label ? label.label : 'All time' };
  }

  function allSales() {
    return DH.store.collection('sales').all();
  }

  function filteredSales() {
    var range = resolveRange();

    return allSales().filter(function (sale) {
      var time = new Date(sale.createdAt || 0).getTime();
      if (isNaN(time)) return false;
      if (range.from && time < range.from.getTime()) return false;
      if (range.to && time > range.to.getTime()) return false;
      return true;
    }).sort(function (a, b) {
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
  }

  /** Range boundaries, falling back to the span of the stored sales. */
  function bounds(sales) {
    var range = resolveRange();
    var from = range.from;
    var to = range.to;

    if (!from || !to) {
      var times = sales.map(function (sale) {
        return new Date(sale.createdAt || 0).getTime();
      }).filter(function (time) { return !isNaN(time); });

      var min = times.length ? Math.min.apply(null, times) : Date.now();
      var max = times.length ? Math.max.apply(null, times) : Date.now();
      from = startOfDay(new Date(min));
      to = endOfDay(new Date(max));
    }

    return { from: startOfDay(from), to: endOfDay(to) };
  }

  /* ---------- Aggregations ---------- */

  function revenueOf(sales) {
    return Math.round(sales.reduce(function (sum, sale) {
      return sum + (Number(sale.total) || 0);
    }, 0) * 100) / 100;
  }

  function itemsOf(sales) {
    return sales.reduce(function (sum, sale) {
      return sum + (Number(sale.itemCount) || 0);
    }, 0);
  }

  /** Daily / weekly / monthly buckets inside the selected range. */
  function buckets(sales, unit, limit) {
    var span = bounds(sales);
    var list = [];
    var cursor;

    if (unit === 'week') {
      cursor = weekStart(span.from);
      while (cursor <= span.to) {
        list.push({
          key: weekKey(cursor),
          label: 'Week of ' + format.date(cursor, { month: 'short', day: 'numeric' }),
          value: 0,
          count: 0
        });
        cursor = addDays(cursor, 7);
      }
    } else if (unit === 'month') {
      cursor = new Date(span.from.getFullYear(), span.from.getMonth(), 1);
      while (cursor <= span.to) {
        list.push({
          key: monthKey(cursor),
          label: format.date(cursor, { month: 'short', year: 'numeric' }),
          value: 0,
          count: 0
        });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
    } else {
      cursor = startOfDay(span.from);
      while (cursor <= span.to) {
        list.push({
          key: dayKey(cursor),
          label: format.date(cursor, { month: 'short', day: 'numeric' }),
          value: 0,
          count: 0
        });
        cursor = addDays(cursor, 1);
      }
    }

    if (list.length > limit) list = list.slice(-limit);

    var totals = {};
    sales.forEach(function (sale) {
      var key = keyFor(new Date(sale.createdAt || 0), unit);
      if (!totals[key]) totals[key] = { value: 0, count: 0 };
      totals[key].value += Number(sale.total) || 0;
      totals[key].count += 1;
    });

    list.forEach(function (item) {
      if (totals[item.key]) {
        item.value = Math.round(totals[item.key].value * 100) / 100;
        item.count = totals[item.key].count;
      }
    });

    return list;
  }

  function bestSellers(sales, limit) {
    var map = {};

    sales.forEach(function (sale) {
      (Array.isArray(sale.items) ? sale.items : []).forEach(function (item) {
        var key = item.productId || item.name;
        if (!map[key]) {
          map[key] = {
            name: item.name || 'Unknown product',
            sku: item.sku || '',
            qty: 0,
            revenue: 0
          };
        }
        var quantity = Number(item.quantity) || 0;
        map[key].qty += quantity;
        map[key].revenue += (Number(item.price) || 0) * quantity;
      });
    });

    return Object.keys(map).map(function (key) {
      map[key].revenue = Math.round(map[key].revenue * 100) / 100;
      return map[key];
    }).sort(function (a, b) {
      return b.qty - a.qty || b.revenue - a.revenue;
    }).slice(0, limit);
  }

  function paymentMix(sales) {
    var map = {};
    var revenue = revenueOf(sales);

    sales.forEach(function (sale) {
      var method = String(sale.payment || 'Card');
      if (!map[method]) map[method] = { method: method, count: 0, revenue: 0 };
      map[method].count += 1;
      map[method].revenue += Number(sale.total) || 0;
    });

    return Object.keys(map).map(function (key) {
      map[key].revenue = Math.round(map[key].revenue * 100) / 100;
      map[key].share = revenue ? (map[key].revenue / revenue) * 100 : 0;
      return map[key];
    }).sort(function (a, b) {
      return b.revenue - a.revenue;
    });
  }

  function categoryPerformance(sales, limit) {
    var products = DH.store.collection('products').all();
    var map = {};

    sales.forEach(function (sale) {
      (Array.isArray(sale.items) ? sale.items : []).forEach(function (item) {
        var product = products.filter(function (entry) { return entry.id === item.productId; })[0];
        var category = (product && product.category) || 'Uncategorised';
        if (!map[category]) map[category] = { category: category, qty: 0, revenue: 0 };

        var quantity = Number(item.quantity) || 0;
        map[category].qty += quantity;
        map[category].revenue += (Number(item.price) || 0) * quantity;
      });
    });

    return Object.keys(map).map(function (key) {
      map[key].revenue = Math.round(map[key].revenue * 100) / 100;
      return map[key];
    }).sort(function (a, b) {
      return b.revenue - a.revenue;
    }).slice(0, limit);
  }

  /* ---------- Markup ---------- */

  function sparkBars(series) {
    if (!series.length) return '<div class="mini-bars" aria-hidden="true"></div>';

    var max = series.reduce(function (highest, item) {
      return Math.max(highest, item.value);
    }, 0) || 1;

    return '<div class="mini-bars" aria-hidden="true">' +
      series.map(function (item) {
        var height = item.value > 0 ? Math.max(6, Math.round((item.value / max) * 100)) : 2;
        return '<span style="height:' + height + '%" title="' + escape(item.label + ': ' + format.currency(item.value)) + '"></span>';
      }).join('') +
    '</div>';
  }

  function aggregationCard(title, subtitle, series, unitLabel) {
    var total = series.reduce(function (sum, item) { return sum + item.value; }, 0);
    var peak = series.reduce(function (best, item) {
      return (!best || item.value > best.value) ? item : best;
    }, null);
    var average = series.length ? total / series.length : 0;

    return '<section class="card report-card">' +
      '<header class="card-head">' +
        '<div><h3>' + escape(title) + '</h3><p>' + escape(subtitle) + '</p></div>' +
        '<span class="chip">' + icon('calendar', 13) + series.length + ' ' + escape(unitLabel) + '</span>' +
      '</header>' +
      sparkBars(series) +
      '<div class="report-caption">' +
        '<span>Total ' + format.currency(total) + ' · avg ' + format.currency(average) + '</span>' +
        '<span>' + (peak && peak.value > 0 ? 'Peak ' + escape(peak.label) : 'No sales yet') + '</span>' +
      '</div>' +
    '</section>';
  }

  function listRows(rows, options) {
    var config = options || {};

    if (!rows.length) {
      return '<div class="report-empty">' + icon('reports', 20) + '<span>' + escape(config.empty || 'No data in this range') + '</span></div>';
    }

    var max = rows.reduce(function (highest, row) {
      return Math.max(highest, row.value);
    }, 0) || 1;

    return '<div class="report-list">' +
      rows.map(function (row) {
        var share = Math.max(2, Math.round((row.value / max) * 100));
        return '<div class="report-row">' +
          '<span class="report-row-copy">' +
            '<strong>' + escape(row.label) + '</strong>' +
            '<span>' + escape(row.meta || '') + '</span>' +
          '</span>' +
          '<span class="report-track"><span class="report-fill" style="width:' + share + '%"></span></span>' +
          '<span class="report-value">' + escape(row.display) + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function chartMarkup(series) {
    if (!series.length) {
      return '<div class="report-empty">' + icon('reports', 20) + '<span>No sales in this range</span></div>';
    }

    var width = 1000;
    var height = 240;
    var padTop = 16;
    var padBottom = 10;
    var max = series.reduce(function (highest, item) { return Math.max(highest, item.value); }, 0) || 1;
    var slot = width / series.length;
    var barWidth = Math.max(3, Math.min(40, slot * 0.56));

    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (ratio) {
      var y = padTop + (height - padTop - padBottom) * ratio;
      return '<line class="report-grid-line" x1="0" y1="' + y.toFixed(1) + '" x2="' + width + '" y2="' + y.toFixed(1) + '"/>';
    }).join('');

    var bars = series.map(function (item, index) {
      var barHeight = item.value > 0 ? Math.max(4, (item.value / max) * (height - padTop - padBottom)) : 2;
      var x = index * slot + (slot - barWidth) / 2;
      var y = height - padBottom - barHeight;
      return '<rect class="report-bar" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barWidth.toFixed(1) + '" height="' + barHeight.toFixed(1) + '" rx="3">' +
        '<title>' + escape(item.label + ' · ' + format.currency(item.value)) + '</title></rect>';
    }).join('');

    var step = Math.max(1, Math.ceil(series.length / 7));
    var shown = series.filter(function (item, index) {
      return index % step === 0 || index === series.length - 1;
    });

    return '<div class="report-chart">' +
      '<svg class="report-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<defs><linearGradient id="reportBarFill" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#2F6BFF" stop-opacity=".9"/>' +
          '<stop offset="100%" stop-color="#2F6BFF" stop-opacity=".25"/>' +
        '</linearGradient></defs>' +
        grid + bars +
      '</svg>' +
      '<div class="report-chart-labels">' +
        shown.map(function (item) { return '<span>' + escape(item.label) + '</span>'; }).join('') +
      '</div>' +
    '</div>';
  }

  /* ---------- CSV export ---------- */

  function csvCell(value) {
    var text = String(value === null || value === undefined ? '' : value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function exportCsv(sales) {
    var rows = [['Receipt', 'Transaction', 'Date', 'Time', 'Customer', 'Payment', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total']];

    sales.forEach(function (sale) {
      rows.push([
        sale.receipt || '',
        sale.transactionId || '',
        isoDate(new Date(sale.createdAt || 0)),
        format.time(sale.createdAt),
        sale.customerName || 'Walk-in customer',
        sale.payment || '',
        Number(sale.itemCount) || 0,
        (Number(sale.subtotal) || 0).toFixed(2),
        (Number(sale.discount) || 0).toFixed(2),
        (Number(sale.tax) || 0).toFixed(2),
        (Number(sale.total) || 0).toFixed(2)
      ]);
    });

    var csv = rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');

    var name = 'devhawx-sales-' + (state.from || 'all') + '-to-' + (state.to || 'all') + '.csv';
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');

    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);

    DH.toast('Exported ' + sales.length + ' transaction' + (sales.length === 1 ? '' : 's') + ' to CSV.', 'success');
  }

  /* ---------- Rendering ---------- */

  function paint(view) {
    var sales = filteredSales();
    var range = resolveRange();
    var revenue = revenueOf(sales);
    var transactions = sales.length;
    var average = transactions ? Math.round((revenue / transactions) * 100) / 100 : 0;

    var daily = buckets(sales, 'day', 14);
    var weekly = buckets(sales, 'week', 8);
    var monthly = buckets(sales, 'month', 6);
    var chart = buckets(sales, state.granularity, state.granularity === 'day' ? 30 : (state.granularity === 'week' ? 12 : 12));
    var sellers = bestSellers(sales, 6);
    var payments = paymentMix(sales);
    var categories = categoryPerformance(sales, 6);

    var rangeLabel = range.label;
    if (state.range === 'custom' && (state.from || state.to)) {
      rangeLabel = (state.from || 'start') + ' → ' + (state.to || 'today');
    }

    view.innerHTML =
      '<div class="view-toolbar">' +
        '<div class="toolbar-left">' +
          '<label class="filter-select" for="report-range">' + icon('calendar', 15) +
            '<select id="report-range" aria-label="Report date range">' +
              RANGES.map(function (option) {
                return '<option value="' + option.value + '"' + (state.range === option.value ? ' selected' : '') + '>' + escape(option.label) + '</option>';
              }).join('') +
            '</select>' +
            '<span class="filter-chevron" aria-hidden="true">' + icon('chevron-down', 14) + '</span>' +
          '</label>' +
          '<label class="date-field" for="report-from">' + icon('calendar', 14) +
            '<input id="report-from" type="date" value="' + escape(state.from) + '" aria-label="Range start date">' +
          '</label>' +
          '<label class="date-field" for="report-to">' + icon('calendar', 14) +
            '<input id="report-to" type="date" value="' + escape(state.to) + '" aria-label="Range end date">' +
          '</label>' +
        '</div>' +
        '<div class="toolbar-right">' +
          '<span class="toolbar-count">' + escape(rangeLabel) + ' · ' + transactions + ' transaction' + (transactions === 1 ? '' : 's') + '</span>' +
          '<button class="btn btn-primary" type="button" id="export-report" ' + (transactions ? '' : 'disabled') + '>' +
            icon('download', 17) + 'Export CSV</button>' +
        '</div>' +
      '</div>' +

      '<div class="stat-grid">' +
        DH.ui.statCard({ label: 'Total revenue', value: format.currency(revenue), hint: 'Completed sales in range', icon: 'dollar', tone: 'blue', trend: rangeLabel, trendIcon: 'calendar' }) +
        DH.ui.statCard({ label: 'Total transactions', value: format.number(transactions), hint: 'Receipts in range', icon: 'receipt', tone: 'cyan', trend: rangeLabel, trendIcon: 'calendar' }) +
        DH.ui.statCard({ label: 'Average order value', value: format.currency(average), hint: 'Revenue per transaction', icon: 'wallet', tone: 'emerald', trend: 'AOV', trendIcon: 'percent' }) +
        DH.ui.statCard({ label: 'Items sold', value: format.number(itemsOf(sales)), hint: 'Units across receipts', icon: 'box', tone: 'navy', trend: 'Volume', trendIcon: 'layers' }) +
      '</div>' +

      '<section class="card table-card report-chart-card">' +
        '<header class="card-head table-card-head">' +
          '<div><h3>Sales chart</h3><p>Revenue over the selected range</p></div>' +
          '<div class="range-toggle" role="group" aria-label="Chart granularity">' +
            GRIDANULARITY.map(function (option) {
              return '<button class="range-btn' + (state.granularity === option.value ? ' is-active' : '') +
                '" type="button" data-granularity="' + option.value + '" aria-pressed="' + (state.granularity === option.value) + '">' +
                option.label + '</button>';
            }).join('') +
          '</div>' +
        '</header>' +
        chartMarkup(chart) +
        '<div class="report-caption">' +
          '<span>Total ' + format.currency(revenue) + ' · avg ' + format.currency(average) + ' per transaction</span>' +
          '<span>Peak ' + (chart.length ? escape(chart.reduce(function (best, item) { return item.value > best.value ? item : best; }, chart[0]).label) : '—') + '</span>' +
        '</div>' +
      '</section>' +

      '<div class="report-grid">' +
        aggregationCard('Daily sales', 'Revenue per day', daily, 'days') +
        aggregationCard('Weekly sales', 'Revenue per week', weekly, 'weeks') +
        aggregationCard('Monthly sales', 'Revenue per month', monthly, 'months') +

        '<section class="card report-card">' +
          '<header class="card-head">' +
            '<div><h3>Best-selling products</h3><p>Ranked by units sold</p></div>' +
            '<span class="chip">' + icon('box', 13) + sellers.length + ' products</span>' +
          '</header>' +
          listRows(sellers.map(function (product) {
            return {
              label: product.name,
              meta: product.qty + ' unit' + (product.qty === 1 ? '' : 's') + ' · ' + (product.sku || 'No SKU'),
              value: product.qty,
              display: format.currency(product.revenue)
            };
          }), { empty: 'No products sold in this range' }) +
        '</section>' +

        '<section class="card report-card">' +
          '<header class="card-head">' +
            '<div><h3>Payment method breakdown</h3><p>How customers paid</p></div>' +
            '<span class="chip">' + icon('card', 13) + payments.length + ' methods</span>' +
          '</header>' +
          listRows(payments.map(function (payment) {
            return {
              label: payment.method,
              meta: payment.count + ' transaction' + (payment.count === 1 ? '' : 's') + ' · ' + format.percent(payment.share),
              value: payment.revenue,
              display: format.currency(payment.revenue)
            };
          }), { empty: 'No payments recorded in this range' }) +
        '</section>' +

        '<section class="card report-card">' +
          '<header class="card-head">' +
            '<div><h3>Sales by category</h3><p>Which departments drive the basket</p></div>' +
            '<span class="chip">' + icon('tag', 13) + categories.length + ' categories</span>' +
          '</header>' +
          listRows(categories.map(function (category) {
            return {
              label: category.category,
              meta: category.qty + ' unit' + (category.qty === 1 ? '' : 's'),
              value: category.revenue,
              display: format.currency(category.revenue)
            };
          }), { empty: 'No category sales in this range' }) +
        '</section>' +
      '</div>';

    bindControls(view);
  }

  function bindControls(view) {
    var range = view.querySelector('#report-range');
    if (range) {
      range.addEventListener('change', function () {
        state.range = range.value;
        if (state.range !== 'custom') {
          var preset = presetRange(state.range);
          state.from = preset.from ? isoDate(preset.from) : '';
          state.to = preset.to ? isoDate(preset.to) : '';
        }
        paint(view);
      });
    }

    var from = view.querySelector('#report-from');
    var to = view.querySelector('#report-to');

    if (from) {
      from.addEventListener('change', function () {
        state.from = from.value;
        state.range = 'custom';
        paint(view);
      });
    }

    if (to) {
      to.addEventListener('change', function () {
        state.to = to.value;
        state.range = 'custom';
        paint(view);
      });
    }

    var granularity = view.querySelectorAll('[data-granularity]');
    Array.prototype.forEach.call(granularity, function (button) {
      button.addEventListener('click', function () {
        state.granularity = button.getAttribute('data-granularity');
        paint(view);
      });
    });

    var exportButton = view.querySelector('#export-report');
    if (exportButton) {
      exportButton.addEventListener('click', function () {
        exportCsv(filteredSales());
      });
    }
  }

  function renderView(view) {
    if (!view.dataset.reportsBound) {
      view.addEventListener('click', function () { /* delegated controls are bound per paint */ });
      view.dataset.reportsBound = 'true';
    }
    paint(view);
  }

  DH.views.reports = { id: 'reports', render: renderView };

})(window);
