// ============================================================================
// STAGE 3.5: ADMIN BOOKING CANCELLATION & VERIFIED COMPLETION TEST SUITE
// ============================================================================

if (typeof console === 'undefined') {
  globalThis.console = { log: print, warn: print, error: print };
} else {
  if (!console.log) console.log = print;
  if (!console.warn) console.warn = print;
  if (!console.error) console.error = print;
}

// In-memory mock storage for full isolation
var mockStorage = {};
var mockSession = { 'crewly_active_role': 'admin' };
var dispatchedEvents = [];

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
  dispatchEvent: function(e) { dispatchedEvents.push(e); }
};

globalThis.CustomEvent = function(type, opts) {
  this.type = type;
  this.detail = opts ? opts.detail : null;
};

// Import core modules from codebase
import {
  loadState,
  saveState,
  resetStateToSeed,
  createBooking,
  calculatePricing,
  canProAcceptSlot,
  assignProToSlot,
  updateProAssignmentStatus,
  adminAssignPro,
  adminUnassignPro,
  canBookingBeCancelled,
  adminCancelBooking,
  canSlotBeAdminCompleted,
  adminVerifyAndCompleteAssignment,
  centsToDollars,
  dollarsToCents
} from '../matching.js';

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

console.log("\n==================================================================");
console.log("CREWLY STAGE 3.5: ADMIN CANCELLATION & VERIFIED COMPLETION SUITE");
console.log("==================================================================");

// Initialize fresh seed data with auto-book disabled for deterministic testing
resetStateToSeed();
var stateInit = loadState();
stateInit.pros.forEach(p => { p.autoBookEnabled = false; });
saveState(stateInit);

// ----------------------------------------------------------------------------
// TEST A: CANCEL AN UNASSIGNED BOOKING
// ----------------------------------------------------------------------------
console.log("\n[Test A: Cancel an Unassigned Booking]");

var bookingA = createBooking({
  customerId: 'cust_sarah',
  address: '2800 Routh St, Dallas, TX 75204',
  zipCode: '75204',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: '2026-11-28',
  scheduledTime: '10:00',
  intakeDetails: { hours: 2, workersNeeded: 2 }
});

assert(bookingA.overallStatus === 'waiting_for_pros', "Booking A initialized in waiting_for_pros status");
var checkA = canBookingBeCancelled(bookingA);
assert(checkA.allowed === true, "canBookingBeCancelled confirms unassigned booking is eligible");

var cancelResA = adminCancelBooking(
  bookingA.id,
  'Customer called to cancel moving reservation due to lease change.',
  { adminName: 'Dallas Dispatch Lead (Demo)' }
);

assert(cancelResA.success === true, "adminCancelBooking succeeds for unassigned booking");
assert(cancelResA.booking.overallStatus === 'cancelled', "Booking overallStatus updated to 'cancelled'");
assert(cancelResA.snapshot !== undefined, "Cancellation snapshot recorded");
assert(cancelResA.snapshot.previousStatus === 'waiting_for_pros', "Snapshot preserves previous status (waiting_for_pros)");
assert(cancelResA.snapshot.formerWorkers.length === 0, "Snapshot records 0 former assigned workers");

var stateA = loadState();
var auditA = stateA.adminAuditLog.find(l => l.bookingId === bookingA.id && l.actionType === 'booking_canceled');
assert(auditA !== undefined, "Administrative audit log recorded booking_canceled action");
assert(auditA.previousValue === 'waiting_for_pros', "Audit record tracks previous status");
assert(auditA.newValue === 'cancelled', "Audit record tracks new status");

var lastMsgA = cancelResA.booking.messages[cancelResA.booking.messages.length - 1];
assert(lastMsgA.text.indexOf('Cancelled — Pending Manual Review — No Refund Processed') !== -1, "Customer notification clearly conveys pending manual review");
assert(lastMsgA.text.indexOf('$') === -1, "Customer notification contains no worker payout amounts");

// ----------------------------------------------------------------------------
// TEST B: CANCEL A PARTIALLY FILLED BOOKING
// ----------------------------------------------------------------------------
console.log("\n[Test B: Cancel a Partially Filled Booking (Pending Reversal)]");

var bookingB = createBooking({
  customerId: 'cust_sarah',
  address: '2800 Routh St, Dallas, TX 75204',
  zipCode: '75204',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: '2026-11-28',
  scheduledTime: '14:00',
  intakeDetails: { hours: 3, workersNeeded: 2 }
});

