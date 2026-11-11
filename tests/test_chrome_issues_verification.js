/**
 * Verification Test for Chrome Browser Bugs: Issue 1 (Checkbox) and Issue 2 (Booking Status)
 * Course: INSY 3331: Artificial Intelligence for Business
 */

if (typeof console === 'undefined') {
  globalThis.console = { log: print, warn: print, error: print };
} else {
  if (!console.log) console.log = print;
  if (!console.warn) console.warn = print;
  if (!console.error) console.error = print;
}

var mockStorage = {};
var mockSession = { 'crewly_active_role': 'admin' };

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

globalThis.window = {
  location: { search: '?role=admin', pathname: '/index.html', origin: 'http://localhost', href: 'http://localhost/index.html?role=admin' },
  history: {
    replaceState: function(s, t, url) {
      window.location.href = url;
      window.location.search = url.indexOf('?') !== -1 ? url.substring(url.indexOf('?')) : '';
    }
  },
  dispatchEvent: function(e) {}
};

globalThis.CustomEvent = function(name, opts) {
  this.name = name;
  this.detail = opts ? opts.detail : null;
};

import {
  loadState,
  saveState,
  resetStateToSeed,
  assignProToSlot,
  updateProAssignmentStatus,
  canBookingBeCancelled,
  canSlotBeAdminCompleted,
  adminVerifyAndCompleteAssignment,
  recalculateBookingStatus
} from '../matching.js';

var passed = 0;
var failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    print("  PASS: " + message);
  } else {
    failed++;
    print("  FAIL: " + message);
  }
}

print("\n==================================================================");
print("CREWLY BUG REGRESSION TEST: CHROME ISSUES 1 & 2");
print("==================================================================");

// Initialize fresh seed state
resetStateToSeed();
var state = loadState();

// 1. Setup multi-worker booking CRW-1001
// Slot 1 is Marcus Davis (assigned). Slot 2 is unassigned.
var b = state.bookings.find(x => x.id === 'CRW-1001');
assert(b !== undefined, "CRW-1001 exists in state");
assert(b.overallStatus === 'partially_filled', "CRW-1001 begins as partially_filled");

// Ensure booking date is valid future date for test progression
b.scheduledDate = '2026-11-15';
saveState(state);

// Assign Jamar Washington to Slot 2
var assignRes = assignProToSlot('CRW-1001', 'slot_2', 'pro_jamar');
assert(assignRes.success === true, "Jamar assigned to Slot 2");

state = loadState();
b = state.bookings.find(x => x.id === 'CRW-1001');
assert(b.overallStatus === 'fully_confirmed', "CRW-1001 transitions to fully_confirmed when both workers assigned");

// Check cancellation allowed pre-work
var preCancel = canBookingBeCancelled(b);
assert(preCancel.allowed === true, "Pre-work cancellation is allowed when workers are assigned");

// 2. Marcus progresses to traveling
var travRes1 = updateProAssignmentStatus('CRW-1001', 'slot_1', 'traveling');
assert(travRes1.success === true, "Marcus transitions to traveling");

state = loadState();
b = state.bookings.find(x => x.id === 'CRW-1001');
assert(b.overallStatus === 'traveling', "Booking header accurately transitions to 'traveling' when worker en route");

// Active work restricts cancellation
var travCancel = canBookingBeCancelled(b);
assert(travCancel.allowed === false, "Cancellation strictly restricted once worker starts traveling");
assert(travCancel.escalationToSupport === true, "Active travel flags escalation to Support");

// 3. Marcus arrives, then starts work
updateProAssignmentStatus('CRW-1001', 'slot_1', 'arrived');
state = loadState();
b = state.bookings.find(x => x.id === 'CRW-1001');
assert(b.overallStatus === 'arrived', "Booking header accurately transitions to 'arrived'");

updateProAssignmentStatus('CRW-1001', 'slot_1', 'in_progress');
state = loadState();
b = state.bookings.find(x => x.id === 'CRW-1001');
assert(b.overallStatus === 'in_progress', "Booking header accurately transitions to 'in_progress' when Marcus starts work");

// 4. Jamar also progresses to in_progress
updateProAssignmentStatus('CRW-1001', 'slot_2', 'traveling');
updateProAssignmentStatus('CRW-1001', 'slot_2', 'arrived');
updateProAssignmentStatus('CRW-1001', 'slot_2', 'in_progress');
state = loadState();
b = state.bookings.find(x => x.id === 'CRW-1001');
assert(b.overallStatus === 'in_progress', "Issue 2 Resolved: When both workers are in_progress, booking header is 'in_progress' (NOT 'fully_confirmed')");
assert(b.workerAssignments[0].status === 'in_progress', "Marcus slot is in_progress");
assert(b.workerAssignments[1].status === 'in_progress', "Jamar slot is in_progress");

// 5. Test Issue 1: Admin Verify & Complete Affirmative Checkbox
var slot1 = b.workerAssignments[0];
var canComplete1 = canSlotBeAdminCompleted(b, slot1);
assert(canComplete1.allowed === true, "canSlotBeAdminCompleted allows verification for in_progress slot");

