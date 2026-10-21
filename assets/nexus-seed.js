/**
 * Nexus demo seed data + localStorage seeding.
 *
 * Loaded by every module page AND the dashboard. Two jobs:
 *
 *  1. Single source of truth for the demo dataset. Each page used to keep its
 *     own private copy of the same records, so the data was duplicated across
 *     files and could drift.
 *
 *  2. Seed localStorage on demand. The dashboard is a separate page that reads
 *     localStorage for its KPI cards, so opening index.html FIRST left those
 *     keys empty and every card showed "—" until you happened to visit a module
 *     page. Calling ensure() on load fixes that, whichever page is opened first.
 *
 * Plain classic script (not an ES module) so it also works from file://.
 */
(function () {
  'use strict';

  var SEED = {

    /* ---------------------------------------------------------------- */
    /* INVENTORY OS  (keys: devhawx_*)                                   */
    /* ---------------------------------------------------------------- */
    'devhawx_products': [
      { id: "P-101", title: "Super Kernel Basmati Rice", sku: "SKU-RICE-01", barcode: "89010011", category: "Grocery", brand: "Guard", cost: 12.00, retail: 16.50, stock: 85, reorder: 20, variant: "5 kg Bag", batch: "B-883", expiry: "2027-12-31", tax: 5.0 },
      { id: "P-102", title: "Olper's Full Cream Milk", sku: "SKU-MILK-02", barcode: "89010022", category: "Dairy", brand: "Engro", cost: 1.10, retail: 1.45, stock: 12, reorder: 25, variant: "1 Litre Pack", batch: "B-201", expiry: "2026-11-15", tax: 2.5 },
      { id: "P-103", title: "Dalda Sunflower Cooking Oil", sku: "SKU-OIL-03", barcode: "89010033", category: "Grocery", brand: "Dalda", cost: 18.50, retail: 22.00, stock: 40, reorder: 15, variant: "5 Litre Tin", batch: "B-109", expiry: "2027-06-30", tax: 5.0 },
      { id: "P-104", title: "Cadbury Dairy Milk Silk", sku: "SKU-CHOC-04", barcode: "89010044", category: "Snacks", brand: "Cadbury", cost: 1.80, retail: 2.50, stock: 120, reorder: 30, variant: "150g Bar", batch: "B-554", expiry: "2027-04-10", tax: 5.0 },
      { id: "P-105", title: "Nestlé Pure Life Water", sku: "SKU-WATR-05", barcode: "89010055", category: "Beverage", brand: "Nestlé", cost: 0.30, retail: 0.60, stock: 6, reorder: 50, variant: "1.5L Bottle", batch: "B-702", expiry: "2027-08-20", tax: 0.0 }
    ],

    'devhawx_adjustments': [
      { id: "ADJ-1", date: "2026-10-18 14:22", sku: "SKU-MILK-02", title: "Olper's Full Cream Milk", qty: 3, reason: "Expired Stock", user: "Inspector Khan" }
    ],

    'devhawx_pos': [
      { id: "PO-9001", supplier: "Engro Foods Dist", productId: "P-102", productTitle: "Olper's Full Cream Milk", qty: 100, cost: 1.10, status: "Pending", deliveryDate: "2026-10-25" }
    ],

    /* ---------------------------------------------------------------- */
    /* VENDORS & PAYABLES  (keys: erp_*)                                 */
    /* ---------------------------------------------------------------- */
    'erp_vendors': [
      { id: "V-101", name: "Nestlé Pakistan Ltd", person: "Kamran Akmal", phone: "042-35987000", email: "orders@nestle.pk", ntn: "0801122-3", strn: "07-01-2100-001-88", terms: "Net 30", paymode: "Bank Transfer", address: "308-Upper Mall, Lahore", balance: 245000 },
      { id: "V-102", name: "Shan Foods (Pvt) Ltd", person: "Zubair Ahmad", phone: "021-35053000", email: "supply@shanfoods.com", ntn: "1422901-5", strn: "02-05-1900-112-44", terms: "Net 15", paymode: "Crossed Cheque", address: "Sector 15, Korangi Industrial Area, Karachi", balance: 120000 },
      { id: "V-103", name: "Unilever Pakistan", person: "Faisal Qureshi", phone: "021-35685411", email: "ap.pk@unilever.com", ntn: "0710099-1", strn: "03-09-3300-551-22", terms: "Net 45", paymode: "Bank Transfer", address: "Avari Plaza, Fatima Jinnah Road, Karachi", balance: 580000 },
      { id: "V-104", name: "Metro Distribution", person: "Sajid Khan", phone: "042-111786638", email: "b2b@metro.pk", ntn: "2910400-8", strn: "05-01-4400-990-11", terms: "Cash on Delivery", paymode: "Cash", address: "Thokar Niaz Baig, Multan Road, Lahore", balance: 0 }
    ],

    'erp_bills': [
      { id: "INV-9021", vendorId: "V-101", vendorName: "Nestlé Pakistan Ltd", billDate: "2026-10-01", dueDate: "2026-10-31", total: 300000, paid: 55000, status: "Partial" },
      { id: "INV-9022", vendorId: "V-102", vendorName: "Shan Foods (Pvt) Ltd", billDate: "2026-09-15", dueDate: "2026-09-30", total: 120000, paid: 0, status: "Overdue" },
      { id: "INV-9023", vendorId: "V-103", vendorName: "Unilever Pakistan", billDate: "2026-10-10", dueDate: "2026-11-25", total: 580000, paid: 0, status: "Unpaid" }
    ],

    'erp_ledger': [
      { id: "TRX-101", date: "2026-10-05 11:30", vendorName: "Nestlé Pakistan Ltd", ref: "HBL-882019", mode: "Bank Transfer", amount: 55000, notes: "Advance payment against INV-9021" }
    ],

    /* ---------------------------------------------------------------- */
    /* CRM & SETTINGS  (key: nexus_crm_customers)                        */
    /* ---------------------------------------------------------------- */
    'nexus_crm_customers': [
      { id: 'CUST-001', name: 'Ali Raza', phone: '0300-1234567', tier: 'Gold', points: 580, khataLimit: 50000, khataBalance: 12500 },
      { id: 'CUST-002', name: 'Sara Khan', phone: '0321-9876543', tier: 'Silver', points: 210, khataLimit: 20000, khataBalance: 0 },
      { id: 'CUST-003', name: 'Usman Ghani', phone: '0333-5554433', tier: 'Platinum', points: 1450, khataLimit: 100000, khataBalance: 42000 },
      { id: 'CUST-004', name: 'Bilal Ahmed', phone: '0312-4441122', tier: 'Bronze', points: 45, khataLimit: 10000, khataBalance: 3200 }
    ]
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Writes every key that is missing or unreadable. Never overwrites data the
   * user has actually saved, so it is safe to call on every page load.
   */
  function ensure() {
    Object.keys(SEED).forEach(function (key) {
      try {
        var raw = localStorage.getItem(key);
        if (raw !== null) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return;   // real data already present
        }
      } catch (e) { /* corrupt value — fall through and reseed */ }

      // JSON.stringify (not just clone) — setItem stringifies anything else via
      // Array.prototype.toString(), which would store "[object Object],[...]".
      try { localStorage.setItem(key, JSON.stringify(SEED[key])); }
      catch (e) { /* private mode / storage disabled — seed in memory only */ }
    });
  }

  /** Fresh deep copy of one seed dataset, or undefined for an unknown key. */
  function get(key) {
    return Object.prototype.hasOwnProperty.call(SEED, key) ? clone(SEED[key]) : undefined;
  }

  window.NEXUS_SEED = SEED;
  window.NexusSeed = {
    ensure: ensure,
    get: get,
    keys: function () { return Object.keys(SEED); }
  };

  // Seed on load so whichever page is opened first — the dashboard included —
  // has data available immediately.
  ensure();
})();