// Marcus accepts slot 1 ($75 payout)
var marcusPrePendingB = loadState().pros.find(p => p.id === 'pro_marcus').earnings.pendingBalance;
var marcusPreAvailB = loadState().pros.find(p => p.id === 'pro_marcus').earnings.availableBalance;
var marcusPreLifeB = loadState().pros.find(p => p.id === 'pro_marcus').earnings.lifetimeEarned;

assignProToSlot(bookingB.id, 'slot_1', 'pro_marcus');

var stateB1 = loadState();
var marcusAfterAssignB = stateB1.pros.find(p => p.id === 'pro_marcus');
assert(marcusAfterAssignB.earnings.pendingBalance === marcusPrePendingB + 75, "Marcus pending balance increased by $75 upon slot 1 assignment");

var bookingBState = stateB1.bookings.find(b => b.id === bookingB.id);
assert(bookingBState.overallStatus === 'partially_filled', "Booking B is partially_filled");
assert(canBookingBeCancelled(bookingBState).allowed === true, "canBookingBeCancelled confirms partially filled pre-work booking is eligible");

// Admin cancels partially filled booking
var cancelResB = adminCancelBooking(
  bookingB.id,
  'Customer requested cancellation before second mover was matched.',
  { adminName: 'Dallas Dispatch Lead (Demo)' }
);

assert(cancelResB.success === true, "adminCancelBooking succeeds for partially filled booking");
assert(cancelResB.booking.overallStatus === 'cancelled', "Booking B status transitioned to 'cancelled'");

var stateB2 = loadState();
var marcusPostCancelB = stateB2.pros.find(p => p.id === 'pro_marcus');
assert(marcusPostCancelB.earnings.pendingBalance === marcusPrePendingB, "Marcus pending balance reversed by exactly $75 ($" + marcusAfterAssignB.earnings.pendingBalance + " -> $" + marcusPostCancelB.earnings.pendingBalance + ")");
assert(marcusPostCancelB.earnings.availableBalance === marcusPreAvailB, "Marcus available balance completely untouched ($" + marcusPreAvailB + ")");
assert(marcusPostCancelB.earnings.lifetimeEarned === marcusPreLifeB, "Marcus lifetime earned completely untouched ($" + marcusPreLifeB + ")");

assert(cancelResB.snapshot.formerWorkers.length === 1, "Snapshot preserved 1 former assigned worker");
assert(cancelResB.snapshot.formerWorkers[0].proId === 'pro_marcus', "Snapshot identified Marcus Davis as unassigned worker");
assert(cancelResB.snapshot.formerWorkers[0].payoutDollarsReversed === 75, "Snapshot recorded $75.00 reversed payout");

// ----------------------------------------------------------------------------
// TEST C: CANCEL A FULLY CONFIRMED BOOKING
// ----------------------------------------------------------------------------
console.log("\n[Test C: Cancel a Fully Confirmed Booking (Both Workers Reversed)]");

var bookingC = createBooking({
  customerId: 'cust_sarah',
  address: '2800 Routh St, Dallas, TX 75204',
  zipCode: '75204',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: '2026-11-29',
  scheduledTime: '11:00',
  intakeDetails: { hours: 3, workersNeeded: 2 }
});

var mPendingPreC = loadState().pros.find(p => p.id === 'pro_marcus').earnings.pendingBalance;
var jPendingPreC = loadState().pros.find(p => p.id === 'pro_jamar').earnings.pendingBalance;

// Assign Marcus (slot 1) and Jamar (slot 2)
assignProToSlot(bookingC.id, 'slot_1', 'pro_marcus');
adminAssignPro(bookingC.id, 'slot_2', 'pro_jamar', 'Dispatch staffing for moving crew', { adminName: 'Dallas Dispatch Lead (Demo)' });

var stateC1 = loadState();
var bookingCState = stateC1.bookings.find(b => b.id === bookingC.id);
assert(bookingCState.overallStatus === 'fully_confirmed', "Booking C is fully_confirmed with 2 assigned Pros");

var mPendingMidC = stateC1.pros.find(p => p.id === 'pro_marcus').earnings.pendingBalance;
var jPendingMidC = stateC1.pros.find(p => p.id === 'pro_jamar').earnings.pendingBalance;
assert(mPendingMidC === mPendingPreC + 75, "Marcus pending balance credited $75");
assert(jPendingMidC === jPendingPreC + 75, "Jamar pending balance credited $75");

