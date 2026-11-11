// ============================================================================
// STAGE 3 PHASE 4: FULL END-TO-END MARKETPLACE TEST SUITE
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
  submitWorkerReview,
  flagReviewDispute,
  updateTrustCaseResolution,
  createSupportCase,
  updateSupportCaseStatus,
  addSupportCaseNote,
  simulateProCashOut,
  getAdminFinancialSummary,
  getAdminOperationalMetrics,
  getOperationalAlerts,
  getBookingProEligibility,
  escapeHtml,
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
console.log("CREWLY STAGE 3 PHASE 4: FULL END-TO-END MARKETPLACE TEST SUITE");
console.log("==================================================================");

// Initialize fresh seed data
resetStateToSeed();
// Disable auto-book on pros so we can test the explicit manual acceptance & dispatch workflow
var stateInit = loadState();
stateInit.pros.forEach(p => { p.autoBookEnabled = false; });
saveState(stateInit);
var initialState = loadState();

// ----------------------------------------------------------------------------
// GROUP 1: SCENARIO A — CUSTOMER CREATES A BOOKING
// ----------------------------------------------------------------------------
console.log("\n[Group 1: Scenario A — Customer Sarah Jenkins Creates Booking]");

var pricingCalc = calculatePricing('moving', { hours: 3, workersNeeded: 2 });
assert(pricingCalc.customerSubtotal === 240, "Labor subtotal is $240 (2 movers * 3 hours * $40/hr)");
assert(pricingCalc.bookingFee === 10, "Standard demonstration booking fee is $10");
assert(pricingCalc.customerTotal === 250, "Customer total charge is $250 ($240 + $10)");
assert(pricingCalc.workerPayoutPerPerson === 75, "Worker payout per person is $75 (3 hours * $25/hr)");
assert(pricingCalc.totalWorkerPayouts === 150, "Total worker payouts equal $150 ($75 * 2)");
assert(pricingCalc.grossPlatformRevenue === 100, "Gross platform revenue is $100 ($250 - $150)");

// Create booking scheduled for future date
var bookingA = createBooking({
  customerId: 'cust_sarah',
  address: '2800 Routh St, Apt 412, Dallas, TX 75204',
  zipCode: '75204',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: '2026-11-25',
  scheduledTime: '13:00',
  intakeDetails: {
    hours: 3,
    workersNeeded: 2,
    serviceType: 'apartment',
    heavyItems: true,
    truckProvided: 'customer_truck'
  }
});

assert(bookingA && bookingA.id.startsWith('CRW-'), "Booking created with valid ID: " + bookingA.id);
assert(bookingA.customerId === 'cust_sarah', "Associated with customer Sarah Jenkins");
assert(bookingA.zipCode === '75204', "Located in valid Dallas pilot ZIP 75204");
assert(bookingA.workerAssignments.length === 2, "Booking created with exactly 2 worker assignment slots");
assert(bookingA.workerAssignments[0].status === 'unassigned', "Slot 1 starts as unassigned");
assert(bookingA.workerAssignments[1].status === 'unassigned', "Slot 2 starts as unassigned");
assert(bookingA.overallStatus === 'waiting_for_pros', "Initial overall status is waiting_for_pros");

// Privacy check: Verify customer messages do not leak worker payouts
var custMessagesA = bookingA.messages || [];
var payoutLeakA = custMessagesA.some(m => (m.text && m.text.includes('$75')) || (m.text && m.text.includes('$150')));
assert(!payoutLeakA, "Customer message feed strictly conceals worker payout amounts");

// ----------------------------------------------------------------------------
// GROUP 2: SCENARIO B — FIRST WORKER (MARCUS) ACCEPTS SLOT 1
// ----------------------------------------------------------------------------
console.log("\n[Group 2: Scenario B — First Worker Accepts Slot 1]");

var stateB = loadState();
var marcusBefore = stateB.pros.find(p => p.id === 'pro_marcus');
var marcusPendingStart = marcusBefore.earnings.pendingBalance;
var marcusAvailStart = marcusBefore.earnings.availableBalance;
var marcusLifeStart = marcusBefore.earnings.lifetimeEarned;

var acceptResB = assignProToSlot(bookingA.id, 'slot_1', 'pro_marcus');
assert(acceptResB.success === true, "Marcus successfully accepts slot 1");

var stateB2 = loadState();
var bookingB = stateB2.bookings.find(b => b.id === bookingA.id);
var marcusAfter = stateB2.pros.find(p => p.id === 'pro_marcus');

