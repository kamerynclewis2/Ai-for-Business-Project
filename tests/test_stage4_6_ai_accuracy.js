// ============================================================================
// STAGE 4.6A: AI ACCURACY & FACTUAL TRUTH HARDENING TEST SUITE
// ============================================================================
// Validates application-level factual verification safeguards:
// 1. Authoritative ground-truth data from state.pros and PRICING_RATES.
// 2. Jamar Washington career record verification & zero-completed-jobs fix.
// 3. Workload metric distinction: recentSessionCompletedJobsCount vs reviewCount.
// 4. Rejection and grounding of hallucinated equipment (trucks, lawn mowers, drills).
// 5. Rejection and grounding of hallucinated skills & outside trades (electrician, plumber).
// 6. Invariance of ratings, review counts, reliability scores, and tiers.
// 7. Price and payout protection against fabricated rates.
// 8. Availability and scheduling grounding against weeklyAvailability.
// 9. UI candidate card rendering directly from authoritative state.pros.
// 10. Human Admin approval gate preservation.
// ============================================================================

if (typeof console === 'undefined') {
  globalThis.console = { log: print, warn: print, error: print };
} else {
  if (!console.log) console.log = print;
  if (!console.warn) console.warn = print;
  if (!console.error) console.error = print;
}

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

import {
  PRICING_RATES,
  INITIAL_PROS,
  AI_DISPATCH_CONFIG
} from '../data.js';

import {
  loadState,
  saveState,
  resetStateToSeed,
  createBooking,
  canProAcceptSlot,
  adminAssignPro,
  getDallasLocalNow,
  buildSanitizedAiDispatchPayload,
  computeBookingDispatchFingerprint,
  validateAndNormalizeAiRecommendation,
  computeDeterministicFallbackRanking,
  groundAndVerifyCandidateClaims,
  groundDraftAdminReason
} from '../matching.js';

var passed = 0;
var failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log('==================================================================');
console.log('CREWLY STAGE 4.6A — AI ACCURACY & FACTUAL TRUTH HARDENING SUITE');
console.log('==================================================================');

// Reset to clean seed data
resetStateToSeed();
var state = loadState();

// ---------------------------------------------------------------------------
// Group 1: Jamar Washington Ground-Truth Record & Workload Metric Clarification
// ---------------------------------------------------------------------------
console.log('\n[Group 1: Jamar Washington Career Record & Workload Metric Distinction]');

var proJamar = (state.pros || []).find(p => p.id === 'pro_jamar');
assert(Boolean(proJamar), '1A: Pro Jamar Washington exists in authoritative state.pros');
assert(proJamar.reviewCount === 14, '1A: Jamar Washington record has 14 verified customer reviews');
assert(proJamar.rating === 4.75, '1A: Jamar Washington record has 4.75 star rating');
assert(proJamar.reliabilityScore === 94, '1A: Jamar Washington record has 94% reliability score');
assert(proJamar.tier === 'Bronze', '1A: Jamar Washington record has Bronze tier');
assert(proJamar.earnings && proJamar.earnings.lifetimeEarned === 520.00, '1A: Jamar Washington has $520.00 in platform lifetime earnings');
assert(Array.isArray(proJamar.verifiedSkills) && proJamar.verifiedSkills.includes('moving') && proJamar.verifiedSkills.includes('furniture_assembly'),
  '1A: Jamar verified skills include moving and furniture assembly');
assert(!proJamar.verifiedSkills.includes('tv_mounting') && !proJamar.verifiedSkills.includes('lawn_mowing'),
  '1A: Jamar does NOT have verified TV mounting or lawn mowing skills in state');
assert(Array.isArray(proJamar.verifiedEquipment) && proJamar.verifiedEquipment.includes('hand_truck') && proJamar.verifiedEquipment.includes('shoulder_dolly'),
  '1A: Jamar verified equipment includes hand_truck and shoulder_dolly');
assert(!proJamar.verifiedEquipment.includes('pickup_truck') && !proJamar.verifiedEquipment.includes('truck'),
  '1A: Jamar does NOT have a verified moving truck in state (labor-only moving Pro)');

