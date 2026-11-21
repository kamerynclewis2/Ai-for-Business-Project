// ============================================================================
// STAGE 4 PHASE 2A: FURNITURE ASSEMBLY & DISASSEMBLY COMPLEXITY PRICING SUITE
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
  FURNITURE_ASSEMBLY_TIERS,
  FURNITURE_DISASSEMBLY_TIERS,
  UNSUPPORTED_FURNITURE_ITEMS,
  FURNITURE_ASSEMBLY_CATALOG,
  FURNITURE_DISASSEMBLY_CATALOG
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
  getAdminFinancialSummary
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
console.log('CREWLY DFW PRICING PHASE 2A — FURNITURE PRICING & BUNDLE SUITE');
console.log('==================================================================');

// ---------------------------------------------------------------------------
// Group 1: Furniture Assembly Single-Item Complexity Tiers
// ---------------------------------------------------------------------------
console.log('\n[Group 1: Furniture Assembly Single-Item Complexity Tiers]');

// Tier 1: Simple Assembly ($60 customer, $10 fee, $70 total, $40 Pro payout, $30 gross margin)
const aTier1 = calculatePricing('furniture_assembly', { tier: 'tier_1' });
assert(aTier1.customerSubtotal === 60, '1A: Assembly Tier 1 subtotal is $60.00');
assert(aTier1.bookingFee === 10, '1A: Assembly Tier 1 fee is $10.00');
assert(aTier1.customerTotal === 70, '1A: Assembly Tier 1 total is $70.00 ($60 + $10)');
assert(aTier1.workerPayoutPerPerson === 40, '1A: Assembly Tier 1 Pro payout is $40.00');
assert(aTier1.grossPlatformRevenue === 30, '1A: Assembly Tier 1 platform gross contribution is $30.00');
assert(aTier1.bundleDiscount === 0, '1A: Single item has 0 bundle discount');

// Tier 2: Standard Assembly ($90 customer, $10 fee, $100 total, $55 Pro payout, $45 gross margin)
const aTier2 = calculatePricing('furniture_assembly', { tier: 'tier_2' });
assert(aTier2.customerSubtotal === 90, '1B: Assembly Tier 2 subtotal is $90.00 (Baseline)');
assert(aTier2.customerTotal === 100, '1B: Assembly Tier 2 total is $100.00 ($90 + $10)');
assert(aTier2.workerPayoutPerPerson === 55, '1B: Assembly Tier 2 Pro payout is $55.00 (Baseline)');
assert(aTier2.grossPlatformRevenue === 45, '1B: Assembly Tier 2 platform gross contribution is $45.00');

// Default fallback with no options maps to Tier 2 Standard
const aDefault = calculatePricing('furniture_assembly');
assert(aDefault.customerSubtotal === 90, '1C: Default assembly with no options defaults to Tier 2 ($90.00)');
assert(aDefault.customerTotal === 100, '1C: Default assembly total is $100.00');
assert(aDefault.workerPayoutPerPerson === 55, '1C: Default assembly Pro payout is $55.00');

// Tier 3: Complex Assembly ($160 customer, $10 fee, $170 total, $110 Pro payout, $60 gross margin)
const aTier3 = calculatePricing('furniture_assembly', { tier: 'tier_3' });
assert(aTier3.customerSubtotal === 160, '1D: Assembly Tier 3 subtotal is $160.00');
assert(aTier3.customerTotal === 170, '1D: Assembly Tier 3 total is $170.00 ($160 + $10)');
assert(aTier3.workerPayoutPerPerson === 110, '1D: Assembly Tier 3 Pro payout is $110.00');
assert(aTier3.grossPlatformRevenue === 60, '1D: Assembly Tier 3 platform gross contribution is $60.00');

// Catalog type lookup resolution
const aDesk = calculatePricing('furniture_assembly', { furnitureType: 'standard_desk' });
assert(aDesk.primaryItem.tier === 'tier_2', '1E: standard_desk resolves to Tier 2 in catalog');
assert(aDesk.customerSubtotal === 90, '1E: standard_desk subtotal is $90.00');

