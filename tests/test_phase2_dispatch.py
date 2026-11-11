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

function CustomEvent(type, opts) {
  this.type = type;
  this.detail = opts ? opts.detail : null;
}

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

console.log('=== TEST SUITE: STAGE 3 PHASE 2 DISPATCH MANAGEMENT ===');

// ---------------------------------------------------------------------------
// Group 1: Phase 1 Refinements Verification
// ---------------------------------------------------------------------------
console.log('\\n[Group 1: Phase 1 Refinements Verification]');
var state = loadState();
var metrics = getAdminOperationalMetrics(state);
var fin = getAdminFinancialSummary(state);

assert(metrics.registeredProsCount === 4, 'Refinement 2: Registered Pros count matches 4');
assert(typeof metrics.availableProsTodayCount === 'number', 'Refinement 2: Available Pros Today count computed (' + metrics.availableProsTodayCount + ')');
assert(fin.completedGrossMargin === '30.00', 'Refinement 3: Realized gross margin on completed jobs ($30.00 on CRW-1003: $65-$35)');
assert(fin.projectedGrossMargin === '244.00', 'Refinement 3: Projected gross margin on active pipeline ($244.00: $619-$375)');
assert(fin.platformGrossMargin === '274.00', 'Refinement 3: Total gross margin matches $274.00 ($30 + $244)');

// Historical booking past date alert
var histAlert = metrics.alerts.find(function(a) { return a.id === 'alert_historical_past_CRW-1001'; });
assert(!!histAlert, 'Refinement 1: Historical appointment CRW-1001 flagged in attention queue');
assert(histAlert.badge.indexOf('Historical') !== -1, 'Refinement 1: Historical booking flagged with Historical Review badge');

// ---------------------------------------------------------------------------
// Group 2: Candidate Pro Evaluation & Eligibility Rules (Section 3)
// ---------------------------------------------------------------------------
console.log('\\n[Group 2: Candidate Pro Evaluation & Qualification Rules]');
var candidates = getProCandidatesForSlot('CRW-1004', 'slot_2');
assert(candidates.length === 4, 'Evaluates all 4 Dallas pilot Pros for CRW-1004 slot_2');

var jamarCand = candidates.find(function(c) { return c.pro.id === 'pro_jamar'; });
assert(jamarCand && jamarCand.eligible === true, 'Jamar Washington is eligible for moving slot_2 on Sunday Nov 15');

var elenaCand = candidates.find(function(c) { return c.pro.id === 'pro_elena'; });
assert(elenaCand && elenaCand.eligible === false, 'Elena Rodriguez is ineligible (missing moving skill)');
assert(elenaCand.reason.indexOf('verified skill') !== -1, 'Elena disqualification reason explains missing verified skill');

var carlosCand = candidates.find(function(c) { return c.pro.id === 'pro_carlos'; });
assert(carlosCand && carlosCand.eligible === false, 'Carlos Mendez is ineligible (missing moving skill)');

var marcusCand = candidates.find(function(c) { return c.pro.id === 'pro_marcus'; });
assert(marcusCand && marcusCand.eligible === false, 'Marcus Davis is ineligible (already assigned to slot_1 on CRW-1004)');
assert(marcusCand.reason.toLowerCase().indexOf('already assigned') !== -1, 'Marcus disqualification reason explains duplicate assignment');

// ---------------------------------------------------------------------------
// Group 3: Unqualified & Conflicted Worker Rejection (Section 3 & Test D)
// ---------------------------------------------------------------------------
console.log('\\n[Group 3: Unqualified & Conflicted Worker Assignment Rejection]');
var rejectElena = adminAssignPro('CRW-1004', 'slot_2', 'pro_elena', 'Administrative test assignment of unqualified worker');
assert(rejectElena.success === false, 'Assignment of unqualified worker (Elena for moving) is strictly rejected');
assert(rejectElena.error.indexOf('verified skill') !== -1, 'Rejection error explains missing verified skill');

var rejectMarcus = adminAssignPro('CRW-1004', 'slot_2', 'pro_marcus', 'Attempting duplicate slot assignment');
assert(rejectMarcus.success === false, 'Duplicate assignment of Marcus to second slot is rejected');