// Test CRW-1004 moving booking payload
var payload1004 = buildSanitizedAiDispatchPayload('CRW-1004');
assert(payload1004.ok === true && payload1004.dispatchable === true, '1B: CRW-1004 sanitized dispatch payload built cleanly');
var jamarCandPayload = payload1004.payload.eligibleCandidates.find(c => c.proId === 'pro_jamar');
assert(Boolean(jamarCandPayload), '1B: Jamar Washington is an eligible candidate for CRW-1004 slot_2');
assert(jamarCandPayload.recentSessionCompletedJobsCount === 0,
  '1B: Payload explicitly distinguishes recentSessionCompletedJobsCount (0 in active demo session)');
assert(jamarCandPayload.reviewCount === 14 && jamarCandPayload.historicalReviewCount === 14,
  '1B: Payload accurately provides verified historical reviewCount (14) alongside session count');
assert(jamarCandPayload.historicalCompletedJobsKnown === false,
  '1B: Payload explicitly marks historicalCompletedJobsKnown as false to prevent LLM assuming 0 lifetime jobs');

// ---------------------------------------------------------------------------
// Group 2: Contradiction Detection & Zero Completed Jobs Caution Stripping
// ---------------------------------------------------------------------------
console.log('\n[Group 2: Contradiction Detection & Zero Completed Jobs Caution Stripping]');

// Simulate AI response where model hallucinated a "0 completed jobs" caution on Jamar
var rawAiWithZeroJobsCaution = {
  bookingId: 'CRW-1004',
  slotRecommendations: [
    {
      slotId: 'slot_2',
      draftAdminReason: 'Recommend Jamar Washington for Assistant Mover.',
      rankedCandidates: [
        {
          proId: 'pro_jamar',
          fitSummary: 'Verified moving helper with 0 completed jobs recorded.',
          rationaleBullets: [
            'Holds verified moving credentials',
            'Caution: worker has 0 completed jobs recorded on Crewly'
          ],
          cautionNote: 'Jamar has 0 completed jobs recorded on the platform; assign with caution.'
        }
      ]
    }
  ]
};

var validatedCautionFix = validateAndNormalizeAiRecommendation(rawAiWithZeroJobsCaution, 'CRW-1004');
assert(validatedCautionFix.ok === true, '2A: validateAndNormalizeAiRecommendation processes response');
var slot2Rec = validatedCautionFix.slotRecommendations.find(s => s.slotId === 'slot_2');
var jamarNorm = slot2Rec.rankedCandidates.find(c => c.proId === 'pro_jamar');

assert(jamarNorm.cautionNote === '',
  '2A: Misleading "0 completed jobs" caution note is safely stripped for experienced Pro with 14 reviews');
assert(jamarNorm.cautionNote.indexOf('0 completed jobs') === -1,
  '2A: Caution note contains no zero-completed-jobs contradiction');
assert(jamarNorm.rationaleBullets.every(b => b.indexOf('0 completed jobs') === -1),
  '2B: Rationale bullets strip zero-completed-jobs contradiction');
assert(jamarNorm.rationaleBullets.some(b => b.indexOf('14 customer reviews') !== -1 || b.indexOf('4.75★') !== -1),
  '2B: False bullet replaced with authoritative customer reviews and rating context');
assert(jamarNorm.rationaleBullets.every(b => b.indexOf('520') === -1 && b.indexOf('lifetime earned') === -1),
  '2D: Financial privacy enforced: Jamar $520 earnings strictly excluded from rationale bullets');
assert(jamarNorm.fitSummary.indexOf('0 completed jobs') === -1,
  '2C: fitSummary strips zero-completed-jobs contradiction and preserves rating/review context');
assert(jamarNorm.fitSummary.indexOf('520') === -1 && jamarNorm.fitSummary.indexOf('lifetime earned') === -1,
  '2D: Financial privacy enforced: Worker earnings strictly excluded from fitSummary');

// ---------------------------------------------------------------------------
// Group 3: Hallucinated Equipment Rejection & Labor-Only Moving Grounding
// ---------------------------------------------------------------------------
console.log('\n[Group 3: Hallucinated Equipment Rejection & Labor-Only Moving Grounding]');