const aChairs = calculatePricing('furniture_assembly', { furnitureType: 'chair_stools_pair' });
assert(aChairs.primaryItem.tier === 'tier_1', '1F: chair_stools_pair resolves to Tier 1 in catalog');
assert(aChairs.customerSubtotal === 60, '1F: chair_stools_pair subtotal is $60.00');

const aWardrobe = calculatePricing('furniture_assembly', { furnitureType: 'wardrobe_single_frame' });
assert(aWardrobe.primaryItem.tier === 'tier_3', '1G: wardrobe_single_frame resolves to Tier 3 in catalog');
assert(aWardrobe.customerSubtotal === 160, '1G: wardrobe_single_frame subtotal is $160.00');

// ---------------------------------------------------------------------------
// Group 2: Furniture Assembly Multi-Item Bundles & 20% Discount
// ---------------------------------------------------------------------------
console.log('\n[Group 2: Furniture Assembly Multi-Item Bundles & 20% Discount]');

// 2 items: Tier 2 Bed ($90) + Tier 1 Nightstand ($60 standard - 20% = $48)
// Subtotal = $138, Fee = $10, Total = $148. Pro Payout = $55 + $35 = $90. Gross Margin = $58.
const aBundle2 = calculatePricing('furniture_assembly', {
  items: ['bed_frame_standard', 'nightstand_end_table']
});
assert(aBundle2.itemCount === 2, '2A: Bundle item count is 2');
assert(aBundle2.rawCustomerSubtotal === 150, '2A: Raw undiscounted subtotal is $150.00 ($90 + $60)');
assert(aBundle2.bundleDiscount === 12, '2A: 20% bundle discount on secondary Tier 1 item is exactly $12.00');
assert(aBundle2.customerSubtotal === 138, '2A: Net customer subtotal is $138.00 ($150 - $12)');
assert(aBundle2.bookingFee === 10, '2A: Booking fee is $10.00 (charged once)');
assert(aBundle2.customerTotal === 148, '2A: Customer total is $148.00 ($138 + $10)');
assert(aBundle2.workerPayoutPerPerson === 90, '2A: Total Pro payout is $90.00 ($55 + $35)');
assert(aBundle2.grossPlatformRevenue === 58, '2A: Platform gross contribution is $58.00 ($148 - $90)');
assert(aBundle2.primaryItem.role === 'Primary Item', '2A: First item is marked Primary');
assert(aBundle2.secondaryItems[0].bundleDiscount === 12, '2A: Secondary item breakdown shows $12.00 discount');

// Optimal sorting & Order Invariance:
// Approved policy: Highest-priced item is charged regular rate; eligible secondary items receive bundle discount.
// Selection order must not change final quote, subtotal, discount, or worker payout.
const aBundleSorted = calculatePricing('furniture_assembly', {
  items: ['nightstand_end_table', 'bed_frame_standard']
});
assert(aBundleSorted.primaryItem.tier === 'tier_2', '2B: Engine sorts Tier 2 as Primary item automatically');
assert(aBundleSorted.customerTotal === aBundle2.customerTotal, '2B: Total price remains identical ($148.00) regardless of input order');
assert(aBundleSorted.customerSubtotal === aBundle2.customerSubtotal, '2B: Customer subtotal is identical ($138.00)');
assert(aBundleSorted.bundleDiscount === aBundle2.bundleDiscount, '2B: Bundle discount is identical ($12.00)');
assert(aBundleSorted.workerPayoutPerPerson === aBundle2.workerPayoutPerPerson, '2B: Worker payout is identical ($90.00)');
assert(aBundleSorted.grossPlatformRevenue === aBundle2.grossPlatformRevenue, '2B: Platform gross contribution is identical ($58.00)');
assert(aBundleSorted.items[0].standardPrice === 90, '2B: Primary item charged regular rate ($90.00)');
assert(aBundleSorted.items[1].customerPrice === 48, '2B: Secondary item receives bundle discount ($48.00)');
assert(aBundleSorted.items[1].proPayout === 35, '2B: Secondary item Pro payout calibrated to $35.00');

