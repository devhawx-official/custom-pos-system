/* ==========================================================================
   DevHawx POS — storage.js
   Centralised localStorage data layer.

   Public API (window.DH.storage, also aliased as window.DH.store):
     getData(key, fallback)      read + safely parse a key
     saveData(key, data)         write a key
     updateData(key, data)       merge an object, or upsert record(s) in an array
     deleteData(key, id)         remove a record, an object field, or the key
     generateId(prefix)          collision-resistant readable id
     initializeDemoData()        seed only when the workspace is empty
     resetDemoData()             clear workspace + reseed the demo

   Everything lives under "devhawx.pos." with an in-memory fallback when
   localStorage is unavailable. Corrupted JSON is backed up to
   "devhawx.pos.corrupt.<key>" instead of crashing the app.
   ========================================================================== */

(function (window) {
  'use strict';

  var DH = window.DH = window.DH || {};

  var PREFIX = 'devhawx.pos.';
  var VERSION = 3;
  var SEED_VERSION = 5;

  var KEYS = Object.freeze({
    meta: 'meta',
    store: 'store',
    settings: 'settings',
    preferences: 'preferences',
    categories: 'categories',
    products: 'products',
    inventory: 'inventory',
    customers: 'customers',
    sales: 'sales',
    cart: 'cart',
    cartDiscount: 'cartDiscount',
    activity: 'activity'
  });

  /* Arrays of records. */
  var ARRAY_KEYS = Object.freeze(['categories', 'products', 'inventory', 'customers', 'sales', 'cart', 'activity']);

  /* Store profile is a singleton object. */
  var DEFAULT_STORE = Object.freeze({
    id: 'store',
    name: 'DevHawx Demo Store',
    legalName: 'DevHawx Retail Ltd.',
    email: 'hello@devhawx.dev',
    phone: '+1 (555) 010-2030',
    address: '18 Harbour Street, Suite 400\nSydney NSW 2000',
    receiptFooter: 'Thank you for shopping with DevHawx.',
    updatedAt: null
  });

  /* Operational settings are kept separate from the store profile. */
  var DEFAULT_SETTINGS = Object.freeze({
    currency: 'USD',
    locale: 'en-US',
    taxRate: 8.5,
    lowStockThreshold: 10,
    cashierName: 'Admin',
    receiptPrefix: 'INV',
    defaultDiscount: 0,
    applyDefaultDiscount: false,
    updatedAt: null
  });

  var DEFAULT_PREFERENCES = Object.freeze({
    sidebarCollapsed: false,
    notificationsSeenAt: null
  });

  /* Keys checked before seeding. meta/preferences alone do not count as data. */
  var DATA_KEYS = Object.freeze([
    'store', 'settings', 'categories', 'products', 'inventory',
    'customers', 'sales', 'cart', 'activity'
  ]);

  var ID_PREFIXES = {
    categories: 'cat',
    products: 'prd',
    inventory: 'inv',
    customers: 'cus',
    sales: 'sale',
    activity: 'act'
  };

  var corruptKeys = [];
  var sequence = 0;

  /* ---------- 1. Low-level access ---------- */

  var available = detectStorage();
  var memory = {};

  function detectStorage() {
    try {
      var probe = PREFIX + '__probe';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (error) {
      console.warn('[DevHawx] localStorage unavailable — using in-memory fallback.');
      return false;
    }
  }

  function rawGet(key) {
    if (!available) return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch (error) {
      return null;
    }
  }

  function rawSet(key, value) {
    if (available) {
      try {
        window.localStorage.setItem(PREFIX + key, value);
        return true;
      } catch (error) {
        console.warn('[DevHawx] localStorage write failed — switching to memory.', error);
        available = false;
      }
    }
    memory[key] = value;
    return false;
  }

  function rawRemove(key) {
    if (available) {
      try {
        window.localStorage.removeItem(PREFIX + key);
      } catch (error) {
        /* ignore */
      }
    }
    delete memory[key];
  }

  function clone(value) {
    if (value === null || value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeKey(key) {
    var value = String(key === undefined || key === null ? '' : key);
    return value.indexOf(PREFIX) === 0 ? value.slice(PREFIX.length) : value;
  }

  function announce(key) {
    document.dispatchEvent(new CustomEvent('dh:storage', {
      detail: { key: key, storageKey: PREFIX + key }
    }));
  }

  function clearCorruptBackupsInternal() {
    corruptKeys = [];

    if (available) {
      var fullKeys = [];
      try {
        for (var i = 0; i < window.localStorage.length; i += 1) {
          var full = window.localStorage.key(i);
          if (full && full.indexOf(PREFIX + 'corrupt.') === 0) fullKeys.push(full);
        }
      } catch (error) {
        /* ignore */
      }
      fullKeys.forEach(function (full) {
        try { window.localStorage.removeItem(full); } catch (error) { /* ignore */ }
      });
    }

    Object.keys(memory).forEach(function (key) {
      if (key.indexOf('corrupt.') === 0) delete memory[key];
    });
  }

  /* ---------- 2. Public data API ---------- */

  function getData(key, fallback) {
    key = normalizeKey(key);
    var raw = rawGet(key);
    if (raw === null || raw === undefined) return clone(fallback);

    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn('[DevHawx] Corrupted JSON in "' + key + '" — backup kept, fallback used.');
      rawSet('corrupt.' + key, raw);
      rawRemove(key);
      if (corruptKeys.indexOf(key) === -1) corruptKeys.push(key);
      return clone(fallback);
    }
  }

  function saveData(key, data) {
    key = normalizeKey(key);
    if (data === undefined) {
      console.warn('[DevHawx] Refused to save undefined data for "' + key + '".');
      return false;
    }

    var raw;
    try {
      raw = JSON.stringify(data);
    } catch (error) {
      console.warn('[DevHawx] Could not serialise "' + key + '".', error);
      return false;
    }
    if (raw === undefined) return false;

    var persisted = rawSet(key, raw);
    announce(key);
    return persisted;
  }

  function updateData(key, data) {
    key = normalizeKey(key);
    var current = getData(key, null);
    var now = new Date().toISOString();

    if (Array.isArray(current)) {
      var incoming = Array.isArray(data) ? data : [data];
      var next = current.slice();
      var changed = false;

      incoming.forEach(function (record) {
        if (!isPlainObject(record)) return;
        var id = record.id || generateId(ID_PREFIXES[key] || 'item');
        var index = -1;

        for (var i = 0; i < next.length; i += 1) {
          if (next[i] && next[i].id === id) {
            index = i;
            break;
          }
        }

        if (index === -1) {
          next.push(Object.assign({ createdAt: now }, record, { id: id, updatedAt: now }));
        } else {
          next[index] = Object.assign({}, next[index], record, { id: id, updatedAt: now });
        }
        changed = true;
      });

      if (!changed) return current;
      saveData(key, next);
      return next;
    }

    if (isPlainObject(current)) {
      if (!isPlainObject(data)) return current;
      var merged = Object.assign({}, current, data, { updatedAt: now });
      saveData(key, merged);
      return merged;
    }

    if (data === undefined) return current;
    saveData(key, data);
    return data;
  }

  function deleteData(key, id) {
    key = normalizeKey(key);
    var current = getData(key, null);

    if (id === undefined || id === null) {
      if (rawGet(key) === null) return false;
      rawRemove(key);
      announce(key);
      return true;
    }

    if (Array.isArray(current)) {
      var next = current.filter(function (item) {
        return !(item && item.id === id);
      });
      if (next.length === current.length) return false;
      saveData(key, next);
      return true;
    }

    if (isPlainObject(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, id)) return false;
      var copy = Object.assign({}, current);
      delete copy[id];
      saveData(key, copy);
      return true;
    }

    return false;
  }

  function generateId(prefix) {
    sequence = (sequence + 1) % 1296;
    var random;
    try {
      random = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 10)
        : Math.random().toString(36).slice(2, 12);
    } catch (error) {
      random = Math.random().toString(36).slice(2, 12);
    }
    return (prefix || 'id') + '_' + Date.now().toString(36) + sequence.toString(36) + '_' + random;
  }

  /* ---------- 3. Collections ---------- */

  function readCollection(key) {
    var value = getData(key, []);
    return Array.isArray(value) ? value : [];
  }

  function collection(key) {
    return {
      key: key,

      all: function () {
        return readCollection(key);
      },

      count: function () {
        return readCollection(key).length;
      },

      find: function (id) {
        var list = readCollection(key);
        for (var i = 0; i < list.length; i += 1) {
          if (list[i].id === id) return list[i];
        }
        return null;
      },

      add: function (record) {
        var list = readCollection(key);
        var now = new Date().toISOString();
        var entry = Object.assign({
          id: generateId(ID_PREFIXES[key] || 'item'),
          createdAt: now,
          updatedAt: now
        }, record || {});
        list.push(entry);
        saveData(key, list);
        return entry;
      },

      update: function (id, patch) {
        var list = readCollection(key);
        for (var i = 0; i < list.length; i += 1) {
          if (list[i].id !== id) continue;
          list[i] = Object.assign({}, list[i], patch || {}, { updatedAt: new Date().toISOString() });
          saveData(key, list);
          return list[i];
        }
        return null;
      },

      remove: function (id) {
        return deleteData(key, id);
      },

      replaceAll: function (items) {
        var next = Array.isArray(items) ? items : [];
        saveData(key, next);
        return next;
      }
    };
  }

  /* ---------- 4. Store profile & settings ---------- */

  function getStore() {
    var stored = getData(KEYS.store, null);

    if (!isPlainObject(stored)) {
      /* Migration fallback for workspaces created before store.js existed. */
      var legacy = getData(KEYS.settings, {});
      stored = {
        id: 'store',
        name: legacy.storeName || DEFAULT_STORE.name,
        legalName: legacy.legalName || DEFAULT_STORE.legalName,
        email: legacy.email || DEFAULT_STORE.email,
        phone: legacy.phone || DEFAULT_STORE.phone,
        address: legacy.address || DEFAULT_STORE.address,
        receiptFooter: legacy.receiptFooter || DEFAULT_STORE.receiptFooter,
        updatedAt: legacy.updatedAt || null
      };
    }

    return Object.assign({}, DEFAULT_STORE, stored, { id: 'store' });
  }

  function saveStore(patch) {
    var now = new Date().toISOString();
    var next = Object.assign({}, getStore(), patch || {}, { id: 'store', updatedAt: now });
    saveData(KEYS.store, next);
    return next;
  }

  function getSettings() {
    var operational = Object.assign({}, DEFAULT_SETTINGS, getData(KEYS.settings, {}));
    var store = getStore();

    /* Flat shape kept for all existing views. */
    return Object.assign({}, operational, {
      storeName: store.name,
      legalName: store.legalName,
      email: store.email,
      phone: store.phone,
      address: store.address,
      receiptFooter: store.receiptFooter,
      updatedAt: operational.updatedAt || store.updatedAt
    });
  }

  function saveSettings(patch) {
    patch = isPlainObject(patch) ? patch : {};
    var now = new Date().toISOString();

    var storePatch = {};
    var storeMap = {
      storeName: 'name',
      name: 'name',
      legalName: 'legalName',
      email: 'email',
      phone: 'phone',
      address: 'address',
      receiptFooter: 'receiptFooter'
    };

    Object.keys(storeMap).forEach(function (field) {
      if (patch[field] !== undefined) storePatch[storeMap[field]] = patch[field];
    });

    if (Object.keys(storePatch).length) saveStore(storePatch);

    var settingsPatch = {};
    ['currency', 'locale', 'taxRate', 'lowStockThreshold', 'cashierName', 'receiptPrefix', 'defaultDiscount', 'applyDefaultDiscount'].forEach(function (field) {
      if (patch[field] !== undefined) settingsPatch[field] = patch[field];
    });

    var nextSettings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      getData(KEYS.settings, {}),
      settingsPatch,
      { updatedAt: now }
    );
    saveData(KEYS.settings, nextSettings);
    return getSettings();
  }

  /* ---------- 5. Demo data ---------- */

  var CATEGORY_IDS = {
    Beverages: 'cat_beverages',
    Bakery: 'cat_bakery',
    Household: 'cat_household',
    Snacks: 'cat_snacks',
    'Personal care': 'cat_personal-care'
  };

  var DEMO_CATEGORIES = [
    { id: 'cat_beverages', name: 'Beverages', slug: 'beverages', description: 'Coffee, tea and cold drinks', color: '#2F6BFF' },
    { id: 'cat_bakery', name: 'Bakery', slug: 'bakery', description: 'Fresh loaves and pastries', color: '#D97706' },
    { id: 'cat_household', name: 'Household', slug: 'household', description: 'Everyday home essentials', color: '#12B8D6' },
    { id: 'cat_snacks', name: 'Snacks', slug: 'snacks', description: 'Sweet and savoury treats', color: '#7C3AED' },
    { id: 'cat_personal-care', name: 'Personal care', slug: 'personal-care', description: 'Soaps and skincare', color: '#0E9F6E' }
  ];

  var DEMO_PRODUCTS = [
    { id: 'prd_espresso', name: 'Aurora Espresso Blend', sku: 'BEV-1042', barcode: '5061234501042', category: 'Beverages', price: 18.5, cost: 10.2, stock: 34 },
    { id: 'prd_cold-brew', name: 'Cold Brew Concentrate', sku: 'BEV-1048', barcode: '5061234501059', category: 'Beverages', price: 14, cost: 7.4, stock: 6 },
    { id: 'prd_matcha', name: 'Matcha Latte Mix', sku: 'BEV-1053', barcode: '5061234501066', category: 'Beverages', price: 16.75, cost: 9.1, stock: 18 },
    { id: 'prd_sourdough', name: 'Sourdough Loaf', sku: 'BAK-2011', barcode: '5061234502018', category: 'Bakery', price: 8.5, cost: 3.2, stock: 12 },
    { id: 'prd_croissant', name: 'Butter Croissant', sku: 'BAK-2016', barcode: '5061234502025', category: 'Bakery', price: 4.25, cost: 1.6, stock: 4 },
    { id: 'prd_danish', name: 'Cinnamon Danish', sku: 'BAK-2022', barcode: '5061234502032', category: 'Bakery', price: 5.25, cost: 2.1, stock: 0 },
    { id: 'prd_pour-over', name: 'Ceramic Pour-Over', sku: 'HOM-3104', barcode: '5061234503015', category: 'Household', price: 32, cost: 14.5, stock: 9 },
    { id: 'prd_tea-towel', name: 'Linen Tea Towel', sku: 'HOM-3112', barcode: '5061234503022', category: 'Household', price: 12, cost: 4.8, stock: 26 },
    { id: 'prd_cleaner', name: 'Citrus All-Purpose Cleaner', sku: 'HOM-3128', barcode: '5061234503039', category: 'Household', price: 9.5, cost: 3.9, stock: 7 },
    { id: 'prd_chocolate', name: 'Sea Salt Dark Chocolate', sku: 'SNK-4007', barcode: '5061234504012', category: 'Snacks', price: 6.75, cost: 2.7, stock: 42 },
    { id: 'prd_almonds', name: 'Smoked Almonds', sku: 'SNK-4014', barcode: '5061234504029', category: 'Snacks', price: 7.25, cost: 3.1, stock: 21 },
    { id: 'prd_granola', name: 'Honey Oat Granola', sku: 'SNK-4029', barcode: '5061234504036', category: 'Snacks', price: 11.5, cost: 5.2, stock: 8 },
    { id: 'prd_hand-soap', name: 'Cedar Hand Soap', sku: 'PER-5003', barcode: '5061234505019', category: 'Personal care', price: 13, cost: 5.6, stock: 15 },
    { id: 'prd_face-mist', name: 'Daily Face Mist', sku: 'PER-5011', barcode: '5061234505026', category: 'Personal care', price: 19, cost: 7.8, stock: 3 }
  ];

  var DEMO_CUSTOMERS = [
    { id: 'cus_amelia', name: 'Amelia Hart', email: 'amelia.hart@example.com', phone: '+1 (555) 014-2201', tier: 'Gold' },
    { id: 'cus_noah', name: 'Noah Bennett', email: 'noah.bennett@example.com', phone: '+1 (555) 014-2202', tier: 'Member' },
    { id: 'cus_priya', name: 'Priya Raman', email: 'priya.raman@example.com', phone: '+1 (555) 014-2203', tier: 'Gold' },
    { id: 'cus_lucas', name: 'Lucas Moreau', email: 'lucas.moreau@example.com', phone: '+1 (555) 014-2204', tier: 'Member' },
    { id: 'cus_sofia', name: 'Sofia Alvarez', email: 'sofia.alvarez@example.com', phone: '+1 (555) 014-2205', tier: 'Member' },
    { id: 'cus_ethan', name: 'Ethan Cole', email: 'ethan.cole@example.com', phone: '+1 (555) 014-2206', tier: 'Silver' },
    { id: 'cus_mia', name: 'Mia Nakamura', email: 'mia.nakamura@example.com', phone: '+1 (555) 014-2207', tier: 'Member' },
    { id: 'cus_olivia', name: 'Olivia Grant', email: 'olivia.grant@example.com', phone: '+1 (555) 014-2208', tier: 'Silver' }
  ];

  var PAYMENTS = ['Card', 'Cash', 'Digital wallet'];

  /* Small deterministic PRNG so the sample dataset is stable per seed. */
  function mulberry32(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function daysAgo(days, hour, minute) {
    var date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(hour === undefined ? 10 : hour, minute === undefined ? 0 : minute, 0, 0);
    return date;
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function hasWorkspaceData() {
    return DATA_KEYS.some(function (key) {
      return rawGet(key) !== null;
    });
  }

  function deriveCategories(products) {
    var seen = {};
    var now = new Date().toISOString();
    var list = [];

    (Array.isArray(products) ? products : []).forEach(function (product) {
      var name = product && product.category ? String(product.category).trim() : '';
      if (!name) return;
      var lookup = name.toLowerCase();
      if (seen[lookup]) return;
      seen[lookup] = true;
      var slug = slugify(name) || 'category';
      list.push({
        id: 'cat_' + slug,
        name: name,
        slug: slug,
        description: '',
        color: '#2F6BFF',
        createdAt: now,
        updatedAt: now
      });
    });

    return list;
  }

  function writeDemoData() {
    var random = mulberry32(20261112);
    var now = new Date();
    var seededAt = now.toISOString();
    var existingMeta = getData(KEYS.meta, null);

    var store = Object.assign({}, DEFAULT_STORE, {
      createdAt: seededAt,
      updatedAt: seededAt
    });

    var settings = Object.assign({}, DEFAULT_SETTINGS, {
      updatedAt: seededAt
    });

    var taxRate = Number(settings.taxRate) || 0;
    var cashierName = settings.cashierName || 'Admin';

    var categories = DEMO_CATEGORIES.map(function (category, index) {
      return Object.assign({}, category, {
        createdAt: daysAgo(200 - index * 4, 9, 0).toISOString(),
        updatedAt: daysAgo(index, 10, 0).toISOString()
      });
    });

    var products = DEMO_PRODUCTS.map(function (product, index) {
      return Object.assign({}, product, {
        categoryId: CATEGORY_IDS[product.category] || null,
        status: 'active',
        createdAt: daysAgo(120 - index * 3, 9, 0).toISOString(),
        updatedAt: daysAgo(index % 4, 11, 30).toISOString()
      });
    });

    var customers = DEMO_CUSTOMERS.map(function (customer, index) {
      var joined = daysAgo(210 - index * 19, 12, 15);
      return Object.assign({}, customer, {
        orders: 0,
        visits: 0,
        totalSpent: 0,
        joinedAt: joined.toISOString(),
        lastVisit: null,
        createdAt: joined.toISOString(),
        updatedAt: joined.toISOString()
      });
    });

    var sales = [];
    var receipt = 4200;

    for (var offset = 29; offset >= 0; offset -= 1) {
      var day = daysAgo(offset, 9, 0);
      var weekday = day.getDay();
      var dailyCount = (weekday === 0 || weekday === 6 ? 6 : 4) + Math.floor(random() * 3);
      if (offset === 0) dailyCount = 6;

      for (var s = 0; s < dailyCount; s += 1) {
        var soldAt;
        if (offset === 0) {
          var opening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0).getTime();
          var start = Math.min(opening, now.getTime() - 3600000);
          var span = Math.max(now.getTime() - start - 60000, 60000);
          soldAt = new Date(start + Math.round(span * ((s + 1) / (dailyCount + 1))));
        } else {
          soldAt = daysAgo(offset, 9 + Math.floor(random() * 9), Math.floor(random() * 60));
        }

        var items = [];
        var itemCount = 1 + Math.floor(random() * 3);
        var used = {};

        for (var i = 0; i < itemCount; i += 1) {
          var product = products[Math.floor(random() * products.length)];
          if (used[product.id]) continue;
          used[product.id] = true;
          var quantity = 1 + Math.floor(random() * 3);
          items.push({
            productId: product.id,
            name: product.name,
            sku: product.sku,
            price: product.price,
            quantity: quantity,
            lineTotal: roundMoney(product.price * quantity)
          });
        }

        var customer = null;
        if (random() > 0.28) {
          customer = customers[Math.floor(random() * customers.length)];
        }

        var subtotal = roundMoney(items.reduce(function (sum, item) {
          return sum + item.lineTotal;
        }, 0));
        var tax = roundMoney(subtotal * (taxRate / 100));
        var paymentRoll = random();
        var payment = PAYMENTS[paymentRoll < 0.54 ? 0 : (paymentRoll < 0.82 ? 1 : 2)];
        receipt += 1;

        sales.push({
          id: 'sale_' + receipt,
          receipt: settings.receiptPrefix + '-' + receipt,
          customerId: customer ? customer.id : null,
          customerName: customer ? customer.name : 'Walk-in customer',
          items: items,
          itemCount: items.reduce(function (sum, item) { return sum + item.quantity; }, 0),
          subtotal: subtotal,
          tax: tax,
          taxRate: taxRate,
          total: roundMoney(subtotal + tax),
          payment: payment,
          status: 'paid',
          cashier: cashierName,
          createdAt: soldAt.toISOString(),
          updatedAt: soldAt.toISOString()
        });
      }
    }

    sales.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });

    sales.forEach(function (sale) {
      if (!sale.customerId) return;
      for (var c = 0; c < customers.length; c += 1) {
        if (customers[c].id !== sale.customerId) continue;
        customers[c].orders += 1;
        customers[c].visits += 1;
        customers[c].totalSpent = roundMoney(customers[c].totalSpent + sale.total);
        if (!customers[c].lastVisit || sale.createdAt > customers[c].lastVisit) {
          customers[c].lastVisit = sale.createdAt;
        }
        customers[c].updatedAt = sale.createdAt;
        break;
      }
    });

    var lowStock = products
      .filter(function (product) { return product.stock <= 10; })
      .sort(function (a, b) { return a.stock - b.stock; });

    var latestSale = sales[sales.length - 1];
    var topCustomer = customers.slice().sort(function (a, b) { return b.totalSpent - a.totalSpent; })[0];

    var activity = [
      {
        id: 'act_sale_latest',
        type: 'sale',
        title: 'Sale completed',
        detail: latestSale.receipt + ' · ' + latestSale.customerName,
        tone: 'success',
        at: latestSale.createdAt
      },
      {
        id: 'act_stock_low',
        type: 'stock',
        title: 'Low stock alert',
        detail: lowStock[0].name + ' · ' + lowStock[0].stock + ' left',
        tone: 'warning',
        at: new Date(now.getTime() - 25 * 60000).toISOString()
      },
      {
        id: 'act_stock_restock',
        type: 'stock',
        title: 'Stock received',
        detail: 'Aurora Espresso Blend · +24 units',
        tone: 'info',
        at: daysAgo(1, 16, 20).toISOString()
      },
      {
        id: 'act_customer',
        type: 'customer',
        title: 'New customer',
        detail: topCustomer.name + ' · ' + topCustomer.tier + ' member',
        tone: 'info',
        at: daysAgo(2, 11, 5).toISOString()
      },
      {
        id: 'act_product',
        type: 'product',
        title: 'Product updated',
        detail: 'Daily Face Mist pricing refreshed',
        tone: 'neutral',
        at: daysAgo(3, 14, 40).toISOString()
      }
    ].sort(function (a, b) { return new Date(b.at) - new Date(a.at); });

    var inventory = [
      { id: 'inv_restock_1', productId: 'prd_espresso', type: 'restock', quantity: 24, stockBefore: 10, stockAfter: 34, note: 'Purchase order PO-2081', at: daysAgo(1, 16, 20).toISOString() },
      { id: 'inv_restock_2', productId: 'prd_chocolate', type: 'restock', quantity: 36, stockBefore: 6, stockAfter: 42, note: 'Weekly snack delivery', at: daysAgo(2, 9, 35).toISOString() },
      { id: 'inv_adjust_1', productId: 'prd_danish', type: 'adjustment', quantity: -4, stockBefore: 4, stockAfter: 0, note: 'Damaged in transit', at: daysAgo(3, 17, 10).toISOString() },
      { id: 'inv_adjust_2', productId: 'prd_face-mist', type: 'adjustment', quantity: -5, stockBefore: 8, stockAfter: 3, note: 'Damaged packaging', at: daysAgo(4, 15, 5).toISOString() },
      { id: 'inv_issue_1', productId: 'prd_croissant', type: 'issue', quantity: -6, stockBefore: 10, stockAfter: 4, note: 'Storefront sample batch', at: daysAgo(5, 10, 40).toISOString() },
      { id: 'inv_restock_3', productId: 'prd_cold-brew', type: 'restock', quantity: 6, stockBefore: 0, stockAfter: 6, note: 'Supplier delivery #4471', at: daysAgo(6, 9, 15).toISOString() }
    ].map(function (movement) {
      var product = products.filter(function (item) { return item.id === movement.productId; })[0];
      return Object.assign({
        productName: product ? product.name : '',
        sku: product ? product.sku : ''
      }, movement);
    });

    saveData(KEYS.store, store);
    saveData(KEYS.settings, settings);
    saveData(KEYS.categories, categories);
    saveData(KEYS.products, products);
    saveData(KEYS.customers, customers);
    saveData(KEYS.sales, sales);
    saveData(KEYS.inventory, inventory);
    saveData(KEYS.activity, activity);
    saveData(KEYS.cart, []);
    saveData(KEYS.preferences, Object.assign({}, DEFAULT_PREFERENCES));
    saveData(KEYS.meta, {
      version: VERSION,
      seedVersion: SEED_VERSION,
      seeded: true,
      createdAt: existingMeta && existingMeta.createdAt ? existingMeta.createdAt : seededAt,
      seededAt: seededAt,
      updatedAt: seededAt
    });
  }

  function ensureMeta(seeded) {
    var now = new Date().toISOString();
    var meta = getData(KEYS.meta, null);

    if (!isPlainObject(meta)) {
      meta = { createdAt: now, seeded: !!seeded };
    }

    meta.version = VERSION;
    meta.updatedAt = now;
    if (typeof meta.seeded !== 'boolean') meta.seeded = !!seeded;
    saveData(KEYS.meta, meta);
    return meta;
  }

  function ensureSchema() {
    var now = new Date().toISOString();

    var settings = getData(KEYS.settings, null);
    if (!isPlainObject(settings)) {
      settings = Object.assign({}, DEFAULT_SETTINGS, { updatedAt: now });
      saveData(KEYS.settings, settings);
    }

    var store = getData(KEYS.store, null);
    if (!isPlainObject(store)) {
      store = {
        id: 'store',
        name: settings.storeName || DEFAULT_STORE.name,
        legalName: settings.legalName || DEFAULT_STORE.legalName,
        email: settings.email || DEFAULT_STORE.email,
        phone: settings.phone || DEFAULT_STORE.phone,
        address: settings.address || DEFAULT_STORE.address,
        receiptFooter: settings.receiptFooter || DEFAULT_STORE.receiptFooter,
        createdAt: settings.createdAt || now,
        updatedAt: now
      };
      saveData(KEYS.store, store);
    }

    ARRAY_KEYS.forEach(function (key) {
      if (key === KEYS.categories) return;
      if (!Array.isArray(getData(key, null))) saveData(key, []);
    });

    if (!Array.isArray(getData(KEYS.categories, null))) {
      saveData(KEYS.categories, deriveCategories(getData(KEYS.products, [])));
    }

    if (!isPlainObject(getData(KEYS.preferences, null))) {
      saveData(KEYS.preferences, Object.assign({}, DEFAULT_PREFERENCES));
    }

    var discount = getData(KEYS.cartDiscount, null);
    if (typeof discount !== 'number' || !isFinite(discount)) {
      saveData(KEYS.cartDiscount, 0);
    }
  }

  /**
   * Seeds the demo only when the workspace is empty. Existing records are
   * never overwritten; missing schema keys are repaired instead.
   */
  function initializeDemoData() {
    if (hasWorkspaceData()) {
      ensureSchema();
      ensureMeta(false);
      return { seeded: false, reason: 'existing-data' };
    }

    writeDemoData();
    return { seeded: true, reason: 'empty-storage' };
  }

  /**
   * Clears every workspace key (including corrupted-value backups) and
   * rebuilds the demo dataset. Call this only after UI confirmation.
   */
  function resetDemoData() {
    Object.keys(KEYS).forEach(function (key) { rawRemove(key); });
    clearCorruptBackupsInternal();
    memory = {};
    var result = initializeDemoData();
    announce('__reset__');
    return result;
  }

  function init() {
    if (!hasWorkspaceData()) {
      writeDemoData();
      return;
    }

    ensureSchema();
    ensureMeta(false);
  }

  /* ---------- 6. Diagnostics ---------- */

  function getCorruptKeys() {
    var found = corruptKeys.slice();

    if (available) {
      try {
        for (var i = 0; i < window.localStorage.length; i += 1) {
          var full = window.localStorage.key(i);
          if (!full || full.indexOf(PREFIX + 'corrupt.') !== 0) continue;
          var name = full.slice(PREFIX.length + 'corrupt.'.length);
          if (found.indexOf(name) === -1) found.push(name);
        }
      } catch (error) {
        /* ignore */
      }
    }

    Object.keys(memory).forEach(function (key) {
      if (key.indexOf('corrupt.') !== 0) return;
      var name = key.slice('corrupt.'.length);
      if (found.indexOf(name) === -1) found.push(name);
    });

    return found;
  }

  function clearCorruptBackups() {
    clearCorruptBackupsInternal();
    announce('__repair__');
  }

  function inspect() {
    return Object.keys(KEYS).map(function (key) {
      var raw = rawGet(key);
      var report = {
        key: key,
        storageKey: PREFIX + key,
        bytes: 0,
        count: 0,
        exists: raw !== null && raw !== '',
        type: 'empty',
        corrupt: false
      };

      if (!report.exists) return report;

      report.bytes = raw.length;
      try { report.bytes = new Blob([raw]).size; } catch (error) { /* keep char length */ }

      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          report.type = 'array';
          report.count = parsed.length;
        } else if (isPlainObject(parsed)) {
          report.type = 'object';
          report.count = Object.keys(parsed).length;
        } else {
          report.type = 'value';
          report.count = 1;
        }
      } catch (error) {
        report.type = 'corrupt';
        report.corrupt = true;
      }

      return report;
    });
  }

  /* ---------- Boot ---------- */

  init();

  var storage = {
    VERSION: VERSION,
    SEED_VERSION: SEED_VERSION,
    PREFIX: PREFIX,
    KEYS: KEYS,
    ARRAY_KEYS: ARRAY_KEYS,
    DEFAULT_STORE: DEFAULT_STORE,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DEFAULT_PREFERENCES: DEFAULT_PREFERENCES,

    getData: getData,
    saveData: saveData,
    updateData: updateData,
    deleteData: deleteData,
    generateId: generateId,

    getStore: getStore,
    saveStore: saveStore,
    getSettings: getSettings,
    saveSettings: saveSettings,

    collection: collection,

    initializeDemoData: initializeDemoData,
    resetDemoData: resetDemoData,

    inspect: inspect,
    getCorruptKeys: getCorruptKeys,
    clearCorruptBackups: clearCorruptBackups,
    isAvailable: function () { return available; },

    /* Short aliases kept for the Step 01/02 call sites. */
    get: getData,
    set: function (key, value) {
      saveData(key, value);
      return value;
    }
  };

  DH.storage = storage;
  DH.store = storage;

})(window);
