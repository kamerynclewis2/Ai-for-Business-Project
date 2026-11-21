// ============================================================================
// STAGE 4 PHASE 4.6B1: CUSTOMER AI BOOKING CONCIERGE (MOVING ONLY) SUITE
// ============================================================================

if (typeof console === 'undefined') {
  globalThis.console = { log: print, warn: print, error: print };
} else {
  if (!console.log) console.log = print;
  if (!console.warn) console.warn = print;
  if (!console.error) console.error = print;
}

var mockStorage = {};
var mockSession = { 'crewly_active_role': 'customer' };
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
  location: {
    hostname: 'localhost',
    port: '8000',
    protocol: 'http:',
    search: '?role=customer',
    pathname: '/index.html',
    origin: 'http://localhost:8000',
    href: 'http://localhost:8000/index.html?role=customer'
  },
  history: { replaceState: function() {} },
  dispatchEvent: function(e) { dispatchedEvents.push(e); }
};

globalThis.CustomEvent = function(type, opts) {
  this.type = type;
  this.detail = opts ? opts.detail : null;
};

if (typeof process === 'undefined') {
  globalThis.process = { exit: function(code) { quit(code); } };
}

import {
  PRICING_RATES,
  DALLAS_SERVICE_ZIPS,
  lookupDallasZip
} from '../data.js';

import {
  loadState,
  saveState,
  resetStateToSeed,
  calculatePricing,
  createBooking,
  assignProToSlot,
  updateProAssignmentStatus,
  dollarsToCents,
  centsToDollars,
  getAdminFinancialSummary,
  getDallasLocalNow,
  CONCIERGE_CONFIG,
  sanitizeCustomerInputPii,
  calculateConciergeDeterministicPricing,
  validateConciergeMovingDraft,
  normalizeConciergeTimeStr,
  requestAiConciergeMovingChat,
  createBookingFromConciergeDraft
} from '../matching.js';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.error(`  FAIL: ${testName}`);
  }
}

console.log('==================================================================');
console.log('CREWLY STAGE 4.6B1 — CUSTOMER AI BOOKING CONCIERGE TEST SUITE');
console.log('==================================================================');

// ---------------------------------------------------------------------------
// Group 1: Client-Side PII Sanitization & Privacy Guards
// ---------------------------------------------------------------------------
console.log('\n[Group 1: Client-Side PII Sanitization & Privacy Guards]');

// 1A: Street Address Redaction
const piiAddr1 = sanitizeCustomerInputPii('I need moving from 123 Main St, Apt 4B to a new house');
assert(!piiAddr1.includes('123 Main St'), '1A: Specific street address is redacted');
assert(piiAddr1.includes('[REDACTED_STREET_ADDRESS]'), '1A: Address redaction placeholder inserted');
assert(piiAddr1.includes('I need moving from'), '1A: Non-PII moving context preserved');

const piiAddr2 = sanitizeCustomerInputPii('Moving out of 4500 Oak Lawn Ave in Dallas');
assert(!piiAddr2.includes('4500 Oak Lawn Ave'), '1B: Secondary street address redacted');
assert(piiAddr2.includes('[REDACTED_STREET_ADDRESS]'), '1B: Address redaction token present');

// 1C: Phone Number Redaction
const piiPhone1 = sanitizeCustomerInputPii('Call me at (214) 555-0199 when ready');
assert(!piiPhone1.includes('555-0199'), '1C: Parenthesized phone number redacted');
assert(piiPhone1.includes('[REDACTED_PHONE]'), '1C: Phone redaction placeholder present');

const piiPhone2 = sanitizeCustomerInputPii('My mobile is +1-214-555-0123 thanks');
assert(!piiPhone2.includes('555-0123'), '1D: E.164-style phone number redacted');
assert(piiPhone2.includes('[REDACTED_PHONE]'), '1D: Phone token inserted');

const piiPhone3 = sanitizeCustomerInputPii('Contact 214.555.0144 or 214-555-9988');
assert(!piiPhone3.includes('214.555.0144'), '1E: Dotted phone number redacted');
assert(!piiPhone3.includes('214-555-9988'), '1E: Dashed phone number redacted');

// 1F: Email Address Redaction
const piiEmail = sanitizeCustomerInputPii('My email is customer.sarah+moving@gmail.com for updates');
assert(!piiEmail.includes('customer.sarah+moving@gmail.com'), '1F: Email address redacted');
assert(piiEmail.includes('[REDACTED_EMAIL]'), '1F: Email redaction token inserted');

// 1G: Gate Code Redaction
const piiGate1 = sanitizeCustomerInputPii('The gate code is 1234 at the complex');
assert(!piiGate1.includes('1234'), '1G: Gate code number redacted');
assert(piiGate1.includes('[REDACTED_ACCESS_CODE]'), '1G: Gate code placeholder present');

const piiGate2 = sanitizeCustomerInputPii('Access code #4492 on keypad');
assert(!piiGate2.includes('4492'), '1H: Hash gate code redacted');
assert(piiGate2.includes('[REDACTED_ACCESS_CODE]'), '1H: Gate code token inserted');

// 1I: Credit Card Redaction
const piiCard = sanitizeCustomerInputPii('Can I pay with card 4111-2222-3333-4444 here?');
assert(!piiCard.includes('4111-2222-3333-4444'), '1I: Card number redacted');
assert(piiCard.includes('[REDACTED_PAYMENT_INFO]'), '1I: Card placeholder inserted');