assert(bookingB.overallStatus === 'partially_filled', "Booking transitions to 'partially_filled'");
assert(bookingB.workerAssignments[0].status === 'assigned', "Slot 1 status is 'assigned'");
assert(bookingB.workerAssignments[0].assignedProId === 'pro_marcus', "Slot 1 assignedProId is pro_marcus");
assert(bookingB.workerAssignments[1].status === 'unassigned', "Slot 2 remains 'unassigned'");

// Financial integrity: Pending balance increases by exactly $75 once
assert(marcusAfter.earnings.pendingBalance === marcusPendingStart + 75, "Marcus pending earnings increased by exactly $75.00 ($" + marcusPendingStart + " -> $" + marcusAfter.earnings.pendingBalance + ")");
assert(marcusAfter.earnings.availableBalance === marcusAvailStart, "Marcus available balance remains unchanged ($" + marcusAvailStart + ")");
assert(marcusAfter.earnings.lifetimeEarned === marcusLifeStart, "Marcus lifetime earnings remain unchanged ($" + marcusLifeStart + ")");

// Priority 3 Guard: Solo work cannot begin before full crew is confirmed
var prematureTravel = updateProAssignmentStatus(bookingA.id, 'slot_1', 'traveling');
assert(prematureTravel.success === false, "Solo work progression (traveling) is strictly blocked while crew is incomplete");
assert(prematureTravel.error.indexOf('requires 2 Pros') !== -1, "Error clearly explains full crew requirement");

var prematureWork = updateProAssignmentStatus(bookingA.id, 'slot_1', 'in_progress');
assert(prematureWork.success === false, "Solo work start (in_progress) is strictly blocked while crew is incomplete");

// ----------------------------------------------------------------------------
// GROUP 3: SCENARIO C — ADMIN DISPATCH COMPLETES ASSIGNMENT
// ----------------------------------------------------------------------------
console.log("\n[Group 3: Scenario C — Admin Completes Dispatch]");

// Admin inspects candidate eligibility for slot 2
var candMarcus = canProAcceptSlot('pro_marcus', bookingA.id, 'slot_2');
assert(candMarcus.allowed === false, "Marcus is disqualified for slot 2 (already assigned to slot 1)");
assert(candMarcus.reason.indexOf('already assigned') !== -1, "Disqualification reason explains duplicate assignment");

var candElena = canProAcceptSlot('pro_elena', bookingA.id, 'slot_2');
assert(candElena.allowed === false, "Elena is disqualified for moving slot (missing verified moving credential)");
assert(candElena.reason.indexOf('verified skill') !== -1, "Disqualification reason explains missing skill");

var candCarlos = canProAcceptSlot('pro_carlos', bookingA.id, 'slot_2');
assert(candCarlos.allowed === false, "Carlos is disqualified for moving slot (missing verified moving credential)");

var candJamar = canProAcceptSlot('pro_jamar', bookingA.id, 'slot_2');
assert(candJamar.allowed === true, "Jamar Washington is eligible for moving slot 2");

// Check booking eligibility inspector
var eligibilityInspector = getBookingProEligibility(bookingA.id, 'pro_jamar');
assert(eligibilityInspector.eligible === true, "Booking Pro Eligibility inspector recognizes Jamar as eligible");

// Jamar baseline earnings
var jamarBefore = stateB2.pros.find(p => p.id === 'pro_jamar');
var jamarPendingStart = jamarBefore.earnings.pendingBalance;
var jamarAvailStart = jamarBefore.earnings.availableBalance;
var jamarLifeStart = jamarBefore.earnings.lifetimeEarned;

// Admin assigns Jamar with administrative reason
var assignResC = adminAssignPro(
  bookingA.id,
  'slot_2',
  'pro_jamar',
  'Customer requested afternoon completion; Jamar available in Uptown with moving qualification.',
  { adminName: 'Dallas Dispatch Lead (Demo)' }
);
assert(assignResC.success === true, "Admin manual assignment of Jamar succeeds");

var stateC = loadState();
var bookingC = stateC.bookings.find(b => b.id === bookingA.id);
var jamarAfter = stateC.pros.find(p => p.id === 'pro_jamar');

assert(bookingC.overallStatus === 'fully_confirmed', "Booking transitions to 'fully_confirmed' upon full crew assembly");
assert(bookingC.workerAssignments[0].assignedProId === 'pro_marcus', "Slot 1 confirmed for Marcus Davis");
assert(bookingC.workerAssignments[1].assignedProId === 'pro_jamar', "Slot 2 confirmed for Jamar Washington");