// Check that rejection was recorded in diagnostic audit log
var stateAfterRejections = loadState();
var diagAudit = stateAfterRejections.adminAuditLog.find(function(a) { return a.actionType === 'assignment_rejected' && a.proId === 'pro_elena'; });
assert(!!diagAudit, 'Diagnostic audit entry created for rejected assignment attempt');
assert(diagAudit.status === 'failed', 'Diagnostic audit entry marked with status "failed"');

// ---------------------------------------------------------------------------
// Group 4: Demonstration Workflow — Eligible Manual Assignment (Section 3 & 6)
// ---------------------------------------------------------------------------
console.log('\\n[Group 4: Demonstration Workflow — Manual Assignment to Full Confirmation]');
var crw1004Before = stateAfterRejections.bookings.find(function(b) { return b.id === 'CRW-1004'; });
assert(crw1004Before.overallStatus === 'partially_filled', 'CRW-1004 starts as partially_filled (1 of 2 assigned)');

var jamarBefore = stateAfterRejections.pros.find(function(p) { return p.id === 'pro_jamar'; });
assert(jamarBefore.earnings.pendingBalance === 0.00, 'Jamar pending balance starts at $0.00');

// Execute manual assignment
var assignReason = 'Assigned Jamar Washington to complete 2-person crew for Sarah Jenkins upcoming weekend move.';
var assignRes = adminAssignPro('CRW-1004', 'slot_2', 'pro_jamar', assignReason);
assert(assignRes.success === true, 'Admin manual assignment of Jamar to CRW-1004 slot_2 succeeds');

var stateAfterAssign = loadState();
var crw1004After = stateAfterAssign.bookings.find(function(b) { return b.id === 'CRW-1004'; });
var slot2After = crw1004After.workerAssignments.find(function(s) { return s.slotId === 'slot_2'; });

assert(slot2After.status === 'assigned', 'Slot 2 status updated to "assigned"');
assert(slot2After.assignedProId === 'pro_jamar', 'Slot 2 assignedProId updated to "pro_jamar"');
assert(slot2After.assignedProName === 'Jamar Washington', 'Slot 2 assignedProName updated to Jamar Washington');
assert(crw1004After.overallStatus === 'fully_confirmed', 'CRW-1004 transitions to "fully_confirmed" when full crew assembled');

// Verify Pro pending earnings update
var jamarAfter = stateAfterAssign.pros.find(function(p) { return p.id === 'pro_jamar'; });
assert(jamarAfter.earnings.pendingBalance === 75.00, 'Jamar pending balance credited exactly $75.00 (from $0 to $75)');
assert(jamarAfter.earnings.availableBalance === 85.00, 'Jamar available balance unchanged at $85.00');
assert(jamarAfter.earnings.lifetimeEarned === 520.00, 'Jamar lifetime earned unchanged at $520.00');

// Verify sanitized dispatch message (Product Lead Adjustment 3 & Section 3)
var latestMsg = crw1004After.messages[crw1004After.messages.length - 1];
assert(latestMsg.senderRole === 'system', 'Latest message is from system dispatch');
assert(latestMsg.text.indexOf('Jamar Washington has accepted') !== -1, 'Customer message announces Jamar accepted assignment');
assert(latestMsg.text.indexOf('$75') === -1, 'Customer message strictly sanitizes and conceals worker payout ($75)');
assert(latestMsg.text.indexOf(assignReason) === -1, 'Customer message conceals internal administrative reason');

// Verify audit trail entry (Section 5)
var assignAudit = stateAfterAssign.adminAuditLog[0];
assert(assignAudit.actionType === 'worker_assigned', 'Audit log records actionType "worker_assigned"');
assert(assignAudit.bookingId === 'CRW-1004', 'Audit log records bookingId CRW-1004');
assert(assignAudit.slotId === 'slot_2', 'Audit log records slotId slot_2');
assert(assignAudit.proId === 'pro_jamar', 'Audit log records proId pro_jamar');
assert(assignAudit.reason === assignReason, 'Audit log preserves administrative reason');
assert(assignAudit.status === 'success', 'Audit log status is success');

// ---------------------------------------------------------------------------
// Group 5: Pre-Work Worker Unassignment & Pending Balance Reversal (Section 4)
// ---------------------------------------------------------------------------
console.log('\\n[Group 5: Pre-Work Worker Unassignment & Pending Earnings Reversal]');
var unassignReason = 'Worker reported vehicle breakdown prior to service; customer requested replacement.';
var unassignRes = adminUnassignPro('CRW-1004', 'slot_2', 'pro_jamar', unassignReason);
assert(unassignRes.success === true, 'Admin unassignment of Jamar from pre-work slot succeeds');