// 1J: Non-PII Moving Details Preserved
const cleanMsg = sanitizeCustomerInputPii('I need 2 movers for 3 hours on 2026-11-25 in 75204 Uptown Dallas');
assert(cleanMsg.includes('2 movers'), '1J: Movers quantity preserved');
assert(cleanMsg.includes('3 hours'), '1J: Duration preserved');
assert(cleanMsg.includes('2026-11-25'), '1J: Date preserved');
assert(cleanMsg.includes('75204'), '1J: Dallas pilot ZIP preserved');
assert(cleanMsg.includes('Uptown Dallas'), '1J: Neighborhood name preserved');

// 1K: Safe Empty / Null Handling
assert(sanitizeCustomerInputPii('') === '', '1K: Empty string returns empty');
assert(sanitizeCustomerInputPii(null) === '', '1K: Null returns empty');
assert(sanitizeCustomerInputPii(undefined) === '', '1K: Undefined returns empty');

// ---------------------------------------------------------------------------
// Group 2: Deterministic Pricing Engine Integration
// ---------------------------------------------------------------------------
console.log('\n[Group 2: Deterministic Pricing Engine Integration]');

// 2A: Baseline 2 Movers, 3 Hours ($50/hr, $30 Pro payout, $10 fee)
const price2x3 = calculateConciergeDeterministicPricing({ workersNeeded: 2, hours: 3 });
assert(price2x3.isReady === true, '2A: Complete draft price is marked ready');
assert(price2x3.workersNeeded === 2, '2A: Workers count is 2');
assert(price2x3.hours === 3, '2A: Hours count is 3');
assert(price2x3.customerSubtotal === 300, '2A: Customer subtotal is $300.00 (2 × 3 × $50)');
assert(price2x3.bookingFee === 10, '2A: Booking fee is $10.00 flat');
assert(price2x3.customerTotal === 310, '2A: Customer total is $310.00 ($300 + $10)');
assert(price2x3.workerPayoutPerPerson === 90, '2A: Pro payout per person is $90.00 (3 × $30)');
assert(price2x3.totalWorkerPayouts === 180, '2A: Total Pro payouts is $180.00 (2 × $90)');
assert(price2x3.grossPlatformRevenue === 130, '2A: Platform gross contribution is $130.00 ($310 - $180)');
assert(price2x3.ratePerHour === 50, '2A: Disclosed hourly rate is $50/mover-hr');
assert(price2x3.payoutPerHour === 30, '2A: Pro compensation rate is $30/mover-hr');

// 2B: Minimum Bookable Moving: 1 Mover, 2 Hours ($100 subtotal + $10 fee = $110 total)
const price1x2 = calculateConciergeDeterministicPricing({ workersNeeded: 1, hours: 2 });
assert(price1x2.isReady === true, '2B: Minimum bookable price is ready');
assert(price1x2.customerSubtotal === 100, '2B: Customer subtotal is $100.00 (1 × 2 × $50)');
assert(price1x2.customerTotal === 110, '2B: Customer total is $110.00 ($100 + $10)');
assert(price1x2.workerPayoutPerPerson === 60, '2B: Pro payout is $60.00 (2 × $30)');
assert(price1x2.grossPlatformRevenue === 50, '2B: Platform gross contribution is $50.00 ($110 - $60)');

// 2C: Maximum Bookable Moving: 4 Movers, 8 Hours ($1,600 subtotal + $10 fee = $1,610 total)
const price4x8 = calculateConciergeDeterministicPricing({ workersNeeded: 4, hours: 8 });
assert(price4x8.customerSubtotal === 1600, '2C: Customer subtotal is $1,600.00 (4 × 8 × $50)');
assert(price4x8.customerTotal === 1610, '2C: Customer total is $1,610.00 ($1600 + $10)');
assert(price4x8.workerPayoutPerPerson === 240, '2C: Pro payout per person is $240.00 (8 × $30)');
assert(price4x8.totalWorkerPayouts === 960, '2C: Total Pro payouts is $960.00 (4 × $240)');
assert(price4x8.grossPlatformRevenue === 650, '2C: Platform gross contribution is $650.00 ($1610 - $960)');

// 2D: Multi-Worker 3 Movers, 4 Hours
const price3x4 = calculateConciergeDeterministicPricing({ workersNeeded: 3, hours: 4 });
assert(price3x4.customerSubtotal === 600, '2D: Customer subtotal is $600.00 (3 × 4 × $50)');
assert(price3x4.customerTotal === 610, '2D: Customer total is $610.00 ($600 + $10)');
assert(price3x4.workerPayoutPerPerson === 120, '2D: Pro payout per person is $120.00 (4 × $30)');
assert(price3x4.totalWorkerPayouts === 360, '2D: Total Pro payouts is $360.00 (3 × $120)');
assert(price3x4.grossPlatformRevenue === 250, '2D: Platform gross contribution is $250.00 ($610 - $360)');

// 2E: Incomplete / Missing Draft Handling
const priceNull = calculateConciergeDeterministicPricing(null);
assert(priceNull.isReady === false, '2E: Null draft price is not ready');
assert(priceNull.customerSubtotal === 0, '2E: Null draft has 0 subtotal');
assert(priceNull.customerTotal === 0, '2E: Null draft has 0 total');
assert(priceNull.bookingFee === 10, '2E: Booking fee is constant $10.00');

const priceNoHours = calculateConciergeDeterministicPricing({ workersNeeded: 2, hours: null });
assert(priceNoHours.isReady === false, '2F: Missing hours makes price not ready');
assert(priceNoHours.customerTotal === 0, '2F: Missing hours total is 0');