// Attempt verification with confirmed: false (simulate unconfirmed submission)
var unconfRes = adminVerifyAndCompleteAssignment(
  'CRW-1001',
  'slot_1',
  'pro_marcus',
  {
    source: 'Customer Direct Phone Confirmation (Demo Simulation)',
    explanation: 'Sarah verified job is done.',
    confirmed: false
  }
);
assert(unconfRes.success === false, "Verification strictly rejected when confirmed is false");
assert(unconfRes.error === 'Affirmative confirmation checkbox is required to verify completion.', "Correct error returned when confirmation checkbox is unconfirmed");

// Marcus balances before
state = loadState();
var marcusPre = state.pros.find(p => p.id === 'pro_marcus');
var mPendingPre = marcusPre.earnings.pendingBalance;
var mAvailPre = marcusPre.earnings.availableBalance;
var mLifetimePre = marcusPre.earnings.lifetimeEarned;

// Jamar balances before
var jamarPre = state.pros.find(p => p.id === 'pro_jamar');
var jPendingPre = jamarPre.earnings.pendingBalance;
var jAvailPre = jamarPre.earnings.availableBalance;
var jLifetimePre = jamarPre.earnings.lifetimeEarned;

// Verification with confirmed: true (simulate UI checkbox checked)
var confRes = adminVerifyAndCompleteAssignment(
  'CRW-1001',
  'slot_1',
  'pro_marcus',
  {
    source: 'Customer Direct Phone Confirmation (Demo Simulation)',
    verificationSource: 'Customer Direct Phone Confirmation (Demo Simulation)',
    explanation: 'Confirmed by phone with Sarah Jenkins.',
    confirmed: true
  }
);
assert(confRes.success === true, "Issue 1 Resolved: Verification succeeds when confirmation checkbox is true");

// 6. Check single-worker earnings release
state = loadState();
b = state.bookings.find(x => x.id === 'CRW-1001');
var marcusPost = state.pros.find(p => p.id === 'pro_marcus');
var jamarPost = state.pros.find(p => p.id === 'pro_jamar');

assert(b.workerAssignments[0].status === 'completed', "Marcus assignment is completed");
assert(b.workerAssignments[1].status === 'in_progress', "Jamar assignment remains in_progress");
assert(b.overallStatus === 'in_progress', "Booking remains 'in_progress' because Jamar has not completed yet");

// Marcus balances updated
assert(marcusPost.earnings.pendingBalance === mPendingPre - 75, "Marcus pending balance decreased by $75.00");
assert(marcusPost.earnings.availableBalance === mAvailPre + 75, "Marcus available balance increased by $75.00");
assert(marcusPost.earnings.lifetimeEarned === mLifetimePre + 75, "Marcus lifetime earned increased by $75.00");

// Jamar balances completely untouched
assert(jamarPost.earnings.pendingBalance === jPendingPre, "Jamar pending balance untouched by Marcus completion");
assert(jamarPost.earnings.availableBalance === jAvailPre, "Jamar available balance untouched by Marcus completion");
assert(jamarPost.earnings.lifetimeEarned === jLifetimePre, "Jamar lifetime earned untouched by Marcus completion");

// 7. Test Repeated Completion Rejection (Zero Duplicate Earnings)
var repeatRes = adminVerifyAndCompleteAssignment(
  'CRW-1001',
  'slot_1',
  'pro_marcus',
  {
    source: 'Customer Direct Phone Confirmation (Demo Simulation)',
    explanation: 'Attempting duplicate completion.',
    confirmed: true
  }
);
assert(repeatRes.success === false, "Repeated completion on already-completed slot is strictly rejected");
state = loadState();
var marcusRepeat = state.pros.find(p => p.id === 'pro_marcus');
assert(marcusRepeat.earnings.availableBalance === marcusPost.earnings.availableBalance, "No duplicate earnings credited upon repeated completion");

// 8. Complete Jamar assignment
var jamarCompRes = adminVerifyAndCompleteAssignment(
  'CRW-1001',
  'slot_2',
  'pro_jamar',
  {
    source: 'On-Site Dispatcher Field Check (Demo Simulation)',
    explanation: 'Dispatcher checked on site.',
    confirmed: true
  }
);
assert(jamarCompRes.success === true, "Jamar completion succeeds");

state = loadState();
b = state.bookings.find(x => x.id === 'CRW-1001');
assert(b.workerAssignments[0].status === 'completed', "Both Slot 1 is completed");
assert(b.workerAssignments[1].status === 'completed', "Both Slot 2 is completed");
assert(b.overallStatus === 'completed', "Booking overallStatus transitions to 'completed' ONLY after both required workers are finished");

var jamarFinal = state.pros.find(p => p.id === 'pro_jamar');
assert(jamarFinal.earnings.availableBalance === jAvailPre + 75, "Jamar earnings safely released upon completion");

print("\n==================================================================");
print("TEST RESULTS: " + passed + " passed, " + failed + " failed.");
print("==================================================================");

if (failed > 0) {
  throw new Error("Tests failed: " + failed);
}
