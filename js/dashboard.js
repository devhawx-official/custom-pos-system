/* ==========================================================================
   DevHawx POS — dashboard.js
   Overview screen: KPIs, interactive sales chart, low-stock watchlist and
   recent transactions. Everything is derived from the local data layer.
   ========================================================================== */

(function (window) {
  'use strict';

  var DH = window.DH;
  var icon = DH.icon;
  var escape = DH.util.escapeHtml;
  var format = DH.format;

  var CHART_W = 720;
  var CHART_H = 220;
  var CHART_TOP = 18;
  var CHART_BOTTOM = 196;

  /* ---------- Date & sales helpers ---------- */

  function startOfDay(value) {
    var date = value ? new Date(value) : new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function addDays(value, days) {
    var date = new Date(value);
    date.setDate(date.getDate() + days);
    return date;
  }

  function saleDate(sale) {
    return new Date(sale.createdAt || sale.date || sale.updatedAt || 0);
  }

  function sumSales(list) {
    return list.reduce(function (sum, sale) {
      return sum + (Number(sale.total) || 0);
    }, 0);
  }

  function salesInRange(list, start, end) {
    return list.filter(function (sale) {
      var date = saleDate(sale);
      return !isNaN(date.getTime()) && date >= start && date < end;
    });
  }

  function changeFor(current, previous) {
    if (!previous) {
      return {
        text: current > 0 ? 'New' : '0%',
        tone: current > 0 ? 'up' : 'neutral'
      };
    }
    var percent = ((current - previous) / previous) * 100;
    return {
      text: (percent >= 0 ? '+' : '') + percent.toFixed(1) + '%',
      tone: percent > 0.05 ? 'up' : percent < -0.05 ? 'down' : 'neutral'
    };
  }

  function plural(count, singular, pluralWord) {
    return count + ' ' + (count === 1 ? singular : (pluralWord || singular + 's'));
  }

  /* ---------- Chart geometry ---------- */

  function chartPoints(sales, days) {
    var today = startOfDay();
    var points = [];

    for (var offset = days - 1; offset >= 0; offset -= 1) {
      var start = addDays(today, -offset);
      var end = addDays(start, 1);
      var daySales = salesInRange(sales, start, end);
      points.push({
        date: start,
        value: sumSales(daySales),
        count: daySales.length
      });
    }

    return points;
  }

  function niceMax(value) {
    if (value <= 0) return 100;
    var magnitude = Math.pow(10, Math.floor(Math.log(value) / Math.LN10));
    var normalized = value / magnitude;
    var step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return step * magnitude;
  }

  function lineCoords(points, max) {
    var count = points.length;
    var usable = CHART_W - 16;
    return points.map(function (point, index) {
      var x = 8 + (count === 1 ? usable / 2 : (index * usable) / (count - 1));
      var y = CHART_BOTTOM - (point.value / max) * (CHART_BOTTOM - CHART_TOP);
      return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    });
  }

  function smoothPath(coords) {
    if (!coords.length) return '';
    var path = 'M ' + coords[0][0] + ' ' + coords[0][1];

    for (var i = 0; i < coords.length - 1; i += 1) {
      var previous = coords[i - 1] || coords[i];
      var current = coords[i];
      var next = coords[i + 1];
      var following = coords[i + 2] || next;
      var tension = 0.18;

      var cp1x = current[0] + (next[0] - previous[0]) * tension;
      var cp1y = current[1] + (next[1] - previous[1]) * tension;
      var cp2x = next[0] - (following[0] - current[0]) * tension;
      var cp2y = next[1] - (following[1] - current[1]) * tension;

      cp1y = Math.max(CHART_TOP, Math.min(CHART_BOTTOM, cp1y));
      cp2y = Math.max(CHART_TOP, Math.min(CHART_BOTTOM, cp2y));

      path += ' C ' + cp1x.toFixed(2) + ' ' + cp1y.toFixed(2) +
        ', ' + cp2x.toFixed(2) + ' ' + cp2y.toFixed(2) +
        ', ' + next[0] + ' ' + next[1];
    }

    return path;
  }

  function axisLabel(point, days) {
    return days <= 7
      ? format.date(point.date, { weekday: 'short' })
      : format.date(point.date, { month: 'short', day: 'numeric' });
  }

  function chartMarkup(points, days, sales) {
    var max = niceMax(Math.max.apply(null, points.map(function (point) { return point.value; })));
    var coords = lineCoords(points, max);
    var path = smoothPath(coords);
    var first = coords[0];
    var last = coords[coords.length - 1];
    var area = path + ' L ' + last[0] + ' ' + CHART_BOTTOM + ' L ' + first[0] + ' ' + CHART_BOTTOM + ' Z';

    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (fraction) {
      var y = CHART_TOP + fraction * (CHART_BOTTOM - CHART_TOP);
      return '<line class="chart-grid-line" x1="0" y1="' + y + '" x2="' + CHART_W + '" y2="' + y + '"/>';
    }).join('');

    var rangeTotal = points.reduce(function (sum, point) { return sum + point.value; }, 0);
    var rangeStart = points[0].date;
    var previousStart = addDays(rangeStart, -days);
    var previousTotal = sumSales(salesInRange(sales, previousStart, rangeStart));
    var change = changeFor(rangeTotal, previousTotal);

    var labelIndexes = days <= 7
      ? points.map(function (_, index) { return index; })
      : [0, 5, 10, 15, 20, 25, points.length - 1];
    var labels = labelIndexes.map(function (index) {
      return '<span>' + escape(axisLabel(points[index], days)) + '</span>';
    }).join('');

    var summary = 'Revenue over the last ' + days + ' days totals ' + format.currency(rangeTotal) + '.';

    return {
      coords: coords,
      points: points,
      html:
        '<div class="chart-summary">' +
          '<strong>' + format.currency(rangeTotal) + '</strong>' +
          '<span class="trend-chip trend-' + change.tone + '">' +
            icon(change.tone === 'down' ? 'trend-down' : 'trend-up', 13) + escape(change.text) +
          '</span>' +
          '<span class="chart-summary-note">vs previous ' + days + ' days</span>' +
        '</div>' +
        '<div class="chart-body" role="img" aria-label="' + escape(summary) + '">' +
          '<svg class="chart-svg" viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" preserveAspectRatio="none" aria-hidden="true">' +
            '<defs>' +
              '<linearGradient id="chartAreaFill" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0%" stop-color="#2F6BFF" stop-opacity=".22"/>' +
                '<stop offset="100%" stop-color="#2F6BFF" stop-opacity="0"/>' +
              '</linearGradient>' +
              '<linearGradient id="chartLineStroke" x1="0" y1="0" x2="1" y2="0">' +
                '<stop offset="0%" stop-color="#2F6BFF"/>' +
                '<stop offset="100%" stop-color="#12B8D6"/>' +
              '</linearGradient>' +
            '</defs>' +
            '<g class="chart-grid">' + grid + '</g>' +
            '<path class="chart-area" d="' + area + '" fill="url(#chartAreaFill)"/>' +
            '<path class="chart-line" d="' + path + '" stroke="url(#chartLineStroke)"/>' +
          '</svg>' +
          '<span class="chart-hover-line" hidden></span>' +
          '<span class="chart-hover-dot" hidden></span>' +
          '<span class="chart-tooltip" hidden></span>' +
        '</div>' +
        '<div class="chart-x" aria-hidden="true">' + labels + '</div>'
    };
  }

  function bindChartHover(panel, chart) {
    var body = panel.querySelector('.chart-body');
    if (!body) return;

    var line = body.querySelector('.chart-hover-line');
    var dot = body.querySelector('.chart-hover-dot');
    var tooltip = body.querySelector('.chart-tooltip');
    if (!line || !dot || !tooltip) return;

    function show(index) {
      var point = chart.points[index];
      var coord = chart.coords[index];
      var xPercent = (coord[0] / CHART_W) * 100;
      var yPercent = (coord[1] / CHART_H) * 100;
      var below = yPercent < 58;

      line.hidden = false;
      dot.hidden = false;
      tooltip.hidden = false;
      line.style.left = xPercent + '%';
      dot.style.left = xPercent + '%';
      dot.style.top = yPercent + '%';
      tooltip.style.left = Math.max(12, Math.min(88, xPercent)) + '%';
      tooltip.style.top = yPercent + '%';
      tooltip.style.transform = below
        ? 'translate(-50%, 12px)'
        : 'translate(-50%, calc(-100% - 12px))';
      tooltip.innerHTML =
        '<strong>' + format.currency(point.value) + '</strong>' +
        '<span>' + escape(format.date(point.date, { weekday: 'short', month: 'short', day: 'numeric' })) +
        ' · ' + plural(point.count, 'sale') + '</span>';
    }

    function hide() {
      line.hidden = true;
      dot.hidden = true;
      tooltip.hidden = true;
    }

    body.addEventListener('pointermove', function (event) {
      var rect = body.getBoundingClientRect();
      if (!rect.width) return;
      var ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      show(Math.round(ratio * (chart.points.length - 1)));
    });

    body.addEventListener('pointerleave', hide);
  }

  function mountChart(panel, sales, days) {
    if (!panel) return;
    var points = chartPoints(sales, days);
    var chart = chartMarkup(points, days, sales);
    panel.innerHTML = chart.html;
    bindChartHover(panel, chart);
  }

  /* ---------- Sections ---------- */

  function introMarkup(config) {
    return '<section class="dash-intro">' +
      '<div class="dash-intro-copy">' +
        '<p class="dash-eyebrow"><span class="live-dot" aria-hidden="true"></span>Live overview' +
          '<span class="dash-sep" aria-hidden="true">·</span>' +
          '<span>' + escape(format.date(null, { weekday: 'long', month: 'long', day: 'numeric' })) + '</span>' +
        '</p>' +
        '<h2>' + escape(DH.util.greeting()) + ', ' + escape(config.cashierName || 'Admin') + '.</h2>' +
        '<p>Here is how <strong>' + escape(config.storeName || 'your store') + '</strong> is performing today.</p>' +
      '</div>' +
      '<div class="dash-actions">' +
        '<a class="btn btn-ghost" href="#/reports">' + icon('reports', 17) + 'View reports</a>' +
        '<a class="btn btn-primary" href="#/pos">' + icon('pos', 17) + 'New sale</a>' +
      '</div>' +
    '</section>';
  }

  function kpiMarkup(config, sales, products, threshold) {
    var today = startOfDay();
    var tomorrow = addDays(today, 1);
    var yesterday = addDays(today, -1);

    var todaySales = salesInRange(sales, today, tomorrow);
    var yesterdaySales = salesInRange(sales, yesterday, today);
    var todayRevenue = sumSales(todaySales);
    var todayChange = changeFor(todayRevenue, sumSales(yesterdaySales));

    var weekStart = addDays(today, -6);
    var previousWeekStart = addDays(today, -13);
    var weekSales = salesInRange(sales, weekStart, tomorrow);
    var previousWeekSales = salesInRange(sales, previousWeekStart, weekStart);
    var weekChange = changeFor(weekSales.length, previousWeekSales.length);

    var totalRevenue = sumSales(sales);
    var weekRevenue = sumSales(weekSales);
    var previousWeekRevenue = sumSales(previousWeekSales);
    var revenueChange = changeFor(weekRevenue, previousWeekRevenue);
    var averageBasket = sales.length ? totalRevenue / sales.length : 0;

    var lowStock = products.filter(function (product) {
      return Number(product.stock) > 0 && Number(product.stock) <= threshold;
    });
    var outOfStock = products.filter(function (product) {
      return Number(product.stock) === 0;
    });
    var alerts = lowStock.length + outOfStock.length;

    return '<div class="stat-grid">' +
      DH.ui.statCard({
        label: "Today's sales",
        value: format.currency(todayRevenue),
        hint: todaySales.length
          ? plural(todaySales.length, 'order') + ' today · avg ' + format.currency(todayRevenue / todaySales.length)
          : 'No sales recorded yet today',
        icon: 'dollar',
        tone: 'blue',
        trend: todayChange.text,
        trendTone: todayChange.tone,
        href: '#/sales'
      }) +
      DH.ui.statCard({
        label: 'Total orders',
        value: format.number(sales.length),
        hint: plural(weekSales.length, 'order') + ' in the last 7 days',
        icon: 'receipt',
        tone: 'cyan',
        trend: weekChange.text,
        trendTone: weekChange.tone,
        href: '#/sales'
      }) +
      DH.ui.statCard({
        label: 'Total revenue',
        value: format.currency(totalRevenue),
        hint: 'All-time · avg. basket ' + format.currency(averageBasket),
        icon: 'wallet',
        tone: 'emerald',
        trend: revenueChange.text,
        trendTone: revenueChange.tone,
        href: '#/reports'
      }) +
      DH.ui.statCard({
        label: 'Total products',
        value: format.number(products.length),
        hint: products.length
          ? plural(lowStock.length, 'item') + ' low · ' + outOfStock.length + ' out of stock'
          : 'Catalog is ready for products',
        icon: 'products',
        tone: 'navy',
        trend: alerts ? alerts + ' alert' + (alerts === 1 ? '' : 's') : 'Healthy',
        trendTone: alerts ? 'down' : 'up',
        trendIcon: alerts ? 'alert-triangle' : 'check-circle',
        href: '#/products'
      }) +
    '</div>';
  }

  function chartCardMarkup() {
    return '<section class="card chart-card">' +
      '<header class="card-head chart-head">' +
        '<div><h3>Sales analytics</h3><p>Revenue collected across the selected range</p></div>' +
        '<div class="range-toggle" role="group" aria-label="Chart range">' +
          '<button class="range-btn is-active" type="button" data-chart-range="7" aria-pressed="true">7 days</button>' +
          '<button class="range-btn" type="button" data-chart-range="30" aria-pressed="false">30 days</button>' +
        '</div>' +
      '</header>' +
      '<div class="chart-panel" id="chart-panel"></div>' +
    '</section>';
  }

  function lowStockMarkup(products, threshold) {
    var lowStock = products.filter(function (product) {
      return Number(product.stock) <= threshold;
    }).sort(function (a, b) {
      return Number(a.stock) - Number(b.stock);
    });

    var list = lowStock.length
      ? lowStock.slice(0, 4).map(function (product) {
        var stock = Number(product.stock) || 0;
        var out = stock === 0;
        return '<a class="low-stock-item" href="#/inventory">' +
          '<span class="low-stock-thumb' + (out ? ' is-out' : '') + '">' +
            icon(out ? 'x-circle' : 'alert-triangle', 17) +
          '</span>' +
          '<span class="low-stock-copy">' +
            '<strong>' + escape(product.name) + '</strong>' +
            '<span>' + escape(product.sku) + ' · ' + escape(product.category) + '</span>' +
          '</span>' +
          '<span class="stock-pill' + (out ? ' is-out' : '') + '">' + (out ? 'Out' : stock + ' left') + '</span>' +
        '</a>';
      }).join('')
      : DH.ui.emptyState({
        compact: true,
        icon: 'check-circle',
        title: 'All stocked up',
        text: 'Every product is above the low-stock threshold.'
      });

    return '<section class="card low-stock-card">' +
      '<header class="card-head">' +
        '<div><h3>Low stock alerts</h3><p>Reorder before you run out</p></div>' +
        '<span class="chip' + (lowStock.length ? ' chip-warning' : '') + '">' +
          icon(lowStock.length ? 'alert-triangle' : 'check-circle', 13) +
          (lowStock.length ? lowStock.length + ' items' : 'All clear') +
        '</span>' +
      '</header>' +
      '<div class="low-stock-list">' + list + '</div>' +
      '<div class="low-stock-foot">' +
        (lowStock.length > 4 ? '<span class="low-stock-more">+' + (lowStock.length - 4) + ' more</span>' : '') +
        '<a class="text-link" href="#/inventory">Review inventory' + icon('arrow-right', 14) + '</a>' +
      '</div>' +
    '</section>';
  }

  function paymentIcon(payment) {
    if (payment === 'Cash') return 'wallet';
    if (payment === 'Digital wallet') return 'phone';
    return 'card';
  }

  function recentTransactionsMarkup(sales) {
    var recent = sales.slice().sort(function (a, b) {
      return saleDate(b) - saleDate(a);
    }).slice(0, 6);

    var body = recent.length
      ? recent.map(function (sale) {
        var date = saleDate(sale);
        var items = Number(sale.itemCount) || (Array.isArray(sale.items) ? sale.items.reduce(function (sum, item) {
          return sum + (Number(item.quantity) || 1);
        }, 0) : 0);
        var walkIn = !sale.customerId;
        return '<tr>' +
          '<td><a class="receipt-code" href="#/sales">' + escape(sale.receipt || sale.id) + '</a></td>' +
          '<td>' +
            '<span class="customer-cell">' +
              '<span class="mini-avatar' + (walkIn ? ' is-walk-in' : '') + '">' +
                escape(walkIn ? 'WI' : DH.util.initials(sale.customerName)) +
              '</span>' +
              '<span class="customer-copy"><strong>' + escape(sale.customerName || 'Walk-in customer') + '</strong>' +
                '<span>' + plural(items, 'item') + '</span></span>' +
            '</span>' +
          '</td>' +
          '<td><span class="date-cell"><strong>' + escape(format.date(date, { month: 'short', day: 'numeric' })) + '</strong>' +
            '<span>' + escape(format.time(date)) + '</span></span></td>' +
          '<td><span class="payment-pill">' + icon(paymentIcon(sale.payment), 13) + escape(sale.payment || 'Card') + '</span></td>' +
          '<td class="align-right"><strong class="amount-cell">' + format.currency(sale.total) + '</strong></td>' +
          '<td class="align-right"><span class="status-pill">' + icon('check', 11) + 'Paid</span></td>' +
        '</tr>';
      }).join('')
      : '<tr><td colspan="6" class="table-empty">' + DH.ui.emptyState({
        icon: 'receipt',
        title: 'No transactions yet',
        text: 'Complete a checkout and the latest receipts will appear here.'
      }) + '</td></tr>';

    return '<section class="card table-card">' +
      '<header class="card-head table-card-head">' +
        '<div><h3>Recent transactions</h3><p>Latest completed checkouts from this register</p></div>' +
        '<a class="text-link" href="#/sales">View all' + icon('arrow-right', 14) + '</a>' +
      '</header>' +
      '<div class="table-wrap">' +
        '<table class="data-table recent-table">' +
          '<thead><tr>' +
            '<th>Receipt</th><th>Customer</th><th>Date</th><th>Payment</th>' +
            '<th class="align-right">Total</th><th class="align-right">Status</th>' +
          '</tr></thead>' +
          '<tbody>' + body + '</tbody>' +
        '</table>' +
      '</div>' +
    '</section>';
  }

  /* ---------- View ---------- */

  function render(view) {
    var config = DH.store.getSettings();
    var products = DH.store.collection('products').all();
    var sales = DH.store.collection('sales').all();
    var threshold = Number(config.lowStockThreshold) || 10;

    view.innerHTML =
      introMarkup(config) +
      kpiMarkup(config, sales, products, threshold) +
      '<div class="dashboard-grid">' +
        chartCardMarkup() +
        lowStockMarkup(products, threshold) +
      '</div>' +
      recentTransactionsMarkup(sales);

    var chartPanel = view.querySelector('#chart-panel');
    mountChart(chartPanel, sales, 7);

    view.querySelectorAll('[data-chart-range]').forEach(function (button) {
      button.addEventListener('click', function () {
        var days = Number(button.getAttribute('data-chart-range')) || 7;
        view.querySelectorAll('[data-chart-range]').forEach(function (other) {
          var active = other === button;
          other.classList.toggle('is-active', active);
          other.setAttribute('aria-pressed', String(active));
        });
        mountChart(chartPanel, sales, days);
      });
    });
  }

  DH.views.dashboard = { id: 'dashboard', render: render };

})(window);