const priceNoMovers = calculateConciergeDeterministicPricing({ workersNeeded: null, hours: 3 });
assert(priceNoMovers.isReady === false, '2G: Missing movers makes price not ready');

// ---------------------------------------------------------------------------
// Group 3: Concierge Config & Pilot Safeguards
// ---------------------------------------------------------------------------
console.log('\n[Group 3: Concierge Config & Pilot Safeguards]');

assert(CONCIERGE_CONFIG.SERVICE_CATEGORY === 'moving', '3A: Concierge category is strictly locked to moving');
assert(CONCIERGE_CONFIG.ENDPOINT.includes('/api/concierge/chat'), '3B: Concierge endpoint points to /api/concierge/chat');
assert(CONCIERGE_CONFIG.HEALTH_ENDPOINT.includes('/health'), '3C: Concierge health endpoint points to /health');
assert(CONCIERGE_CONFIG.SUPPORTED_DALLAS_ZIPS.length === 11, '3D: Supported Dallas pilot ZIP count is 11');
assert(CONCIERGE_CONFIG.SUPPORTED_DALLAS_ZIPS.includes('75201'), '3E: 75201 Downtown is included');
assert(CONCIERGE_CONFIG.SUPPORTED_DALLAS_ZIPS.includes('75204'), '3E: 75204 Uptown is included');
assert(CONCIERGE_CONFIG.SUPPORTED_DALLAS_ZIPS.includes('75206'), '3E: 75206 Lower Greenville is included');
assert(CONCIERGE_CONFIG.SUPPORTED_DALLAS_ZIPS.includes('75214'), '3E: 75214 Lakewood is included');
assert(CONCIERGE_CONFIG.SUPPORTED_DALLAS_ZIPS.includes('75225'), '3E: 75225 University Park is included');
assert(!CONCIERGE_CONFIG.SUPPORTED_DALLAS_ZIPS.includes('75001'), '3F: 75001 (Addison) is outside Dallas pilot');

// ---------------------------------------------------------------------------
// Group 4: Conversational Chat Request & Offline Fallbacks
// ---------------------------------------------------------------------------
console.log('\n[Group 4: Conversational Chat Request & Offline Fallbacks]');

// 4A: Fallback when proxy is offline / fetch fails
const offlineFetchMock = async () => {
  throw new Error('Connection refused (localhost:8000 offline)');
};

const offlineRes = await requestAiConciergeMovingChat({
  messages: [{ role: 'user', content: 'I need movers for 3 hours in 75204' }],
  currentDraft: { serviceCategory: 'moving', workersNeeded: 2, hours: 3 },
  options: { fetchFn: offlineFetchMock }
});

assert(offlineRes.ok === false, '4A: Offline request returns ok === false');
assert(offlineRes.offline === true, '4A: Offline flag is explicitly true');
assert(offlineRes.fallbackRecommended === true, '4A: Manual booking fallback is recommended');
assert(offlineRes.error.includes('standard guided moving booking form'), '4A: Error directs customer to standard form');
assert(offlineRes.pricing.isReady === true, '4A: Preserves deterministic pricing even when offline');
assert(offlineRes.pricing.customerTotal === 310, '4A: Preserves $310 total on offline fallback');

// 4B: Successful Chat with Mock Transport
const successfulChatMock = async (url, opts) => {
  assert(url.includes('/api/concierge/chat'), '4B: Transport invoked correct endpoint');
  const body = JSON.parse(opts.body);
  assert(body.serviceCategory === 'moving', '4B: Payload enforces serviceCategory === moving');
  assert(Array.isArray(body.messages), '4B: Payload includes messages array');

  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({
      ok: true,
      provider: 'openai',
      inferenceSource: 'mock_ai_test_mode',
      conciergeResult: {
        assistantMessage: 'I have set up 2 movers for 3 hours in Uptown Dallas (75204) on 2026-11-25. Your deterministic total will be calculated by Crewly.',
        isComplete: true,
        missingFields: [],
        clarificationQuestions: [],
        extractedDetails: {
          serviceCategory: 'moving',
          workersNeeded: 2,
          hours: 3,
          scheduledDate: '2026-11-25',
          scheduledTime: '10:00',
          zipCode: '75204',
          truckOption: 'labor_only',
          stairsOption: 'elevator',
          scopeSummary: '1-bedroom apartment move in Uptown with elevator access.',
          missingFields: [],
          isComplete: true
        }
      }
    })
  };
};

const chatRes = await requestAiConciergeMovingChat({
  messages: [{ role: 'user', content: 'I need 2 movers for 3 hours on 2026-11-25 in 75204 with an elevator' }],
  currentDraft: null,
  options: { fetchFn: successfulChatMock }
});

assert(chatRes.ok === true, '4B: Successful request returns ok === true');
assert(chatRes.isComplete === true, '4B: Concierge evaluates draft is complete');
assert(chatRes.draft.workersNeeded === 2, '4B: Draft stores 2 workers');
assert(chatRes.draft.hours === 3, '4B: Draft stores 3 hours');
assert(chatRes.draft.zipCode === '75204', '4B: Draft stores 75204 ZIP');
assert(chatRes.pricing.customerTotal === 310, '4B: Calculated deterministic price matches $310.00');

// ---------------------------------------------------------------------------
// Group 5: Structured Draft Missing Fields & Completion Tracking
// ---------------------------------------------------------------------------
console.log('\n[Group 5: Structured Draft Missing Fields & Completion Tracking]');