var rawAiWithHallucinatedEquipment = {
  bookingId: 'CRW-1004',
  slotRecommendations: [
    {
      slotId: 'slot_2',
      draftAdminReason: 'Recommend Jamar Washington.',
      rankedCandidates: [
        {
          proId: 'pro_jamar',
          fitSummary: 'Equipped with pickup truck and commercial lawn mower.',
          rationaleBullets: [
            'Brings his own pickup truck to haul furniture',
            'Equipped with commercial gas lawn mower and weed eater',
            'Has cordless power drill and laser level'
          ],
          cautionNote: ''
        }
      ]
    }
  ]
};

var validatedEquipFix = validateAndNormalizeAiRecommendation(rawAiWithHallucinatedEquipment, 'CRW-1004');
var jamarEquip = validatedEquipFix.slotRecommendations[0].rankedCandidates[0];

// Jamar does NOT have a pickup truck; for moving, it must be labor-only moving assistance
assert(jamarEquip.rationaleBullets.every(b => b.indexOf('commercial gas lawn mower') === -1),
  '3A: Hallucinated lawn mower claim stripped from mover candidate bullets');
assert(jamarEquip.rationaleBullets.every(b => b.indexOf('weed eater') === -1),
  '3A: Hallucinated weed eater claim stripped from mover candidate bullets');
assert(jamarEquip.rationaleBullets.every(b => b.indexOf('cordless power drill') === -1),
  '3B: Hallucinated power drill claim stripped for Pro without power tools');
assert(jamarEquip.rationaleBullets.every(b => b.indexOf('laser level') === -1),
  '3B: Hallucinated laser level claim stripped for Pro without laser level');
assert(jamarEquip.rationaleBullets.some(b => b.indexOf('labor-only moving') !== -1 || b.indexOf('hand truck') !== -1),
  '3C: Truck claim grounded to labor-only moving assistance with verified hand truck & dolly');

// ---------------------------------------------------------------------------
// Group 4: Hallucinated Skills & Outside Trade Credentials Safeguard
// ---------------------------------------------------------------------------
console.log('\n[Group 4: Hallucinated Skills & Outside Trade Credentials Safeguard]');

var rawAiWithFakeSkills = {
  bookingId: 'CRW-1004',
  slotRecommendations: [
    {
      slotId: 'slot_2',
      draftAdminReason: 'Jamar is a certified electrician.',
      rankedCandidates: [
        {
          proId: 'pro_jamar',
          fitSummary: 'Licensed master electrician and certified plumber.',
          rationaleBullets: [
            'Certified master electrician with 10 years trade experience',
            'Licensed plumber for pipe repairs',
            'Expert TV mounting specialist'
          ],
          cautionNote: ''
        }
      ]
    }
  ]
};

var validatedSkillsFix = validateAndNormalizeAiRecommendation(rawAiWithFakeSkills, 'CRW-1004');
var jamarSkills = validatedSkillsFix.slotRecommendations[0].rankedCandidates[0];

assert(jamarSkills.rationaleBullets.every(b => b.toLowerCase().indexOf('electrician') === -1),
  '4A: Unverified outside trade (electrician) stripped from candidate bullets');
assert(jamarSkills.rationaleBullets.every(b => b.toLowerCase().indexOf('plumber') === -1),
  '4A: Unverified outside trade (plumber) stripped from candidate bullets');
assert(jamarSkills.rationaleBullets.every(b => b.toLowerCase().indexOf('tv mounting') === -1),
  '4B: Unverified category skill (TV mounting) stripped from moving-only Pro bullets');
assert(jamarSkills.fitSummary.toLowerCase().indexOf('electrician') === -1 && jamarSkills.fitSummary.toLowerCase().indexOf('plumber') === -1,
  '4C: fitSummary scrubs outside trade claims cleanly');

// ---------------------------------------------------------------------------
// Group 5: Rating, Review Count, Reliability Score & Tier Invariance
// ---------------------------------------------------------------------------
console.log('\n[Group 5: Rating, Review Count, Reliability Score & Tier Invariance]');

var rawAiDistortedStats = {
  bookingId: 'CRW-1004',
  slotRecommendations: [
    {
      slotId: 'slot_2',
      draftAdminReason: 'Recommend Jamar.',
      rankedCandidates: [
        {
          proId: 'pro_jamar',
          fitSummary: 'Gold tier mover with 5.0 stars and 200 reviews (99% reliability).',
          rationaleBullets: [
            'Rated 5.0 stars on platform',
            'Over 200 reviews recorded',
            'Gold tier professional with 99% reliability'
          ],
          cautionNote: ''
        }
      ]
    }
  ]
};