// Admin cancels fully confirmed booking before work begins
var cancelResC = adminCancelBooking(
  bookingC.id,
  'Customer building access delayed; moving rescheduled for next month.',
  { adminName: 'Dallas Dispatch Lead (Demo)' }
);

assert(cancelResC.success === true, "adminCancelBooking succeeds for fully confirmed pre-work booking");
assert(cancelResC.booking.overallStatus === 'cancelled', "Booking C overallStatus is 'cancelled'");

var stateC2 = loadState();
var mPendingPostC = stateC2.pros.find(p => p.id === 'pro_marcus').earnings.pendingBalance;
var jPendingPostC = stateC2.pros.find(p => p.id === 'pro_jamar').earnings.pendingBalance;

assert(mPendingPostC === mPendingPreC, "Marcus pending balance safely reversed from $" + mPendingMidC + " back to $" + mPendingPostC);
assert(jPendingPostC === jPendingPreC, "Jamar pending balance safely reversed from $" + jPendingMidC + " back to $" + jPendingPostC);
assert(cancelResC.snapshot.formerWorkers.length === 2, "Snapshot recorded both former assigned Pros");

// ----------------------------------------------------------------------------
// TEST D: PROTECT ACTIVE WORK
// ----------------------------------------------------------------------------
console.log("\n[Test D: Protect Active Work (Traveling, Arrived, In Progress)]");

var bookingD = createBooking({
  customerId: 'cust_sarah',
  address: '2800 Routh St, Dallas, TX 75204',
  zipCode: '75204',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: '2026-11-29',
  scheduledTime: '15:00',
  intakeDetails: { hours: 3, workersNeeded: 2 }
});

assignProToSlot(bookingD.id, 'slot_1', 'pro_marcus');
adminAssignPro(bookingD.id, 'slot_2', 'pro_jamar', 'Dispatch full crew', { adminName: 'Dallas Dispatch Lead (Demo)' });

// Marcus starts traveling
updateProAssignmentStatus(bookingD.id, 'slot_1', 'traveling');

var stateD1 = loadState();
var bookingDState = stateD1.bookings.find(b => b.id === bookingD.id);
var checkD = canBookingBeCancelled(bookingDState);

assert(checkD.allowed === false, "canBookingBeCancelled blocks cancellation when a worker is traveling");
assert(checkD.escalationToSupport === true, "Flags escalation to Customer Support");
assert(checkD.reason.indexOf('Work is underway') !== -1, "Reason explains work is underway");

var cancelResD = adminCancelBooking(
  bookingD.id,
  'Attempted cancellation while worker is en route',
  { adminName: 'Dallas Dispatch Lead (Demo)' }
);

assert(cancelResD.success === false, "adminCancelBooking strictly rejects cancellation of underway job");
assert(cancelResD.escalationToSupport === true, "Rejection advises Customer Support escalation");

var stateD2 = loadState();
var auditD = stateD2.adminAuditLog.find(l => l.bookingId === bookingD.id && l.actionType === 'admin_lifecycle_action_rejected');
assert(auditD !== undefined, "Administrative audit logged action rejection for attempted cancellation of active work");

// ----------------------------------------------------------------------------
// TEST E: PREVENT DUPLICATE CANCELLATION (IDEMPOTENCY)
// ----------------------------------------------------------------------------
console.log("\n[Test E: Prevent Duplicate Cancellation (Idempotency)]");

var fixedRequestIdE = 'req_cancel_test_dedup_101';
var firstCancelE = adminCancelBooking(
  bookingA.id,
  'First cancellation attempt',
  { requestId: fixedRequestIdE, adminName: 'Dallas Dispatch Lead (Demo)' }
);

assert(firstCancelE.success === false || firstCancelE.alreadyProcessed === true, "Duplicate cancellation call handled safely");

var secondCancelE = adminCancelBooking(
  bookingB.id,
  'Second cancellation attempt on already cancelled booking',
  { adminName: 'Dallas Dispatch Lead (Demo)' }
);

assert(secondCancelE.success === false, "Attempting to cancel already-cancelled Booking B is rejected");
assert(secondCancelE.error.indexOf('already cancelled') !== -1, "Error clearly explains booking is already cancelled");

