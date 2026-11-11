// Complete Browser DOM & ES Module Startup Verification Harness
if (typeof console === 'undefined') {
  globalThis.console = { log: print, warn: print, error: print };
} else {
  if (!console.log) console.log = print;
  if (!console.warn) console.warn = print;
  if (!console.error) console.error = print;
}

import { loadState, resetStateToSeed, flagReviewDispute } from '../matching.js';

var mockStorage = {};
var mockSession = { 'crewly_active_role': 'customer' };

var elements = {};

function createElementMock(id, tag = 'div') {
  return {
    id: id,
    tagName: tag.toUpperCase(),
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    classList: {
      _classes: new Set(),
      add: function(c) { this._classes.add(c); },
      remove: function(c) { this._classes.delete(c); },
      contains: function(c) { return this._classes.has(c); }
    },
    style: {},
    disabled: false,
    checked: false,
    _listeners: {},
    addEventListener: function(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    },
    dispatchEvent: function(event) {
      var fns = this._listeners[event.type || event] || [];
      for (var i = 0; i < fns.length; i++) fns[i](event);
    },
    querySelector: function(sel) { return null; },
    querySelectorAll: function(sel) { return []; },
    getAttribute: function(name) { return null; },
    setAttribute: function(name, val) {}
  };
}

globalThis.localStorage = {
  getItem: function(key) { return mockStorage[key] || null; },
  setItem: function(key, val) { mockStorage[key] = String(val); },
  removeItem: function(key) { delete mockStorage[key]; }
};

globalThis.sessionStorage = {
  getItem: function(key) { return mockSession[key] || null; },
  setItem: function(key, val) { mockSession[key] = String(val); },
  removeItem: function(key) { delete mockSession[key]; }
};

var docListeners = {};
globalThis.document = {
  getElementById: function(id) {
    if (!elements[id]) {
      elements[id] = createElementMock(id);
    }
    return elements[id];
  },
  querySelector: function(sel) {
    if (sel.startsWith('#')) return this.getElementById(sel.substring(1));
    return createElementMock('mock_query', 'div');
  },
  querySelectorAll: function(sel) {
    if (sel === '.admin-tab-panel') {
      return [
        this.getElementById('admin-panel-overview'),
        this.getElementById('admin-panel-alerts'),
        this.getElementById('admin-panel-dispatch'),
        this.getElementById('admin-panel-workers'),
        this.getElementById('admin-panel-support'),
        this.getElementById('admin-panel-finance'),
        this.getElementById('admin-panel-trust'),
        this.getElementById('admin-panel-audit')
      ];
    }
    if (sel === '.admin-subnav-btn') {
      return ['overview', 'alerts', 'dispatch', 'workers', 'support', 'finance', 'trust', 'audit'].map(function(t) {
        var el = createElementMock('subnav_' + t, 'button');
        el.getAttribute = function(attr) { return attr === 'data-tab' ? t : null; };
        return el;
      });
    }
    return [];
  },
  addEventListener: function(event, fn) {
    if (!docListeners[event]) docListeners[event] = [];
    docListeners[event].push(fn);
  }
};

globalThis.window = {
  location: { search: '', pathname: '/index.html', origin: 'http://localhost', href: 'http://localhost/index.html' },
  history: {
    replaceState: function(s, t, url) {
      window.location.href = url;
      window.location.search = url.indexOf('?') !== -1 ? url.substring(url.indexOf('?')) : '';
    }
  },
  addEventListener: function(event, fn) {},
  dispatchEvent: function(e) {}
};

globalThis.CustomEvent = function(type, opts) {
  this.type = type;
  this.detail = opts ? opts.detail : null;
};

// Reset demo seed data
resetStateToSeed();

// Dynamically import app.js
console.log("Loading app.js as ES module...");
await import('../app.js');
console.log("app.js imported successfully!");

// Trigger DOMContentLoaded
console.log("Triggering DOMContentLoaded...");
var dclListeners = docListeners['DOMContentLoaded'] || [];
for (var i = 0; i < dclListeners.length; i++) {
  dclListeners[i]();
}
console.log("DOMContentLoaded executed cleanly!");

// Verification assertions
var passed = 0;
var failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log("  PASS: " + message);
  } else {
    failed++;
    console.log("  FAIL: " + message);
  }
}

console.log("\n=== BROWSER INITIALIZATION VERIFICATION ===");

