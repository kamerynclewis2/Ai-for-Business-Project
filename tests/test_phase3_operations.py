import re
import subprocess
import os

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
      var pair = parts[i].split('=');
      this.searchParams._map[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
    }
  }
}
"""

test_logic = """
var passedAssertions = 0;
var failedAssertions = 0;
var totalAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log("  PASS: " + message);
  } else {
    failedAssertions++;
    console.log("  FAIL: " + message);
  }
}

console.log("\\n=== TEST SUITE: STAGE 3 PHASE 3 ADMINISTRATIVE OPERATIONS ===\\n");

// ---------------------------------------------------------------------------
// Group 1: Worker Directory & Availability Inspection (Adjustment 5)
// ---------------------------------------------------------------------------
console.log("[Group 1: Worker Directory & Availability Inspection]");
resetStateToSeed();
var state = loadState();
var summary = getProDirectorySummary(state);

assert(summary !== null, "Directory summary computed successfully");
assert(summary.registeredProsCount === 4, "Registered Pros count is exactly 4");
assert(summary.availableProsTodayCount >= 1, "Available Pros Today count is non-zero (" + summary.availableProsTodayCount + ")");
assert(summary.pros.length === 4, "Roster contains all 4 Dallas Pros");

var marcusSummary = summary.pros.find(function(p) { return p.id === 'pro_marcus'; });
assert(marcusSummary.tier === 'Gold', "Marcus Davis is Gold Tier");
assert(marcusSummary.rating === 4.94, "Marcus Davis rating matches 4.94");
assert(marcusSummary.reviewCount === 88, "Marcus Davis review count matches 88");
assert(marcusSummary.reliabilityScore === 98, "Marcus Davis reliability matches 98%");
assert(marcusSummary.verifiedServices.indexOf('Moving & Lifting') !== -1, "Marcus has verified Moving & Lifting");
assert(marcusSummary.verifiedEquipment.indexOf('Heavy-Duty Hand Truck') !== -1, "Marcus has verified equipment");
assert(marcusSummary.serviceAreaPreferences.indexOf('75204') !== -1, "Marcus serves Uptown 75204");

// Booking-Specific Eligibility Inspector
var jamarEligibility = getBookingProEligibility('CRW-1004', 'pro_jamar');
assert(jamarEligibility.eligible === true, "Jamar is eligible for open moving slot on CRW-1004");

var elenaEligibility = getBookingProEligibility('CRW-1004', 'pro_elena');
assert(elenaEligibility.eligible === false, "Elena is ineligible for moving job (missing moving credential)");
assert(elenaEligibility.primaryReason.indexOf('platform-verified') !== -1, "Elena disqualification reason explains missing platform-verified skill");

var marcusEligibility = getBookingProEligibility('CRW-1004', 'pro_marcus');
var marcusSlot1 = marcusEligibility.slotEvaluations.find(function(s) { return s.slotId === 'slot_1'; });
assert(marcusSlot1 && marcusSlot1.reason.indexOf('assigned') !== -1, "Marcus recognized as currently assigned to slot 1");

// ---------------------------------------------------------------------------
// Group 2: Customer Support Case Lifecycle & Unified Management (Adjustment 1)
// ---------------------------------------------------------------------------
console.log("\\n[Group 2: Customer Support Case Lifecycle & Unified Management]");
var initialCaseCount = state.supportCases.length;
assert(initialCaseCount >= 1, "Initial seed case CASE-101 is present");

// Create support case
var createRes = createSupportCase({
  title: "Customer inquiries regarding same-day moving window",
  category: "support",
  issueType: "general",
  bookingId: "CRW-1004",
  customerId: "cust_sarah",
  priority: "high",
  initialNote: "Sarah contacted support asking for estimated arrival buffer."
}, "Dallas Dispatch Lead (Test)");

assert(createRes.success === true, "Support case created successfully");
assert(createRes.case.caseId.indexOf('CASE-') === 0, "Case assigned valid sequential caseId: " + createRes.case.caseId);
assert(createRes.case.status === 'open', "Case status starts as 'open'");
assert(createRes.case.notes.length === 1, "Initial internal dispatcher note recorded");
assert(createRes.case.notes[0].text.indexOf('Sarah contacted support') !== -1, "Note content matches initial note");

var newCaseId = createRes.case.caseId;

// Update status to under_review
var statusRes1 = updateSupportCaseStatus(newCaseId, 'under_review', 'Dispatched lead mover Marcus contacted customer directly');
assert(statusRes1.success === true, "Status updated to 'under_review'");
assert(statusRes1.case.status === 'under_review', "Case status property is 'under_review'");
assert(statusRes1.case.notes.length === 2, "Status change appended internal explanation note");