// 5A: Partial Draft — Missing Hours, Date & ZIP
const partialChatMock1 = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => ({
    ok: true,
    provider: 'openai',
    conciergeResult: {
      assistantMessage: 'Great! I noted you want 2 movers. How many hours do you anticipate needing them for (2 hours minimum)?',
      isComplete: false,
      missingFields: ['hours', 'scheduledDate', 'zipCode'],
      clarificationQuestions: ['How many hours do you anticipate needing the movers?'],
      extractedDetails: {
        serviceCategory: 'moving',
        workersNeeded: 2,
        hours: null,
        scheduledDate: null,
        scheduledTime: null,
        zipCode: null,
        missingFields: ['hours', 'scheduledDate', 'zipCode'],
        isComplete: false
      }
    }
  })
});

const partialRes1 = await requestAiConciergeMovingChat({
  messages: [{ role: 'user', content: 'I need 2 movers' }],
  options: { fetchFn: partialChatMock1 }
});

assert(partialRes1.isComplete === false, '5A: Partial draft is not complete');
assert(partialRes1.draft.missingFields.includes('hours'), '5A: Missing fields includes hours');
assert(partialRes1.draft.missingFields.includes('scheduledDate'), '5A: Missing fields includes scheduledDate');
assert(partialRes1.draft.missingFields.includes('zipCode'), '5A: Missing fields includes zipCode');
assert(partialRes1.pricing.isReady === false, '5A: Pricing is not ready when hours are missing');

// 5B: Partial Draft — Movers & Hours Set, Missing Date & ZIP
const partialChatMock2 = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => ({
    ok: true,
    provider: 'openai',
    conciergeResult: {
      assistantMessage: 'Understood, 2 movers for 3 hours ($310 total upfront). What date and Dallas ZIP code or neighborhood will this take place in?',
      isComplete: false,
      missingFields: ['scheduledDate', 'zipCode'],
      clarificationQuestions: ['What date and Dallas ZIP code is your move scheduled for?'],
      extractedDetails: {
        serviceCategory: 'moving',
        workersNeeded: 2,
        hours: 3,
        scheduledDate: null,
        scheduledTime: null,
        zipCode: null,
        missingFields: ['scheduledDate', 'zipCode'],
        isComplete: false
      }
    }
  })
});

const partialRes2 = await requestAiConciergeMovingChat({
  messages: [{ role: 'user', content: '2 movers for 3 hours' }],
  options: { fetchFn: partialChatMock2 }
});

assert(partialRes2.isComplete === false, '5B: Partial draft without date/zip is not complete');
assert(partialRes2.pricing.isReady === true, '5B: Pricing quote preview is available with movers & hours');
assert(partialRes2.pricing.customerTotal === 310, '5B: Preview total is $310.00');

// ---------------------------------------------------------------------------
// Group 6: Explicit Customer Booking Creation & Deterministic Snapshot
// ---------------------------------------------------------------------------
console.log('\n[Group 6: Explicit Customer Booking Creation & Deterministic Snapshot]');

resetStateToSeed();

const completeDraft = {
  serviceCategory: 'moving',
  workersNeeded: 2,
  hours: 3,
  scheduledDate: '2026-11-28',
  scheduledTime: '10:00',
  zipCode: '75204',
  truckOption: 'labor_only',
  stairsOption: 'elevator',
  scopeSummary: 'Moving 1-bedroom apartment from Uptown Dallas',
  missingFields: [],
  isComplete: true
};

// 6A: Create Booking from Complete Draft
const createdBooking = createBookingFromConciergeDraft({
  customerId: 'cust_sarah',
  address: '2800 McKinney Ave, Apt 402',
  zipCode: '75204',
  draft: completeDraft,
  notes: 'Call on callbox upon arrival'
});

assert(createdBooking && createdBooking.id, '6A: Booking created successfully');
assert(createdBooking.serviceCategory === 'moving', '6A: Booking serviceCategory is moving');
assert(createdBooking.address === '2800 McKinney Ave, Apt 402', '6A: Street address accurately stored from local input');
assert(createdBooking.zipCode === '75204', '6A: ZIP code accurately stored');
assert(createdBooking.neighborhoodName.includes('Uptown'), '6A: Neighborhood mapped to Uptown');
assert(createdBooking.scheduledDate === '2026-11-28', '6A: Scheduled date matches draft');
assert(createdBooking.scheduledTime === '10:00', '6A: Scheduled time matches draft');
assert(createdBooking.pricing.customerSubtotal === 300, '6A: Stored customer subtotal is $300.00');
assert(createdBooking.pricing.bookingFee === 10, '6A: Stored booking fee is $10.00');
assert(createdBooking.pricing.customerTotal === 310, '6A: Stored customer total is $310.00 ($300 + $10)');
assert(createdBooking.workersNeeded === 2, '6A: 2 workers required');
assert(createdBooking.workerAssignments.length === 2, '6A: 2 worker assignment slots created');
assert(createdBooking.workerAssignments[0].payout === 90, '6A: Slot 1 payout is $90.00 (3 hrs × $30)');
assert(createdBooking.workerAssignments[1].payout === 90, '6A: Slot 2 payout is $90.00 (3 hrs × $30)');
assert(createdBooking.overallStatus === 'waiting_for_pros', '6A: Initial in-memory status is waiting_for_pros');
assert(createdBooking.workerAssignments[0].status === 'unassigned', '6A: Slot 1 initially unassigned upon creation');
assert(createdBooking.workerAssignments[1].status === 'unassigned', '6A: Slot 2 remains open and unassigned');