// Verify audit log has exactly one booking_canceled entry for Booking B
var stateE = loadState();
var bAuditEntries = stateE.adminAuditLog.filter(l => l.bookingId === bookingB.id && l.actionType === 'booking_canceled');
assert(bAuditEntries.length === 1, "Exactly one booking_canceled audit log entry exists for Booking B (no duplicates)");

// ----------------------------------------------------------------------------
// TEST F: ADMIN-VERIFIED JOB COMPLETION
// ----------------------------------------------------------------------------
console.log("\n[Test F: Admin-Verified Job Completion Workflow]");

var bookingF = createBooking({
  customerId: 'cust_sarah',
  address: '2800 Routh St, Dallas, TX 75204',
  zipCode: '75204',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: '2026-11-30',
  scheduledTime: '09:00',
  intakeDetails: { hours: 3, workersNeeded: 2 }
});

assignProToSlot(bookingF.id, 'slot_1', 'pro_marcus');
adminAssignPro(bookingF.id, 'slot_2', 'pro_jamar', 'Assemble full crew for moving job', { adminName: 'Dallas Dispatch Lead (Demo)' });

// Progress both workers to in_progress
updateProAssignmentStatus(bookingF.id, 'slot_1', 'traveling');
updateProAssignmentStatus(bookingF.id, 'slot_1', 'arrived');
updateProAssignmentStatus(bookingF.id, 'slot_1', 'in_progress');

updateProAssignmentStatus(bookingF.id, 'slot_2', 'traveling');
updateProAssignmentStatus(bookingF.id, 'slot_2', 'arrived');
updateProAssignmentStatus(bookingF.id, 'slot_2', 'in_progress');

// 1. Marcus completes normally through Pro view
var marcusNormalComplete = updateProAssignmentStatus(bookingF.id, 'slot_1', 'completed');
assert(marcusNormalComplete.success === true, "Marcus completes slot 1 normally");

var stateF1 = loadState();
var bookingFMid = stateF1.bookings.find(b => b.id === bookingF.id);
assert(bookingFMid.workerAssignments[0].status === 'completed', "Marcus slot 1 is completed");
assert(bookingFMid.workerAssignments[1].status === 'in_progress', "Jamar slot 2 remains in_progress");
assert(bookingFMid.overallStatus === 'in_progress', "Booking F remains in_progress while Jamar is still working");

// 2. Jamar finished work but could not update app. Admin verifies completion.
var jamarPrePendingF = stateF1.pros.find(p => p.id === 'pro_jamar').earnings.pendingBalance;
var jamarPreAvailF = stateF1.pros.find(p => p.id === 'pro_jamar').earnings.availableBalance;
var jamarPreLifeF = stateF1.pros.find(p => p.id === 'pro_jamar').earnings.lifetimeEarned;

var verifyCompleteResF = adminVerifyAndCompleteAssignment(
  bookingF.id,
  'slot_2',
  'pro_jamar',
  {
    source: 'Customer Direct Phone Confirmation (Demo Simulation)',
    explanation: 'Customer Sarah Jenkins confirmed by phone that Jamar completed all unloading tasks.',
    confirmed: true
  },
  { adminName: 'Dallas Dispatch Lead (Demo)' }
);

assert(verifyCompleteResF.success === true, "adminVerifyAndCompleteAssignment succeeds for Jamar in_progress slot");
assert(verifyCompleteResF.slot.status === 'completed', "Jamar slot transitioned to 'completed'");
assert(verifyCompleteResF.booking.overallStatus === 'completed', "Booking F overallStatus transitioned to 'completed' after both workers finished");

var stateF2 = loadState();
var jamarPostCompleteF = stateF2.pros.find(p => p.id === 'pro_jamar');

// Financial assertions for Jamar
assert(jamarPostCompleteF.earnings.pendingBalance === jamarPrePendingF - 75, "Jamar pending balance decreased by $75.00 ($" + jamarPrePendingF + " -> $" + jamarPostCompleteF.earnings.pendingBalance + ")");
assert(jamarPostCompleteF.earnings.availableBalance === jamarPreAvailF + 75, "Jamar available balance increased by $75.00 ($" + jamarPreAvailF + " -> $" + jamarPostCompleteF.earnings.availableBalance + ")");
assert(jamarPostCompleteF.earnings.lifetimeEarned === jamarPreLifeF + 75, "Jamar lifetime earnings increased by $75.00 ($" + jamarPreLifeF + " -> $" + jamarPostCompleteF.earnings.lifetimeEarned + ")");

