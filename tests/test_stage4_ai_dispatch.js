// ============================================================================
// STAGE 4 PHASE 4.2: OFFLINE AI-ASSISTED DISPATCH PRIVACY, TRUST & FALLBACK SUITE
// ============================================================================

if (typeof console === 'undefined') {
  globalThis.console = { log: print, warn: print, error: print };
} else {
  if (!console.log) console.log = print;
  if (!console.warn) console.warn = print;
  if (!console.error) console.error = print;
}

// Track fetch invocations to ensure Phase 4.2 stays 100% offline.
var fetchCallCount = 0;
globalThis.fetch = function() {
  fetchCallCount++;
  throw new Error('Network fetch must NOT be invoked during Phase 4.2 offline execution.');
};

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
  history: { replaceState: function() {} },
  dispatchEvent: function(e) { dispatchedEvents.push(e); }
};

globalThis.CustomEvent = function(type, opts) {
  this.type = type;
  this.detail = opts ? opts.detail : null;
};

import { AI_DISPATCH_CONFIG } from '../data.js';
import {
  loadState,
  saveState,
  resetStateToSeed,
  createBooking,
  adminAssignPro,
  adminCancelBooking,
  canProAcceptSlot,
  sanitizeAiText,
  computeBookingDispatchFingerprint,
  buildSanitizedAiDispatchPayload,
  computeDeterministicFallbackRanking,
  validateAndNormalizeAiRecommendation,
  verifyRecommendationFreshness,
  logAiDispatchAuditEvent
} from '../matching.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.error('  FAIL: ' + msg);
  }
}