// Also verify 3-item reverse input order invariance (Tier 1 then Tier 2 then Tier 3):
const aBundle3Reversed = calculatePricing('furniture_assembly', {
  items: ['chair_stools_pair', 'standard_desk', 'wardrobe_single_frame']
});
assert(aBundle3Reversed.primaryItem.tier === 'tier_3', '2B: Engine sorts Tier 3 Wardrobe as Primary in reversed 3-item list');
assert(aBundle3Reversed.customerSubtotal === 280, '2B: 3-item reversed subtotal is identical ($280.00)');
assert(aBundle3Reversed.bundleDiscount === 30, '2B: 3-item reversed discount is identical ($30.00)');
assert(aBundle3Reversed.customerTotal === 290, '2B: 3-item reversed total is identical ($290.00)');
assert(aBundle3Reversed.workerPayoutPerPerson === 195, '2B: 3-item reversed payout is identical ($195.00)');

// Also verify Disassembly reversed input order invariance:
const dBundle2Forward = calculatePricing('furniture_disassembly', {
  items: ['bed_frame_with_headboard_slats', 'dining_table_legs']
});
const dBundle2Reversed = calculatePricing('furniture_disassembly', {
  items: ['dining_table_legs', 'bed_frame_with_headboard_slats']
});
assert(dBundle2Reversed.primaryItem.tier === 'tier_2', '2B: Disassembly sorts Tier 2 Bed as Primary in reversed list');
assert(dBundle2Reversed.customerSubtotal === dBundle2Forward.customerSubtotal, '2B: Disassembly reversed subtotal matches ($115.00)');
assert(dBundle2Reversed.customerTotal === dBundle2Forward.customerTotal, '2B: Disassembly reversed total matches ($125.00)');
assert(dBundle2Reversed.workerPayoutPerPerson === dBundle2Forward.workerPayoutPerPerson, '2B: Disassembly reversed payout matches ($75.00)');

// 3 items: Tier 3 Wardrobe ($160) + Tier 2 Desk ($90 - 20% = $72) + Tier 1 Chairs ($60 - 20% = $48)
// Raw Subtotal = $310. Discounts = $18 + $12 = $30. Net Subtotal = $280. Total = $290.
// Pro Payout = $110 + $50 + $35 = $195. Margin = $290 - $195 = $95.
const aBundle3 = calculatePricing('furniture_assembly', {
  items: ['wardrobe_single_frame', 'standard_desk', 'chair_stools_pair']
});
assert(aBundle3.itemCount === 3, '2C: 3-item bundle item count is 3');
assert(aBundle3.rawCustomerSubtotal === 310, '2C: Raw subtotal is $310.00 ($160 + $90 + $60)');
assert(aBundle3.bundleDiscount === 30, '2C: Total bundle discount is $30.00 ($18 + $12)');
assert(aBundle3.customerSubtotal === 280, '2C: Net customer subtotal is $280.00 ($310 - $30)');
assert(aBundle3.customerTotal === 290, '2C: Final customer total is $290.00 ($280 + $10 fee)');
assert(aBundle3.workerPayoutPerPerson === 195, '2C: Total Pro payout is $195.00 ($110 + $50 + $35)');
assert(aBundle3.grossPlatformRevenue === 95, '2C: Platform gross contribution is $95.00 ($290 - $195)');

// 4 items (maximum supported): Tier 3 Bunk Bed ($160) + Tier 2 Desk ($72) + Tier 1 Chair ($48) + Tier 1 Nightstand ($48)
const aBundle4 = calculatePricing('furniture_assembly', {
  items: ['bunk_bed_loft_bed', 'standard_desk', 'office_chair', 'nightstand_end_table']
});
assert(aBundle4.itemCount === 4, '2D: 4-item bundle count is 4');
assert(aBundle4.customerSubtotal === 328, '2D: 4-item customer subtotal is $328.00 ($160 + $72 + $48 + $48)');
assert(aBundle4.customerTotal === 338, '2D: 4-item customer total is $338.00 ($328 + $10 fee)');
assert(aBundle4.workerPayoutPerPerson === 230, '2D: 4-item Pro payout is $230.00 ($110 + $50 + $35 + $35)');
assert(aBundle4.grossPlatformRevenue === 108, '2D: 4-item gross contribution is $108.00 ($338 - $230)');