var jamarTxs = jamarPostCompleteF.earnings.walletTransactions || [];
var jamarCompleteTx = jamarTxs.filter(t => t.bookingId === bookingF.id && t.slotId === 'slot_2');
assert(jamarCompleteTx.length === 1, "Exactly one earnings_credit transaction recorded for Jamar on this booking");
assert(jamarCompleteTx[0].amountCents === 7500, "Transaction amount is 7500 cents ($75.00)");

// Audit trail for admin verified completion
var auditVerifyF = stateF2.adminAuditLog.find(l => l.bookingId === bookingF.id && l.actionType === 'admin_completion_verified');
assert(auditVerifyF !== undefined, "Administrative audit log recorded admin_completion_verified event");
assert(auditVerifyF.verificationSource === 'Customer Direct Phone Confirmation (Demo Simulation)', "Audit record preserves verificationSource");
assert(auditVerifyF.reason.indexOf('Sarah Jenkins confirmed by phone') !== -1, "Audit record preserves administrative explanation");

// ----------------------------------------------------------------------------
// TEST G: PREVENT UNAUTHORIZED COMPLETION
// ----------------------------------------------------------------------------
console.log("\n[Test G: Prevent Unauthorized Completion]");

// 1. Attempt completion on an unassigned slot
var unassignedCheck = canSlotBeAdminCompleted(bookingBState, { status: 'unassigned', assignedProId: null });
assert(unassignedCheck.allowed === false, "canSlotBeAdminCompleted rejects unassigned position");

// 2. Attempt completion on an already completed slot
var alreadyDoneCheck = canSlotBeAdminCompleted(bookingF.id, { status: 'completed', payoutReleased: true });
assert(alreadyDoneCheck.allowed === false, "canSlotBeAdminCompleted rejects already completed position");

// 3. Attempt completion on an assigned (pre-work) slot
var bookingG = createBooking({
  customerId: 'cust_sarah',
  address: '2800 Routh St, Dallas, TX 75204',
  zipCode: '75204',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: '2026-11-30',
  scheduledTime: '13:00',
  intakeDetails: { hours: 2, workersNeeded: 2 }
});
assignProToSlot(bookingG.id, 'slot_1', 'pro_marcus');
var stateG = loadState();
var bookingGState = stateG.bookings.find(b => b.id === bookingG.id);
var slot1G = bookingGState.workerAssignments[0];

var prematureVerify = adminVerifyAndCompleteAssignment(
  bookingG.id,
  'slot_1',
  'pro_marcus',
  { source: 'Field Check (Demo Simulation)', explanation: 'Premature attempt', confirmed: true }
);

assert(prematureVerify.success === false, "adminVerifyAndCompleteAssignment rejects pre-work assignment");
assert(prematureVerify.error.indexOf('actively in progress') !== -1, "Rejection explains assignment must be in_progress");

// 4. Attempt completion without affirmative confirmation checkbox
var noConfirmAttempt = adminVerifyAndCompleteAssignment(
  bookingF.id,
  'slot_2',
  'pro_jamar',
  { source: 'Customer Phone (Demo)', explanation: 'Missing checkbox', confirmed: false }
);
assert(noConfirmAttempt.success === false, "Rejects completion when confirmation checkbox is false");

// ----------------------------------------------------------------------------
// TEST H: FINANCIAL INTEGRITY & DISCREPANCY REJECTION
// ----------------------------------------------------------------------------
console.log("\n[Test H: Financial Integrity & Discrepancy Rejection]");

// Simulate a state corruption where Pro's pending balance was tampered to 0
var stateH = loadState();
var testPro = stateH.pros.find(p => p.id === 'pro_carlos');
testPro.earnings.pendingBalance = 0; // zero out pending
saveState(stateH);

// Attempting to cancel or complete an assignment with insufficient pending balance must be rejected
var bookingH = createBooking({
  customerId: 'cust_david',
  address: '6820 Lakewood Blvd, Dallas, TX 75214',
  zipCode: '75214',
  serviceCategory: 'tv_mounting',
  timingType: 'scheduled',
  scheduledDate: '2026-11-30',
  scheduledTime: '16:00',
  intakeDetails: { itemCount: 1 }
});