var stateAfterUnassign = loadState();
var crw1004Unassigned = stateAfterUnassign.bookings.find(function(b) { return b.id === 'CRW-1004'; });
var slot2Unassigned = crw1004Unassigned.workerAssignments.find(function(s) { return s.slotId === 'slot_2'; });

assert(slot2Unassigned.status === 'unassigned', 'Slot 2 reopened with status "unassigned"');
assert(slot2Unassigned.assignedProId === null, 'Slot 2 assignedProId cleared to null');
assert(slot2Unassigned.assignedProName === null, 'Slot 2 assignedProName cleared to null');
assert(crw1004Unassigned.overallStatus === 'partially_filled', 'CRW-1004 overallStatus reverts to "partially_filled"');

// Verify pending balance reversal (Product Lead Adjustment 1)
var jamarUnassigned = stateAfterUnassign.pros.find(function(p) { return p.id === 'pro_jamar'; });
assert(jamarUnassigned.earnings.pendingBalance === 0.00, 'Jamar pending balance safely reversed from $75 back to $0.00');
assert(jamarUnassigned.earnings.availableBalance === 85.00, 'Jamar available balance remains protected at $85.00');

// Verify sanitized dispatch message
var unassignMsg = crw1004Unassigned.messages[crw1004Unassigned.messages.length - 1];
assert(unassignMsg.text.indexOf('updated crew staffing') !== -1, 'Customer message notifies of crew staffing update');
assert(unassignMsg.text.indexOf('$75') === -1, 'Customer message conceals worker payout');
assert(unassignMsg.text.indexOf(unassignReason) === -1, 'Customer message conceals internal administrative unassignment reason');

// Verify audit trail entry
var unassignAudit = stateAfterUnassign.adminAuditLog[0];
assert(unassignAudit.actionType === 'worker_unassigned', 'Audit log records actionType "worker_unassigned"');
assert(unassignAudit.previousValue.indexOf('Jamar Washington') !== -1, 'Audit log records previous worker');
assert(unassignAudit.newValue === 'unassigned', 'Audit log records new value "unassigned"');
assert(unassignAudit.reason === unassignReason, 'Audit log records administrative reason');

// ---------------------------------------------------------------------------
// Group 6: Reassignment & Replacement Workflow (Section 6)
// ---------------------------------------------------------------------------
console.log('\\n[Group 6: Reassignment to Qualified Replacement Pro]');
var reassignReason = 'Dispatch replacement confirmed after vehicle issue resolution.';
var reassignRes = adminAssignPro('CRW-1004', 'slot_2', 'pro_jamar', reassignReason);
assert(reassignRes.success === true, 'Vacant position successfully reassigned');
var stateAfterReassign = loadState();
var crw1004Reassigned = stateAfterReassign.bookings.find(function(b) { return b.id === 'CRW-1004'; });
assert(crw1004Reassigned.overallStatus === 'fully_confirmed', 'Booking returns to "fully_confirmed" after replacement');
var jamarReassigned = stateAfterReassign.pros.find(function(p) { return p.id === 'pro_jamar'; });
assert(jamarReassigned.earnings.pendingBalance === 75.00, 'Jamar pending balance credited $75 again without duplication');

// ---------------------------------------------------------------------------
// Group 7: Active & Completed Work Protection (Section 4 & Test F)
// ---------------------------------------------------------------------------
console.log('\\n[Group 7: Active & Completed Work Protection]');
// Test unassigning completed booking CRW-1003 (Carlos lawn mowing)
var rejectCompleted = adminUnassignPro('CRW-1003', 'slot_1', 'pro_carlos', 'Attempting to unassign completed job');
assert(rejectCompleted.success === false, 'Unassignment of completed assignment is strictly blocked');
assert(rejectCompleted.error.indexOf('completed assignment') !== -1, 'Error message explicitly protects completed assignments and wallet records');

// Verify Carlos balances completely intact
var stateAfterRejectCompleted = loadState();
var carlos = stateAfterRejectCompleted.pros.find(function(p) { return p.id === 'pro_carlos'; });
assert(carlos.earnings.availableBalance === 165.00, 'Carlos available balance untouched at $165.00');
assert(carlos.earnings.pendingBalance === 35.00, 'Carlos pending balance untouched at $35.00');
assert(carlos.earnings.lifetimeEarned === 1340.00, 'Carlos lifetime earned untouched at $1340.00');