// 1. Customer Profile dropdown displays customers
var customerSelector = document.getElementById('customer-selector');
assert(customerSelector.innerHTML.indexOf('Sarah Jenkins') !== -1, "Customer selector populated with Sarah Jenkins");
assert(customerSelector.innerHTML.indexOf('David Miller') !== -1, "Customer selector populated with David Miller");

// 2. Service booking cards render
var serviceCards = document.getElementById('service-cards-container');
assert(serviceCards.innerHTML.indexOf('Moving & Lifting Assistance') !== -1, "Service cards rendered with Moving service");
assert(serviceCards.innerHTML.indexOf('TV Mounting') !== -1, "Service cards rendered with TV Mounting service");
assert(serviceCards.innerHTML.indexOf('Lawn Mowing & Basic Care') !== -1, "Service cards rendered with Lawn Care service");

// 3. Customer active and completed bookings render
var activeBookings = document.getElementById('customer-active-bookings-container');
assert(activeBookings.innerHTML.indexOf('CRW-1001') !== -1 || activeBookings.innerHTML.indexOf('CRW-1004') !== -1, "Active bookings rendered in customer view");

var pastBookings = document.getElementById('customer-past-bookings-container');
assert(pastBookings.innerHTML.indexOf('CRW-1003') !== -1 || pastBookings.innerHTML.indexOf('No completed bookings') !== -1 || pastBookings.innerHTML.length > 0, "Past bookings section initialized");

// 4. Pro View loads with jobs and wallet information
var proJobs = document.getElementById('pro-job-board-container');
assert(proJobs.innerHTML.length > 0, "Pro job board loaded");

var proAvailable = document.getElementById('pro-stat-available');
assert(proAvailable.textContent.indexOf('$') !== -1, "Pro wallet available balance rendered (" + proAvailable.textContent + ")");

var proPending = document.getElementById('pro-stat-pending');
assert(proPending.textContent.indexOf('$') !== -1, "Pro wallet pending balance rendered (" + proPending.textContent + ")");

var proLifetime = document.getElementById('pro-stat-lifetime');
assert(proLifetime.textContent.indexOf('$') !== -1, "Pro wallet lifetime balance rendered (" + proLifetime.textContent + ")");

// 5. Admin View loads all its tabs
var adminTotalBookings = document.getElementById('admin-stat-total-bookings');
var adminAlerts = document.getElementById('admin-alerts-container');
var adminDispatch = document.getElementById('admin-dispatch-bookings-list');
var adminWorkersGrid = document.getElementById('admin-workers-roster-grid');
var adminSupportList = document.getElementById('admin-support-cases-list');
var adminFinancePros = document.getElementById('admin-finance-pros-table-body');
var adminFinanceLedger = document.getElementById('admin-finance-ledger-table-body');
var adminTrustReviews = document.getElementById('admin-trust-reviews-list');
var adminAuditTable = document.getElementById('admin-audit-table-container');

assert(String(adminTotalBookings.textContent) === '4', "Admin Overview stat total requests matches 4");
assert(adminAlerts.innerHTML.length > 0, "Admin Needs Attention queue rendered");
assert(adminDispatch.innerHTML.indexOf('CRW-1004') !== -1, "Admin Dispatch console rendered with CRW-1004");
assert(adminWorkersGrid.innerHTML.indexOf('Marcus Davis') !== -1, "Admin Worker Directory rendered Marcus Davis");
assert(adminWorkersGrid.innerHTML.indexOf('Elena Rodriguez') !== -1, "Admin Worker Directory rendered Elena Rodriguez");
assert(adminSupportList.innerHTML.indexOf('CASE-101') !== -1, "Admin Support queue rendered with CASE-101");
assert(adminFinancePros.innerHTML.indexOf('Marcus Davis') !== -1, "Admin Finance Pro wallet summary rendered");
assert(adminFinanceLedger.innerHTML.length > 0, "Admin Finance Master Platform Ledger rendered");
assert(adminTrustReviews.innerHTML.indexOf('Carlos Mendez') !== -1, "Admin Trust & Safety review roster rendered");
assert(adminAuditTable.innerHTML.indexOf('audit-table') !== -1, "Admin Audit Trail rendered");

// 6. Trust & Safety dispute functionality works
var disputeRes = flagReviewDispute('CRW-1003', 'slot_1', 'Automated startup test dispute');
assert(disputeRes.success === true, "flagReviewDispute succeeds in browser runtime");
assert(disputeRes.case.category === 'trust_safety', "Trust & Safety case generated");

console.log("\n=================================================");
console.log("STARTUP RESULTS: " + passed + " passed, " + failed + " failed.");
if (failed > 0) {
  throw new Error("Browser startup verification failed.");
}