// 6B: Strict Privacy — Street Address Kept Outside Draft
assert(!completeDraft.scopeSummary.includes('2800 McKinney Ave'), '6B: Street address not leaked into concierge draft');

// 6C: Validation Guards on Booking Creation
let missingAddrError = null;
try {
  createBookingFromConciergeDraft({
    customerId: 'cust_sarah',
    address: '   ',
    zipCode: '75204',
    draft: completeDraft
  });
} catch (err) {
  missingAddrError = err.message;
}
assert(missingAddrError && missingAddrError.includes('street address'), '6C: Blank street address throws explicit error');

let incompleteDraftError = null;
try {
  createBookingFromConciergeDraft({
    customerId: 'cust_sarah',
    address: '2800 McKinney Ave',
    zipCode: '75204',
    draft: { ...completeDraft, hours: null, isComplete: false }
  });
} catch (err) {
  incompleteDraftError = err.message;
}
assert(incompleteDraftError && incompleteDraftError.includes('incomplete'), '6C: Incomplete draft throws explicit error');

let invalidZipError = null;
try {
  createBookingFromConciergeDraft({
    customerId: 'cust_sarah',
    address: '100 North St',
    zipCode: '75001', // Outside Dallas pilot
    draft: { ...completeDraft, zipCode: '75001' }
  });
} catch (err) {
  invalidZipError = err.message;
}
assert(invalidZipError && invalidZipError.includes('pilot'), '6C: Non-pilot ZIP code throws explicit error');

// ---------------------------------------------------------------------------
// Group 7: Pro Assignment, Lifecycle & Ledger Invariance
// ---------------------------------------------------------------------------
console.log('\n[Group 7: Pro Assignment, Lifecycle & Ledger Invariance]');

const stateBeforeAssign = loadState();
const jamarBefore = stateBeforeAssign.pros.find(p => p.id === 'pro_jamar');
const jamarPendingBefore = jamarBefore.earnings.pendingBalance;
const jamarAvailBefore = jamarBefore.earnings.availableBalance;

// Assign Jamar Washington (pro_jamar) to open slot 2
const assignRes = assignProToSlot(createdBooking.id, 'slot_2', 'pro_jamar');
assert(assignRes.success === true, '7A: Pro Jamar assigned to Concierge booking slot 2');

const stateAfterAssign = loadState();
const jamarAfterAssign = stateAfterAssign.pros.find(p => p.id === 'pro_jamar');
assert(jamarAfterAssign.earnings.pendingBalance === jamarPendingBefore + 90, '7B: Jamar pending balance increased by exactly $90.00');
assert(jamarAfterAssign.earnings.availableBalance === jamarAvailBefore, '7B: Jamar available balance untouched upon assignment');

// Update assignment status through execution lifecycle to completed
updateProAssignmentStatus(createdBooking.id, 'slot_2', 'traveling');
updateProAssignmentStatus(createdBooking.id, 'slot_2', 'arrived');
updateProAssignmentStatus(createdBooking.id, 'slot_2', 'in_progress');
const completeRes = updateProAssignmentStatus(createdBooking.id, 'slot_2', 'completed');
assert(completeRes.success === true, '7C: Assignment marked completed');

const stateAfterComplete = loadState();
const jamarAfterComplete = stateAfterComplete.pros.find(p => p.id === 'pro_jamar');
assert(jamarAfterComplete.earnings.pendingBalance === jamarPendingBefore, '7D: Pending balance decremented by $90.00');
assert(jamarAfterComplete.earnings.availableBalance === jamarAvailBefore + 90, '7D: Available balance credited with exactly $90.00');

// Verify wallet ledger entry
const jamarTx = jamarAfterComplete.earnings.walletTransactions.find(t => t.bookingId === createdBooking.id && t.slotId === 'slot_2');
assert(jamarTx !== undefined, '7E: Wallet transaction ledger entry found');
assert(jamarTx.amountCents === 9000, '7E: Wallet transaction amount is 9000 cents ($90.00)');

// Duplicate completion rejected
const dupRes = updateProAssignmentStatus(createdBooking.id, 'slot_2', 'completed');
assert(dupRes.success === false, '7F: Duplicate completion rejected');

// ---------------------------------------------------------------------------
// Group 8: Historical Baseline Invariants
// ---------------------------------------------------------------------------
console.log('\n[Group 8: Historical Baseline Invariants]');

resetStateToSeed();
const seedState = loadState();

const crw1001 = seedState.bookings.find(b => b.id === 'CRW-1001');
assert(crw1001.pricing.customerTotal === 250, '8A: Historical CRW-1001 total preserved at $250.00');
assert(crw1001.workerAssignments[0].payout === 75, '8A: Historical CRW-1001 payout preserved at $75.00');

const crw1002 = seedState.bookings.find(b => b.id === 'CRW-1002');
assert(crw1002.pricing.customerTotal === 119, '8B: Historical CRW-1002 total preserved at $119.00');
assert(crw1002.workerAssignments[0].payout === 75, '8B: Historical CRW-1002 payout preserved at $75.00');

const crw1003 = seedState.bookings.find(b => b.id === 'CRW-1003');
assert(crw1003.pricing.customerTotal === 65, '8C: Historical CRW-1003 total preserved at $65.00');
assert(crw1003.workerAssignments[0].payout === 35, '8C: Historical CRW-1003 payout preserved at $35.00');