var validatedStatsFix = validateAndNormalizeAiRecommendation(rawAiDistortedStats, 'CRW-1004');
var jamarStats = validatedStatsFix.slotRecommendations[0].rankedCandidates[0];

// Invariance checks: attributes in candidate object
assert(jamarStats.tier === 'Bronze', '5A: Candidate object tier invariant (Bronze, not Gold)');
assert(jamarStats.rating === 4.75, '5A: Candidate object rating invariant (4.75, not 5.0)');
assert(jamarStats.reviewCount === 14, '5A: Candidate object reviewCount invariant (14, not 200)');
assert(jamarStats.reliabilityScore === 94, '5A: Candidate object reliabilityScore invariant (94, not 99)');

// Text grounding checks: bullets and fitSummary grounded to authoritative values
assert(jamarStats.fitSummary.indexOf('Gold') === -1, '5B: fitSummary corrected: "Gold tier" replaced with Bronze tier');
assert(jamarStats.fitSummary.indexOf('Bronze tier') !== -1, '5B: fitSummary asserts authoritative Bronze tier');
assert(jamarStats.fitSummary.indexOf('4.75★') !== -1 || jamarStats.fitSummary.indexOf('4.75') !== -1,
  '5B: fitSummary asserts authoritative 4.75 rating instead of 5.0');
assert(jamarStats.fitSummary.indexOf('14 reviews') !== -1,
  '5B: fitSummary asserts authoritative 14 reviews instead of 200');
assert(jamarStats.fitSummary.indexOf('94% reliability') !== -1,
  '5B: fitSummary asserts authoritative 94% reliability instead of 99%');
assert(jamarStats.verifiedEvidence !== undefined && typeof jamarStats.verifiedEvidence === 'object',
  '5C: Candidate object carries structured verifiedEvidence anchor from authoritative state');
assert(jamarStats.verifiedEvidence.tier === 'Bronze' && jamarStats.verifiedEvidence.reviewCount === 14,
  '5C: verifiedEvidence reflects ground-truth Bronze tier and 14 reviews');
assert(jamarStats.verifiedEvidence.verifiedEquipment.includes('hand_truck'),
  '5C: verifiedEvidence corroborates verified hand_truck equipment');

// ---------------------------------------------------------------------------
// Group 6: Service Price, Pro Payout & Financial Privacy Protection
// ---------------------------------------------------------------------------
console.log('\n[Group 6: Service Price, Pro Payout & Financial Privacy Protection]');

// 6A: Privacy assertion: dispatch payload builder MUST NOT leak Pro earnings or wallet data to AI provider
var payloadForAi = buildSanitizedAiDispatchPayload('CRW-1004');
var candZero = payloadForAi.payload.eligibleCandidates[0];
assert(candZero.lifetimeEarned === undefined, '6A: Pro lifetimeEarned is strictly excluded from AI dispatch payload');
assert(candZero.availableBalance === undefined, '6A: Pro availableBalance is strictly excluded from AI dispatch payload');
assert(candZero.pendingBalance === undefined, '6A: Pro pendingBalance is strictly excluded from AI dispatch payload');
assert(candZero.walletTransactions === undefined, '6A: Pro walletTransactions is strictly excluded from AI dispatch payload');

var rawAiFabricatedPricing = {
  bookingId: 'CRW-1004',
  slotRecommendations: [
    {
      slotId: 'slot_2',
      draftAdminReason: 'Charges custom $65/hr moving rate with $45/hr payout.',
      rankedCandidates: [
        {
          proId: 'pro_jamar',
          fitSummary: 'Available at custom rate of $60/hr with $45/hr Pro payout.',
          rationaleBullets: [
            'Custom customer rate: $60/hr',
            'Pro payout guaranteed at $45/hr',
            'Includes $25 service surcharge'
          ],
          cautionNote: 'Non-standard fee of $75 quoted.'
        }
      ]
    }
  ]
};