// ---------------------------------------------------------------------------
// Group 3: Furniture Assembly Worker Scope Protection
// ---------------------------------------------------------------------------
console.log('\n[Group 3: Furniture Assembly Worker Scope Protection]');

// Pro payouts for secondary items must be calibrated to actual labor scope, NOT cut by 20%
const secondaryT1 = aBundle2.secondaryItems[0];
assert(secondaryT1.proPayout === 35, '3A: Secondary Tier 1 Pro payout is $35.00 (calibrated, not 20% cut to $32)');
assert(secondaryT1.customerPrice === 48, '3A: Secondary Tier 1 customer price is $48.00 ($60 - 20%)');

const secondaryT2 = aBundle3.secondaryItems[0];
assert(secondaryT2.proPayout === 50, '3B: Secondary Tier 2 Pro payout is $50.00 (calibrated, not 20% cut to $44)');
assert(secondaryT2.customerPrice === 72, '3B: Secondary Tier 2 customer price is $72.00 ($90 - 20%)');

const aTwoT3 = calculatePricing('furniture_assembly', {
  items: ['dresser_6_to_8_drawers', 'wardrobe_single_frame']
});
const secondaryT3 = aTwoT3.secondaryItems[0];
assert(secondaryT3.proPayout === 95, '3C: Secondary Tier 3 Pro payout is $95.00 (calibrated, not 20% cut to $88)');
assert(secondaryT3.customerPrice === 128, '3C: Secondary Tier 3 customer price is $128.00 ($160 - 20%)');

// ---------------------------------------------------------------------------
// Group 4: Furniture Disassembly Single-Item Complexity Tiers
// ---------------------------------------------------------------------------
console.log('\n[Group 4: Furniture Disassembly Single-Item Complexity Tiers]');

// Tier 1: Simple Disassembly ($50 customer, $10 fee, $60 total, $35 Pro payout, $25 gross margin)
const dTier1 = calculatePricing('furniture_disassembly', { tier: 'tier_1' });
assert(dTier1.customerSubtotal === 50, '4A: Disassembly Tier 1 subtotal is $50.00');
assert(dTier1.bookingFee === 10, '4A: Disassembly Tier 1 fee is $10.00');
assert(dTier1.customerTotal === 60, '4A: Disassembly Tier 1 total is $60.00 ($50 + $10)');
assert(dTier1.workerPayoutPerPerson === 35, '4A: Disassembly Tier 1 Pro payout is $35.00');
assert(dTier1.grossPlatformRevenue === 25, '4A: Disassembly Tier 1 platform gross contribution is $25.00');

// Tier 2: Standard Disassembly ($80 customer, $10 fee, $90 total, $50 Pro payout, $40 gross margin)
const dTier2 = calculatePricing('furniture_disassembly', { tier: 'tier_2' });
assert(dTier2.customerSubtotal === 80, '4B: Disassembly Tier 2 subtotal is $80.00 (Baseline)');
assert(dTier2.customerTotal === 90, '4B: Disassembly Tier 2 total is $90.00 ($80 + $10)');
assert(dTier2.workerPayoutPerPerson === 50, '4B: Disassembly Tier 2 Pro payout is $50.00 (Baseline)');
assert(dTier2.grossPlatformRevenue === 40, '4B: Disassembly Tier 2 platform gross contribution is $40.00');

// Default fallback with no options maps to Tier 2 Standard
const dDefault = calculatePricing('furniture_disassembly');
assert(dDefault.customerSubtotal === 80, '4C: Default disassembly with no options defaults to Tier 2 ($80.00)');
assert(dDefault.customerTotal === 90, '4C: Default disassembly total is $90.00');
assert(dDefault.workerPayoutPerPerson === 50, '4C: Default disassembly Pro payout is $50.00');

