/* ==========================================================================
   DevHawx POS — app.js
   Application core: icon set, formatters, shared UI helpers, hash router,
   sidebar/topbar behaviour and global event delegation.
   Modules register themselves on DH.views[routeId] = { render(view, route) }.
   ========================================================================== */

(function (window, document) {
  'use strict';

  var DH = window.DH = window.DH || {};
  DH.views = DH.views || {};

  /* ---------- Icon system (inline SVG, currentColor) ---------- */

  var ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
    pos: '<path d="M6 7h12l1.2 13H4.8L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    products: '<path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z"/><path d="m3 8.5 9 5.5 9-5.5M12 14v7"/>',
    inventory: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
    customers: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11"/>',
    sales: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    reports: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9c.14.37.47.65.87.76H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-right': '<path d="m9 6 6 6-6 6"/>',
    'arrow-right': '<path d="M4 12h16M14 6l6 6-6 6"/>',
    'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
    'arrow-left': '<path d="M20 12H4M10 6l-6 6 6 6"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    'alert-triangle': '<path d="M10.3 3.9 2.4 17.5A1.8 1.8 0 0 0 4 20h16a1.8 1.8 0 0 0 1.6-2.5L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    'x-circle': '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    dollar: '<path d="M12 2v20M17 6.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6.5"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    sparkles: '<path d="m12 3 1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
    store: '<path d="M4 9.5V20h16V9.5"/><path d="M3 4h18l1 5.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0L3 4Z"/><path d="M9 20v-5h6v5"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h3"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.4"/><path d="M20 4v7h-7"/>',
    filter: '<path d="M3 5h18l-7 8.5V20l-4 2v-8.5L3 5Z"/>',
    'trend-up': '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    'trend-down': '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    box: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M8 6V3h8v3"/>',
    receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
    barcode: '<path d="M4 5v14M8 5v14M12 5v9M16 5v14M20 5v14"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m14.5 5.5 4 4"/>',
    sliders: '<path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h6M14 18h6"/><circle cx="14" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="12" cy="18" r="2"/>',
    printer: '<path d="M7 9V3h10v6"/><path d="M5 9h14a2 2 0 0 1 2 2v6h-4v4H7v-4H3v-6a2 2 0 0 1 2-2Z"/><path d="M7 17h10"/>',
    tag: '<path d="M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a1.4 1.4 0 0 1 0 2Z"/><circle cx="7.8" cy="7.8" r="1.2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.2 1-1.2 2M12 17h.01"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    percent: '<path d="m5 19 14-14"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    wallet: '<path d="M20 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6"/><path d="M16 13h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    mail: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.2 2 2 0 0 1 5 3Z"/>'
  };

  DH.icon = function (name, size) {
    var body = ICONS[name];
    if (!body) return '';
    var dimension = size || 20;
    return '<svg class="icon" width="' + dimension + '" height="' + dimension +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      body + '</svg>';
  };

  /* ---------- Utilities ---------- */

  DH.util = {
    escapeHtml: function (value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/[&<>"']/g, function (character) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
        });
    },

    debounce: function (fn, wait) {
      var timer = null;
      return function () {
        var args = arguments;
        var context = this;
        window.clearTimeout(timer);
        timer = window.setTimeout(function () { fn.apply(context, args); }, wait || 200);
      };
    },

    initials: function (name) {
      var parts = String(name || 'Admin').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return 'AD';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    },

    greeting: function () {
      var hour = new Date().getHours();
      if (hour < 12) return 'Good morning';
      if (hour < 18) return 'Good afternoon';
      return 'Good evening';
    },

    relativeTime: function (value) {
      var date = value ? new Date(value) : new Date();
      if (isNaN(date.getTime())) return '—';
      var diff = Date.now() - date.getTime();
      var minutes = Math.round(diff / 60000);
      if (minutes < 1) return 'just now';
      if (minutes < 60) return minutes + 'm ago';
      var hours = Math.round(minutes / 60);
      if (hours < 24) return hours + 'h ago';
      var days = Math.round(hours / 24);
      if (days < 7) return days + 'd ago';
      return DH.format.date(date, { month: 'short', day: 'numeric' });
    }
  };

  /* ---------- Formatters (respect store currency/locale) ---------- */

  function settings() {
    return DH.store && DH.store.getSettings ? DH.store.getSettings() : { currency: 'USD', locale: 'en-US' };
  }

  function preferences() {
    var defaults = DH.store.DEFAULT_PREFERENCES || { sidebarCollapsed: false, notificationsSeenAt: null };
    return Object.assign({}, defaults, DH.store.get(DH.store.KEYS.preferences, {}));
  }

  function savePreferences(patch) {
    var next = Object.assign({}, preferences(), patch || {});
    DH.store.set(DH.store.KEYS.preferences, next);
    return next;
  }

  DH.format = {
    currency: function (value, options) {
      var config = settings();
      var amount = Number(value) || 0;
      try {
        return new Intl.NumberFormat(config.locale || 'en-US', Object.assign({
          style: 'currency',
          currency: config.currency || 'USD',
          minimumFractionDigits: 2
        }, options || {})).format(amount);
      } catch (error) {
        return '$' + amount.toFixed(2);
      }
    },

    number: function (value, options) {
      var config = settings();
      try {
        return new Intl.NumberFormat(config.locale || 'en-US', options || {}).format(Number(value) || 0);
      } catch (error) {
        return String(value);
      }
    },

    percent: function (value, digits) {
      var amount = Number(value) || 0;
      return amount.toFixed(digits === undefined ? 1 : digits) + '%';
    },

    date: function (value, options) {
      var date = value ? new Date(value) : new Date();
      if (isNaN(date.getTime())) return '—';
      try {
        return new Intl.DateTimeFormat(settings().locale || 'en-US', options || {
          month: 'short', day: 'numeric', year: 'numeric'
        }).format(date);
      } catch (error) {
        return date.toLocaleDateString();
      }
    },

    time: function (value) {
      var date = value ? new Date(value) : new Date();
      if (isNaN(date.getTime())) return '—';
      try {
        return new Intl.DateTimeFormat(settings().locale || 'en-US', {
          hour: 'numeric', minute: '2-digit'
        }).format(date);
      } catch (error) {
        return date.toLocaleTimeString();
      }
    },

    initials: DH.util.initials
  };

  /* ---------- Toast ---------- */

  DH.toast = function (message, type) {
    var root = document.getElementById('toast-root');
    if (!root) return;

    var tone = type || 'info';
    var iconName = tone === 'success' ? 'check-circle'
      : tone === 'error' ? 'x-circle'
      : tone === 'warning' ? 'alert-triangle'
      : 'info';

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + tone;
    toast.innerHTML =
      '<span class="toast-icon">' + DH.icon(iconName, 18) + '</span>' +
      '<p>' + DH.util.escapeHtml(message) + '</p>' +
      '<button class="toast-close" type="button" aria-label="Dismiss">' + DH.icon('close', 14) + '</button>';

    root.appendChild(toast);
    window.requestAnimationFrame(function () { toast.classList.add('is-visible'); });

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      toast.classList.remove('is-visible');
      window.setTimeout(function () { toast.remove(); }, 240);
    }

    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    window.setTimeout(dismiss, 4200);
  };

  /* ---------- Modal ---------- */

  var modalEscHandler = null;

  DH.modal = {
    open: function (options) {
      var config = options || {};
      var root = document.getElementById('modal-root');
      if (!root) return;

      root.innerHTML =
        '<div class="modal-overlay" data-modal-overlay>' +
          '<div class="modal-card' + (config.className ? ' ' + DH.util.escapeHtml(config.className) : '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
            '<div class="modal-head">' +
              '<div>' +
                '<h2 id="modal-title">' + DH.util.escapeHtml(config.title || 'Confirm action') + '</h2>' +
                (config.description ? '<p>' + DH.util.escapeHtml(config.description) + '</p>' : '') +
              '</div>' +
              '<button class="icon-btn" type="button" data-modal-close aria-label="Close dialog">' + DH.icon('close', 18) + '</button>' +
            '</div>' +
            (config.body ? '<div class="modal-body">' + config.body + '</div>' : '') +
            '<div class="modal-foot">' +
              '<button class="btn btn-ghost" type="button" data-modal-close>' + DH.util.escapeHtml(config.cancelLabel || 'Cancel') + '</button>' +
              '<button class="btn ' + (config.danger === false ? 'btn-primary' : 'btn-danger') + '" type="button" data-modal-confirm>' +
                DH.util.escapeHtml(config.confirmLabel || 'Confirm') +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      root.classList.add('is-open');
      document.body.style.overflow = 'hidden';

      var confirmButton = root.querySelector('[data-modal-confirm]');
      if (confirmButton) confirmButton.focus();

      function close() { DH.modal.close(); }
      function runConfirm() {
        var result = typeof config.onConfirm === 'function' ? config.onConfirm() : true;
        if (result !== false) close();
      }

      root.querySelectorAll('[data-modal-close]').forEach(function (button) {
        button.addEventListener('click', close);
      });
      if (confirmButton) confirmButton.addEventListener('click', runConfirm);

      var overlay = root.querySelector('[data-modal-overlay]');
      if (overlay) {
        overlay.addEventListener('click', function (event) {
          if (event.target === overlay) close();
        });
      }

      modalEscHandler = function (event) {
        if (event.key === 'Escape') close();
      };
      document.addEventListener('keydown', modalEscHandler);
    },

    close: function () {
      var root = document.getElementById('modal-root');
      if (!root) return;
      root.classList.remove('is-open');
      root.innerHTML = '';
      document.body.style.overflow = document.body.classList.contains('nav-open') ? 'hidden' : '';
      if (modalEscHandler) {
        document.removeEventListener('keydown', modalEscHandler);
        modalEscHandler = null;
      }
    }
  };

  /* ---------- Shared UI fragments ---------- */

  DH.ui = {
    statCard: function (options) {
      var config = options || {};
      var tag = config.href ? 'a' : 'article';
      var trendTone = config.trendTone || 'neutral';
      var trendIcon = config.trendIcon || (trendTone === 'down' ? 'trend-down' : 'trend-up');

      return '' +
        '<' + tag + ' class="stat-card tone-' + (config.tone || 'blue') + (config.href ? ' is-link' : '') + '"' +
          (config.href ? ' href="' + DH.util.escapeHtml(config.href) + '"' : '') + '>' +
          '<div class="stat-card-top">' +
            '<span class="stat-icon">' + DH.icon(config.icon || 'sparkles', 19) + '</span>' +
            (config.trend ? '<span class="stat-trend trend-' + trendTone + '">' + DH.icon(trendIcon, 13) + DH.util.escapeHtml(config.trend) + '</span>' : '') +
          '</div>' +
          '<p class="stat-label">' + DH.util.escapeHtml(config.label || '') + '</p>' +
          '<p class="stat-value">' + DH.util.escapeHtml(config.value === undefined ? '0' : String(config.value)) + '</p>' +
          '<p class="stat-hint">' + DH.util.escapeHtml(config.hint || '') + '</p>' +
        '</' + tag + '>';
    },

    table: function (options) {
      var config = options || {};
      var head = (config.columns || []).map(function (column) {
        return '<th' + (column.align === 'right' ? ' class="align-right"' : '') + '>' +
          DH.util.escapeHtml(column.label) + '</th>';
      }).join('');

      return '<section class="card table-card"><div class="table-wrap"><table class="data-table' +
        (config.className ? ' ' + DH.util.escapeHtml(config.className) : '') + '">' +
        '<thead><tr>' + head + '</tr></thead>' +
        '<tbody' + (config.bodyId ? ' id="' + DH.util.escapeHtml(config.bodyId) + '"' : '') + '>' +
          (config.body || '') +
        '</tbody>' +
      '</table></div></section>';
    },

    emptyState: function (options) {
      var config = options || {};
      return '' +
        '<div class="empty-state' + (config.compact ? ' is-compact' : '') + '">' +
          '<span class="empty-icon">' + DH.icon(config.icon || 'sparkles', 24) + '</span>' +
          '<h3>' + DH.util.escapeHtml(config.title || 'Nothing here yet') + '</h3>' +
          '<p>' + DH.util.escapeHtml(config.text || '') + '</p>' +
          (config.action || '') +
        '</div>';
    },

    /* Form field with a label, inline error slot and optional help text. */
    formField: function (options) {
      var config = options || {};
      var id = config.id || 'field-' + config.name;
      var describedBy = 'error-' + id;
      var attrs = ' id="' + DH.util.escapeHtml(id) + '" name="' + DH.util.escapeHtml(config.name) + '"' +
        ' aria-describedby="' + DH.util.escapeHtml(describedBy) + '"' +
        (config.required ? ' required aria-required="true"' : '');
      var control;

      if (config.type === 'select') {
        control = '<select' + attrs + '>' +
          (config.options || []).map(function (option) {
            return '<option value="' + DH.util.escapeHtml(option.value) + '"' +
              (String(option.value) === String(config.value) ? ' selected' : '') + '>' +
              DH.util.escapeHtml(option.label) + '</option>';
          }).join('') +
        '</select>';
      } else if (config.type === 'textarea') {
        control = '<textarea' + attrs + ' rows="' + (config.rows || 3) + '">' +
          DH.util.escapeHtml(config.value) + '</textarea>';
      } else {
        control = '<input' + attrs +
          ' type="' + (config.type || 'text') + '"' +
          ' value="' + DH.util.escapeHtml(config.value) + '"' +
          (config.placeholder ? ' placeholder="' + DH.util.escapeHtml(config.placeholder) + '"' : '') +
          (config.step ? ' step="' + config.step + '"' : '') +
          (config.min !== undefined ? ' min="' + config.min + '"' : '') +
          (config.max !== undefined ? ' max="' + config.max + '"' : '') +
          (config.inputmode ? ' inputmode="' + config.inputmode + '"' : '') +
          ' autocomplete="off">';
      }

      return '<div class="form-field' + (config.full ? ' is-full' : '') + '">' +
        '<label for="' + DH.util.escapeHtml(id) + '">' + DH.util.escapeHtml(config.label) +
          (config.required ? '<span class="req" aria-hidden="true">*</span>' : '') +
        '</label>' +
        control +
        '<p class="field-error" id="' + DH.util.escapeHtml(describedBy) + '" data-error="' +
          DH.util.escapeHtml(config.name) + '" aria-live="polite"></p>' +
      '</div>';
    },

    setFieldError: function (form, name, message) {
      if (!form) return;
      var input = form.querySelector('[name="' + name + '"]');
      var hint = form.querySelector('[data-error="' + name + '"]');

      if (input) {
        input.classList.toggle('is-invalid', !!message);
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
      if (hint) hint.textContent = message || '';
    },

    clearFieldErrors: function (form) {
      if (!form) return;
      Array.prototype.forEach.call(form.querySelectorAll('.is-invalid'), function (field) {
        field.classList.remove('is-invalid');
        field.removeAttribute('aria-invalid');
      });
      Array.prototype.forEach.call(form.querySelectorAll('.field-error'), function (hint) {
        hint.textContent = '';
      });
    }
  };

  /* ---------- Routes ---------- */

  var ROUTES = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Workspace', kicker: 'Overview', title: 'Dashboard', subtitle: 'Store performance at a glance' },
    { id: 'pos', label: 'Point of sale', icon: 'pos', group: 'Workspace', kicker: 'Checkout', title: 'Point of sale', subtitle: 'Ring up sales in seconds', badge: 'Live' },
    { id: 'products', label: 'Products', icon: 'products', group: 'Catalog', kicker: 'Catalog', title: 'Products', subtitle: 'Manage everything you sell' },
    { id: 'inventory', label: 'Inventory', icon: 'inventory', group: 'Catalog', kicker: 'Catalog', title: 'Inventory', subtitle: 'Track stock levels and replenishment' },
    { id: 'customers', label: 'Customers', icon: 'customers', group: 'Relationships', kicker: 'Relationships', title: 'Customers', subtitle: 'Profiles, loyalty and purchase history' },
    { id: 'sales', label: 'Sales', icon: 'sales', group: 'Insights', kicker: 'Insights', title: 'Sales', subtitle: 'Every transaction in one place' },
    { id: 'reports', label: 'Reports', icon: 'reports', group: 'Insights', kicker: 'Insights', title: 'Reports', subtitle: 'Turn transactions into decisions' },
    { id: 'settings', label: 'Settings', icon: 'settings', group: 'System', kicker: 'System', title: 'Settings', subtitle: 'Store profile, tax and demo data' }
  ];

  DH.routes = ROUTES;

  DH.getRoute = function (id) {
    for (var i = 0; i < ROUTES.length; i += 1) {
      if (ROUTES[i].id === id) return ROUTES[i];
    }
    return null;
  };

  /* ---------- Navigation / chrome ---------- */

  function buildNav() {
    var nav = document.getElementById('app-nav');
    if (!nav) return;

    var groups = [];
    ROUTES.forEach(function (route) {
      var group = null;
      for (var i = 0; i < groups.length; i += 1) {
        if (groups[i].name === route.group) { group = groups[i]; break; }
      }
      if (!group) {
        group = { name: route.group, items: [] };
        groups.push(group);
      }
      group.items.push(route);
    });

    nav.innerHTML = groups.map(function (group) {
      return '<div class="nav-group">' +
        '<p class="nav-label">' + DH.util.escapeHtml(group.name) + '</p>' +
        group.items.map(function (route) {
          return '<a class="nav-link" href="#/' + route.id + '" data-route="' + route.id + '" data-label="' + DH.util.escapeHtml(route.label) + '" aria-label="' + DH.util.escapeHtml(route.label) + '">' +
            DH.icon(route.icon, 19) +
            '<span class="nav-link-label">' + DH.util.escapeHtml(route.label) + '</span>' +
            (route.badge ? '<span class="nav-badge">' + DH.util.escapeHtml(route.badge) + '</span>' : '') +
          '</a>';
        }).join('') +
      '</div>';
    }).join('');
  }

  function closeNav() {
    document.body.classList.remove('nav-open');
    var menuButton = document.getElementById('menu-btn');
    if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
    updateMenuButton();
  }

  function openNav() {
    document.body.classList.add('nav-open');
    var menuButton = document.getElementById('menu-btn');
    if (menuButton) menuButton.setAttribute('aria-expanded', 'true');
    updateMenuButton();
  }

  function syncProfile() {
    var config = settings();
    var name = config.cashierName || 'Admin';
    var label = DH.util.initials(name);

    document.querySelectorAll('.avatar').forEach(function (avatar) {
      avatar.textContent = label;
    });

    var sidebarName = document.querySelector('.sidebar-user-info strong');
    if (sidebarName) sidebarName.textContent = name;

    var sidebarRole = document.querySelector('.sidebar-user-info span');
    if (sidebarRole) sidebarRole.textContent = 'Store manager';
  }

  function syncStorageStatus() {
    var status = document.getElementById('storage-status');
    if (!status) return;
    status.textContent = DH.store.isAvailable() ? 'localStorage · online' : 'memory fallback';
  }

  /* ---------- Router ---------- */

  var refreshTimer = null;

  /** Coalesces repeated refreshes (a settings save writes two keys). */
  function scheduleRefresh() {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(function () {
      refreshTimer = null;
      router.refresh();
    }, 40);
  }

  var router = {
    current: null,

    parse: function () {
      var hash = window.location.hash.replace(/^#\/?/, '');
      var id = hash.split('/')[0];
      return DH.getRoute(id) ? id : 'dashboard';
    },

    go: function (id) {
      var target = DH.getRoute(id) ? id : 'dashboard';
      if (this.parse() === target) {
        this.render();
      } else {
        window.location.hash = '#/' + target;
      }
    },

    refresh: function () {
      this.render();
    },

    render: function () {
      var id = this.parse();
      var route = DH.getRoute(id) || ROUTES[0];
      var root = document.getElementById('view-root');
      if (!root) return;

      this.current = route.id;
      document.title = route.title + ' · DevHawx POS';

      var title = document.getElementById('page-title');
      var kicker = document.getElementById('page-kicker');
      if (title) title.textContent = route.title;
      if (kicker) kicker.textContent = route.kicker;

      document.querySelectorAll('.nav-link').forEach(function (link) {
        var active = link.getAttribute('data-route') === route.id;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });

      root.innerHTML = '';

      var view = document.createElement('section');
      view.className = 'view';
      view.setAttribute('data-view', route.id);
      root.appendChild(view);

      var module = DH.views[route.id];
      try {
        if (module && typeof module.render === 'function') {
          module.render(view, route);
        } else {
          view.innerHTML = '<div class="card">' + DH.ui.emptyState({
            icon: route.icon,
            title: route.title + ' module is on the way',
            text: 'This route is registered but its view has not been built yet.'
          }) + '</div>';
        }
      } catch (error) {
        console.error('[DevHawx] Failed to render "' + route.id + '"', error);
        view.innerHTML = '<div class="card">' + DH.ui.emptyState({
          icon: 'alert-triangle',
          title: 'Something went wrong',
          text: 'This view could not be rendered. Check the browser console for details.'
        }) + '</div>';
      }

      syncProfile();
      closeNav();
      closePopovers();
      closeSearch();
      window.scrollTo(0, 0);
    }
  };

  DH.router = router;

  /* ---------- Global event delegation ---------- */

  document.addEventListener('click', function (event) {
    var goTarget = event.target.closest('[data-go]');
    if (goTarget) {
      event.preventDefault();
      router.go(goTarget.getAttribute('data-go'));
    }
  });

  /* ---------- Shell behaviour ---------- */

  var popoverConfig = {
    notifications: { button: 'notifications-btn', panel: 'notifications-panel' },
    profile: { button: 'topbar-user', panel: 'profile-panel' }
  };

  function isDrawerMode() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function isMobileSearch() {
    return window.matchMedia('(max-width: 1100px)').matches;
  }

  function updateMenuButton() {
    var button = document.getElementById('menu-btn');
    var shell = document.querySelector('.app-shell');
    if (!button || !shell) return;
    var collapsed = shell.classList.contains('is-collapsed');

    if (isDrawerMode()) {
      var open = document.body.classList.contains('nav-open');
      button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('title', open ? 'Close navigation' : 'Open navigation');
    } else {
      button.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    }
  }

  function applySidebar(collapsed) {
    var shell = document.querySelector('.app-shell');
    if (!shell) return;
    shell.classList.toggle('is-collapsed', !!collapsed && !isDrawerMode());
    updateMenuButton();
  }

  function closePopovers() {
    Object.keys(popoverConfig).forEach(function (name) {
      var config = popoverConfig[name];
      var panel = document.getElementById(config.panel);
      var button = document.getElementById(config.button);
      if (panel) {
        panel.hidden = true;
        panel.classList.remove('is-open');
      }
      if (button) button.setAttribute('aria-expanded', 'false');
    });
  }

  function openPopover(name) {
    closePopovers();
    var config = popoverConfig[name];
    if (!config) return;

    if (name === 'notifications') renderNotifications();
    if (name === 'profile') renderProfilePanel();

    var panel = document.getElementById(config.panel);
    var button = document.getElementById(config.button);
    if (panel) {
      panel.hidden = false;
      panel.classList.add('is-open');
    }
    if (button) button.setAttribute('aria-expanded', 'true');
  }

  function togglePopover(name) {
    var config = popoverConfig[name];
    var panel = config ? document.getElementById(config.panel) : null;
    if (panel && !panel.hidden) closePopovers();
    else openPopover(name);
  }

  function activityRoute(type) {
    if (type === 'sale') return 'sales';
    if (type === 'stock') return 'inventory';
    if (type === 'customer') return 'customers';
    if (type === 'product') return 'products';
    return 'dashboard';
  }

  function activityIcon(type) {
    if (type === 'sale') return 'receipt';
    if (type === 'stock') return 'inventory';
    if (type === 'customer') return 'customers';
    if (type === 'product') return 'products';
    return 'bell';
  }

  function syncNotificationsDot() {
    var button = document.getElementById('notifications-btn');
    if (!button) return;

    var activity = DH.store.collection('activity').all();
    var latest = activity.reduce(function (max, entry) {
      var time = new Date(entry.at || entry.createdAt || 0).getTime();
      return time > max ? time : max;
    }, 0);
    var prefs = preferences();
    var seen = prefs.notificationsSeenAt ? new Date(prefs.notificationsSeenAt).getTime() : 0;
    var unread = activity.length > 0 && latest > seen;

    button.classList.toggle('has-dot', unread);
    button.setAttribute('aria-label', unread ? 'Notifications (unread)' : 'Notifications');
  }

  function renderNotifications() {
    var panel = document.getElementById('notifications-panel');
    if (!panel) return;

    var activity = DH.store.collection('activity').all().slice().sort(function (a, b) {
      return new Date(b.at || b.createdAt) - new Date(a.at || a.createdAt);
    });
    var prefs = preferences();
    var seen = prefs.notificationsSeenAt ? new Date(prefs.notificationsSeenAt).getTime() : 0;
    var unreadCount = activity.filter(function (entry) {
      return new Date(entry.at || entry.createdAt || 0).getTime() > seen;
    }).length;

    var list = activity.length
      ? activity.map(function (entry) {
        var unread = new Date(entry.at || entry.createdAt || 0).getTime() > seen;
        var tone = entry.tone || 'info';
        return '<a class="popover-item' + (unread ? ' is-unread' : '') + '" href="#/' + activityRoute(entry.type) + '">' +
          '<span class="popover-icon tone-' + tone + '">' + DH.icon(activityIcon(entry.type), 17) + '</span>' +
          '<span class="popover-copy"><strong>' + DH.util.escapeHtml(entry.title) + '</strong>' +
            '<span>' + DH.util.escapeHtml(entry.detail) + '</span></span>' +
          '<span class="popover-time">' + DH.util.escapeHtml(DH.util.relativeTime(entry.at)) + '</span>' +
        '</a>';
      }).join('')
      : '<div class="popover-empty">' + DH.icon('bell', 20) + '<p>No notifications yet.</p></div>';

    panel.innerHTML =
      '<div class="popover-head">' +
        '<div><strong>Notifications</strong><span>' +
          (unreadCount ? unreadCount + ' new update' + (unreadCount === 1 ? '' : 's') : 'You are all caught up') +
        '</span></div>' +
        '<button class="text-btn" id="mark-notifications-read" type="button">Mark all read</button>' +
      '</div>' +
      '<div class="popover-list">' + list + '</div>' +
      '<div class="popover-foot">' +
        '<a class="text-link" href="#/sales">View all transactions' + DH.icon('arrow-right', 14) + '</a>' +
      '</div>';
  }

  function renderProfilePanel() {
    var panel = document.getElementById('profile-panel');
    if (!panel) return;

    var config = settings();
    var name = config.cashierName || 'Admin';

    panel.innerHTML =
      '<div class="profile-head">' +
        '<span class="avatar">' + DH.util.escapeHtml(DH.util.initials(name)) + '</span>' +
        '<div class="profile-copy">' +
          '<strong>' + DH.util.escapeHtml(name) + '</strong>' +
          '<span>Store manager</span>' +
          '<small>' + DH.util.escapeHtml(config.email || '') + '</small>' +
        '</div>' +
      '</div>' +
      '<div class="popover-menu">' +
        '<a class="menu-item" href="#/settings">' + DH.icon('settings', 17) + '<span>Store settings</span><span class="menu-arrow">' + DH.icon('chevron-right', 15) + '</span></a>' +
        '<a class="menu-item" href="#/reports">' + DH.icon('reports', 17) + '<span>View reports</span><span class="menu-arrow">' + DH.icon('chevron-right', 15) + '</span></a>' +
        '<a class="menu-item" href="#/products">' + DH.icon('products', 17) + '<span>Browse catalog</span><span class="menu-arrow">' + DH.icon('chevron-right', 15) + '</span></a>' +
      '</div>' +
      '<div class="popover-menu popover-menu-danger">' +
        '<button class="menu-item is-danger" id="profile-reset" type="button">' + DH.icon('refresh', 17) + '<span>Reset demo data</span></button>' +
      '</div>' +
      '<div class="popover-foot">' +
        '<span class="popover-note">' + DH.icon('lock', 13) + 'Stored locally on this device</span>' +
      '</div>';
  }

  function searchIndex() {
    var items = [];

    ROUTES.forEach(function (route) {
      items.push({
        type: 'Page',
        title: route.label,
        meta: route.subtitle || route.kicker,
        icon: route.icon,
        route: route.id
      });
    });

    DH.store.collection('products').all().forEach(function (product) {
      items.push({
        type: 'Product',
        title: product.name,
        meta: [product.sku, DH.format.currency(product.price), (Number(product.stock) || 0) + ' in stock'].join(' · '),
        icon: 'products',
        route: 'products'
      });
    });

    DH.store.collection('customers').all().forEach(function (customer) {
      items.push({
        type: 'Customer',
        title: customer.name,
        meta: [customer.email, customer.phone].filter(Boolean).join(' · '),
        icon: 'customers',
        route: 'customers'
      });
    });

    DH.store.collection('sales').all().forEach(function (sale) {
      items.push({
        type: 'Sale',
        title: sale.receipt || sale.id,
        meta: [sale.customerName, DH.format.currency(sale.total), DH.format.date(sale.createdAt, { month: 'short', day: 'numeric' })].join(' · '),
        icon: 'sales',
        route: 'sales'
      });
    });

    return items;
  }

  function searchResultRow(item) {
    return '<a class="search-result" href="#/' + item.route + '" data-route="' + item.route + '">' +
      '<span class="search-result-icon">' + DH.icon(item.icon, 16) + '</span>' +
      '<span class="search-result-copy"><strong>' + DH.util.escapeHtml(item.title) + '</strong>' +
        '<span>' + DH.util.escapeHtml(item.meta) + '</span></span>' +
      '<span class="search-result-kind">' + DH.util.escapeHtml(item.type) + '</span>' +
    '</a>';
  }

  function renderSearchResults(value) {
    var box = document.getElementById('search-results');
    if (!box) return;

    var query = String(value || '').trim();
    var head;
    var rows;

    if (!query) {
      var quick = searchIndex().filter(function (item) {
        return item.type === 'Page' && ['pos', 'products', 'sales', 'customers'].indexOf(item.route) !== -1;
      });
      head = '<div class="search-results-head"><span>Quick links</span><span class="search-count">Jump to</span></div>';
      rows = quick.map(searchResultRow).join('');
    } else {
      var needle = query.toLowerCase();
      var matches = searchIndex().filter(function (item) {
        return (item.title + ' ' + item.meta + ' ' + item.type).toLowerCase().indexOf(needle) !== -1;
      }).sort(function (a, b) {
        var aStart = a.title.toLowerCase().indexOf(needle) === 0 ? 0 : 1;
        var bStart = b.title.toLowerCase().indexOf(needle) === 0 ? 0 : 1;
        return aStart - bStart;
      }).slice(0, 8);

      if (!matches.length) {
        box.innerHTML = '<div class="search-empty">' + DH.icon('search', 22) +
          '<strong>No matches for “' + DH.util.escapeHtml(query) + '”</strong>' +
          '<span>Try a product name, SKU, customer or receipt number.</span></div>';
        box.hidden = false;
        return;
      }

      head = '<div class="search-results-head"><span>Results</span><span class="search-count">' + matches.length + ' found</span></div>';
      rows = matches.map(searchResultRow).join('');
    }

    box.innerHTML = head + '<div class="search-result-list">' + rows + '</div>';
    box.hidden = false;
  }

  function closeSearchResults() {
    var box = document.getElementById('search-results');
    if (box) box.hidden = true;
  }

  function openSearch() {
    var wrap = document.getElementById('search-wrap');
    var toggle = document.getElementById('search-toggle');
    var search = document.getElementById('global-search');
    if (!wrap) return;
    wrap.classList.add('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    renderSearchResults(search ? search.value : '');
    if (search) window.setTimeout(function () { search.focus(); }, 40);
  }

  function closeSearch() {
    var wrap = document.getElementById('search-wrap');
    var toggle = document.getElementById('search-toggle');
    var search = document.getElementById('global-search');
    if (wrap) wrap.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    closeSearchResults();
    if (search && document.activeElement === search) search.blur();
  }

  function confirmReset() {
    closePopovers();
    DH.modal.open({
      title: 'Reset demo data?',
      description: 'This clears your local changes and restores the sample catalog, customers and sales.',
      confirmLabel: 'Reset workspace',
      cancelLabel: 'Keep my data',
      onConfirm: function () {
        DH.store.resetDemoData();
        applySidebar(preferences().sidebarCollapsed);
        syncNotificationsDot();
        DH.router.refresh();
        DH.toast('Demo workspace restored with fresh sample data.', 'success');
      }
    });
  }

  function bindChrome() {
    var menuButton = document.getElementById('menu-btn');
    var closeButton = document.getElementById('sidebar-close');
    var scrim = document.getElementById('sidebar-scrim');
    var newSale = document.getElementById('new-sale-btn');
    var notifications = document.getElementById('notifications-btn');
    var topbarUser = document.getElementById('topbar-user');
    var sidebarUserMenu = document.getElementById('sidebar-user-menu');
    var search = document.getElementById('global-search');
    var searchToggle = document.getElementById('search-toggle');
    var searchClose = document.getElementById('search-close');
    var runSearch = DH.util.debounce(function () {
      if (search) renderSearchResults(search.value);
    }, 120);

    if (menuButton) {
      menuButton.addEventListener('click', function () {
        if (isDrawerMode()) {
          if (document.body.classList.contains('nav-open')) closeNav();
          else openNav();
          return;
        }
        var shell = document.querySelector('.app-shell');
        var next = !(shell && shell.classList.contains('is-collapsed'));
        applySidebar(next);
        savePreferences({ sidebarCollapsed: next });
      });
    }

    if (closeButton) closeButton.addEventListener('click', closeNav);
    if (scrim) scrim.addEventListener('click', closeNav);

    if (newSale) newSale.addEventListener('click', function () { router.go('pos'); });
    if (sidebarUserMenu) sidebarUserMenu.addEventListener('click', function () { router.go('settings'); });

    if (notifications) {
      notifications.addEventListener('click', function () { togglePopover('notifications'); });
    }

    if (topbarUser) {
      topbarUser.addEventListener('click', function () { togglePopover('profile'); });
    }

    if (searchToggle) {
      searchToggle.addEventListener('click', function () {
        var wrap = document.getElementById('search-wrap');
        if (wrap && wrap.classList.contains('is-open')) closeSearch();
        else openSearch();
      });
    }

    if (searchClose) searchClose.addEventListener('click', closeSearch);

    if (search) {
      search.addEventListener('input', runSearch);

      search.addEventListener('focus', function () {
        renderSearchResults(search.value);
      });

      search.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          closeSearch();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          var first = document.querySelector('#search-results .search-result');
          if (first) router.go(first.getAttribute('data-route'));
        }
      });
    }

    document.addEventListener('click', function (event) {
      if (!event.target.closest('.search-wrap') && !event.target.closest('#search-toggle')) {
        closeSearchResults();
      }
      if (!event.target.closest('.popover-wrap')) closePopovers();

      if (event.target.closest('#mark-notifications-read')) {
        savePreferences({ notificationsSeenAt: new Date().toISOString() });
        syncNotificationsDot();
        renderNotifications();
        DH.toast('Notifications marked as read.', 'success');
        return;
      }

      if (event.target.closest('#profile-reset')) confirmReset();
    });

    document.addEventListener('keydown', function (event) {
      var modalOpen = document.getElementById('modal-root').classList.contains('is-open');

      if (event.key === 'Escape') {
        if (modalOpen) return;
        closeNav();
        closePopovers();
        closeSearch();
      }

      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !modalOpen) {
        var active = document.activeElement;
        var typing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
        if (typing) return;
        event.preventDefault();
        if (isMobileSearch()) openSearch();
        else if (search) {
          search.focus();
          renderSearchResults(search.value);
        }
      }
    });

    window.addEventListener('resize', DH.util.debounce(function () {
      applySidebar(preferences().sidebarCollapsed);
      if (!isDrawerMode()) closeNav();
      if (!isMobileSearch()) {
        var wrap = document.getElementById('search-wrap');
        var toggle = document.getElementById('search-toggle');
        if (wrap) wrap.classList.remove('is-open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    }, 120));

    document.addEventListener('dh:storage', function (event) {
      syncProfile();
      syncStorageStatus();

      var key = event.detail && event.detail.key;

      if (key === '__reset__') {
        applySidebar(preferences().sidebarCollapsed);
        syncNotificationsDot();
        router.refresh();
      } else if (key === DH.store.KEYS.activity) {
        syncNotificationsDot();
      } else if (key === DH.store.KEYS.settings || key === DH.store.KEYS.store) {
        /* Store or checkout settings changed — apply them everywhere at once. */
        scheduleRefresh();
      }
    });
  }

  /* ---------- Boot ---------- */

  function boot() {
    buildNav();
    bindChrome();
    applySidebar(preferences().sidebarCollapsed);
    syncProfile();
    syncStorageStatus();
    syncNotificationsDot();

    var date = document.getElementById('topbar-date');
    if (date) {
      date.innerHTML = DH.icon('calendar', 15) + '<span>' + DH.format.date(null, {
        weekday: 'short', month: 'short', day: 'numeric'
      }) + '</span>';
      date.style.gap = '7px';
    }

    var year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());

    if (!window.location.hash) {
      try {
        window.history.replaceState(null, '', '#/dashboard');
      } catch (error) {
        window.location.hash = '#/dashboard';
      }
    }

    window.addEventListener('hashchange', function () { router.render(); });
    router.render();
  }

  /* Deferred scripts still run before DOMContentLoaded, so waiting for the
     event guarantees every view module is registered before the first render. */
  if (document.readyState === 'loading' || document.readyState === 'interactive') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

})(window, document);