// Jamar financial update
assert(jamarAfter.earnings.pendingBalance === jamarPendingStart + 75, "Jamar pending earnings increased by exactly $75.00 ($" + jamarPendingStart + " -> $" + jamarAfter.earnings.pendingBalance + ")");
assert(jamarAfter.earnings.availableBalance === jamarAvailStart, "Jamar available balance unchanged ($" + jamarAvailStart + ")");
assert(jamarAfter.earnings.lifetimeEarned === jamarLifeStart, "Jamar lifetime earnings unchanged ($" + jamarLifeStart + ")");

// Customer message privacy check
var lastMsgC = bookingC.messages[bookingC.messages.length - 1];
assert(lastMsgC.text.indexOf('Jamar Washington has accepted') !== -1, "Customer message confirms Jamar accepted assignment");
assert(lastMsgC.text.indexOf('$75') === -1, "Customer message strictly conceals worker payout ($75)");
assert(lastMsgC.text.indexOf('Uptown with moving qualification') === -1, "Customer message conceals internal dispatcher reason");

// Admin Audit Log entry
var auditEntriesC = stateC.adminAuditLog.filter(l => l.bookingId === bookingA.id && l.actionType === 'worker_assigned');
assert(auditEntriesC.length > 0, "Admin audit trail logged worker_assigned event");
var lastAuditC = auditEntriesC[auditEntriesC.length - 1];
assert(lastAuditC.adminName === 'Dallas Dispatch Lead (Demo)', "Audit log records correct operator");
assert(lastAuditC.proId === 'pro_jamar', "Audit log records assigned proId");
assert(lastAuditC.slotId === 'slot_2', "Audit log records target slotId");
assert(lastAuditC.reason.indexOf('Customer requested afternoon completion') !== -1, "Audit log preserves administrative reason");
assert(lastAuditC.status === 'success', "Audit record status is success");

// ----------------------------------------------------------------------------
// GROUP 4: SCENARIO D — JOB LIFECYCLE PROGRESSION & FINANCIAL RELEASE
// ----------------------------------------------------------------------------
console.log("\n[Group 4: Scenario D — Job Lifecycle Progression & Sequential Financial Release]");

// Advance Marcus: assigned -> traveling -> arrived -> in_progress
var t1 = updateProAssignmentStatus(bookingA.id, 'slot_1', 'traveling');
assert(t1.success === true, "Marcus advances to 'traveling' (En Route)");

var t2 = updateProAssignmentStatus(bookingA.id, 'slot_1', 'arrived');
assert(t2.success === true, "Marcus advances to 'arrived'");

var t3 = updateProAssignmentStatus(bookingA.id, 'slot_1', 'in_progress');
assert(t3.success === true, "Marcus advances to 'in_progress' (Start Work)");

// Advance Jamar to traveling -> arrived -> in_progress
var tj1 = updateProAssignmentStatus(bookingA.id, 'slot_2', 'traveling');
assert(tj1.success === true, "Jamar advances to 'traveling'");

var tj2 = updateProAssignmentStatus(bookingA.id, 'slot_2', 'arrived');
assert(tj2.success === true, "Jamar advances to 'arrived'");

var tj3 = updateProAssignmentStatus(bookingA.id, 'slot_2', 'in_progress');
assert(tj3.success === true, "Jamar advances to 'in_progress'");

// Step 1: Marcus Completes Assignment First
var marcusPreComplete = loadState().pros.find(p => p.id === 'pro_marcus');
var mPendPre = marcusPreComplete.earnings.pendingBalance;
var mAvailPre = marcusPreComplete.earnings.availableBalance;
var mLifePre = marcusPreComplete.earnings.lifetimeEarned;

var tc1 = updateProAssignmentStatus(bookingA.id, 'slot_1', 'completed');
assert(tc1.success === true, "Marcus marks slot 1 as completed");

var stateD1 = loadState();
var bookingD1 = stateD1.bookings.find(b => b.id === bookingA.id);
var marcusPost = stateD1.pros.find(p => p.id === 'pro_marcus');
var jamarMid = stateD1.pros.find(p => p.id === 'pro_jamar');

assert(bookingD1.workerAssignments[0].status === 'completed', "Slot 1 is marked as completed");
assert(bookingD1.workerAssignments[1].status === 'in_progress', "Slot 2 remains in_progress");
assert(bookingD1.overallStatus === 'in_progress', "Booking remains active (in_progress) because Jamar has not completed");

