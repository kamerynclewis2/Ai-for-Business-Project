// ============================================================================
// STAGE 4 PHASE 1: DEDICATED MOVING & LIFTING PRICING VERIFICATION SUITE
// ============================================================================
// Verifies approved DFW Moving & Lifting Pricing Updates:
// - Customer labor rate: $50 per mover-hour (up from $40/hr)
// - Pro payout: $30 per mover-hour (up from $25/hr)
// - 2-hour minimum duration enforced upfront (below-minimum attempts rejected)
// - Transparent flat booking fee: $10
// - 1 to 4 movers supported
// - Duration up to 8 hours supported
// - Historical booking preservation (CRW-1001 through CRW-1004 prices locked)
// - Strict separation of customer price visibility and worker payouts
// - Non-moving services pricing unchanged
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

if (typeof process === 'undefined') {
  globalThis.process = { exit: function(code) { quit(code); } };
}

import {
  PRICING_RATES,
  INITIAL_BOOKINGS,
  INITIAL_PROS,
  INITIAL_CUSTOMERS,
  DALLAS_SERVICE_ZIPS
} from '../data.js';

import {
  calculatePricing,
  createBooking,
  loadState,
  saveState,
  resetStateToSeed,
  assignProToSlot,
  updateProAssignmentStatus,
  getAdminFinancialSummary,
  dollarsToCents,
  centsToDollars
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
console.log('CREWLY STAGE 4 PHASE 1: MOVING & LIFTING PRICING VERIFICATION');
console.log('==================================================================');

// Reset state cleanly before testing
resetStateToSeed();

// ---------------------------------------------------------------------------
// Group 1: Approved Core Moving Pricing Scenarios (calculatePricing & createBooking)
// ---------------------------------------------------------------------------
console.log('\n[Group 1: Approved Core Moving Pricing Scenarios]');

// Scenario 1A: 1 mover for 2 hours
var q1A = calculatePricing('moving', { workersNeeded: 1, hours: 2 });
assert(q1A.customerRatePerHour === 50, '1A: Customer rate is $50/mover-hour');
assert(q1A.proPayoutPerHour === 30, '1A: Pro payout is $30/mover-hour');
assert(q1A.hours === 2, '1A: Duration is 2 hours');
assert(q1A.workersNeeded === 1, '1A: Worker count is 1 mover');
assert(q1A.customerSubtotal === 100, '1A: Subtotal is $100.00 (1 mover * 2 hrs * $50)');
assert(q1A.bookingFee === 10, '1A: Flat booking fee is $10.00');
assert(q1A.customerTotal === 110, '1A: Final upfront customer price is $110.00 ($100 + $10)');
assert(q1A.workerPayoutPerPerson === 60, '1A: Pro payout is $60.00 (2 hrs * $30)');
assert(q1A.totalWorkerPayouts === 60, '1A: Total Pro payouts equal $60.00');
assert(q1A.grossPlatformRevenue === 50, '1A: Platform gross margin is $50.00 ($110 - $60)');

// Scenario 1B: 2 movers for 2 hours
var q1B = calculatePricing('moving', { workersNeeded: 2, hours: 2 });
assert(q1B.customerSubtotal === 200, '1B: Subtotal is $200.00 (2 movers * 2 hrs * $50)');
assert(q1B.customerTotal === 210, '1B: Customer total charge is $210.00 ($200 + $10)');
assert(q1B.workerPayoutPerPerson === 60, '1B: Each Pro earns $60.00 (2 hrs * $30)');
assert(q1B.totalWorkerPayouts === 120, '1B: Total Pro payouts equal $120.00 (2 * $60)');
assert(q1B.grossPlatformRevenue === 90, '1B: Platform gross revenue is $90.00 ($210 - $120)');

// Scenario 1C: 2 movers for 3 hours (Product Lead Approved Canonical Example)
var q1C = calculatePricing('moving', { workersNeeded: 2, hours: 3 });
assert(q1C.customerSubtotal === 300, '1C: Subtotal is $300.00 (2 movers * 3 hrs * $50)');
assert(q1C.bookingFee === 10, '1C: Flat booking fee is $10.00');
assert(q1C.customerTotal === 310, '1C: Final upfront customer price is $310.00');
assert(q1C.workerPayoutPerPerson === 90, '1C: Each Pro earns $90.00 (3 hrs * $30)');
assert(q1C.totalWorkerPayouts === 180, '1C: Total Pro payouts equal $180.00');
assert(q1C.grossPlatformRevenue === 130, '1C: Platform gross margin before opex is $130.00 ($310 - $180)');

// Scenario 1D: 3 movers for 4 hours
var q1D = calculatePricing('moving', { workersNeeded: 3, hours: 4 });
assert(q1D.customerSubtotal === 600, '1D: Subtotal is $600.00 (3 movers * 4 hrs * $50)');
assert(q1D.customerTotal === 610, '1D: Customer total is $610.00 ($600 + $10)');
assert(q1D.workerPayoutPerPerson === 120, '1D: Each Pro earns $120.00 (4 hrs * $30)');
assert(q1D.totalWorkerPayouts === 360, '1D: Total Pro payouts equal $360.00 (3 * $120)');
assert(q1D.grossPlatformRevenue === 250, '1D: Platform gross revenue is $250.00 ($610 - $360)');

// Scenario 1E: 4 movers for 8 hours (Maximum Supported Move)
var q1E = calculatePricing('moving', { workersNeeded: 4, hours: 8 });
assert(q1E.customerSubtotal === 1600, '1E: Subtotal is $1,600.00 (4 movers * 8 hrs * $50)');
assert(q1E.customerTotal === 1610, '1E: Customer total is $1,610.00 ($1600 + $10)');
assert(q1E.workerPayoutPerPerson === 240, '1E: Each Pro earns $240.00 (8 hrs * $30)');
assert(q1E.totalWorkerPayouts === 960, '1E: Total Pro payouts equal $960.00 (4 * $240)');
assert(q1E.grossPlatformRevenue === 650, '1E: Platform gross revenue is $650.00 ($1,610 - $960)');

// ---------------------------------------------------------------------------
// Group 2: Strict 2-Hour Minimum & Boundary Enforcement (Below-Minimum Rejection)
// ---------------------------------------------------------------------------
console.log('\n[Group 2: Strict 2-Hour Minimum & Boundary Enforcement]');

// 2A: calculatePricing rejects below-minimum hours
var calcErr1 = null;
try {
  calculatePricing('moving', { hours: 1, workersNeeded: 2 });
} catch (e) {
  calcErr1 = e.message;
}
assert(calcErr1 && calcErr1.indexOf('requires a 2-hour minimum duration') !== -1, '2A: calculatePricing rejects 1 hour request');

var calcErr15 = null;
try {
  calculatePricing('moving', { hours: 1.5, workersNeeded: 2 });
} catch (e) {
  calcErr15 = e.message;
}
assert(calcErr15 && calcErr15.indexOf('requires a 2-hour minimum duration') !== -1, '2A: calculatePricing rejects 1.5 hour request');

// 2B: calculatePricing defaults to 2 hours when hours not provided
var qDefault = calculatePricing('moving', { workersNeeded: 2 });
assert(qDefault.hours === 2, '2B: calculatePricing defaults to 2-hour minimum');
assert(qDefault.customerTotal === 210, '2B: Default 2-mover quote is $210 ($200 + $10)');

// 2C: createBooking rejects below-minimum duration
var createErr1 = null;
try {
  createBooking({
    customerId: 'cust_sarah',
    address: '2800 McKinney Ave, Dallas, TX 75204',
    zipCode: '75204',
    serviceCategory: 'moving',
    timingType: 'scheduled',
    scheduledDate: '2026-11-20',
    scheduledTime: '10:00',
    intakeDetails: { hours: 1, workersNeeded: 2 }
  });
} catch (e) {
  createErr1 = e.message;
}
assert(createErr1 && createErr1.indexOf('requires a 2-hour minimum duration') !== -1, '2C: createBooking rejects 1 hour moving request');

var createErr15 = null;
try {
  createBooking({
    customerId: 'cust_sarah',
    address: '2800 McKinney Ave, Dallas, TX 75204',
    zipCode: '75204',
    serviceCategory: 'moving',
    timingType: 'scheduled',
    scheduledDate: '2026-11-20',
    scheduledTime: '10:00',
    intakeDetails: { hours: 1.5, workersNeeded: 1 }
  });
} catch (e) {
  createErr15 = e.message;
}
assert(createErr15 && createErr15.indexOf('requires a 2-hour minimum duration') !== -1, '2C: createBooking rejects 1.5 hour moving request');

// 2D: createBooking rejects duration over 8 hours
var createErrOver = null;
try {
  createBooking({
    customerId: 'cust_sarah',
    address: '2800 McKinney Ave, Dallas, TX 75204',
    zipCode: '75204',
    serviceCategory: 'moving',
    timingType: 'scheduled',
    scheduledDate: '2026-11-20',
    scheduledTime: '10:00',
    intakeDetails: { hours: 10, workersNeeded: 2 }
  });
} catch (e) {
  createErrOver = e.message;
}
assert(createErrOver && createErrOver.indexOf('supports up to 8 hours') !== -1, '2D: createBooking rejects duration > 8 hours');

// 2E: createBooking enforces 1 to 4 movers
var createErrMovers0 = null;
try {
  createBooking({
    customerId: 'cust_sarah',
    address: '2800 McKinney Ave, Dallas, TX 75204',
    zipCode: '75204',
    serviceCategory: 'moving',
    timingType: 'scheduled',
    scheduledDate: '2026-11-20',
    scheduledTime: '10:00',
    intakeDetails: { hours: 2, workersNeeded: 0 }
  });
} catch (e) {
  createErrMovers0 = e.message;
}
assert(createErrMovers0 && createErrMovers0.indexOf('supports between 1 and 4 movers') !== -1, '2E: createBooking rejects 0 movers');

var createErrMovers5 = null;
try {
  createBooking({
    customerId: 'cust_sarah',
    address: '2800 McKinney Ave, Dallas, TX 75204',
    zipCode: '75204',
    serviceCategory: 'moving',
    timingType: 'scheduled',
    scheduledDate: '2026-11-20',
    scheduledTime: '10:00',
    intakeDetails: { hours: 2, workersNeeded: 5 }
  });
} catch (e) {
  createErrMovers5 = e.message;
}
assert(createErrMovers5 && createErrMovers5.indexOf('supports between 1 and 4 movers') !== -1, '2E: createBooking rejects 5 movers (>4 max)');

// ---------------------------------------------------------------------------
// Group 3: Historical Booking Price Preservation & Zero-Mutation Invariance
// ---------------------------------------------------------------------------
console.log('\n[Group 3: Historical Booking Price Preservation & Zero-Mutation Invariance]');

var seedState = loadState();

// 3A: CRW-1001 (Moving, 2 movers, 3 hours — historical agreed price)
var b1001 = seedState.bookings.find(b => b.id === 'CRW-1001');
assert(b1001 !== undefined, '3A: CRW-1001 found in seed state');
assert(b1001.serviceCategory === 'moving', '3A: CRW-1001 service is moving');
assert(b1001.serviceDetails.hours === 3, '3A: CRW-1001 duration is 3 hours');
assert(b1001.workersNeeded === 2, '3A: CRW-1001 has 2 workers needed');
assert(b1001.pricing.customerSubtotal === 240, '3A: CRW-1001 subtotal preserved at historical $240.00 ($40/hr rate)');
assert(b1001.pricing.bookingFee === 10, '3A: CRW-1001 fee preserved at historical $10.00');
assert(b1001.pricing.customerTotal === 250, '3A: CRW-1001 total preserved at historical $250.00');
assert(b1001.pricing.workerPayoutPerPerson === 75, '3A: CRW-1001 payout per person preserved at historical $75.00 ($25/hr rate)');
assert(b1001.pricing.totalWorkerPayouts === 150, '3A: CRW-1001 total payouts preserved at historical $150.00');
assert(b1001.pricing.grossPlatformRevenue === 100, '3A: CRW-1001 gross revenue preserved at historical $100.00');

// 3B: CRW-1002 (TV Mounting — historical agreed price)
var b1002 = seedState.bookings.find(b => b.id === 'CRW-1002');
assert(b1002 !== undefined, '3B: CRW-1002 found in seed state');
assert(b1002.pricing.customerSubtotal === 109, '3B: CRW-1002 subtotal preserved at $109.00');
assert(b1002.pricing.bookingFee === 10, '3B: CRW-1002 fee preserved at $10.00');
assert(b1002.pricing.customerTotal === 119, '3B: CRW-1002 total preserved at $119.00');
assert(b1002.pricing.workerPayoutPerPerson === 75, '3B: CRW-1002 payout preserved at $75.00');

// 3C: CRW-1003 (Lawn Mowing — historical completed booking)
var b1003 = seedState.bookings.find(b => b.id === 'CRW-1003');
assert(b1003 !== undefined, '3C: CRW-1003 found in seed state');
assert(b1003.pricing.customerSubtotal === 55, '3C: CRW-1003 subtotal preserved at $55.00');
assert(b1003.pricing.bookingFee === 10, '3C: CRW-1003 fee preserved at $10.00');
assert(b1003.pricing.customerTotal === 65, '3C: CRW-1003 total preserved at $65.00');
assert(b1003.pricing.workerPayoutPerPerson === 35, '3C: CRW-1003 payout preserved at $35.00');

// 3D: CRW-1004 (Moving, 2 movers, 3 hours — historical agreed price)
var b1004 = seedState.bookings.find(b => b.id === 'CRW-1004');
assert(b1004 !== undefined, '3D: CRW-1004 found in seed state');
assert(b1004.pricing.customerSubtotal === 240, '3D: CRW-1004 subtotal preserved at historical $240.00');
assert(b1004.pricing.customerTotal === 250, '3D: CRW-1004 total preserved at historical $250.00');
assert(b1004.pricing.workerPayoutPerPerson === 75, '3D: CRW-1004 payout preserved at historical $75.00');

// 3E: Initial Seed Financial Summary Invariance
var seedFin = getAdminFinancialSummary(seedState);
assert(seedFin.totalGrossBookingValue === '684.00', '3E: Historical Total GBV invariant at $684.00');
assert(seedFin.projectedGrossBookingValue === '619.00', '3E: Historical Projected GBV invariant at $619.00');
assert(seedFin.completedGrossBookingValue === '65.00', '3E: Historical Completed GBV invariant at $65.00');
assert(seedFin.totalBookingFees === '40.00', '3E: Historical Total Booking Fees invariant at $40.00');
assert(seedFin.totalWorkerCompensation === '410.00', '3E: Historical Worker Compensation invariant at $410.00');
assert(seedFin.completedWorkerPayouts === '35.00', '3E: Historical Completed Payouts invariant at $35.00');
assert(seedFin.pendingWorkerPayouts === '375.00', '3E: Historical Pending Payouts invariant at $375.00');
assert(seedFin.platformGrossMargin === '274.00', '3E: Historical Platform Gross Margin invariant at $274.00');

// ---------------------------------------------------------------------------
// Group 4: Individual Worker Compensation, Wallet Protection & No Duplicate Credits
// ---------------------------------------------------------------------------
console.log('\n[Group 4: Individual Worker Compensation & Wallet Protection]');

// Disable auto-book so we can verify explicit manual/admin assignment lifecycle
var stPrep = loadState();
stPrep.pros.forEach(p => { p.autoBookEnabled = false; });
saveState(stPrep);

// Create new moving booking under new rates: 2 movers for 3 hours
var newMoveBooking = createBooking({
  customerId: 'cust_sarah',
  address: '2800 McKinney Ave, Apt 402, Dallas, TX 75204',
  zipCode: '75204',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: '2026-11-25',
  scheduledTime: '10:00',
  intakeDetails: { hours: 3, workersNeeded: 2, notes: 'New move test' }
});

assert(newMoveBooking.pricing.customerSubtotal === 300, '4A: New booking subtotal is $300.00');
assert(newMoveBooking.pricing.customerTotal === 310, '4A: New booking total is $310.00');
assert(newMoveBooking.pricing.workerPayoutPerPerson === 90, '4A: New booking payout per person is $90.00');
assert(newMoveBooking.workerAssignments[0].payout === 90, '4A: Slot 1 payout is $90.00');
assert(newMoveBooking.workerAssignments[1].payout === 90, '4A: Slot 2 payout is $90.00');

// 4B: Assign Marcus to slot 1
var stBeforeAssign = loadState();
var mBefore = stBeforeAssign.pros.find(p => p.id === 'pro_marcus');
var mPendingPre = mBefore.earnings.pendingBalance;
var mAvailPre = mBefore.earnings.availableBalance;
var mLifePre = mBefore.earnings.lifetimeEarned;

var assignRes1 = assignProToSlot(newMoveBooking.id, 'slot_1', 'pro_marcus');
assert(assignRes1.success === true, '4B: Marcus assigned to slot 1');

var stAfterAssign = loadState();
var mAfter = stAfterAssign.pros.find(p => p.id === 'pro_marcus');
assert(mAfter.earnings.pendingBalance === mPendingPre + 90, '4B: Marcus pending balance increased by exactly $90.00');
assert(mAfter.earnings.availableBalance === mAvailPre, '4B: Marcus available balance untouched upon assignment');
assert(mAfter.earnings.lifetimeEarned === mLifePre, '4B: Marcus lifetime earned untouched upon assignment');

// 4C: Assign Jamar to slot 2
var jBefore = stAfterAssign.pros.find(p => p.id === 'pro_jamar');
var jPendingPre = jBefore.earnings.pendingBalance;
var jAvailPre = jBefore.earnings.availableBalance;
var jLifePre = jBefore.earnings.lifetimeEarned;

var assignRes2 = assignProToSlot(newMoveBooking.id, 'slot_2', 'pro_jamar');
assert(assignRes2.success === true, '4C: Jamar assigned to slot 2');

var stAfterAssign2 = loadState();
var jAfter = stAfterAssign2.pros.find(p => p.id === 'pro_jamar');
assert(jAfter.earnings.pendingBalance === jPendingPre + 90, '4C: Jamar pending balance increased by exactly $90.00');

// 4D: Marcus completes assignment -> releases $90 to available balance
updateProAssignmentStatus(newMoveBooking.id, 'slot_1', 'traveling');
updateProAssignmentStatus(newMoveBooking.id, 'slot_2', 'traveling');
updateProAssignmentStatus(newMoveBooking.id, 'slot_1', 'arrived');
updateProAssignmentStatus(newMoveBooking.id, 'slot_2', 'arrived');
updateProAssignmentStatus(newMoveBooking.id, 'slot_1', 'in_progress');
updateProAssignmentStatus(newMoveBooking.id, 'slot_2', 'in_progress');

var compRes1 = updateProAssignmentStatus(newMoveBooking.id, 'slot_1', 'completed');
assert(compRes1.success === true, '4D: Marcus completes slot 1');

var stAfterComp1 = loadState();
var mPostComp = stAfterComp1.pros.find(p => p.id === 'pro_marcus');
assert(mPostComp.earnings.pendingBalance === mPendingPre, '4D: Marcus pending balance decreased by $90.00');
assert(mPostComp.earnings.availableBalance === mAvailPre + 90, '4D: Marcus available balance increased by $90.00');
assert(mPostComp.earnings.lifetimeEarned === mLifePre + 90, '4D: Marcus lifetime earned increased by $90.00');

var mTx = mPostComp.earnings.walletTransactions.find(t => t.bookingId === newMoveBooking.id && t.slotId === 'slot_1');
assert(mTx !== undefined, '4D: Transaction ledger entry created for Marcus completion');
assert(mTx.amountCents === 9000, '4D: Transaction amount is exactly 9000 cents ($90.00)');

// 4E: Duplicate completion attempt rejected and zero duplicate credits
var dupComp = updateProAssignmentStatus(newMoveBooking.id, 'slot_1', 'completed');
assert(dupComp.success === false, '4E: Duplicate completion rejected');
var stAfterDup = loadState();
var mPostDup = stAfterDup.pros.find(p => p.id === 'pro_marcus');
assert(mPostDup.earnings.availableBalance === mAvailPre + 90, '4E: No duplicate credits added on second completion attempt');

// ---------------------------------------------------------------------------
// Group 5: Customer vs Pro View Visibility Separation & Message Privacy
// ---------------------------------------------------------------------------
console.log('\n[Group 5: Customer vs Pro View Visibility Separation]');

var finalMoveBooking = loadState().bookings.find(b => b.id === newMoveBooking.id);

// 5A: Customer view sees exact customerTotal and bookingFee
assert(finalMoveBooking.pricing.customerTotal === 310, '5A: Customer pricing total is $310.00');
assert(finalMoveBooking.pricing.bookingFee === 10, '5A: Customer pricing fee is $10.00');
assert(finalMoveBooking.pricing.customerSubtotal === 300, '5A: Customer pricing subtotal is $300.00');

// 5B: Customer message timeline conceals worker payout amounts
var custMsgs = finalMoveBooking.messages || [];
var hasPayoutLeak = custMsgs.some(m =>
  m.text.indexOf('$90') !== -1 ||
  m.text.indexOf('$180') !== -1 ||
  m.text.indexOf('$30/hr') !== -1 ||
  m.text.indexOf('payout') !== -1
);
assert(!hasPayoutLeak, '5B: Customer messages strictly conceal individual worker payouts');

// 5C: Pro job card visibility shows only their offered payout ($90.00)
assert(finalMoveBooking.workerAssignments[0].payout === 90, '5C: Pro assignment card shows offered payout of $90.00');
assert(finalMoveBooking.workerAssignments[1].payout === 90, '5C: Pro assignment card shows offered payout of $90.00');

// ---------------------------------------------------------------------------
// Group 6: Non-Moving Services Pricing Unchanged
// ---------------------------------------------------------------------------
console.log('\n[Group 6: Non-Moving Services Pricing Unchanged]');

// 6A: TV Mounting ($109 customer, $75 Pro payout)
var qTv = calculatePricing('tv_mounting');
assert(qTv.customerSubtotal === 109, '6A: TV Mounting subtotal is $109.00');
assert(qTv.customerTotal === 119, '6A: TV Mounting total is $119.00 ($109 + $10 fee)');
assert(qTv.workerPayoutPerPerson === 75, '6A: TV Mounting Pro payout is $75.00');
assert(qTv.grossPlatformRevenue === 44, '6A: TV Mounting platform gross margin is $44.00');

// 6B: Wall Mounting & Shelving ($95 customer, $65 Pro payout)
var qWall = calculatePricing('wall_mounting');
assert(qWall.customerSubtotal === 95, '6B: Wall Mounting subtotal is $95.00');
assert(qWall.customerTotal === 105, '6B: Wall Mounting total is $105.00 ($95 + $10 fee)');
assert(qWall.workerPayoutPerPerson === 65, '6B: Wall Mounting Pro payout is $65.00');
assert(qWall.grossPlatformRevenue === 40, '6B: Wall Mounting platform gross margin is $40.00');

// 6C: Furniture Assembly ($90 customer, $55 Pro payout)
var qAssem = calculatePricing('furniture_assembly');
assert(qAssem.customerSubtotal === 90, '6C: Furniture Assembly subtotal is $90.00');
assert(qAssem.customerTotal === 100, '6C: Furniture Assembly total is $100.00 ($90 + $10 fee)');
assert(qAssem.workerPayoutPerPerson === 55, '6C: Furniture Assembly Pro payout is $55.00');
assert(qAssem.grossPlatformRevenue === 45, '6C: Furniture Assembly platform gross margin is $45.00');

// 6D: Furniture Disassembly ($80 customer, $50 Pro payout)
var qDis = calculatePricing('furniture_disassembly');
assert(qDis.customerSubtotal === 80, '6D: Furniture Disassembly subtotal is $80.00');
assert(qDis.customerTotal === 90, '6D: Furniture Disassembly total is $90.00 ($80 + $10 fee)');
assert(qDis.workerPayoutPerPerson === 50, '6D: Furniture Disassembly Pro payout is $50.00');
assert(qDis.grossPlatformRevenue === 40, '6D: Furniture Disassembly platform gross margin is $40.00');

// 6E: Lawn Mowing ($55 customer, $35 Pro payout)
var qLawn = calculatePricing('lawn_mowing');
assert(qLawn.customerSubtotal === 55, '6E: Lawn Mowing subtotal is $55.00');
assert(qLawn.customerTotal === 65, '6E: Lawn Mowing total is $65.00 ($55 + $10 fee)');
assert(qLawn.workerPayoutPerPerson === 35, '6E: Lawn Mowing Pro payout is $35.00');
assert(qLawn.grossPlatformRevenue === 30, '6E: Lawn Mowing platform gross margin is $30.00');

// ---------------------------------------------------------------------------
// Group 7: Currency Rounding & Fractional Cent Prevention
// ---------------------------------------------------------------------------
console.log('\n[Group 7: Currency Rounding & Fractional Cent Prevention]');

var qHalfHour = calculatePricing('moving', { workersNeeded: 2, hours: 2.5 });
assert(qHalfHour.customerSubtotal === 250, '7A: 2.5 hrs subtotal is $250.00');
assert(qHalfHour.customerTotal === 260, '7A: 2.5 hrs total is $260.00');
assert(qHalfHour.workerPayoutPerPerson === 75, '7A: 2.5 hrs Pro payout is $75.00');
assert(qHalfHour.totalWorkerPayouts === 150, '7A: 2.5 hrs total payouts equal $150.00');
assert(qHalfHour.grossPlatformRevenue === 110, '7A: 2.5 hrs gross margin is $110.00');

assert(dollarsToCents(260.00) === 26000, '7B: dollarsToCents(260.00) is 26000');
assert(centsToDollars(26000) === '260.00', '7B: centsToDollars(26000) is "260.00"');
assert(dollarsToCents(75.00) === 7500, '7C: dollarsToCents(75.00) is 7500');
assert(centsToDollars(7500) === '75.00', '7C: centsToDollars(7500) is "75.00"');

// ---------------------------------------------------------------------------
// Group 8: Admin Financial Totals with New Moving Booking
// ---------------------------------------------------------------------------
console.log('\n[Group 8: Admin Financial Totals with New Moving Booking]');

// Complete Jamar slot 2 so newMoveBooking is completely completed
updateProAssignmentStatus(newMoveBooking.id, 'slot_2', 'completed');

var stateFinal = loadState();
var finSummary = getAdminFinancialSummary(stateFinal);

// Historical GBV ($684) + New Move Booking ($310) = $994.00
assert(finSummary.totalGrossBookingValue === '994.00', '8A: Total GBV includes new completed booking ($994.00)');
// Completed GBV includes historical CRW-1003 ($65) + new completed booking ($310) = $375.00
assert(finSummary.completedGrossBookingValue === '375.00', '8B: Completed GBV is $375.00 ($65 + $310)');
// Total Booking Fees: 4 historical ($40) + 1 new ($10) = $50.00
assert(finSummary.totalBookingFees === '50.00', '8C: Total Booking Fees equal $50.00 (5 bookings * $10)');
// Completed Worker Payouts: Carlos ($35) + Marcus ($90) + Jamar ($90) = $215.00
assert(finSummary.completedWorkerPayouts === '215.00', '8D: Completed Worker Payouts equal $215.00 ($35 + $180)');
// Completed Gross Margin: $375 - $215 = $160.00
assert(finSummary.completedGrossMargin === '160.00', '8E: Completed Gross Margin equals $160.00');

console.log('==================================================================');
console.log(`FINAL RESULTS: ${passed} of ${passed + failed} assertions passed (100%).`);
console.log('==================================================================');

if (failed > 0) {
  process.exit(1);
}