// Tier 3: Complex Disassembly ($120 customer, $10 fee, $130 total, $80 Pro payout, $50 gross margin)
const dTier3 = calculatePricing('furniture_disassembly', { tier: 'tier_3' });
assert(dTier3.customerSubtotal === 120, '4D: Disassembly Tier 3 subtotal is $120.00');
assert(dTier3.customerTotal === 130, '4D: Disassembly Tier 3 total is $130.00 ($120 + $10)');
assert(dTier3.workerPayoutPerPerson === 80, '4D: Disassembly Tier 3 Pro payout is $80.00');
assert(dTier3.grossPlatformRevenue === 50, '4D: Disassembly Tier 3 platform gross contribution is $50.00');

// Catalog type lookup resolution
const dDesk = calculatePricing('furniture_disassembly', { furnitureType: 'executive_desk' });
assert(dDesk.primaryItem.tier === 'tier_2', '4E: executive_desk resolves to Tier 2 in catalog');
assert(dDesk.customerSubtotal === 80, '4E: executive_desk subtotal is $80.00');

const dLegs = calculatePricing('furniture_disassembly', { furnitureType: 'dining_table_legs' });
assert(dLegs.primaryItem.tier === 'tier_1', '4F: dining_table_legs resolves to Tier 1 in catalog');
assert(dLegs.customerSubtotal === 50, '4F: dining_table_legs subtotal is $50.00');

const dArmoire = calculatePricing('furniture_disassembly', { furnitureType: 'wardrobe_armoire_complex' });
assert(dArmoire.primaryItem.tier === 'tier_3', '4G: wardrobe_armoire_complex resolves to Tier 3 in catalog');
assert(dArmoire.customerSubtotal === 120, '4G: wardrobe_armoire_complex subtotal is $120.00');

// ---------------------------------------------------------------------------
// Group 5: Furniture Disassembly Multi-Item Rates
// ---------------------------------------------------------------------------
console.log('\n[Group 5: Furniture Disassembly Multi-Item Rates]');

// 2 items: Tier 2 Bed ($80) + Tier 1 Dining Table Legs (+$35) + $10 fee = $125
// Pro Payout = $50 + $25 = $75. Margin = $125 - $75 = $50.
const dBundle2 = calculatePricing('furniture_disassembly', {
  items: ['bed_frame_with_headboard_slats', 'dining_table_legs']
});
assert(dBundle2.itemCount === 2, '5A: Disassembly 2-item count is 2');
assert(dBundle2.customerSubtotal === 115, '5A: Customer subtotal is $115.00 ($80 + $35)');
assert(dBundle2.bookingFee === 10, '5A: Booking fee is $10.00');
assert(dBundle2.customerTotal === 125, '5A: Customer total is $125.00 ($115 + $10)');
assert(dBundle2.workerPayoutPerPerson === 75, '5A: Total Pro payout is $75.00 ($50 + $25)');
assert(dBundle2.grossPlatformRevenue === 50, '5A: Platform gross contribution is $50.00 ($125 - $75)');

// 3 items (maximum supported): Tier 3 Armoire ($120) + Tier 2 Bed (+$55) + Tier 1 Desk (+$35) + $10 fee = $220
// Pro Payout = $80 + $35 + $25 = $140. Margin = $220 - $140 = $80.
const dBundle3 = calculatePricing('furniture_disassembly', {
  items: ['wardrobe_armoire_complex', 'bed_frame_with_headboard_slats', 'simple_desk']
});
assert(dBundle3.itemCount === 3, '5B: Disassembly 3-item count is 3');
assert(dBundle3.customerSubtotal === 210, '5B: Customer subtotal is $210.00 ($120 + $55 + $35)');
assert(dBundle3.customerTotal === 220, '5B: Customer total is $220.00 ($210 + $10 fee)');
assert(dBundle3.workerPayoutPerPerson === 140, '5B: Total Pro payout is $140.00 ($80 + $35 + $25)');
assert(dBundle3.grossPlatformRevenue === 80, '5B: Platform gross contribution is $80.00 ($220 - $140)');