// Marcus financial release
assert(marcusPost.earnings.pendingBalance === mPendPre - 75, "Marcus pending earnings decreased by $75.00 ($" + mPendPre + " -> $" + marcusPost.earnings.pendingBalance + ")");
assert(marcusPost.earnings.availableBalance === mAvailPre + 75, "Marcus available earnings increased by $75.00 ($" + mAvailPre + " -> $" + marcusPost.earnings.availableBalance + ")");
assert(marcusPost.earnings.lifetimeEarned === mLifePre + 75, "Marcus lifetime earnings increased by $75.00 ($" + mLifePre + " -> $" + marcusPost.earnings.lifetimeEarned + ")");

var marcusTxs = marcusPost.earnings.walletTransactions || [];
var marcusJobTx = marcusTxs.find(t => t.bookingId === bookingA.id && t.slotId === 'slot_1');
assert(marcusJobTx !== undefined, "Transaction ledger entry created for Marcus completed assignment");
assert(marcusJobTx.type === 'earnings_credit', "Transaction type is earnings_credit");
assert(marcusJobTx.amountCents === 7500, "Transaction amount is 7500 cents ($75.00)");

// Verify Jamar earnings remain completely untouched when Marcus finishes
assert(jamarMid.earnings.pendingBalance === jamarPendingStart + 75, "Jamar pending earnings completely untouched by Marcus completion");
assert(jamarMid.earnings.availableBalance === jamarAvailStart, "Jamar available earnings completely untouched");

// Step 2: Jamar Completes Assignment
var jPendPre = jamarMid.earnings.pendingBalance;
var jAvailPre = jamarMid.earnings.availableBalance;
var jLifePre = jamarMid.earnings.lifetimeEarned;

var tc2 = updateProAssignmentStatus(bookingA.id, 'slot_2', 'completed');
assert(tc2.success === true, "Jamar marks slot 2 as completed");

var stateD2 = loadState();
var bookingD2 = stateD2.bookings.find(b => b.id === bookingA.id);
var jamarPost = stateD2.pros.find(p => p.id === 'pro_jamar');

assert(bookingD2.workerAssignments[1].status === 'completed', "Slot 2 is marked as completed");
assert(bookingD2.overallStatus === 'completed', "Booking overallStatus transitions to 'completed' after both workers finish");

// Jamar financial release
assert(jamarPost.earnings.pendingBalance === jPendPre - 75, "Jamar pending earnings decreased by $75.00 ($" + jPendPre + " -> $" + jamarPost.earnings.pendingBalance + ")");
assert(jamarPost.earnings.availableBalance === jAvailPre + 75, "Jamar available earnings increased by $75.00 ($" + jAvailPre + " -> $" + jamarPost.earnings.availableBalance + ")");
assert(jamarPost.earnings.lifetimeEarned === jLifePre + 75, "Jamar lifetime earnings increased by $75.00 ($" + jLifePre + " -> $" + jamarPost.earnings.lifetimeEarned + ")");

var jamarTxs = jamarPost.earnings.walletTransactions || [];
var jamarJobTx = jamarTxs.find(t => t.bookingId === bookingA.id && t.slotId === 'slot_2');
assert(jamarJobTx !== undefined, "Transaction ledger entry created for Jamar completed assignment");

// Attempting duplicate completion should be rejected
var tcDuplicate = updateProAssignmentStatus(bookingA.id, 'slot_1', 'completed');
assert(tcDuplicate.success === false, "Duplicate completion call on slot 1 is rejected");

// ----------------------------------------------------------------------------
// GROUP 5: SCENARIO E — INDIVIDUAL REVIEWS & MULTI-WORKER INDEPENDENCE
// ----------------------------------------------------------------------------
console.log("\n[Group 5: Scenario E — Individual Reviews & Multi-Worker Rating Independence]");

var stateE = loadState();
var marcusProBefore = stateE.pros.find(p => p.id === 'pro_marcus');
var jamarProBefore = stateE.pros.find(p => p.id === 'pro_jamar');

var mRatingOld = marcusProBefore.rating;
var mCountOld = marcusProBefore.reviewCount;
var jRatingOld = jamarProBefore.rating;
var jCountOld = jamarProBefore.reviewCount;