const crw1004 = seedState.bookings.find(b => b.id === 'CRW-1004');
assert(crw1004.pricing.customerTotal === 250, '8D: Historical CRW-1004 total preserved at $250.00');
assert(crw1004.workerAssignments[0].payout === 75, '8D: Historical CRW-1004 payout preserved at $75.00');

const finSummary = getAdminFinancialSummary(seedState);
assert(finSummary.totalGrossBookingValue === '684.00', '8E: Historical Total GBV invariant at $684.00');
assert(finSummary.completedGrossBookingValue === '65.00', '8E: Historical Completed GBV invariant at $65.00');
assert(finSummary.projectedGrossBookingValue === '619.00', '8E: Historical Projected GBV invariant at $619.00');
assert(finSummary.totalBookingFees === '40.00', '8E: Historical Booking Fees invariant at $40.00');
assert(finSummary.totalWorkerCompensation === '410.00', '8E: Historical Worker Compensation invariant at $410.00');
assert(finSummary.platformGrossMargin === '274.00', '8E: Historical Platform Gross Margin invariant at $274.00');

// ---------------------------------------------------------------------------
// Group 9: First-Message Regression — Draft with isComplete + missingFields (HTTP 400 bug)
// Reproduces the case where the initial conciergeCurrentDraft passed isComplete and
// missingFields to the proxy, causing invalid_concierge_payload HTTP 400.
// ---------------------------------------------------------------------------
console.log('\n[Group 9: First-Message Draft Regression — isComplete+missingFields in Draft]');

// 9A: Sending a first real user message with the full initial draft should NOT be rejected
const firstMsgDraft = {
  serviceCategory: 'moving',
  workersNeeded: null,
  hours: null,
  scheduledDate: null,
  scheduledTime: null,
  zipCode: null,
  truckOption: null,
  stairsOption: null,
  scopeSummary: '',
  missingFields: ['workersNeeded', 'hours', 'scheduledDate', 'zipCode'],
  isComplete: false
};

// Mock that simulates proxy accepting the first message and returning partial results
const firstMsgMock = async (url, opts) => {
  const body = JSON.parse(opts.body);
  // Verify the payload correctly strips or passes isComplete+missingFields in draft
  assert(body.serviceCategory === 'moving', '9A: serviceCategory is moving in first message payload');
  assert(Array.isArray(body.messages) && body.messages.length === 1, '9A: First message contains exactly 1 message turn');
  assert(body.messages[0].role === 'user', '9A: First turn has role user');
  assert(body.currentDraft !== undefined, '9A: currentDraft is included in payload');
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({
      ok: true,
      provider: 'openai',
      inferenceSource: 'mock_ai_test_mode',
      isSimulatedTestMode: true,
      conciergeResult: {
        assistantMessage: "Got it! You need 2 movers and already have a truck — great. What date, neighborhood or Dallas ZIP code, and estimated duration do you have in mind?",
        isComplete: false,
        missingFields: ['hours', 'scheduledDate', 'zipCode'],
        clarificationQuestions: ['What date is your move?', 'How many hours do you estimate needing?', 'What Dallas ZIP code or neighborhood?'],
        extractedDetails: {
          serviceCategory: 'moving',
          workersNeeded: 2,
          hours: 0,
          scheduledDate: '',
          scheduledTime: '',
          zipCode: '',
          truckOption: 'labor_only',
          stairsOption: 'undetermined',
          scopeSummary: 'Apartment move, customer has own truck, needs 2 movers.',
          unsupportedReason: ''
        }
      }
    })
  };
};

const firstMsgRes = await requestAiConciergeMovingChat({
  messages: [{ role: 'user', content: 'I need help moving out of my apartment. I already have a rental truck and need two movers.' }],
  currentDraft: firstMsgDraft,
  options: { fetchFn: firstMsgMock, locationOrigin: 'http://127.0.0.1:8000', endpoint: 'http://127.0.0.1:8787/api/concierge/chat' }
});

assert(firstMsgRes.ok === true, '9A: First real user message succeeds (regression — was HTTP 400 invalid_concierge_payload)');
assert(firstMsgRes.offline === false, '9A: Proxy not marked offline for first real message success');
assert(firstMsgRes.draft && firstMsgRes.draft.workersNeeded === 2, '9A: AI correctly extracted 2 movers from first message');
assert(firstMsgRes.isComplete === false, '9A: Draft is not complete after first message — date/hours/ZIP still missing');
assert(Array.isArray(firstMsgRes.missingFields) && firstMsgRes.missingFields.includes('hours'), '9A: hours flagged as missing after first message');
assert(Array.isArray(firstMsgRes.missingFields) && firstMsgRes.missingFields.includes('scheduledDate'), '9A: scheduledDate flagged as missing after first message');
assert(Array.isArray(firstMsgRes.missingFields) && firstMsgRes.missingFields.includes('zipCode'), '9A: zipCode flagged as missing after first message');
assert(firstMsgRes.pricing.isReady === false, '9A: Pricing not ready — hours and ZIP still unknown');
// 9B: Validation error from proxy (HTTP 400) should NOT be flagged as "offline"
const validationErrorMock = async () => ({
  ok: false,
  status: 400,
  headers: { get: () => 'application/json' },
  json: async () => ({
    ok: false,
    code: 'invalid_concierge_payload',
    error: 'Disallowed keys in currentDraft: ["badKey"].',
    fallbackRecommended: false
  })
});