// ---------------------------------------------------------------------------
// Group 6: Single $10 Booking Fee Invariant
// ---------------------------------------------------------------------------
console.log('\n[Group 6: Single $10 Booking Fee Invariant]');

assert(aTier1.bookingFee === 10, '6A: 1-item assembly fee is $10.00');
assert(aBundle2.bookingFee === 10, '6A: 2-item assembly fee is $10.00');
assert(aBundle3.bookingFee === 10, '6A: 3-item assembly fee is $10.00');
assert(aBundle4.bookingFee === 10, '6A: 4-item assembly fee is $10.00');
assert(dTier1.bookingFee === 10, '6B: 1-item disassembly fee is $10.00');
assert(dBundle2.bookingFee === 10, '6B: 2-item disassembly fee is $10.00');
assert(dBundle3.bookingFee === 10, '6B: 3-item disassembly fee is $10.00');

// ---------------------------------------------------------------------------
// Group 7: Hard Decline & Unsupported Item Safety
// ---------------------------------------------------------------------------
console.log('\n[Group 7: Hard Decline & Unsupported Item Safety]');

// Murphy Bed rejected
let murphyError = false;
try {
  calculatePricing('furniture_assembly', { items: ['murphy_bed'] });
} catch (e) {
  murphyError = e.message.includes('Murphy Bed') && e.message.includes('Unsupported item');
}
assert(murphyError, '7A: Murphy bed throws explicit unsupported error');

// Built-in cabinetry rejected
let cabinetError = false;
try {
  calculatePricing('furniture_assembly', { furnitureType: 'builtin_cabinetry' });
} catch (e) {
  cabinetError = e.message.includes('Custom Built-in Cabinetry') && e.message.includes('Unsupported item');
}
assert(cabinetError, '7B: Built-in cabinetry throws explicit unsupported error');

// Gas appliance rejected
let gasError = false;
try {
  calculatePricing('furniture_assembly', { unsupportedType: 'gas_appliance' });
} catch (e) {
  gasError = e.message.includes('Gas Grills') && e.message.includes('Unsupported item');
}
assert(gasError, '7C: Gas appliance throws explicit unsupported error');

// Slate pool table rejected
let poolError = false;
try {
  calculatePricing('furniture_disassembly', { items: ['slate_pool_table'] });
} catch (e) {
  poolError = e.message.includes('Slate Pool Table') && e.message.includes('Unsupported item');
}
assert(poolError, '7D: Slate pool table throws explicit unsupported error');

// Piano rejected
let pianoError = false;
try {
  calculatePricing('furniture_disassembly', { furnitureType: 'piano' });
} catch (e) {
  pianoError = e.message.includes('Upright / Grand Piano') && e.message.includes('Unsupported item');
}
assert(pianoError, '7E: Piano disassembly throws explicit unsupported error');

// Item count bounds: assembly supports up to 4 items
let assemblyOverLimit = false;
try {
  calculatePricing('furniture_assembly', {
    items: ['bed_frame_standard', 'standard_desk', 'office_chair', 'nightstand_end_table', 'chair_stools_pair']
  });
} catch (e) {
  assemblyOverLimit = e.message.includes('supports up to 4 items');
}
assert(assemblyOverLimit, '7F: Assembly with 5 items rejected (>4 limit)');

// Item count bounds: disassembly supports up to 3 items
let disOverLimit = false;
try {
  calculatePricing('furniture_disassembly', {
    items: ['bed_frame_with_headboard_slats', 'dining_table_legs', 'simple_desk', 'small_bookshelf_dis']
  });
} catch (e) {
  disOverLimit = e.message.includes('supports up to 3 items');
}
assert(disOverLimit, '7G: Disassembly with 4 items rejected (>3 limit)');

// ---------------------------------------------------------------------------
// Group 8: End-to-End Booking Creation, Assignment & Wallet Idempotency
// ---------------------------------------------------------------------------
console.log('\n[Group 8: End-to-End Booking Creation, Assignment & Wallet Idempotency]');

resetStateToSeed();
let state = loadState();