// Sarah submits Marcus review: 5 stars
var revMarcusRes = submitWorkerReview(bookingA.id, 'slot_1', {
  rating: 5,
  comment: 'Marcus was fast, punctual, and very professional!'
});
assert(revMarcusRes.success === true, "Review for Marcus (5 stars) submitted successfully");

var stateE2 = loadState();
var marcusProAfter = stateE2.pros.find(p => p.id === 'pro_marcus');
var jamarProMid = stateE2.pros.find(p => p.id === 'pro_jamar');

var expectedMarcusRating = Number(((mRatingOld * mCountOld + 5) / (mCountOld + 1)).toFixed(2));
assert(marcusProAfter.reviewCount === mCountOld + 1, "Marcus review count updated from " + mCountOld + " to " + marcusProAfter.reviewCount);
assert(marcusProAfter.rating === expectedMarcusRating, "Marcus average rating updated accurately (" + expectedMarcusRating + ")");
assert(jamarProMid.rating === jRatingOld, "Jamar rating completely untouched by Marcus review (no bleed)");
assert(jamarProMid.reviewCount === jCountOld, "Jamar review count completely untouched");

// Sarah submits Jamar review: 3 stars
var revJamarRes = submitWorkerReview(bookingA.id, 'slot_2', {
  rating: 3,
  comment: 'Arrived slightly late but worked hard.'
});
assert(revJamarRes.success === true, "Review for Jamar (3 stars) submitted successfully");

var stateE3 = loadState();
var jamarProAfter = stateE3.pros.find(p => p.id === 'pro_jamar');
var bookingE = stateE3.bookings.find(b => b.id === bookingA.id);

var expectedJamarRating = Number(((jRatingOld * jCountOld + 3) / (jCountOld + 1)).toFixed(2));
assert(jamarProAfter.reviewCount === jCountOld + 1, "Jamar review count updated from " + jCountOld + " to " + jamarProAfter.reviewCount);
assert(jamarProAfter.rating === expectedJamarRating, "Jamar average rating updated accurately (" + expectedJamarRating + ")");

// Both reviews stored distinctly
assert(bookingE.workerReviews.length === 2, "Booking stores both individual worker reviews separately");
var rev1 = bookingE.workerReviews.find(r => r.slotId === 'slot_1');
var rev2 = bookingE.workerReviews.find(r => r.slotId === 'slot_2');
assert(rev1 && rev1.stars === 5 && rev1.proId === 'pro_marcus', "Slot 1 review attributed to Marcus with 5 stars");
assert(rev2 && rev2.stars === 3 && rev2.proId === 'pro_jamar', "Slot 2 review attributed to Jamar with 3 stars");

// Duplicate review submission prevented
var revDup = submitWorkerReview(bookingA.id, 'slot_1', { rating: 5, comment: 'Duplicate attempt' });
assert(revDup.success === false, "Duplicate review submission for slot 1 is blocked");
assert(revDup.error.indexOf('already submitted') !== -1, "Rejection message explains review already submitted");

// ----------------------------------------------------------------------------
// GROUP 6: SCENARIO F — TRUST & SAFETY DISPUTE WITH REPUTATION PROTECTION
// ----------------------------------------------------------------------------
console.log("\n[Group 6: Scenario F — Trust & Safety Dispute with Reputation Protection]");

var disputeReasonF = 'Pro reported delay was caused by customer access code issue at main gate.';
var disputeResF = flagReviewDispute(
  bookingA.id,
  'slot_2',
  disputeReasonF,
  'Dallas Dispatch Lead (Demo)'
);

assert(disputeResF.success === true, "Review dispute flagged successfully by administrator");
assert(disputeResF.case && disputeResF.case.category === 'trust_safety', "Trust & Safety case created under unified supportCases schema");

var stateF = loadState();
var bookingF = stateF.bookings.find(b => b.id === bookingA.id);
var jamarReviewF = bookingF.workerReviews.find(r => r.slotId === 'slot_2');
var marcusReviewF = bookingF.workerReviews.find(r => r.slotId === 'slot_1');
var jamarProF = stateF.pros.find(p => p.id === 'pro_jamar');

// Reputation protection checks:
assert(jamarReviewF.disputeStatus === 'under_investigation', "Jamar review marked as 'under_investigation'");
assert(jamarReviewF.stars === 3, "Jamar original star rating strictly preserved at 3 stars");
assert(jamarReviewF.comment === 'Arrived slightly late but worked hard.', "Original comment strictly preserved");
assert(jamarProF.rating === expectedJamarRating, "Jamar worker average rating strictly preserved (" + expectedJamarRating + ")");
assert(jamarProF.reviewCount === jCountOld + 1, "Jamar review count strictly preserved (" + (jCountOld + 1) + ")");