// Add another internal note
var noteRes = addSupportCaseNote(newCaseId, 'Customer confirmed arrival window is acceptable via SMS.', 'Dispatcher Jane');
assert(noteRes.success === true, "Internal note added successfully");
assert(noteRes.case.notes.length === 3, "Notes count updated to 3");

// Resolve case
var statusRes2 = updateSupportCaseStatus(newCaseId, 'resolved', 'Customer confirmed satisfaction with schedule');
assert(statusRes2.success === true, "Status updated to 'resolved'");
assert(statusRes2.case.status === 'resolved', "Case status property is 'resolved'");
assert(statusRes2.case.resolvedAt !== null, "resolvedAt timestamp recorded");

// Re-open case
var statusRes3 = updateSupportCaseStatus(newCaseId, 'open', 'Customer called back requesting crew change');
assert(statusRes3.success === true, "Case successfully reopened");
assert(statusRes3.case.status === 'open', "Case status restored to 'open'");
assert(statusRes3.case.resolvedAt === null, "resolvedAt cleared upon reopening");

// ---------------------------------------------------------------------------
// Group 3: Support Case Persistence Across State Reloads
// ---------------------------------------------------------------------------
console.log("\\n[Group 3: Support Case Persistence Across State Reloads]");
var reloadedState = loadState();
var persistedCase = reloadedState.supportCases.find(function(c) { return c.caseId === newCaseId; });
assert(persistedCase !== undefined, "Case " + newCaseId + " persisted in localStorage");
assert(persistedCase.notes.length === 5, "All 5 notes persisted across state reload");
assert(persistedCase.status === 'open', "Case status persisted as 'open'");

// ---------------------------------------------------------------------------
// Group 4: Customer Privacy & Internal Notes Protection (Adjustment 4)
// ---------------------------------------------------------------------------
console.log("\\n[Group 4: Customer Privacy & Internal Notes Protection]");
var targetBooking = reloadedState.bookings.find(function(b) { return b.id === 'CRW-1004'; });
var leakedNote = targetBooking.messages.some(function(m) {
  return m.text && (m.text.indexOf('Sarah contacted support') !== -1 || m.text.indexOf('SMS') !== -1 || m.text.indexOf('crew change') !== -1);
});
assert(leakedNote === false, "Customer messages contain ZERO internal support notes or dispatcher reasons");

// ---------------------------------------------------------------------------
// Group 5: Read-Only Financial Operations & Zero Mutations (Adjustment 3)
// ---------------------------------------------------------------------------
console.log("\\n[Group 5: Read-Only Financial Operations & Zero Mutations]");
var fin1 = getAdminFinancialSummary(reloadedState);
assert(fin1 !== null, "Financial summary computed");
assert(fin1.projectedGrossBookingValue === "619.00", "Projected GBV matches $619.00");
assert(fin1.completedGrossBookingValue === "65.00", "Completed GBV matches $65.00");
assert(fin1.completedGrossMargin === "30.00", "Realized margin matches $30.00");
assert(fin1.projectedGrossMargin === "244.00", "Projected pipeline margin matches $244.00");
assert(fin1.platformGrossMargin === "274.00", "Total gross margin matches $274.00");

// Snapshot worker balances before repeated calls
var marcusAvailBefore = reloadedState.pros[0].earnings.availableBalance;
var marcusPendBefore = reloadedState.pros[0].earnings.pendingBalance;
var marcusTxsBefore = reloadedState.pros[0].earnings.walletTransactions.length;

// Call financial summary multiple times
for (var i = 0; i < 10; i++) {
  getAdminFinancialSummary(reloadedState);
}

assert(reloadedState.pros[0].earnings.availableBalance === marcusAvailBefore, "Marcus available balance completely untouched after 10 financial calculations");
assert(reloadedState.pros[0].earnings.pendingBalance === marcusPendBefore, "Marcus pending balance completely untouched");
assert(reloadedState.pros[0].earnings.walletTransactions.length === marcusTxsBefore, "No phantom wallet transactions created by financial inspection");

// ---------------------------------------------------------------------------
// Group 6: Trust & Safety Review Inspection & Dispute Management (Adjustment 2)
// ---------------------------------------------------------------------------
console.log("\\n[Group 6: Trust & Safety Review Inspection & Dispute Management]");
var crw1003 = reloadedState.bookings.find(function(b) { return b.id === 'CRW-1003'; });
assert(crw1003 && crw1003.workerReviews.length === 1, "CRW-1003 has 1 completed worker review");

var carlosReview = crw1003.workerReviews[0];
var originalStars = carlosReview.stars;
var originalComment = carlosReview.comment;
var carlosPro = reloadedState.pros.find(function(p) { return p.id === carlosReview.proId; });
var originalProRating = carlosPro.rating;
var originalProReviewCount = carlosPro.reviewCount;