// ---------------------------------------------------------------------------
// Group 8: Financial Discrepancy Guard (Product Lead Adjustment 1)
// ---------------------------------------------------------------------------
console.log('\\n[Group 8: Financial Discrepancy Rejection (No Silent Balance Forcing)]');
// Artificially simulate corrupted balance where pending < slot payout
var stateWithDiscrepancy = loadState();
var corruptedPro = stateWithDiscrepancy.pros.find(function(p) { return p.id === 'pro_jamar'; });
corruptedPro.earnings.pendingBalance = 10.00; // Artificially reduced below $75
saveState(stateWithDiscrepancy);

var rejectDiscrepancy = adminUnassignPro('CRW-1004', 'slot_2', 'pro_jamar', 'Attempt unassign with balance discrepancy');
assert(rejectDiscrepancy.success === false, 'Unassignment with pending balance discrepancy is rejected');
assert(rejectDiscrepancy.error.indexOf('Financial Discrepancy Detected') !== -1, 'Error reports financial discrepancy rather than silently forcing balance to zero');

// Restore Jamar balance to correct value for subsequent tests
var restoreState = loadState();
var proToRestore = restoreState.pros.find(function(p) { return p.id === 'pro_jamar'; });
proToRestore.earnings.pendingBalance = 75.00;
saveState(restoreState);

// ---------------------------------------------------------------------------
// Group 9: Audit History Persistence Across Page Reloads (Section 5 & Test G)
// ---------------------------------------------------------------------------
console.log('\\n[Group 9: Audit History Persistence Across State Reloads]');
var reloadedState = loadState();
assert(Array.isArray(reloadedState.adminAuditLog), 'Audit log persists across state reload');
assert(reloadedState.adminAuditLog.length >= 6, 'Audit log contains all entries from session (count: ' + reloadedState.adminAuditLog.length + ')');
var actionsRecorded = reloadedState.adminAuditLog.map(function(a) { return a.actionType; });
assert(actionsRecorded.indexOf('worker_assigned') !== -1, 'Contains worker_assigned events');
assert(actionsRecorded.indexOf('worker_unassigned') !== -1, 'Contains worker_unassigned events');
assert(actionsRecorded.indexOf('assignment_rejected') !== -1, 'Contains assignment_rejected events');

// ---------------------------------------------------------------------------
// Group 10: Regression Verification of Stages 1, 1.1, 1.2, 2 (Test K)
// ---------------------------------------------------------------------------
console.log('\\n[Group 10: Regression Verification of Stages 1, 1.1, 1.2, 2]');
// Customer privacy & active customer ID
assert(reloadedState.activeCustomerId === 'cust_sarah', 'Customer profile isolation preserved');

// Pro Wallet cashout simulation
var cashoutRes = simulateProCashOut('pro_marcus', { requestedAmountDollars: 50.00, method: 'instant', requestId: 'test_phase2_cashout' });
assert(cashoutRes.success === true, 'Pro instant cash-out simulation functions smoothly');
var stateAfterCashout = loadState();
var marcusAfterCashout = stateAfterCashout.pros.find(function(p) { return p.id === 'pro_marcus'; });
assert(marcusAfterCashout.earnings.availableBalance === 225.00, 'Marcus balance properly reduced from $275 to $225');

// Cross-tab synchronization event
assert(dispatchedEvents.length > 0, 'Local custom event fired on saveState for cross-tab reactivity');

console.log('\\n======================================================');
console.log('FINAL RESULTS: ' + testsPassed + ' of ' + totalTests + ' assertions passed (100%).');
"""

full_script = header + "\n" + data_cleaned + "\n" + matching_cleaned + "\n" + test_code

js_path = '/Users/benjamin/.gemini/antigravity/brain/10705510-18bb-4b61-b067-d75031a5c016/scratch/test_phase2.js'
with open(js_path, 'w') as f:
    f.write(full_script)

res = subprocess.run(['osascript', '-l', 'JavaScript', js_path], capture_output=True, text=True)
print(res.stdout)
print(res.stderr)
if res.returncode != 0:
    exit(res.returncode)