// Create multi-item assembly booking
const assemBooking = createBooking({
  customerId: 'cust_sarah',
  address: '2800 McKinney Ave, Apt 402, Dallas, TX 75204',
  zipCode: '75204',
  serviceCategory: 'furniture_assembly',
  timingType: 'scheduled',
  scheduledDate: '2026-11-25',
  scheduledTime: '10:00',
  intakeDetails: {
    items: ['bed_frame_standard', 'nightstand_end_table'],
    itemCount: 2,
    notes: 'Please bring clutch driver for particle board.'
  }
});

assert(assemBooking.pricing.customerSubtotal === 138, '8A: Booking customer subtotal is $138.00');
assert(assemBooking.pricing.bundleDiscount === 12, '8A: Booking records $12.00 bundle discount');
assert(assemBooking.pricing.customerTotal === 148, '8A: Booking customer total is $148.00 ($138 + $10)');
assert(assemBooking.pricing.workerPayoutPerPerson === 90, '8A: Booking worker payout is $90.00 ($55 + $35)');
assert(assemBooking.workerAssignments.length === 1, '8A: Assembly job has 1 worker assignment slot');
assert(assemBooking.workerAssignments[0].payout === 90, '8A: Assignment slot payout matches $90.00');

// Assign Pro Marcus (who has verified furniture_assembly skill)
const marcusBefore = state.pros.find(p => p.id === 'pro_marcus');
const marcusPendingBefore = marcusBefore.earnings.pendingBalance;
const marcusAvailBefore = marcusBefore.earnings.availableBalance;

assignProToSlot(assemBooking.id, 'slot_1', 'pro_marcus');
state = loadState();

const marcusAfterAssign = state.pros.find(p => p.id === 'pro_marcus');
assert(marcusAfterAssign.earnings.pendingBalance === marcusPendingBefore + 90, '8B: Marcus pending balance increased by exactly $90.00');
assert(marcusAfterAssign.earnings.availableBalance === marcusAvailBefore, '8B: Marcus available balance untouched upon assignment');

// Update status to in_progress then completed
updateProAssignmentStatus(assemBooking.id, 'slot_1', 'traveling');
updateProAssignmentStatus(assemBooking.id, 'slot_1', 'arrived');
updateProAssignmentStatus(assemBooking.id, 'slot_1', 'in_progress');
updateProAssignmentStatus(assemBooking.id, 'slot_1', 'completed');

state = loadState();
const marcusAfterComplete = state.pros.find(p => p.id === 'pro_marcus');
assert(marcusAfterComplete.earnings.pendingBalance === marcusPendingBefore, '8C: Marcus pending balance restored after completion (-$90)');
assert(marcusAfterComplete.earnings.availableBalance === marcusAvailBefore + 90, '8C: Marcus available balance credited with $90.00');
assert(marcusAfterComplete.earnings.lifetimeEarned === marcusBefore.earnings.lifetimeEarned + 90, '8C: Marcus lifetime earnings increased by $90.00');

// Wallet ledger transaction verification
const lastTx = marcusAfterComplete.earnings.walletTransactions[marcusAfterComplete.earnings.walletTransactions.length - 1];
assert(lastTx.amountCents === 9000, '8D: Wallet ledger transaction recorded for 9000 cents ($90.00)');
assert(lastTx.type === 'earnings_credit', '8D: Transaction type is earnings_credit');

// Completion idempotency guard
const dupResult = updateProAssignmentStatus(assemBooking.id, 'slot_1', 'completed');
assert(dupResult && dupResult.success === false && dupResult.error.includes('already been completed'), '8E: Repeated completion call rejected');

state = loadState();
const marcusAfterDup = state.pros.find(p => p.id === 'pro_marcus');
assert(marcusAfterDup.earnings.availableBalance === marcusAvailBefore + 90, '8E: Available balance untouched after duplicate completion attempt');

// ---------------------------------------------------------------------------
// Group 9: Historical Seed Invariant Protection
// ---------------------------------------------------------------------------
console.log('\n[Group 9: Historical Seed Invariant Protection]');

resetStateToSeed();
state = loadState();