assert(originalStars === 5, "Original review has 5 stars");
assert(carlosReview.disputed === false, "Review starts as undisputed");

// Flag review as disputed
var disputeRes = flagReviewDispute('CRW-1003', 'slot_1', 'Worker disputes lawn boundary expectations', 'Lead Dispatcher');
assert(disputeRes.success === true, "Review successfully flagged as disputed");
assert(disputeRes.case.category === 'trust_safety', "Dispute case categorized under unified 'trust_safety'");
assert(disputeRes.case.caseId.indexOf('CASE-TS-') === 0, "Dispute case given stable ID: " + disputeRes.case.caseId);

// Check review preservation (Adjustment 2)
var updatedBooking = loadState().bookings.find(function(b) { return b.id === 'CRW-1003'; });
var updatedReview = updatedBooking.workerReviews[0];
assert(updatedReview.disputed === true, "Review marked as disputed");
assert(updatedReview.stars === originalStars, "Original review star rating strictly preserved (" + updatedReview.stars + "★)");
assert(updatedReview.comment === originalComment, "Original comment text strictly preserved");

var updatedCarlosPro = loadState().pros.find(function(p) { return p.id === carlosReview.proId; });
assert(updatedCarlosPro.rating === originalProRating, "Worker average rating strictly untouched (" + updatedCarlosPro.rating + ")");
assert(updatedCarlosPro.reviewCount === originalProReviewCount, "Worker review count strictly untouched (" + updatedCarlosPro.reviewCount + ")");

// Resolve dispute investigation
var resolveDisputeRes = updateTrustCaseResolution(disputeRes.case.caseId, 'dispute_resolved', 'Customer and worker aligned on pilot lawn boundary definition');
assert(resolveDisputeRes.success === true, "Trust case resolved");
assert(resolveDisputeRes.case.status === 'resolved', "Trust case status updated to 'resolved'");

var finalBooking = loadState().bookings.find(function(b) { return b.id === 'CRW-1003'; });
assert(finalBooking.workerReviews[0].disputeStatus === 'dispute_resolved', "Review disputeStatus updated to dispute_resolved");

// ---------------------------------------------------------------------------
// Group 7: Extended Administrative Audit Trail
// ---------------------------------------------------------------------------
console.log("\\n[Group 7: Extended Administrative Audit Trail]");
var auditLog = loadState().adminAuditLog || [];
var hasCaseCreated = auditLog.some(function(l) { return l.actionType === 'support_case_created'; });
var hasCaseUpdated = auditLog.some(function(l) { return l.actionType === 'support_case_status_updated'; });
var hasNoteAdded = auditLog.some(function(l) { return l.actionType === 'support_case_note_added'; });
var hasReviewDisputed = auditLog.some(function(l) { return l.actionType === 'review_dispute_flagged'; });
var hasTrustUpdated = auditLog.some(function(l) { return l.actionType === 'trust_case_updated'; });

assert(hasCaseCreated === true, "Audit trail logged support_case_created");
assert(hasCaseUpdated === true, "Audit trail logged support_case_status_updated");
assert(hasNoteAdded === true, "Audit trail logged support_case_note_added");
assert(hasReviewDisputed === true, "Audit trail logged review_dispute_flagged");
assert(hasTrustUpdated === true, "Audit trail logged trust_case_updated");

var sampleAudit = auditLog.find(function(l) { return l.actionType === 'review_dispute_flagged'; });
assert(sampleAudit.caseId !== null, "Audit record links caseId (" + sampleAudit.caseId + ")");
assert(sampleAudit.bookingId === 'CRW-1003', "Audit record links bookingId CRW-1003");
assert(sampleAudit.reason.indexOf('Worker disputes') !== -1, "Audit record preserves administrative reason");

// ---------------------------------------------------------------------------
// Group 8: Manual Dispatch Integrity Preservation (Phase 2 Regression)
// ---------------------------------------------------------------------------
console.log("\\n[Group 8: Manual Dispatch Integrity Preservation]");
var assignRes = adminAssignPro('CRW-1004', 'slot_2', 'pro_jamar', 'Dispatch staffing second mover position');
assert(assignRes.success === true, "adminAssignPro remains 100% operational");
assert(assignRes.booking.overallStatus === 'fully_confirmed', "CRW-1004 transitions to fully_confirmed");

var unassignRes = adminUnassignPro('CRW-1004', 'slot_2', 'pro_jamar', 'Customer requested rescheduling');
assert(unassignRes.success === true, "adminUnassignPro remains 100% operational");
assert(unassignRes.booking.overallStatus === 'partially_filled', "CRW-1004 reverts to partially_filled");

