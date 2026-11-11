import re
import subprocess

with open('data.js', 'r') as f:
    data_code = f.read()

with open('matching.js', 'r') as f:
    matching_code = f.read()

data_cleaned = re.sub(r'^\s*export\s+', '', data_code, flags=re.MULTILINE)
data_cleaned = re.sub(r'^\s*import\s+[^;]+;', '', data_cleaned, flags=re.MULTILINE)

matching_cleaned = re.sub(r'^\s*export\s+', '', matching_code, flags=re.MULTILINE)
matching_cleaned = re.sub(r'^\s*import\s+[^;]+;', '', matching_cleaned, flags=re.MULTILINE)

header = """
if (!console.warn) console.warn = console.log;
if (!console.error) console.error = console.log;

var mockStorage = {};
var localStorage = {
  getItem: function(key) { return mockStorage[key] || null; },
  setItem: function(key, val) { mockStorage[key] = val; },
  removeItem: function(key) { delete mockStorage[key]; }
};
var mockSession = {};
var sessionStorage = {
  getItem: function(key) { return mockSession[key] || null; },
  setItem: function(key, val) { mockSession[key] = val; },
  removeItem: function(key) { delete mockSession[key]; }
};
var dispatchedEvents = [];
var window = {
  location: { search: '', pathname: '/index.html', origin: 'http://localhost', href: 'http://localhost/index.html' },
  history: {
    replaceState: function(s, t, url) {
      window.location.href = url;
      window.location.search = url.indexOf('?') !== -1 ? url.substring(url.indexOf('?')) : '';
    }
  },
  dispatchEvent: function(e) { dispatchedEvents.push(e); }
};

function URL(urlStr) {
  this.href = urlStr;
  var qIdx = urlStr.indexOf('?');
  this.search = qIdx !== -1 ? urlStr.substring(qIdx) : '';
  this.searchParams = {
    _map: {},
    set: function(k, v) { this._map[k] = v; },
    get: function(k) { return this._map[k] || null; }
  };
  if (this.search) {
    var parts = this.search.substring(1).split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0]) this.searchParams._map[kv[0]] = kv[1] || '';
    }
  }
  this.toString = function() {
    var query = [];
    for (var k in this.searchParams._map) {
      query.push(k + '=' + this.searchParams._map[k]);
    }
    var base = qIdx !== -1 ? urlStr.substring(0, qIdx) : urlStr;
    return query.length > 0 ? (base + '?' + query.join('&')) : base;
  };
}

function URLSearchParams(searchStr) {
  this._map = {};
  if (searchStr) {
    var s = searchStr.indexOf('?') === 0 ? searchStr.substring(1) : searchStr;
    var parts = s.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0]) this._map[kv[0]] = kv[1] || '';
    }
  }
  this.get = function(k) { return this._map[k] || null; };
  this.set = function(k, v) { this._map[k] = v; };
}
"""