var validatedPriceFix = validateAndNormalizeAiRecommendation(rawAiFabricatedPricing, 'CRW-1004');
var jamarPrice = validatedPriceFix.slotRecommendations[0].rankedCandidates[0];

assert(jamarPrice.fitSummary.indexOf('$60/hr') === -1 && jamarPrice.fitSummary.indexOf('$60') === -1,
  '6A: Fabricated customer rate ($60/hr) stripped from fitSummary');
assert(jamarPrice.fitSummary.indexOf('$50/hr') !== -1 || jamarPrice.fitSummary.indexOf('$50') !== -1,
  '6A: fitSummary grounded to official Crewly moving customer rate ($50/hr)');
assert(jamarPrice.rationaleBullets.every(b => b.indexOf('$45/hr') === -1),
  '6B: Fabricated Pro payout ($45/hr) stripped from rationale bullets');
assert(jamarPrice.rationaleBullets.every(b => b.indexOf('$25 service surcharge') === -1),
  '6B: Fabricated surcharge stripped from rationale bullets');

// ---------------------------------------------------------------------------
// Group 7: Availability & Scheduling Grounding
// ---------------------------------------------------------------------------
console.log('\n[Group 7: Availability & Scheduling Grounding]');

// Elena has Sunday availability disabled
var proElena = (state.pros || []).find(p => p.id === 'pro_elena');
assert(proElena.weeklyAvailability.Sunday.enabled === false, '7A: Elena Rodriguez Sunday availability is disabled');

// Try to pass Elena as candidate on Sunday booking CRW-1004
var rawAiElenaSunday = {
  bookingId: 'CRW-1004',
  slotRecommendations: [
    {
      slotId: 'slot_2',
      draftAdminReason: 'Recommend Elena for Sunday moving.',
      rankedCandidates: [
        {
          proId: 'pro_elena',
          fitSummary: 'Available all day Sunday.',
          rationaleBullets: ['Available on Sunday'],
          cautionNote: ''
        }
      ]
    }
  ]
};

var validatedElenaSunday = validateAndNormalizeAiRecommendation(rawAiElenaSunday, 'CRW-1004');
var elenaInSlot2 = validatedElenaSunday.slotRecommendations[0].rankedCandidates.find(c => c.proId === 'pro_elena');
assert(elenaInSlot2 === undefined,
  '7B: Live canProAcceptSlot() strictly rejects unavailable Elena from Sunday recommendations');
assert(validatedElenaSunday.validationReport.rejectedCandidateCount >= 1,
  '7B: Elena rejection recorded in validationReport.rejectedCandidateCount');

// ---------------------------------------------------------------------------
// Group 8: Draft Admin Reason Grounding
// ---------------------------------------------------------------------------
console.log('\n[Group 8: Draft Admin Reason Grounding]');

var draftResult = groundDraftAdminReason(
  'Recommend Jamar Washington (Gold tier) with 0 completed jobs and $60/hr rate.',
  proJamar,
  { serviceCategory: 'moving', serviceTitle: 'Moving & Lifting Assistance' },
  'Assistant Mover'
);

assert(draftResult.indexOf('Gold') === -1, '8A: draftAdminReason strips false Gold tier');
assert(draftResult.indexOf('Bronze') !== -1, '8A: draftAdminReason asserts authoritative Bronze tier');
assert(draftResult.indexOf('0 completed jobs') === -1, '8B: draftAdminReason strips false zero completed jobs claim');
assert(draftResult.indexOf('$60/hr') === -1, '8C: draftAdminReason scrubs fabricated $60/hr pricing');

// ---------------------------------------------------------------------------
// Group 9: Direct groundAndVerifyCandidateClaims Unit Tests
// ---------------------------------------------------------------------------
console.log('\n[Group 9: Direct groundAndVerifyCandidateClaims Unit Verification]');

// Test 9A: Zero jobs claim stripped for Jamar
var test9A = groundAndVerifyCandidateClaims(
  {
    proId: 'pro_jamar',
    fitSummary: 'Jamar is an untested worker with 0 completed jobs.',
    rationaleBullets: ['Has 0 completed jobs recorded on platform', 'Available in Oak Lawn'],
    cautionNote: 'Caution: 0 completed jobs on Crewly.'
  },
  proJamar,
  { serviceCategory: 'moving', serviceTitle: 'Moving & Lifting Assistance' }
);