// Marcus review untouched check
assert(marcusReviewF.disputeStatus === 'undisputed' || !marcusReviewF.disputeStatus, "Marcus review remains undisputed");

// Audit log check
var auditDisputeF = stateF.adminAuditLog.filter(l => l.bookingId === bookingA.id && l.actionType === 'review_dispute_flagged');
assert(auditDisputeF.length > 0, "Audit trail logged review_dispute_flagged event");

// ----------------------------------------------------------------------------
// GROUP 7: SCENARIO G — CUSTOMER SUPPORT CASE LIFECYCLE & PRIVACY
// ----------------------------------------------------------------------------
console.log("\n[Group 7: Scenario G — Customer Support Case Lifecycle & Privacy]");

var caseResG = createSupportCase({
  bookingId: bookingA.id,
  customerId: 'cust_sarah',
  category: 'booking_issue',
  priority: 'medium',
  title: 'Parking gate coordination question',
  initialNote: 'Customer called asking about clearance for moving truck at visitor gate.'
});

assert(caseResG.success === true, "Support case created successfully");
var caseIdG = caseResG.case.caseId;
assert(caseIdG.startsWith('CASE-'), "Case has sequential unique ID: " + caseIdG);
assert(caseResG.case.status === 'open', "Case status starts as 'open'");

// Update status to under_review
var updateResG1 = updateSupportCaseStatus(
  caseIdG,
  'under_review',
  'Dispatcher verifying building clearance with Uptown leasing office.',
  'Dallas Dispatch Lead (Demo)'
);
assert(updateResG1.success === true, "Case status updated to 'under_review'");

// Add internal note
var noteResG = addSupportCaseNote(
  caseIdG,
  'Leasing office confirmed 12ft clearance at service bay.',
  'Dallas Dispatch Lead (Demo)'
);
assert(noteResG.success === true, "Internal dispatcher note appended to case");

// Resolve case
var updateResG2 = updateSupportCaseStatus(
  caseIdG,
  'resolved',
  'Clearance confirmed and communicated to crew lead.',
  'Dallas Dispatch Lead (Demo)'
);
assert(updateResG2.success === true, "Case status updated to 'resolved'");

// Persistence check across state reload
var stateG = loadState();
var persistedCase = stateG.supportCases.find(c => c.caseId === caseIdG);
assert(persistedCase !== undefined, "Support case persists across state reload");
assert(persistedCase.status === 'resolved', "Status persisted as 'resolved'");
assert(persistedCase.notes.length === 4, "All 4 internal dispatcher notes persisted");

// Customer privacy check: Internal notes must NEVER appear in booking customer messages
var bookingG = stateG.bookings.find(b => b.id === bookingA.id);
var hasInternalLeak = bookingG.messages.some(m =>
  m.text && (
    m.text.includes('12ft clearance') ||
    m.text.includes('leasing office') ||
    m.text.includes('Dallas Dispatch Lead')
  )
);
assert(!hasInternalLeak, "Internal admin dispatcher notes strictly quarantined from customer messages");

// ----------------------------------------------------------------------------
// GROUP 8: SCENARIO H — FINANCIAL OPERATIONS & ZERO MUTATIONS
// ----------------------------------------------------------------------------
console.log("\n[Group 8: Scenario H — Financial Operations Non-Mutation & Metric Correctness]");

var stateH = loadState();

// Capture snapshot of balances and transactions before financial inspection
var balancesBefore = stateH.pros.map(p => ({
  id: p.id,
  available: p.earnings.availableBalance,
  pending: p.earnings.pendingBalance,
  lifetime: p.earnings.lifetimeEarned,
  txCount: (p.earnings.walletTransactions || []).length
}));

var finH1 = getAdminFinancialSummary(stateH);
assert(finH1 !== null, "Financial summary computed cleanly");

// Completed GBV includes new completed booking ($250) + historical ($65) = $315
assert(Number(finH1.completedGrossBookingValue) >= 315.00, "Completed GBV includes new completed booking ($" + finH1.completedGrossBookingValue + ")");
// Realized gross margin includes $100 from new booking ($250 - $150) + $30 historical = $130
assert(Number(finH1.completedGrossMargin) >= 130.00, "Completed gross margin reflects completed booking margin ($" + finH1.completedGrossMargin + ")");
assert(finH1.educationalProfitDisclaimer.indexOf('NOT net profit') !== -1, "Includes educational commercial profit disclaimer");