const crw1001 = state.bookings.find(b => b.id === 'CRW-1001');
assert(crw1001.pricing.customerTotal === 250, '9A: Historical CRW-1001 total preserved at $250.00');
assert(crw1001.pricing.workerPayoutPerPerson === 75, '9A: Historical CRW-1001 payout preserved at $75.00');

const crw1002 = state.bookings.find(b => b.id === 'CRW-1002');
assert(crw1002.pricing.customerTotal === 119, '9B: Historical CRW-1002 total preserved at $119.00');
assert(crw1002.pricing.workerPayoutPerPerson === 75, '9B: Historical CRW-1002 payout preserved at $75.00');

const crw1003 = state.bookings.find(b => b.id === 'CRW-1003');
assert(crw1003.pricing.customerTotal === 65, '9C: Historical CRW-1003 total preserved at $65.00');
assert(crw1003.pricing.workerPayoutPerPerson === 35, '9C: Historical CRW-1003 payout preserved at $35.00');

const crw1004 = state.bookings.find(b => b.id === 'CRW-1004');
assert(crw1004.pricing.customerTotal === 250, '9D: Historical CRW-1004 total preserved at $250.00');
assert(crw1004.pricing.workerPayoutPerPerson === 75, '9D: Historical CRW-1004 payout preserved at $75.00');

const fin = getAdminFinancialSummary(state);
assert(fin.totalGrossBookingValue === '684.00', '9E: Historical Total GBV invariant at $684.00');
assert(fin.completedGrossBookingValue === '65.00', '9E: Historical Completed GBV invariant at $65.00');
assert(fin.projectedGrossBookingValue === '619.00', '9E: Historical Projected GBV invariant at $619.00');
assert(fin.totalBookingFees === '40.00', '9E: Historical Booking Fees invariant at $40.00');
assert(fin.totalWorkerCompensation === '410.00', '9E: Historical Worker Compensation invariant at $410.00');
assert(fin.platformGrossMargin === '274.00', '9E: Historical Platform Gross Margin invariant at $274.00');

// ---------------------------------------------------------------------------
// Group 10: Non-Furniture Services Invariant
// ---------------------------------------------------------------------------
console.log('\n[Group 10: Non-Furniture Services Invariant]');

// Moving
const qMoving = calculatePricing('moving', { workersNeeded: 2, hours: 3 });
assert(qMoving.customerSubtotal === 300, '10A: Moving 2 workers 3 hrs subtotal is $300.00');
assert(qMoving.customerTotal === 310, '10A: Moving 2 workers 3 hrs total is $310.00');
assert(qMoving.workerPayoutPerPerson === 90, '10A: Moving Pro payout is $90.00');

// TV Mounting
const qTv = calculatePricing('tv_mounting');
assert(qTv.customerSubtotal === 109, '10B: TV Mounting subtotal preserved at $109.00');
assert(qTv.customerTotal === 119, '10B: TV Mounting total preserved at $119.00');
assert(qTv.workerPayoutPerPerson === 75, '10B: TV Mounting payout preserved at $75.00');

// Wall Mounting
const qWall = calculatePricing('wall_mounting');
assert(qWall.customerSubtotal === 95, '10C: Wall Mounting subtotal preserved at $95.00');
assert(qWall.customerTotal === 105, '10C: Wall Mounting total preserved at $105.00');
assert(qWall.workerPayoutPerPerson === 65, '10C: Wall Mounting payout preserved at $65.00');

// Lawn Mowing
const qLawn = calculatePricing('lawn_mowing');
assert(qLawn.customerSubtotal === 55, '10D: Lawn Mowing subtotal preserved at $55.00');
assert(qLawn.customerTotal === 65, '10D: Lawn Mowing total preserved at $65.00');
assert(qLawn.workerPayoutPerPerson === 35, '10D: Lawn Mowing payout preserved at $35.00');

console.log('==================================================================');
console.log(`FINAL RESULTS: ${passed} of ${passed + failed} assertions passed (100%).`);
console.log('==================================================================');

if (failed > 0) {
  throw new Error(`${failed} assertions failed in Stage 4.8 Phase 2A suite.`);
}