// Artificially assign Carlos without crediting pending balance to simulate discrepancy
var stateH2 = loadState();
var bH = stateH2.bookings.find(b => b.id === bookingH.id);
bH.workerAssignments[0].status = 'assigned';
bH.workerAssignments[0].assignedProId = 'pro_carlos';
bH.workerAssignments[0].assignedProName = 'Carlos Mendez';
bH.workerAssignments[0].payout = 45;
bH.overallStatus = 'fully_confirmed';
saveState(stateH2);

var discrepancyCancel = adminCancelBooking(
  bookingH.id,
  'Test cancellation against corrupted zero pending balance',
  { adminName: 'Dallas Dispatch Lead (Demo)' }
);

assert(discrepancyCancel.success === false, "adminCancelBooking rejects cancellation when pending balance discrepancy detected");
assert(discrepancyCancel.error.indexOf('Financial Discrepancy Detected') !== -1, "Error clearly identifies financial discrepancy");

// ----------------------------------------------------------------------------
// TEST I: CUSTOMER PRIVACY & NOTIFICATION SANITIZATION
// ----------------------------------------------------------------------------
console.log("\n[Test I: Customer Privacy & Notification Sanitization]");

var stateI = loadState();
var allCustomerMessages = [];
(stateI.bookings || []).forEach(b => {
  (b.messages || []).forEach(m => {
    allCustomerMessages.push(m.text || '');
  });
});

var leakedPayoutInCustomerView = allCustomerMessages.some(txt =>
  txt.includes('$75 payout') ||
  txt.includes('$75.00 payout') ||
  txt.includes('$45 payout') ||
  txt.includes('reversed $75') ||
  txt.includes('reversed $45')
);

assert(!leakedPayoutInCustomerView, "Customer messages strictly conceal all individual worker payout dollar figures");

var leakedInternalReason = allCustomerMessages.some(txt =>
  txt.includes('lease change') ||
  txt.includes('unloading tasks') ||
  txt.includes('Dallas Dispatch Lead')
);

assert(!leakedInternalReason, "Customer messages strictly conceal all internal administrative cancellation and completion reasons");

// ----------------------------------------------------------------------------
// TEST J: HISTORICAL RECORDS PERSISTENCE ACROSS STATE RELOADS
// ----------------------------------------------------------------------------
console.log("\n[Test J: Historical Records Persistence Across State Reloads]");

var reloadedState = loadState();
var cancelledBookingRecord = reloadedState.bookings.find(b => b.id === bookingA.id);
assert(cancelledBookingRecord !== undefined, "Cancelled Booking A persists in state");
assert(cancelledBookingRecord.overallStatus === 'cancelled', "Booking A maintains 'cancelled' status across reload");
assert(cancelledBookingRecord.cancellationSnapshot !== undefined, "Cancellation snapshot persists across reload");

var completedBookingRecord = reloadedState.bookings.find(b => b.id === bookingF.id);
assert(completedBookingRecord !== undefined, "Completed Booking F persists in state");
assert(completedBookingRecord.overallStatus === 'completed', "Booking F maintains 'completed' status across reload");

var allAuditLogs = reloadedState.adminAuditLog || [];
var cancelAuditCount = allAuditLogs.filter(l => l.actionType === 'booking_canceled').length;
var completeAuditCount = allAuditLogs.filter(l => l.actionType === 'admin_completion_verified').length;
var rejectAuditCount = allAuditLogs.filter(l => l.actionType === 'admin_lifecycle_action_rejected').length;

assert(cancelAuditCount >= 3, "Administrative audit log recorded all valid cancellations (" + cancelAuditCount + ")");
assert(completeAuditCount >= 1, "Administrative audit log recorded verified completion (" + completeAuditCount + ")");
assert(rejectAuditCount >= 2, "Administrative audit log recorded lifecycle action rejections (" + rejectAuditCount + ")");

// ----------------------------------------------------------------------------
// SUMMARY
// ----------------------------------------------------------------------------
console.log("\n==================================================================");
console.log("FINAL RESULTS: " + passed + " of " + (passed + failed) + " assertions passed (" + Math.round((passed / (passed + failed)) * 100) + "%).");
console.log("==================================================================");

if (failed > 0) {
  throw new Error("One or more assertions failed in Stage 3.5 Test Suite.");
}