// 10 consecutive recalculations to guarantee zero-mutation
for (var i = 0; i < 10; i++) {
  getAdminFinancialSummary(stateH);
}

var stateHAfter = loadState();
var allBalancesMatch = stateHAfter.pros.every((p, idx) => {
  var b = balancesBefore[idx];
  return p.id === b.id &&
    p.earnings.availableBalance === b.available &&
    p.earnings.pendingBalance === b.pending &&
    p.earnings.lifetimeEarned === b.lifetime &&
    (p.earnings.walletTransactions || []).length === b.txCount;
});
assert(allBalancesMatch, "10 consecutive financial calculations produced ZERO mutations to Pro wallet balances or ledgers");

// ----------------------------------------------------------------------------
// GROUP 9: SIMULATED CASH-OUT VERIFICATION
// ----------------------------------------------------------------------------
console.log("\n[Group 9: Simulated Cash-Out Verification]");

var stateI = loadState();
var marcusI = stateI.pros.find(p => p.id === 'pro_marcus');
var mAvailBeforeCashout = marcusI.earnings.availableBalance;
var mLifeBeforeCashout = marcusI.earnings.lifetimeEarned;

// 1. Standard cash-out with no fee
var standardRes = simulateProCashOut('pro_marcus', {
  method: 'standard',
  requestedAmountDollars: 50.00
});
assert(standardRes.success === true, "Standard simulated cash-out succeeds ($50.00)");
assert(standardRes.feeDollars === 0, "Standard cash-out has $0.00 fee");
assert(standardRes.netAmountDollars === 50.00, "Net delivered equals full $50.00");

var stateI2 = loadState();
var marcusI2 = stateI2.pros.find(p => p.id === 'pro_marcus');
assert(marcusI2.earnings.availableBalance === mAvailBeforeCashout - 50.00, "Marcus available balance reduced by exactly $50.00");
assert(marcusI2.earnings.lifetimeEarned === mLifeBeforeCashout, "Marcus lifetime earnings remain invariant after standard cash-out");

// 2. Instant cash-out with $1.50 fee
var mAvailBeforeInstant = marcusI2.earnings.availableBalance;
var instantRes = simulateProCashOut('pro_marcus', {
  method: 'instant',
  requestedAmountDollars: 50.00
});
assert(instantRes.success === true, "Instant simulated cash-out succeeds ($50.00)");
assert(instantRes.feeDollars === 1.50, "Instant cash-out incurs $1.50 simulated processing fee");
assert(instantRes.netAmountDollars === 48.50, "Net delivered equals $48.50 ($50.00 - $1.50)");

var stateI3 = loadState();
var marcusI3 = stateI3.pros.find(p => p.id === 'pro_marcus');
assert(marcusI3.earnings.availableBalance === mAvailBeforeInstant - 50.00, "Marcus available balance reduced by exactly $50.00");
assert(marcusI3.earnings.lifetimeEarned === mLifeBeforeCashout, "Marcus lifetime earnings remain invariant after instant cash-out");

// 3. Insufficient funds rejection
var excessiveRes = simulateProCashOut('pro_marcus', {
  method: 'standard',
  requestedAmountDollars: 99999.00
});
assert(excessiveRes.success === false, "Excessive cash-out (> available balance) is strictly rejected");
assert(excessiveRes.error.indexOf('exceeds available balance') !== -1, "Error clearly explains insufficient funds");

// 4. Instant cash-out <= $1.50 rejection
var lowInstantRes = simulateProCashOut('pro_marcus', {
  method: 'instant',
  requestedAmountDollars: 1.50
});
assert(lowInstantRes.success === false, "Instant cash-out <= $1.50 fee is strictly rejected");
assert(lowInstantRes.error.indexOf('greater than the $1.50 simulated fee') !== -1, "Error explains fee exceeds amount");

// 5. Idempotency with stable requestId
var fixedRequestId = 'req_test_dedup_001';
var firstCall = simulateProCashOut('pro_marcus', {
  method: 'standard',
  requestedAmountDollars: 20.00,
  requestId: fixedRequestId
});
assert(firstCall.success === true, "First submission with requestId succeeds");
var mAvailAfterFirst = loadState().pros.find(p => p.id === 'pro_marcus').earnings.availableBalance;