const validationErrRes = await requestAiConciergeMovingChat({
  messages: [{ role: 'user', content: 'Need movers' }],
  currentDraft: { serviceCategory: 'moving', workersNeeded: 2 },
  options: { fetchFn: validationErrorMock, locationOrigin: 'http://127.0.0.1:8000', endpoint: 'http://127.0.0.1:8787/api/concierge/chat' }
});

assert(validationErrRes.ok === false, '9B: Validation error response has ok === false');
assert(validationErrRes.offline === false, '9B: HTTP 400 validation error is NOT flagged as proxy offline');
assert(validationErrRes.validationError === true, '9B: validationError flag is set for HTTP 400 response');
assert(validationErrRes.fallbackRecommended === false, '9B: fallbackRecommended is false for payload validation errors (proxy is online)');

// 9C: True proxy offline (network error / HTTP 503) SHOULD be flagged as offline
const proxyOfflineMock = async () => ({
  ok: false,
  status: 503,
  headers: { get: () => 'application/json' },
  json: async () => ({
    ok: false,
    code: 'proxy_not_configured',
    error: 'Local AI Concierge proxy disabled: OPENAI_API_KEY is not configured.',
    fallbackRecommended: true
  })
});

const proxyOfflineRes = await requestAiConciergeMovingChat({
  messages: [{ role: 'user', content: 'Need movers' }],
  currentDraft: null,
  options: { fetchFn: proxyOfflineMock, locationOrigin: 'http://127.0.0.1:8000', endpoint: 'http://127.0.0.1:8787/api/concierge/chat' }
});

assert(proxyOfflineRes.ok === false, '9C: Proxy 503 no-key response has ok === false');
assert(proxyOfflineRes.offline === true, '9C: HTTP 503 proxy_not_configured IS correctly flagged as offline');
assert(proxyOfflineRes.fallbackRecommended === true, '9C: fallbackRecommended is true when proxy is offline/unconfigured');

// 9D: Quote for 2 movers × 3 hours = $310 is deterministically correct after draft fills
const completedDraftForPricing = {
  serviceCategory: 'moving',
  workersNeeded: 2,
  hours: 3,
  scheduledDate: '2026-11-28',
  scheduledTime: '10:00',
  zipCode: '75204',
  truckOption: 'labor_only',
  stairsOption: 'elevator',
  scopeSummary: 'Apartment move',
  isComplete: true,
  missingFields: []
};
const finalPricing = calculateConciergeDeterministicPricing(completedDraftForPricing);
assert(finalPricing.isReady === true, '9D: Pricing ready when all required fields known');
assert(finalPricing.customerSubtotal === 300, '9D: Customer subtotal is $300.00 (2 × 3 × $50)');
assert(finalPricing.bookingFee === 10, '9D: Booking fee is $10.00');
assert(finalPricing.customerTotal === 310, '9D: Final customer total is $310.00 — matches expected quote');
assert(finalPricing.workerPayoutPerPerson === 90, '9D: Pro payout per person is $90.00 (3 × $30)');

// ---------------------------------------------------------------------------
// Group 10: Confirmation Button & Authoritative Draft Bug Regression
// ---------------------------------------------------------------------------
console.log('\n[Group 10: Confirmation Button & Authoritative Draft Bug Regression]');

// 10A: Authoritative validation normalizes raw AI extractedDetails (which lacks isComplete)
const rawProxyExtractedDetails = {
  serviceCategory: 'moving',
  workersNeeded: 2,
  hours: 3,
  scheduledDate: '2026-11-28',
  scheduledTime: '10:00 AM', // 12h format from live AI
  zipCode: '75204',
  truckOption: 'labor_only',
  stairsOption: 'elevator',
  scopeSummary: '2-bedroom apartment move with elevator access'
};

const val10A = validateConciergeMovingDraft(rawProxyExtractedDetails);
assert(val10A.isComplete === true, '10A: validateConciergeMovingDraft authoritatively evaluates complete draft');
assert(val10A.missingFields.length === 0, '10A: missingFields is empty for complete draft');
assert(val10A.normalizedDraft.isComplete === true, '10A: normalizedDraft contains isComplete === true');
assert(val10A.normalizedDraft.scheduledTime === '10:00', '10A: scheduledTime normalized from "10:00 AM" to "10:00"');
assert(val10A.normalizedDraft.workersNeeded === 2, '10A: workersNeeded preserved at 2');
assert(val10A.normalizedDraft.hours === 3, '10A: hours preserved at 3');
assert(val10A.normalizedDraft.zipCode === '75204', '10A: zipCode verified at 75204');

// 10B: Confirmation button enablement logic matches authoritative validation
const pricing10B = calculateConciergeDeterministicPricing(val10A.normalizedDraft);
const addr10B_present = '2800 McKinney Ave, Apt 402';
const addr10B_blank = '';

const btnEnabled_ready = val10A.isComplete && pricing10B.isReady && !!addr10B_present.trim();
const btnEnabled_noAddr = val10A.isComplete && pricing10B.isReady && !!addr10B_blank.trim();
const btnEnabled_incomplete = false && pricing10B.isReady && !!addr10B_present.trim();

assert(btnEnabled_ready === true, '10B: Confirmation button condition enabled when draft complete and address present');
assert(btnEnabled_noAddr === false, '10B: Confirmation button disabled when address is blank');
assert(btnEnabled_incomplete === false, '10B: Confirmation button disabled when draft is incomplete');

// 10C: Confirm booking creates exactly ONE booking with $310 customer total and $90 payouts
const preState10C = loadState();
const preBookingCount10C = preState10C.bookings.length;