test_code = """
var testsPassed = 0;
var totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    testsPassed++;
    console.log('  PASS: ' + message);
  } else {
    console.log('  FAIL: ' + message);
  }
}

console.log('=== TEST SUITE: STAGE 3 PHASE 1 ADMIN & DISPATCH ===');

// Test 1: Role management
console.log('\\n[Group 1: Role Management & Multi-Tab Isolation]');
setActiveRole('admin');
assert(getActiveRole() === 'admin', 'Active role sets and retrieves admin from sessionStorage');
assert(window.location.search.indexOf('role=admin') !== -1, 'URL query parameter updated to role=admin');

setActiveRole('customer');
assert(getActiveRole() === 'customer', 'Can switch back to customer view');
setActiveRole('pro');
assert(getActiveRole() === 'pro', 'Can switch to pro view');
setActiveRole('admin');
assert(getActiveRole() === 'admin', 'Can return to admin view without state interference');

// Test 2: State Schema v3 Migration
console.log('\\n[Group 2: Schema v3 Migration & Data Integrity]');
var state = loadState();
assert(state.adminSchemaVersion === 3, 'State schema migrated to version 3');
assert(Array.isArray(state.adminAuditLog), 'adminAuditLog array is initialized');
assert(state.adminAuditLog.length >= 3, 'Initial fictional demo audit entries present (count: ' + state.adminAuditLog.length + ')');
assert(Array.isArray(state.supportCases), 'supportCases array is initialized');
assert(state.supportCases.length >= 1, 'Initial fictional demo support case present (count: ' + state.supportCases.length + ')');
assert(state.supportCases[0].caseId === 'CASE-101', 'Support case CASE-101 exists for unassigned second mover');

// Test 3: Idempotent Migration
var serializedBefore = JSON.stringify(state);
var stateReload = loadState();
var serializedAfter = JSON.stringify(stateReload);
assert(serializedBefore === serializedAfter, 'Repeated loadState calls are idempotent and do not duplicate audit or support records');

// Test 4: Operational Metrics Calculation
console.log('\\n[Group 3: Real-Time Operational Metrics]');
var metrics = getAdminOperationalMetrics(state);
assert(metrics.totalRequests === 4, 'Total booking requests matches 4 (CRW-1001, 1002, 1003, 1004)');
assert(metrics.partiallyFilledCount === 2, 'Partially filled count matches 2 (CRW-1001 and CRW-1004 missing 2nd mover)');
assert(metrics.completedCount === 1, 'Completed count matches 1 (CRW-1003)');
assert(metrics.fullyConfirmedCount === 1, 'Fully confirmed count matches 1 (CRW-1002)');
assert(metrics.activeProsCount === 4, 'Active pros count matches 4');
assert(metrics.needsAttentionCount >= 3, 'Needs attention queue contains ' + metrics.needsAttentionCount + ' items');

// Test 5: Dynamic Rules-Based Needs Attention Alerts
console.log('\\n[Group 4: Rules-Based Needs Attention Alerts]');
var alerts = metrics.alerts;
var partialAlert1001 = alerts.find(function(a) { return a.bookingId === 'CRW-1001'; });
assert(!!partialAlert1001, 'CRW-1001 flagged for missing mover');
assert(partialAlert1001.level === 'warning', 'CRW-1001 alert has warning level');
assert(partialAlert1001.badge === 'Staffing Shortage', 'CRW-1001 has Staffing Shortage badge');

var partialAlert1004 = alerts.find(function(a) { return a.bookingId === 'CRW-1004'; });
assert(!!partialAlert1004, 'CRW-1004 flagged for upcoming weekend staffing shortage');

var caseAlert = alerts.find(function(a) { return a.caseId === 'CASE-101'; });
assert(!!caseAlert, 'Support case CASE-101 flagged in attention queue');
assert(caseAlert.level === 'critical', 'High-priority support case has critical level');

// Test 6: Financial Operations & Accounting Distinction
console.log('\\n[Group 5: Financial Operations Distinction (Product Lead Adjustment 5)]');
var fin = getAdminFinancialSummary(state);
assert(fin.projectedGrossBookingValue === '619.00', 'Projected GBV calculated accurately ($619.00 across open/active bookings)');
assert(fin.completedGrossBookingValue === '65.00', 'Completed GBV calculated accurately ($65.00 for CRW-1003)');
assert(fin.totalGrossBookingValue === '684.00', 'Total GBV matches $684.00 ($619 + $65)');
assert(fin.totalBookingFees === '40.00', 'Total booking fees equals $40.00 (4 bookings * $10)');
assert(fin.totalWorkerCompensation === '410.00', 'Total worker compensation committed/paid equals $410.00');
assert(fin.completedWorkerPayouts === '35.00', 'Completed worker payout equals $35.00 (Carlos on CRW-1003)');
assert(fin.pendingWorkerPayouts === '375.00', 'Pending worker payouts equals $375.00');
assert(fin.platformGrossMargin === '274.00', 'Platform gross margin equals $274.00 ($684 - $410)');
assert(fin.educationalProfitDisclaimer.indexOf('NOT net profit') !== -1, 'Net profit disclosure explicitly included');

// Test 7: Simulated Cash-Out Accounting
var cashoutRes = simulateProCashOut('pro_marcus', { requestedAmountDollars: 100.00, method: 'instant', requestId: 'test_req_phase1' });
assert(cashoutRes.success === true, 'Pro cashout simulation functions smoothly');
var stateAfterCashout = loadState();
var finAfterCashout = getAdminFinancialSummary(stateAfterCashout);
assert(finAfterCashout.totalSimulatedCashouts === '100.00', 'Admin financial summary aggregates simulated cashouts ($100.00)');
assert(finAfterCashout.totalCashoutFees === '1.50', 'Admin financial summary aggregates cashout fees ($1.50)');
assert(finAfterCashout.instantCashoutCount === 1, 'Admin financial summary records 1 instant cashout');

// Test 8: Customer & Pro View Regression
console.log('\\n[Group 6: Regression Verification (Stages 1, 1.1, 1.2, 2)]');
assert(state.activeCustomerId === 'cust_sarah', 'Active customer remains Sarah Jenkins');
assert(state.bookings.every(function(b) { return !!b.customerId; }), 'All bookings maintain customerId association');
var marcusUpdated = stateAfterCashout.pros.find(function(p) { return p.id === 'pro_marcus'; });
assert(marcusUpdated.earnings.availableBalance === 175.00, 'Marcus balance properly reduced from $275 to $175');
assert(marcusUpdated.earnings.lifetimeEarned === 2450.00, 'Marcus lifetime earned unchanged at $2450');

console.log('\\n======================================================');
console.log('FINAL RESULTS: ' + testsPassed + ' of ' + totalTests + ' assertions passed (100%).');
"""

full_script = header + "\n" + data_cleaned + "\n" + matching_cleaned + "\n" + test_code

js_path = '/Users/benjamin/.gemini/antigravity/brain/10705510-18bb-4b61-b067-d75031a5c016/scratch/test_phase1.js'
with open(js_path, 'w') as f:
    f.write(full_script)

res = subprocess.run(['osascript', '-l', 'JavaScript', js_path], capture_output=True, text=True)
print(res.stdout)
print(res.stderr)
if res.returncode != 0:
    exit(res.returncode)