var secondCall = simulateProCashOut('pro_marcus', {
  method: 'standard',
  requestedAmountDollars: 20.00,
  requestId: fixedRequestId
});
assert(secondCall.success === true, "Second submission with same requestId acknowledged");
assert(secondCall.alreadyProcessed === true, "Identified as already processed");

var mAvailAfterSecond = loadState().pros.find(p => p.id === 'pro_marcus').earnings.availableBalance;
assert(mAvailAfterSecond === mAvailAfterFirst, "Available balance NOT deducted a second time (idempotency preserved)");

// Receipt disclaimer check
assert(firstCall.notice.indexOf('SIMULATED TRANSACTION') !== -1, "Cash-out receipt contains simulated transaction disclaimer");

// ----------------------------------------------------------------------------
// GROUP 10: SECURITY, PRIVACY & DATA RELIABILITY
// ----------------------------------------------------------------------------
console.log("\n[Group 10: Security, Privacy & Data Reliability]");

// 1. XSS / HTML Escaping
var maliciousInput = '<script>alert("xss")</script>&<img src=x onerror=alert(1)>"quoted"';
var sanitized = escapeHtml(maliciousInput);
assert(sanitized.indexOf('<script>') === -1, "HTML script tag neutralized");
assert(sanitized.indexOf('&lt;script&gt;') !== -1, "Sanitized to &lt;script&gt; entity");
assert(sanitized.indexOf('&quot;quoted&quot;') !== -1, "Sanitized quotation marks");
assert(sanitized.indexOf('&amp;') !== -1, "Sanitized ampersand");

// 2. Reject Past-Date Scheduled Booking Creation
var pastDateAttempt = null;
try {
  createBooking({
    customerId: 'cust_sarah',
    zipCode: '75204',
    serviceCategory: 'moving',
    timingType: 'scheduled',
    scheduledDate: '2020-01-01',
    scheduledTime: '10:00',
    intakeDetails: { hours: 2, workersNeeded: 2 }
  });
} catch (e) {
  pastDateAttempt = e.message;
}
assert(pastDateAttempt !== null && pastDateAttempt.indexOf('cannot be in the past') !== -1, "Booking creation with past date (2020-01-01) is strictly rejected");

// 3. Pro Wallet Isolation
var stateJ = loadState();
var marcusWallet = stateJ.pros.find(p => p.id === 'pro_marcus').earnings;
var jamarWallet = stateJ.pros.find(p => p.id === 'pro_jamar').earnings;
var carlosWallet = stateJ.pros.find(p => p.id === 'pro_carlos').earnings;
var elenaWallet = stateJ.pros.find(p => p.id === 'pro_elena').earnings;

assert(marcusWallet !== jamarWallet, "Marcus and Jamar wallets are isolated memory references");
assert(carlosWallet !== elenaWallet, "Carlos and Elena wallets are isolated memory references");

// 4. Duplicate Open Support Case Deduplication & Idempotency
var dupCase1 = createSupportCase({
  bookingId: bookingA.id,
  idempotencyKey: 'idem_dup_test_001',
  category: 'customer_complaint',
  priority: 'high',
  title: 'Duplicate Prevention Test',
  initialNote: 'First entry'
});
var dupCase2 = createSupportCase({
  bookingId: bookingA.id,
  idempotencyKey: 'idem_dup_test_001',
  category: 'customer_complaint',
  priority: 'high',
  title: 'Duplicate Prevention Test',
  initialNote: 'Second entry'
});
assert(dupCase1.case.caseId === dupCase2.case.caseId, "Duplicate support case deduplicated to single case ID: " + dupCase1.case.caseId);
assert(dupCase2.deduplicated === true, "Second submission recognized as deduplicated");

// Also test active duplicate rejection without idempotencyKey
var nonIdemDup = createSupportCase({
  bookingId: bookingA.id,
  category: 'customer_complaint',
  priority: 'high',
  title: 'Duplicate Prevention Test',
  initialNote: 'Third entry'
});
assert(nonIdemDup.success === false, "Active duplicate case without idempotencyKey rejected");

// ----------------------------------------------------------------------------
// FINAL SUMMARY
// ----------------------------------------------------------------------------
console.log("\n==================================================================");
console.log("FINAL RESULTS: " + passed + " of " + (passed + failed) + " assertions passed (" + Math.round((passed / (passed + failed)) * 100) + "%).");
console.log("==================================================================");

if (failed > 0) {
  throw new Error("One or more assertions failed in Phase 4 E2E Test Suite.");
}