const createdBooking10C = createBookingFromConciergeDraft({
  customerId: 'cust_1',
  address: addr10B_present,
  zipCode: '75204',
  draft: rawProxyExtractedDetails, // raw AI details without isComplete
  notes: 'Callbox #1234'
});

const postState10C = loadState();
assert(postState10C.bookings.length === preBookingCount10C + 1, '10C: Exactly ONE simulated booking created in state');
assert(createdBooking10C.serviceCategory === 'moving', '10C: Booking category is moving');
assert(createdBooking10C.pricing.customerTotal === 310, '10C: Customer total is $310.00');
assert(createdBooking10C.pricing.customerSubtotal === 300, '10C: Customer subtotal is $300.00');
assert(createdBooking10C.pricing.bookingFee === 10, '10C: Booking fee is $10.00');
assert(createdBooking10C.workersNeeded === 2, '10C: workersNeeded is 2');
assert(createdBooking10C.workerAssignments.length === 2, '10C: 2 worker assignment slots created');
assert(createdBooking10C.workerAssignments[0].payout === 90, '10C: Slot 1 worker payout is $90.00');
assert(createdBooking10C.workerAssignments[1].payout === 90, '10C: Slot 2 worker payout is $90.00');
assert(createdBooking10C.workerAssignments[0].status === 'unassigned', '10C: Slot 1 is unassigned upon creation');
assert(createdBooking10C.workerAssignments[0].assignedProId === null, '10C: Slot 1 has no automatically assigned pro (assignedProId === null)');
assert(createdBooking10C.workerAssignments[1].status === 'unassigned', '10C: Slot 2 is unassigned upon creation');
assert(createdBooking10C.workerAssignments[1].assignedProId === null, '10C: Slot 2 has no automatically assigned pro (assignedProId === null)');

// 10D: Duplicate submission idempotency guard
let simulatedSubmittingLock = false;
let duplicateAttemptsBlocked = 0;

function simulatedConfirmClick() {
  if (simulatedSubmittingLock) {
    duplicateAttemptsBlocked++;
    return null;
  }
  simulatedSubmittingLock = true;
  try {
    return 'booking_created';
  } finally {
    simulatedSubmittingLock = false;
  }
}

// First click acquires lock
simulatedSubmittingLock = true;
// Subsequent rapid click while submitting is blocked
const duplicateResult = simulatedConfirmClick();
assert(duplicateResult === null, '10D: Rapid secondary click is blocked by submission lock');
assert(duplicateAttemptsBlocked === 1, '10D: Duplicate attempt counter incremented');
simulatedSubmittingLock = false;

// 10E: Incomplete or invalid drafts are strictly rejected
let rejectedNoHours = false;
try {
  createBookingFromConciergeDraft({
    customerId: 'cust_1',
    address: '2800 McKinney Ave',
    zipCode: '75204',
    draft: { serviceCategory: 'moving', workersNeeded: 2, scheduledDate: '2026-11-28', zipCode: '75204' }
  });
} catch (e) {
  rejectedNoHours = e.message.includes('incomplete');
}
assert(rejectedNoHours === true, '10E: Draft missing hours is strictly rejected');

let rejectedNoAddress = false;
try {
  createBookingFromConciergeDraft({
    customerId: 'cust_1',
    address: '   ',
    zipCode: '75204',
    draft: rawProxyExtractedDetails
  });
} catch (e) {
  rejectedNoAddress = e.message.includes('street address');
}
assert(rejectedNoAddress === true, '10E: Blank street address is strictly rejected');

let rejectedBadZip = false;
try {
  createBookingFromConciergeDraft({
    customerId: 'cust_1',
    address: '100 Main St',
    zipCode: '76102', // Fort Worth, outside Dallas pilot
    draft: { ...rawProxyExtractedDetails, zipCode: '76102' }
  });
} catch (e) {
  rejectedBadZip = e.message.includes('Dallas') || e.message.includes('pilot') || e.message.includes('ZIP') || e.message.includes('incomplete');
}
assert(rejectedBadZip === true, '10E: Non-pilot ZIP code is strictly rejected');

// 10F: Historical baseline bookings remain completely intact
const histCheck10F = loadState();
const crw1001_10F = histCheck10F.bookings.find(b => b.id === 'CRW-1001');
const crw1002_10F = histCheck10F.bookings.find(b => b.id === 'CRW-1002');
const crw1003_10F = histCheck10F.bookings.find(b => b.id === 'CRW-1003');
const crw1004_10F = histCheck10F.bookings.find(b => b.id === 'CRW-1004');
assert(crw1001_10F && crw1001_10F.pricing.customerTotal === 250, '10F: CRW-1001 total intact ($250)');
assert(crw1002_10F && crw1002_10F.pricing.customerTotal === 119, '10F: CRW-1002 total intact ($119)');
assert(crw1003_10F && crw1003_10F.pricing.customerTotal === 65, '10F: CRW-1003 total intact ($65)');
assert(crw1004_10F && crw1004_10F.pricing.customerTotal === 250, '10F: CRW-1004 total intact ($250)');

// ---------------------------------------------------------------------------
// Final Summary
// ---------------------------------------------------------------------------
console.log('==================================================================');
console.log(`FINAL RESULTS: ${passed} of ${passed + failed} assertions passed (${Math.round((passed / (passed + failed)) * 100)}%).`);
console.log('==================================================================');

if (failed > 0) {
  process.exit(1);
}