// ---------------------------------------------------------------------------
// Group 9: Multi-Worker Review Independence (Adjustment 2)
// ---------------------------------------------------------------------------
console.log("\\n[Group 9: Multi-Worker Review Independence]");
var testState = loadState();
// Simulate a 2-worker completed booking with 2 independent reviews
var multiBooking = {
  id: 'CRW-TEST-MULTI',
  customerId: 'cust_sarah',
  customerName: 'Sarah Jenkins',
  overallStatus: 'completed',
  workerAssignments: [
    { slotId: 'slot_1', assignedProId: 'pro_marcus', assignedProName: 'Marcus Davis', status: 'completed', payout: 75, payoutReleased: true },
    { slotId: 'slot_2', assignedProId: 'pro_jamar', assignedProName: 'Jamar Washington', status: 'completed', payout: 75, payoutReleased: true }
  ],
  workerReviews: [
    { slotId: 'slot_1', proId: 'pro_marcus', proName: 'Marcus Davis', stars: 5, comment: 'Marcus was great!', date: '2026-11-10', disputed: false },
    { slotId: 'slot_2', proId: 'pro_jamar', proName: 'Jamar Washington', stars: 2, comment: 'Jamar dropped a box.', date: '2026-11-10', disputed: false }
  ]
};
testState.bookings.push(multiBooking);
saveState(testState);

// Flag only Jamar's review as disputed
var multiDispute = flagReviewDispute('CRW-TEST-MULTI', 'slot_2', 'Jamar states box was already damaged by customer');
assert(multiDispute.success === true, "Disputed Jamar review on multi-worker job");

var checkMultiBooking = loadState().bookings.find(function(b) { return b.id === 'CRW-TEST-MULTI'; });
var marcusRev = checkMultiBooking.workerReviews.find(function(r) { return r.slotId === 'slot_1'; });
var jamarRev = checkMultiBooking.workerReviews.find(function(r) { return r.slotId === 'slot_2'; });

assert(jamarRev.disputed === true, "Jamar review is marked as disputed");
assert(marcusRev.disputed === false, "Marcus review remains completely UNDISPUTED (no cross-worker bleed)");

// ---------------------------------------------------------------------------
// Group 10: Historical Snapshot Double-Count Prevention & XSS Escaping (Adjustment 3 & 4)
// ---------------------------------------------------------------------------
console.log("\\n[Group 10: Historical Snapshot Invariance & XSS Escaping]");
// Verify XSS escaping
var maliciousStr = '<script>alert("XSS")</script>&\\"test\\\'';
var escaped = escapeHtml(maliciousStr);
assert(escaped.indexOf('<script>') === -1, "Script tags escaped");
assert(escaped.indexOf('&lt;script&gt;') !== -1, "Contains &lt;script&gt;");
assert(escaped.indexOf('&quot;') !== -1, "Contains escaped quotes");

// Verify idempotency on support case creation
var keyCase1 = createSupportCase({
  idempotencyKey: 'idem_test_key_123',
  title: 'Idempotency Test Case',
  category: 'support',
  priority: 'low',
  initialNote: 'First attempt'
});

var keyCase2 = createSupportCase({
  idempotencyKey: 'idem_test_key_123',
  title: 'Idempotency Test Case',
  category: 'support',
  priority: 'low',
  initialNote: 'Second attempt with identical key'
});

assert(keyCase1.success === true, "First idempotent case created");
assert(keyCase2.success === true && keyCase2.deduplicated === true, "Second idempotent submission recognized as deduplicated");
assert(keyCase1.case.caseId === keyCase2.case.caseId, "Both calls returned identical case ID: " + keyCase1.case.caseId);

// Duplicate title on same booking guard
var dupBookingCase = createSupportCase({
  bookingId: 'CRW-1004',
  title: 'Customer inquiries regarding same-day moving window',
  initialNote: 'Duplicate attempt'
});
assert(dupBookingCase.success === false, "Duplicate open case for same booking with identical title is rejected");

console.log("\\n======================================================");
console.log("FINAL RESULTS: " + passedAssertions + " of " + totalAssertions + " assertions passed (" + Math.round((passedAssertions/totalAssertions)*100) + "%).\\n");
"""

full_code = header + "\n" + data_cleaned + "\n" + matching_cleaned + "\n" + test_logic

js_filename = '/Users/benjamin/.gemini/antigravity/brain/10705510-18bb-4b61-b067-d75031a5c016/scratch/test_phase3.js'
with open(js_filename, 'w') as f:
    f.write(full_code)

res = subprocess.run(['osascript', '-l', 'JavaScript', js_filename], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
print(res.stdout)
if res.stderr:
    print("STDERR:\\n", res.stderr)