function getFutureDateDaysAhead(daysAhead, targetWeekday = null) {
  const dt = new Date(Date.now() + daysAhead * 86400000);
  if (targetWeekday !== null) {
    while (dt.getDay() !== targetWeekday) {
      dt.setTime(dt.getTime() + 86400000);
    }
  }
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

console.log('\n==================================================================');
console.log('STAGE 4 PHASE 4.2: AI DISPATCH PRIVACY, TRUST & FALLBACK TESTS');
console.log('==================================================================');

// ---------------------------------------------------------------------------
// Group 1: Offline Configuration & Disclaimers (Adjustments 1, 3, 5)
// ---------------------------------------------------------------------------
console.log('\n[Group 1: Offline Configuration Integrity & Limitations Disclosures]');
assert(AI_DISPATCH_CONFIG.PROXY_ENABLED === false, 'Phase 4.2 config keeps live proxy disabled');
assert(AI_DISPATCH_CONFIG.PROXY_ENDPOINT === null, 'Phase 4.2 config holds null proxy endpoint');
const configJson = JSON.stringify(AI_DISPATCH_CONFIG);
assert(!/AIza|Bearer|secret|password|private_key/i.test(configJson), 'AI_DISPATCH_CONFIG contains zero credentials or secret tokens');
assert(/not measure GPS proximity|driving ETAs/i.test(AI_DISPATCH_CONFIG.NEIGHBORHOOD_LIMITATION_NOTE), 'Neighborhood config explicitly disclaims live GPS/ETA');
assert(/localStorage/i.test(AI_DISPATCH_CONFIG.TRUST_LIMITATIONS_DISCLOSURE), 'Trust disclosure explicitly documents localStorage demonstration limitation');
assert(typeof AI_DISPATCH_CONFIG.FALLBACK_SCORING_WEIGHTS.SAME_NEIGHBORHOOD_POINTS === 'number', 'Transparent fallback scoring weights exposed');

// ---------------------------------------------------------------------------
// Group 2: Partially Filled Booking (CRW-1004) & Strict Privacy Allowlist (Adjustment 4)
// ---------------------------------------------------------------------------
console.log('\n[Group 2: Partially Filled Milestone (CRW-1004) & PII Privacy Audit]');
resetStateToSeed();
const sSeed = loadState();
const b1004 = sSeed.bookings.find(b => b.id === 'CRW-1004');
b1004.serviceDetails.notes = 'SECRET_GATE_CODE_9944 Call Sarah Jenkins at 214-555-8831';
const jamarSeed = sSeed.pros.find(p => p.id === 'pro_jamar');
jamarSeed.selfReportedNotes = 'PRIVATE_SELF_NOTE_7721';
saveState(sSeed);

const prepared1004 = buildSanitizedAiDispatchPayload('CRW-1004');
assert(prepared1004.ok === true && prepared1004.dispatchable === true, 'CRW-1004 (partially filled) is dispatchable');
assert(prepared1004.payload.bookingContext.openSlots.length === 1, 'CRW-1004 exposes exactly 1 open slot (slot_2)');
assert(prepared1004.payload.bookingContext.openSlots[0].slotId === 'slot_2', 'CRW-1004 identifies slot_2 accurately');
assert(prepared1004.payload.eligibleCandidates.length === 1 && prepared1004.payload.eligibleCandidates[0].proId === 'pro_jamar', 'Deterministic prefilter admits only pro_jamar for CRW-1004 slot_2');
assert(prepared1004.payload.disqualifiedSummary.reasonsCount.alreadyAssignedOnBooking === 1, 'Aggregate disqualified counter tracks Marcus duplicate booking exclusion without leaking PII');

const serializedReq = JSON.stringify(prepared1004.payload);
assert(serializedReq.indexOf('Sarah Jenkins') === -1, 'Privacy: Customer name omitted from AI payload');
assert(serializedReq.indexOf('cust_sarah') === -1, 'Privacy: Customer ID omitted from AI payload');
assert(serializedReq.indexOf('2800 McKinney') === -1, 'Privacy: Street address omitted from AI payload');
assert(serializedReq.indexOf('75204') === -1, 'Privacy: Exact postal code omitted from AI payload');
assert(serializedReq.indexOf('SECRET_GATE_CODE_9944') === -1, 'Privacy: Customer free-text notes omitted from AI payload');
assert(serializedReq.indexOf('PRIVATE_SELF_NOTE_7721') === -1, 'Privacy: Worker selfReportedNotes omitted from AI payload');
assert(serializedReq.indexOf('555-0377') === -1 && serializedReq.indexOf('555-8831') === -1, 'Privacy: Customer & Pro phone numbers omitted from AI payload');
assert(serializedReq.indexOf('grossPlatformRevenue') === -1 && serializedReq.indexOf('totalWorkerPayouts') === -1, 'Privacy: Financial margins and total payouts stripped');
assert(serializedReq.indexOf('availableBalance') === -1 && serializedReq.indexOf('pendingBalance') === -1 && serializedReq.indexOf('walletTransactions') === -1, 'Privacy: Worker wallet balances and transactions stripped');
assert(serializedReq.indexOf('CASE-101') === -1, 'Privacy: Internal support cases excluded from AI payload');

const cand0 = prepared1004.payload.eligibleCandidates[0];
assert(cand0.phone === undefined && cand0.earnings === undefined && cand0.autoBookMinPayout === undefined, 'Candidate schema strictly omits phone, earnings, and autoBookMinPayout');
assert(prepared1004.payload.bookingContext.pricing === undefined && prepared1004.payload.bookingContext.address === undefined, 'Booking context strictly omits pricing and address');

// ---------------------------------------------------------------------------
// Group 3: Deterministic Fallback Transparency & Side-Effect Isolation (Adjustments 1 & 5)
// ---------------------------------------------------------------------------
console.log('\n[Group 3: Deterministic Rules Fallback & Zero State Mutation]');
resetStateToSeed();
const beforeSnapshot = JSON.stringify(loadState());
const fallback1004 = computeDeterministicFallbackRanking('CRW-1004', 'proxy_offline_test');
const afterSnapshot = JSON.stringify(loadState());

assert(beforeSnapshot === afterSnapshot, 'Zero mutation to bookings, messages, wallets, or audit logs during recommendation generation');
assert(fallback1004.ok === true && fallback1004.provenance.isLiveAi === false, 'Fallback provenance explicitly marks isLiveAi === false');
assert(fallback1004.provenance.model === null, 'Fallback provenance sets model === null');
assert(/Fallback|No LLM/i.test(fallback1004.provenance.label), 'Fallback provenance label explicitly distinguishes rules engine from Live Gemini');
assert(fallback1004.slotRecommendations[0].recommendedPrimaryProId === 'pro_jamar', 'Fallback recommends eligible pro_jamar for CRW-1004 slot_2');
assert(fallback1004.slotRecommendations[0].rankedCandidates[0].scoreBreakdown.totalScore === undefined &&
  typeof fallback1004.slotRecommendations[0].rankedCandidates[0].deterministicScore === 'number', 'Transparent numeric deterministicScore & breakdown present');
assert(/not live GPS|no live driving ETA/i.test(fallback1004.slotRecommendations[0].rankedCandidates[0].rationaleBullets.join(' ')), 'Fallback rationale clarifies zone label is not GPS/ETA');
assert(/supporting context/i.test(fallback1004.slotRecommendations[0].rankedCandidates[0].rationaleBullets.join(' ')), 'Fallback frames tier/rating strictly as supporting context');

// ---------------------------------------------------------------------------
// Group 4: Multi-Worker Logic & Crew Combination Coverage (Adjustment 2)
// ---------------------------------------------------------------------------
console.log('\n[Group 4: Multi-Worker Crew Combinations, Partial/Insufficient & Zero-Eligible Slots]');
resetStateToSeed();
const nextSun = getFutureDateDaysAhead(7, 0); // Next Sunday (both Marcus and Jamar enabled!)
const bookingMulti = createBooking({
  customerId: 'cust_sarah',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: nextSun,
  scheduledTime: '11:00',
  zipCode: '75204',
  intakeDetails: { workersNeeded: 2, hours: 2, notes: 'MULTI_WORKER_PRIVATE_NOTE' }
});
// If Auto-Book assigned Marcus automatically (since Marcus has autoBookEnabled=true on moving!), unassign or reset state cleanly so BOTH slots are open!
const sMulti = loadState();
const bmObj = sMulti.bookings.find(b => b.id === bookingMulti.id);
const marcusMulti = sMulti.pros.find(p => p.id === 'pro_marcus');
bmObj.workerAssignments.forEach(sl => {
  if (sl.assignedProId === 'pro_marcus') {
    marcusMulti.earnings.pendingBalance = Math.max(0, marcusMulti.earnings.pendingBalance - sl.payout);
  }
  sl.status = 'unassigned';
  sl.assignedProId = null;
  sl.assignedProName = null;
  sl.assignedAt = null;
});
bmObj.overallStatus = 'waiting_for_pros';
saveState(sMulti);

// 4A: Fallback across 2 open slots enforces disjoint workers
const multiFallback = computeDeterministicFallbackRanking(bookingMulti.id);
assert(multiFallback.staffingFeasibility.openSlotCount === 2, '4A: 2 open slots detected on fully open booking');
assert(multiFallback.staffingFeasibility.fullCrewFeasible === true, '4A: fullCrewFeasible true when Marcus + Jamar cover 2 slots');
const p1 = multiFallback.slotRecommendations[0].recommendedPrimaryProId;
const p2 = multiFallback.slotRecommendations[1].recommendedPrimaryProId;
assert(p1 && p2 && p1 !== p2, '4A: Deterministic solver assigns distinct workers across slot_1 and slot_2');

// 4B: Combination solver resolves collision when AI puts Marcus #1 in slot_2 too (or swaps order to cover both slots)
const collidingAiResponse = {
  bookingId: bookingMulti.id,
  slotRecommendations: [
    {
      slotId: 'slot_1',
      draftAdminReason: 'Assign Marcus to slot 1',
      rankedCandidates: [
        { proId: 'pro_marcus', fitSummary: 'Lead pro', rationaleBullets: ['Verified moving skill'], cautionNote: '' }
      ]
    },
    {
      slotId: 'slot_2',
      draftAdminReason: 'Assign Marcus to slot 2',
      rankedCandidates: [
        { proId: 'pro_marcus', fitSummary: 'Top score', rationaleBullets: ['High rating'], cautionNote: '' },
        { proId: 'pro_jamar', fitSummary: 'Strong helper', rationaleBullets: ['Verified moving & Oak Lawn adjacent'], cautionNote: '' }
      ]
    }
  ],
  operationalRisks: [],
  shortageAssessment: 'tight_supply',
  recommendedNextAction: 'approve_top_candidate'
};
const validatedCombo = validateAndNormalizeAiRecommendation(collidingAiResponse, bookingMulti.id, { model: 'gemini-test-model' });
assert(validatedCombo.provenance.isLiveAi === true, '4B: Valid joint AI crew recommendation preserved as isLiveAi');
const comboSlot1 = validatedCombo.slotRecommendations.find(s => s.slotId === 'slot_1');
const comboSlot2 = validatedCombo.slotRecommendations.find(s => s.slotId === 'slot_2');
assert(comboSlot1.recommendedPrimaryProId === 'pro_marcus' && comboSlot2.recommendedPrimaryProId === 'pro_jamar',
  '4B: Joint solver avoids recommending same Pro twice & picks feasible full crew (Marcus -> slot_1, Jamar -> slot_2)');
assert(comboSlot2.draftAdminReason.indexOf('Jamar') !== -1 && comboSlot2.draftAdminReason.indexOf('Marcus') === -1,
  '4B: Regenerates slot_2 draft reason so it matches resolved primary worker (Jamar), not collided worker');

// 4C: Insufficient unique workers (block Marcus via schedule conflict -> only Jamar eligible for 2 open slots!)
const sConflict = loadState();
const conflictJob = createBooking({
  customerId: 'cust_david',
  serviceCategory: 'tv_mounting',
  timingType: 'scheduled',
  scheduledDate: nextSun,
  scheduledTime: '11:30',
  zipCode: '75214',
  intakeDetails: { tvSize: '55-65', wallType: 'Drywall', notes: 'CONFLICT_BOOKING' }
});
const sAfterConflict = loadState();
const cjObj = sAfterConflict.bookings.find(b => b.id === conflictJob.id);
cjObj.workerAssignments[0].status = 'assigned';
cjObj.workerAssignments[0].assignedProId = 'pro_marcus';
cjObj.workerAssignments[0].assignedProName = 'Marcus Davis';
cjObj.overallStatus = 'fully_confirmed';
saveState(sAfterConflict);

const scarceMulti = computeDeterministicFallbackRanking(bookingMulti.id);
assert(scarceMulti.staffingFeasibility.fullCrewFeasible === false, '4C: Detects 1 unique worker cannot fully staff 2 open slots');
assert(scarceMulti.staffingFeasibility.maxFillableOpenSlots === 1, '4C: Reports exact maxFillableOpenSlots === 1');
assert(scarceMulti.staffingFeasibility.shortageStatus === 'insufficient_supply', '4C: Sets insufficient_supply status without fabricating workers');
const assignedCountInScarce = scarceMulti.slotRecommendations.filter(s => s.recommendedPrimaryProId !== null).length;
assert(assignedCountInScarce === 1, '4C: Recommends pro_jamar for at most 1 slot when 2nd slot lacks unique supply');
assert(/Insufficient unique workers/i.test(scarceMulti.staffingFeasibility.cannotCompletelyStaffReason), '4C: Explains plainly why full staffing is impossible');

// 4E: Contract does NOT require recommendations on every slot when supply only covers 1 of 2 slots
const partialAiSlotsResponse = {
  bookingId: bookingMulti.id,
  slotRecommendations: [
    {
      slotId: 'slot_1',
      draftAdminReason: 'Assign Jamar to Lead Mover position; 2nd mover requires escalation.',
      rankedCandidates: [{ proId: 'pro_jamar', fitSummary: 'Verified mover', rationaleBullets: ['Verified moving skill'], cautionNote: '' }]
    },
    {
      slotId: 'slot_2',
      draftAdminReason: '',
      rankedCandidates: []
    }
  ],
  operationalRisks: [],
  recommendedNextAction: 'escalate_support_case'
};
const partialAiValidated = validateAndNormalizeAiRecommendation(partialAiSlotsResponse, bookingMulti.id, { model: 'gemini-test' });
assert(partialAiValidated.ok === true && partialAiValidated.provenance.isLiveAi === true,
  '4E: Partial multi-worker AI response accepted without requiring candidates for uncovered 2nd slot');
assert(partialAiValidated.slotRecommendations[0].recommendedPrimaryProId === 'pro_jamar' &&
  partialAiValidated.slotRecommendations[1].rankedCandidates.length === 0 &&
  partialAiValidated.staffingFeasibility.fullCrewFeasible === false,
  '4E: Leaves uncovered slot empty without inventing workers & preserves fullCrewFeasible === false');

// 4D: Zero eligible Pros short-circuit (lawn mowing booking with Carlos unavailable on that weekday)
const nextMon = getFutureDateDaysAhead(2, 1);
const sLawn = loadState();
sLawn.pros.find(p => p.id === 'pro_carlos').weeklyAvailability.Monday.enabled = false;
saveState(sLawn);
const zeroLawnBooking = createBooking({
  customerId: 'cust_david',
  serviceCategory: 'lawn_mowing',
  timingType: 'scheduled',
  scheduledDate: nextMon,
  scheduledTime: '10:00',
  zipCode: '75214',
  intakeDetails: { yardSize: 'Small', gateAccess: 'Unlocked', notes: 'LAWN_ZERO' }
});
const zeroPrepared = buildSanitizedAiDispatchPayload(zeroLawnBooking.id);
assert(zeroPrepared.zeroEligibleOverall === true, '4D: Prefilter detects 0 eligible Pros cleanly');
assert(zeroPrepared.payload.slotSupply[0].zeroEligible === true, '4D: Slot supply explicitly flags zeroEligible === true');
const zeroFallback = validateAndNormalizeAiRecommendation({
  bookingId: zeroLawnBooking.id,
  slotRecommendations: [{ slotId: 'slot_1', draftAdminReason: 'Fake', rankedCandidates: [{ proId: 'pro_marcus', fitSummary: 'Fake', rationaleBullets: ['Bypass attempt'] }] }]
}, zeroLawnBooking.id);
assert(zeroFallback.provenance.isLiveAi === false && zeroFallback.provenance.source === 'zero_eligible_short_circuit',
  '4D: Zero-eligible state blocks untrusted AI from bypassing rules & uses zero_eligible_short_circuit');
assert(zeroFallback.slotRecommendations[0].rankedCandidates.length === 0, '4D: Never invents workers to fill empty slot');
assert(zeroFallback.recommendedNextAction === 'escalate_support_case', '4D: Zero-eligible non-ASAP recommends escalate_support_case');

// ---------------------------------------------------------------------------
// Group 5: Explicit Trust Boundary, Hallucination, Eligibility, XSS & Status Checks (Adjustments 3 & 4)
// ---------------------------------------------------------------------------
console.log('\n[Group 5: AI Trust Boundary — Untrusted Payload Rejection, XSS & Rule Verification]');
resetStateToSeed();

// T5a: Malformed JSON
const badJsonRes = validateAndNormalizeAiRecommendation('{not valid json', 'CRW-1004');
assert(badJsonRes.ok === true && badJsonRes.provenance.isLiveAi === false, 'T5a: Malformed JSON gracefully degrades to fallback (isLiveAi: false)');
assert(badJsonRes.validationReport.rejectedDetails.length > 0, 'T5a: Logs malformed JSON diagnostic detail');

// T5b: Wrong bookingId
const mismatchRes = validateAndNormalizeAiRecommendation({
  bookingId: 'CRW-9999',
  slotRecommendations: [{ slotId: 'slot_2', rankedCandidates: [{ proId: 'pro_jamar', fitSummary: 'ok', rationaleBullets: ['ok'] }] }]
}, 'CRW-1004');
assert(mismatchRes.provenance.isLiveAi === false, 'T5b: Rejects bookingId mismatch & falls back cleanly');

// T5c & T5d: Strips hallucinated Pro, wrong skill (Carlos), already assigned (Marcus), unavailable day (Elena), & filled slot_1; keeps verified Jamar
const mixedAi = {
  bookingId: 'CRW-1004',
  slotRecommendations: [
    {
      slotId: 'slot_1', // already filled by Marcus!
      draftAdminReason: 'Should be ignored',
      rankedCandidates: [{ proId: 'pro_marcus', fitSummary: 'Already filled', rationaleBullets: ['Bypass'], cautionNote: '' }]
    },
    {
      slotId: 'slot_2',
      draftAdminReason: '<script>alert("xss")</script>Recommend verified mover Jamar Washington.',
      rankedCandidates: [
        { proId: 'pro_fake_ghost', fitSummary: 'Ghost', rationaleBullets: ['Fake'], cautionNote: '' },
        { proId: 'pro_carlos', fitSummary: 'No skill', rationaleBullets: ['Lawn only'], cautionNote: '' },
        { proId: 'pro_elena', fitSummary: 'Off Sunday', rationaleBullets: ['Unavailable'], cautionNote: '' },
        { proId: 'pro_marcus', fitSummary: 'Duplicate slot', rationaleBullets: ['Already on slot_1'], cautionNote: '' },
        {
          proId: 'pro_jamar',
          fitSummary: '<img src=x onerror=alert(1)>Qualified assistant mover',
          rationaleBullets: ['javascript:alert(9)Verified moving skill & Oak Lawn base', 'Reliable 94% track record'],
          cautionNote: '<b>Confirm Sunday arrival window</b>'
        }
      ]
    }
  ],
  operationalRisks: [
    { severity: 'high', code: 'thin_candidate_pool', message: '<script>steal()</script>Only one eligible mover on Sunday.' }
  ],
  recommendedNextAction: 'approve_top_candidate'
};
const trustedMixed = validateAndNormalizeAiRecommendation(mixedAi, 'CRW-1004', { model: 'gemini-flash' });
assert(trustedMixed.provenance.isLiveAi === true, 'T5d: Valid surviving Pro retains vetted live advisory status');
assert(trustedMixed.validationReport.rejectedCandidateCount === 4, 'T5d: Exactly 4 invalid/ineligible/hallucinated candidates stripped on slot_2');
assert(trustedMixed.slotRecommendations[0].rankedCandidates.length === 1 && trustedMixed.slotRecommendations[0].rankedCandidates[0].proId === 'pro_jamar',
  'T5d: Only deterministic-verified pro_jamar survives validation');

// T5e: XSS neutralization assertions across every rendered text property
const jamarValidated = trustedMixed.slotRecommendations[0].rankedCandidates[0];
const xssBundle = [
  trustedMixed.slotRecommendations[0].draftAdminReason,
  jamarValidated.fitSummary,
  jamarValidated.rationaleBullets.join(' '),
  jamarValidated.cautionNote,
  trustedMixed.operationalRisks.map(r => r.message).join(' ')
].join(' ');
assert(xssBundle.indexOf('<script') === -1 && xssBundle.indexOf('<img') === -1 && xssBundle.indexOf('onerror=') === -1 && xssBundle.indexOf('javascript:') === -1,
  'T5g: XSS script tags, img handlers, and javascript: URIs completely neutralized');

// T5f: All candidates fail live check -> triggers fallback
const allBadAi = {
  bookingId: 'CRW-1004',
  slotRecommendations: [
    {
      slotId: 'slot_2',
      draftAdminReason: 'All ineligible',
      rankedCandidates: [{ proId: 'pro_elena', fitSummary: 'Invalid', rationaleBullets: ['Invalid'], cautionNote: '' }]
    }
  ]
};
const allBadResult = validateAndNormalizeAiRecommendation(allBadAi, 'CRW-1004');
assert(allBadResult.provenance.isLiveAi === false && allBadResult.provenance.fallbackReason === 'ai_candidates_rejected_by_rules',
  'T5d: Falls back to deterministic ranking when all AI picks fail live rules');

// T5h: Non-dispatchable historical/completed/cancelled/expired ASAP bookings
const past1001 = buildSanitizedAiDispatchPayload('CRW-1001'); // 2026-11-08 past relative to 2026-11-11
assert(past1001.dispatchable === false, 'T5h: Past scheduled booking (CRW-1001) rejected as non-dispatchable');
const comp1003 = buildSanitizedAiDispatchPayload('CRW-1003');
assert(comp1003.dispatchable === false, 'T5h: Completed booking (CRW-1003) rejected as non-dispatchable');
const asapExpiredBooking = createBooking({
  customerId: 'cust_sarah',
  serviceCategory: 'tv_mounting',
  timingType: 'asap',
  zipCode: '75204',
  intakeDetails: { tvSize: '55-65', wallType: 'Drywall', bracket: 'Customer owns', notes: '' }
});
const expiredCheck = buildSanitizedAiDispatchPayload(asapExpiredBooking.id, {
  currentTimeMs: Date.now() + 120 * 60 * 1000
});
assert(expiredCheck.dispatchable === false && /expired/i.test(expiredCheck.error), 'T5h: Expired ASAP window rejected cleanly');

// ---------------------------------------------------------------------------
// Group 6: Freshness Fingerprint Detects Booking, Worker Availability & Conflicts (Adjustment 3)
// ---------------------------------------------------------------------------
console.log('\n[Group 6: Freshness Fingerprint & Worker Availability/Conflict Invalidation]');
resetStateToSeed();
const rec1004 = computeDeterministicFallbackRanking('CRW-1004');
const fpInitial = rec1004.fingerprint;
const freshCheck0 = verifyRecommendationFreshness(rec1004, 'CRW-1004', { slotId: 'slot_2', proId: 'pro_jamar' });
assert(freshCheck0.fresh === true && freshCheck0.allowedForApproval === true, '6: Initial recommendation verifies fresh & approval-eligible');

// 6A: Worker weekly availability modified WITHOUT touching booking
const sAvailMod = loadState();
sAvailMod.pros.find(p => p.id === 'pro_jamar').weeklyAvailability.Sunday.enabled = false;
saveState(sAvailMod);
const freshAfterAvailMod = verifyRecommendationFreshness(rec1004, 'CRW-1004', { slotId: 'slot_2', proId: 'pro_jamar' });
assert(freshAfterAvailMod.fresh === false && freshAfterAvailMod.allowedForApproval === false,
  '6A: Fingerprint invalidates when eligible worker disables target weekday availability');

// Restore Sunday enabled
sAvailMod.pros.find(p => p.id === 'pro_jamar').weeklyAvailability.Sunday.enabled = true;
saveState(sAvailMod);
assert(verifyRecommendationFreshness(rec1004, 'CRW-1004').fresh === true, '6A: Restored availability restores matching fingerprint');

// 6B: Another booking assigns pro_jamar at overlapping time on same Sunday WITHOUT touching CRW-1004
const otherSunJob = createBooking({
  customerId: 'cust_david',
  serviceCategory: 'furniture_assembly',
  timingType: 'scheduled',
  scheduledDate: '2026-11-15',
  scheduledTime: '11:30',
  zipCode: '75214',
  intakeDetails: { itemCount: 1, notes: '' }
});
const sOtherMod = loadState();
const oj = sOtherMod.bookings.find(b => b.id === otherSunJob.id);
oj.workerAssignments[0].status = 'assigned';
oj.workerAssignments[0].assignedProId = 'pro_jamar';
oj.workerAssignments[0].assignedProName = 'Jamar Washington';
oj.overallStatus = 'fully_confirmed';
saveState(sOtherMod);

const freshAfterConflict = verifyRecommendationFreshness(rec1004, 'CRW-1004', { slotId: 'slot_2', proId: 'pro_jamar' });
assert(freshAfterConflict.fresh === false && freshAfterConflict.allowedForApproval === false,
  '6B: Fingerprint invalidates & blocks approval when worker takes conflicting job on another booking');

// 6C: Stale fingerprint passed to validateAndNormalizeAiRecommendation
resetStateToSeed();
const staleAiRes = validateAndNormalizeAiRecommendation({
  bookingId: 'CRW-1004',
  slotRecommendations: [{ slotId: 'slot_2', rankedCandidates: [{ proId: 'pro_jamar', fitSummary: 'ok', rationaleBullets: ['ok'] }] }]
}, 'CRW-1004', { expectedFingerprint: 'fp_outdated_state' });
assert(staleAiRes.provenance.isLiveAi === false && staleAiRes.validationReport.staleDetected === true,
  '6C: Stale fingerprint rejects live AI wrapper & marks staleDetected === true');

// 6D: Cancelled booking invalidates previously captured recommendation
const cancelRes = adminCancelBooking('CRW-1004', 'Customer rescheduled trip.');
assert(cancelRes.success === true, 'Setup: cancelled CRW-1004 cleanly');
const freshAfterCancel = verifyRecommendationFreshness(rec1004, 'CRW-1004', { slotId: 'slot_2', proId: 'pro_jamar' });
assert(freshAfterCancel.fresh === false && freshAfterCancel.allowedForApproval === false,
  '6D: Cancelled booking invalidates recommendation & blocks approval');

// ---------------------------------------------------------------------------
// Group 7: Sanitized Audit Helpers & Manual Approval Boundary (Adjustments 1 & 4)
// ---------------------------------------------------------------------------
console.log('\n[Group 7: Sanitized Audit Events & Human-Controlled Admin Approval Continuity]');
resetStateToSeed();
const badAudit = logAiDispatchAuditEvent({ actionType: 'worker_assigned', bookingId: 'CRW-1004', reason: 'Spoof attempt' });
assert(badAudit.success === false, 'Audit helper rejects non-AI action types');

const goodAudit = logAiDispatchAuditEvent({
  actionType: 'ai_dispatch_fallback_used',
  bookingId: 'CRW-1004',
  slotId: 'slot_2',
  proId: 'pro_jamar',
  reason: '<script>x</script>Suggested Jamar Washington. Call 214-555-8831 or key AIzaSyD123456789012345678901234567890.'
});
assert(goodAudit.success === true, 'Audit helper logs allowlisted Stage 4 event');
assert(goodAudit.auditRecord.reason.indexOf('<script') === -1 && goodAudit.auditRecord.reason.indexOf('555-8831') === -1 && goodAudit.auditRecord.reason.indexOf('AIza') === -1,
  'Audit record redacts HTML, phone numbers, and API key patterns cleanly');

// Confirm zero network calls ever occurred during entire Phase 4.2 run
assert(fetchCallCount === 0, 'Strictly offline: zero fetch() calls invoked across all Phase 4.2 tests');

// Verify human Admin assignment flow remains 100% functional using vetted advisory draft
const advisory = computeDeterministicFallbackRanking('CRW-1004');
const topSlot = advisory.slotRecommendations[0];
const assignRes = adminAssignPro('CRW-1004', topSlot.slotId, topSlot.recommendedPrimaryProId, topSlot.draftAdminReason);
assert(assignRes.success === true && assignRes.booking.overallStatus === 'fully_confirmed',
  'Human-controlled adminAssignPro() executes cleanly using advisory recommendation');

console.log('\n==================================================================');
console.log(`FINAL RESULTS: ${passed} of ${passed + failed} assertions passed (${Math.round((passed / Math.max(1, passed + failed)) * 100)}%).`);
console.log('==================================================================');
if (failed > 0) {
  throw new Error(`${failed} Stage 4 Phase 4.2 test assertions failed.`);
}