assert(test9A.cautionNote === '', '9A: cautionNote becomes empty string when zero-jobs caution is removed');
assert(test9A.rationaleBullets[0].indexOf('14 customer reviews') !== -1, '9A: bullet replaced with 14 customer reviews');
assert(test9A.rationaleBullets[0].indexOf('520') === -1 && test9A.rationaleBullets[0].indexOf('lifetime earned') === -1, '9A: Earnings excluded from replacement bullet');
assert(test9A.fitSummary.indexOf('0 completed jobs') === -1, '9A: fitSummary zero-jobs reference scrubbed');
assert(test9A.fitSummary.indexOf('520') === -1 && test9A.fitSummary.indexOf('lifetime earned') === -1, '9A: Earnings excluded from fitSummary');

// Test 9B: Active workload caution preserved when Pro actually has active assignments
var stateWithActive = loadState();
var bookingActive = stateWithActive.bookings.find(b => b.id === 'CRW-1004');
var test9B = groundAndVerifyCandidateClaims(
  {
    proId: 'pro_jamar',
    fitSummary: 'Fit for moving.',
    rationaleBullets: ['Verified moving skill'],
    cautionNote: 'Jamar has 0 completed jobs recorded.'
  },
  proJamar,
  { serviceCategory: 'moving', serviceTitle: 'Moving & Lifting Assistance' },
  { bookings: [{ id: 'CRW-9999', overallStatus: 'in_progress', workerAssignments: [{ slotId: 'slot_1', assignedProId: 'pro_jamar', status: 'accepted' }] }] }
);
assert(test9B.cautionNote.indexOf('Currently holding 1 active assignment') !== -1,
  '9B: Legitimate active workload caution note generated when Pro has active assignments');

// Test 9C: TV mounting service rate grounding
var proMarcus = (state.pros || []).find(p => p.id === 'pro_marcus');
var test9C = groundAndVerifyCandidateClaims(
  {
    proId: 'pro_marcus',
    fitSummary: 'Marcus charges $175 flat for TV mounting.',
    rationaleBullets: ['Price is $175 flat fee'],
    cautionNote: ''
  },
  proMarcus,
  { serviceCategory: 'tv_mounting', serviceTitle: 'TV Mounting' }
);
assert(test9C.fitSummary.indexOf('$175') === -1, '9C: Fabricated $175 TV mounting rate stripped');
assert(test9C.fitSummary.indexOf('$109') !== -1, '9C: Grounded to authoritative $109 TV mounting rate');

// ---------------------------------------------------------------------------
// Group 10: Human Admin Assignment Gate Remains 100% Functional
// ---------------------------------------------------------------------------
console.log('\n[Group 10: Human Admin Assignment Gate Preserved]');

// Using the grounded recommendation from Group 2, execute human admin assignment
var groundedRec = validatedCautionFix;
var topCandidate = groundedRec.slotRecommendations[0].rankedCandidates[0];
assert(topCandidate.proId === 'pro_jamar', '10A: Top candidate for slot_2 is Jamar Washington');

var assignResult = adminAssignPro(
  'CRW-1004',
  'slot_2',
  topCandidate.proId,
  groundedRec.slotRecommendations[0].draftAdminReason
);

assert(assignResult.success === true, '10B: Human adminAssignPro() succeeds with grounded recommendation');
var finalBooking = (loadState().bookings || []).find(b => b.id === 'CRW-1004');
assert(finalBooking.overallStatus === 'fully_confirmed', '10B: Booking transitions to fully_confirmed after human assignment');
var slot2Final = finalBooking.workerAssignments.find(s => s.slotId === 'slot_2');
assert(slot2Final.assignedProId === 'pro_jamar' && slot2Final.status === 'assigned',
  '10B: Jamar Washington assigned to slot_2 with assigned status');

console.log('\n==================================================================');
console.log(`FINAL RESULTS: ${passed} of ${passed + failed} assertions passed (${Math.round((passed / Math.max(1, passed + failed)) * 100)}%).`);
console.log('==================================================================');

if (failed > 0) {
  throw new Error(`Test suite failed with ${failed} failures.`);
}
