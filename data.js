/**
 * Crewly Data & Seed Configuration
 * Course: INSY 3331: Artificial Intelligence for Business
 * Initial Launch Pilot: Dallas, Texas
 */

export const DALLAS_NEIGHBORHOODS = [
  { id: 'uptown', name: 'Uptown Dallas', zip: '75204', sampleDistanceMiles: 2.4 },
  { id: 'downtown', name: 'Downtown Dallas', zip: '75201', sampleDistanceMiles: 1.8 },
  { id: 'deep_ellum', name: 'Deep Ellum', zip: '75226', sampleDistanceMiles: 3.1 },
  { id: 'bishop_arts', name: 'Bishop Arts District', zip: '75208', sampleDistanceMiles: 4.5 },
  { id: 'lakewood', name: 'Lakewood / East Dallas', zip: '75214', sampleDistanceMiles: 5.2 },
  { id: 'oak_lawn', name: 'Oak Lawn', zip: '75219', sampleDistanceMiles: 2.9 },
  { id: 'lower_greenville', name: 'Lower Greenville', zip: '75206', sampleDistanceMiles: 4.1 },
  { id: 'preston_hollow', name: 'Preston Hollow', zip: '75225', sampleDistanceMiles: 7.8 }
];

export const DALLAS_SERVICE_ZIPS = {
  '75201': { areaName: 'Downtown / Arts District', neighborhoodId: 'downtown' },
  '75202': { areaName: 'Downtown Dallas', neighborhoodId: 'downtown' },
  '75204': { areaName: 'Uptown / West Village', neighborhoodId: 'uptown' },
  '75206': { areaName: 'Lower Greenville', neighborhoodId: 'lower_greenville' },
  '75208': { areaName: 'Bishop Arts / Oak Cliff', neighborhoodId: 'bishop_arts' },
  '75214': { areaName: 'Lakewood / East Dallas', neighborhoodId: 'lakewood' },
  '75219': { areaName: 'Oak Lawn', neighborhoodId: 'oak_lawn' },
  '75225': { areaName: 'Preston Hollow', neighborhoodId: 'preston_hollow' },
  '75226': { areaName: 'Deep Ellum', neighborhoodId: 'deep_ellum' }
};

// Configurable ASAP matching window (60 minutes) and initial travel/prep arrival buffer (30 minutes)
export const ASAP_MATCHING_WINDOW_MINUTES = 60;
export const ASAP_DISPATCH_BUFFER_MINUTES = 30;

// ---------------------------------------------------------------------------
// Wallet Configuration (Stage 2 — Simulated Pro Wallet)
// ---------------------------------------------------------------------------
// All fee values in INTEGER CENTS. Dollar balances (availableBalance,
// pendingBalance, lifetimeEarned) remain as floating-point dollars per
// their established schema; cents are used only within the transaction
// ledger and for cash-out arithmetic at conversion boundaries.
export const WALLET_CONFIG = {
  INSTANT_CASHOUT_FEE_CENTS:    150,    // $1.50 simulated instant transfer fee
  STANDARD_CASHOUT_FEE_CENTS:   0,      // $0.00 — standard ACH, no fee
  INSTANT_METHOD_ID:            'instant',
  STANDARD_METHOD_ID:           'standard',
  INSTANT_LABEL:                'Instant Cash-Out — Dallas Debit Card ****4012',
  STANDARD_LABEL:               'Standard ACH Transfer — Bank of Texas ****8921',
  INSTANT_PROCESSING_TIME:      'Funds available in minutes (simulated)',
  STANDARD_PROCESSING_TIME:     '1–2 business days (simulated)',
  SCHEMA_VERSION:               2,       // wallet migration version gate
  SIMULATED_DISCLAIMER:         'SIMULATED TRANSACTION — NO REAL MONEY TRANSFERRED'
};

export function lookupDallasZip(zip) {
  const cleanZip = String(zip || '').trim().slice(0, 5);
  if (DALLAS_SERVICE_ZIPS[cleanZip]) {
    return {
      valid: true,
      zip: cleanZip,
      areaName: DALLAS_SERVICE_ZIPS[cleanZip].areaName,
      neighborhoodId: DALLAS_SERVICE_ZIPS[cleanZip].neighborhoodId
    };
  }
  return {
    valid: false,
    zip: cleanZip,
    message: 'Crewly pilot is currently limited to Dallas pilot ZIP codes (75201, 75202, 75204, 75206, 75208, 75214, 75219, 75225, 75226). Surrounding metroplex cities are scheduled for Phase 2 expansion.'
  };
}

export const FUTURE_EXPANSION_CITIES = [
  { name: 'Plano, TX', status: 'Expansion Phase 2' },
  { name: 'Frisco, TX', status: 'Expansion Phase 2' },
  { name: 'Arlington, TX', status: 'Expansion Phase 2' },
  { name: 'Fort Worth, TX', status: 'Expansion Phase 3' }
];

export const PRICING_RATES = {
  moving: {
    type: 'hourly',
    customerRate: 40, // per worker-hour
    proPayout: 25,    // per worker-hour
    name: 'Moving & Lifting Assistance',
    categoryIcon: 'truck',
    description: 'Heavy lifting, apartment moving, truck loading/unloading across Dallas.'
  },
  tv_mounting: {
    type: 'fixed',
    customerRate: 109,
    proPayout: 75,
    name: 'TV Mounting',
    categoryIcon: 'tv',
    description: 'Secure wall mounting up to 85", drywall/brick anchoring, wire concealment.'
  },
  wall_mounting: {
    type: 'fixed',
    customerRate: 95,
    proPayout: 65,
    name: 'Wall Mounting & Shelving',
    categoryIcon: 'frame',
    description: 'Shelves, artwork, mirrors, heavy mirrors, curtains, and soundbars.'
  },
  furniture_assembly: {
    type: 'fixed',
    customerRate: 90,
    proPayout: 55,
    name: 'Furniture Assembly',
    categoryIcon: 'box',
    description: 'IKEA, Wayfair, beds, desks, dressers, and outdoor patio furniture.'
  },
  furniture_disassembly: {
    type: 'fixed',
    customerRate: 80,
    proPayout: 50,
    name: 'Furniture Disassembly',
    categoryIcon: 'tool',
    description: 'Breakdown of bulky furniture, bed frames, exercise equipment for moving.'
  },
  lawn_mowing: {
    type: 'fixed',
    customerRate: 55,
    proPayout: 35,
    name: 'Lawn Mowing & Basic Care',
    categoryIcon: 'sun',
    description: 'Yard mowing, perimeter edging, blowing, and grass clipping management.'
  },
  bookingFee: 10 // Standard platform demo booking fee
};

export const INITIAL_PROS = [
  {
    id: 'pro_marcus',
    name: 'Marcus Davis',
    avatar: '👨🏾‍🔧',
    phone: '(214) 555-0142',
    tier: 'Gold',
    rating: 4.94,
    reviewCount: 88,
    reliabilityScore: 98,
    homeNeighborhood: 'Uptown Dallas',
    bio: 'Professional mover and installer with 6+ years experience in Dallas high-rises.',
    verifiedBadges: [
      { id: 'verified_mover', label: 'Verified Mover (Lift Certified 100+ lbs)' },
      { id: 'verified_tools', label: 'Verified Power Tools & Stud Finder' },
      { id: 'background_checked', label: 'Background Check Clear (Dallas County)' },
      { id: 'id_verified', label: 'State of Texas ID Verified' }
    ],
    verifiedSkills: ['moving', 'tv_mounting', 'wall_mounting', 'furniture_assembly'],
    verifiedEquipment: ['heavy_duty_dolly', 'moving_straps', 'impact_driver', 'stud_finder', 'ladder'],
    selfReportedNotes: 'Available weekends and weekday afternoons. Equipped with 2-wheel and 4-wheel dollies.',
    weeklyAvailability: {
      Monday: { start: '08:00', end: '18:00', enabled: true },
      Tuesday: { start: '08:00', end: '18:00', enabled: true },
      Wednesday: { start: '08:00', end: '18:00', enabled: true },
      Thursday: { start: '08:00', end: '18:00', enabled: true },
      Friday: { start: '08:00', end: '19:00', enabled: true },
      Saturday: { start: '08:00', end: '20:00', enabled: true },
      Sunday: { start: '10:00', end: '16:00', enabled: true }
    },
    autoBookEnabled: true,
    autoBookMaxDistanceMiles: 15,
    autoBookMinPayout: 50,
    earnings: {
      availableBalance: 275.00,
      pendingBalance: 75.00,
      lifetimeEarned: 2450.00,
      walletTransactions: []
    }
  },
  {
    id: 'pro_elena',
    name: 'Elena Rodriguez',
    avatar: '👩🏻‍🔧',
    phone: '(214) 555-0189',
    tier: 'Platinum',
    rating: 4.98,
    reviewCount: 142,
    reliabilityScore: 99,
    homeNeighborhood: 'Lakewood / East Dallas',
    bio: 'Specialized in precision mounting, art installations, and complex modular furniture assembly.',
    verifiedBadges: [
      { id: 'verified_tools', label: 'Verified Precision Tools & Wall Scanner' },
      { id: 'background_checked', label: 'Background Check Clear (Dallas County)' },
      { id: 'id_verified', label: 'State of Texas ID Verified' }
    ],
    verifiedSkills: ['tv_mounting', 'wall_mounting', 'furniture_assembly', 'furniture_disassembly'],
    verifiedEquipment: ['digital_stud_finder', 'laser_level', 'concrete_anchors', 'cordless_driver_set'],
    selfReportedNotes: 'Master assembler. Can install on masonry, brick, tile, and drywall.',
    weeklyAvailability: {
      Monday: { start: '09:00', end: '17:00', enabled: true },
      Tuesday: { start: '09:00', end: '17:00', enabled: true },
      Wednesday: { start: '09:00', end: '17:00', enabled: true },
      Thursday: { start: '09:00', end: '17:00', enabled: true },
      Friday: { start: '09:00', end: '18:00', enabled: true },
      Saturday: { start: '09:00', end: '17:00', enabled: true },
      Sunday: { start: '11:00', end: '15:00', enabled: false }
    },
    autoBookEnabled: false,
    autoBookMaxDistanceMiles: 12,
    autoBookMinPayout: 60,
    earnings: {
      availableBalance: 410.00,
      pendingBalance: 0.00,
      lifetimeEarned: 4890.00,
      walletTransactions: []
    }
  },
  {
    id: 'pro_carlos',
    name: 'Carlos Mendez',
    avatar: '👨🏽‍🌾',
    phone: '(214) 555-0233',
    tier: 'Silver',
    rating: 4.88,
    reviewCount: 45,
    reliabilityScore: 96,
    homeNeighborhood: 'Bishop Arts District',
    bio: 'Dallas native lawn care specialist with commercial-grade residential lawn equipment.',
    verifiedBadges: [
      { id: 'verified_lawn_equipment', label: 'Verified Commercial Lawn Equipment' },
      { id: 'background_checked', label: 'Background Check Clear (Dallas County)' },
      { id: 'id_verified', label: 'State of Texas ID Verified' }
    ],
    verifiedSkills: ['lawn_mowing'],
    verifiedEquipment: ['self_propelled_mower', 'gas_string_trimmer', 'leaf_blower', 'edger'],
    selfReportedNotes: 'Owns 21-inch Honda commercial mower, Stihl gas trimmer and blower.',
    weeklyAvailability: {
      Monday: { start: '07:30', end: '16:00', enabled: true },
      Tuesday: { start: '07:30', end: '16:00', enabled: true },
      Wednesday: { start: '07:30', end: '16:00', enabled: true },
      Thursday: { start: '07:30', end: '16:00', enabled: true },
      Friday: { start: '07:30', end: '16:00', enabled: true },
      Saturday: { start: '07:30', end: '17:00', enabled: true },
      Sunday: { start: '08:00', end: '13:00', enabled: true }
    },
    autoBookEnabled: true,
    autoBookMaxDistanceMiles: 18,
    autoBookMinPayout: 35,
    earnings: {
      availableBalance: 165.00,
      pendingBalance: 35.00,
      lifetimeEarned: 1340.00,
      walletTransactions: []
    }
  },
  {
    id: 'pro_jamar',
    name: 'Jamar Washington',
    avatar: '👨🏾‍💼',
    phone: '(214) 555-0377',
    tier: 'Bronze',
    rating: 4.75,
    reviewCount: 14,
    reliabilityScore: 94,
    homeNeighborhood: 'Oak Lawn',
    bio: 'Energetic helper skilled in heavy moving and furniture assembly.',
    verifiedBadges: [
      { id: 'verified_mover', label: 'Verified Mover (Lift Certified 100+ lbs)' },
      { id: 'background_checked', label: 'Background Check Clear (Dallas County)' },
      { id: 'id_verified', label: 'State of Texas ID Verified' }
    ],
    verifiedSkills: ['moving', 'furniture_assembly'],
    verifiedEquipment: ['hand_truck', 'shoulder_dolly'],
    selfReportedNotes: 'Strong, reliable, careful with stairs and elevator loading.',
    weeklyAvailability: {
      Monday: { start: '10:00', end: '18:00', enabled: true },
      Tuesday: { start: '10:00', end: '18:00', enabled: true },
      Wednesday: { start: '10:00', end: '18:00', enabled: true },
      Thursday: { start: '10:00', end: '18:00', enabled: true },
      Friday: { start: '10:00', end: '20:00', enabled: true },
      Saturday: { start: '08:00', end: '20:00', enabled: true },
      Sunday: { start: '09:00', end: '18:00', enabled: true }
    },
    autoBookEnabled: false,
    autoBookMaxDistanceMiles: 10,
    autoBookMinPayout: 40,
    earnings: {
      availableBalance: 85.00,
      pendingBalance: 0.00,
      lifetimeEarned: 520.00,
      walletTransactions: []
    }
  }
];

export const INITIAL_CUSTOMERS = [
  {
    id: 'cust_sarah',
    name: 'Sarah Jenkins',
    avatar: '👩🏼',
    phone: '(214) 555-8831',
    neighborhood: 'Uptown Dallas',
    address: '2800 McKinney Ave, Apt 402, Dallas, TX 75204'
  },
  {
    id: 'cust_david',
    name: 'David Miller',
    avatar: '👨🏻',
    phone: '(214) 555-4920',
    neighborhood: 'Lakewood / East Dallas',
    address: '6820 Lakewood Blvd, Dallas, TX 75214'
  }
];

export const INITIAL_BOOKINGS = [
  {
    id: 'CRW-1001',
    customerId: 'cust_sarah',
    customerName: 'Sarah Jenkins',
    neighborhoodId: 'uptown',
    neighborhoodName: 'Uptown Dallas',
    address: '2800 McKinney Ave, Apt 402, Dallas, TX 75204',
    serviceCategory: 'moving',
    serviceTitle: 'Moving & Lifting Assistance',
    timingType: 'scheduled',
    scheduledDate: '2026-11-08',
    scheduledTime: '10:00',
    estimatedDurationHours: 3,
    workersNeeded: 2,
    serviceDetails: {
      workersNeeded: 2,
      hours: 3,
      truckNeeded: false,
      stairsElevator: 'Elevator access available',
      largeItemsCount: 'Sofa, king bed, dining table, 15 boxes',
      notes: 'Moving from 4th floor to storage unit in same building.'
    },
    // Pricing visibility separation
    pricing: {
      customerSubtotal: 240, // 2 workers * 3 hrs * $40
      bookingFee: 10,
      customerTotal: 250,
      workerPayoutPerPerson: 75, // 3 hrs * $25
      totalWorkerPayouts: 150,   // 2 * $75
      grossPlatformRevenue: 100  // $250 - $150 (before operating expenses)
    },
    // Multi-worker assignment decomposition
    workerAssignments: [
      {
        slotId: 'slot_1',
        roleTitle: 'Lead Mover',
        status: 'assigned',
        assignedProId: 'pro_marcus',
        assignedProName: 'Marcus Davis',
        assignedAt: '2026-11-05T09:15:00Z',
        payout: 75
      },
      {
        slotId: 'slot_2',
        roleTitle: 'Assistant Mover',
        status: 'unassigned',
        assignedProId: null,
        assignedProName: null,
        assignedAt: null,
        payout: 75
      }
    ],
    // Overall status: remains partially_filled until all slots are assigned!
    overallStatus: 'partially_filled', // 'waiting_for_pros' | 'partially_filled' | 'fully_confirmed' | 'in_progress' | 'completed' | 'cancelled'
    partialFulfillmentNotice: '1 of 2 workers assigned. Crewly is matching your 2nd mover.',
    messages: [
      {
        id: 'msg_1',
        senderRole: 'system',
        senderName: 'Crewly Match',
        timestamp: '09:15 AM',
        text: 'Marcus Davis (Lead Mover) accepted the assignment.'
      },
      {
        id: 'msg_2',
        senderRole: 'pro',
        senderName: 'Marcus Davis',
        timestamp: '09:16 AM',
        text: 'Hi Sarah! I have your booking on my schedule for Sunday. I will bring two dollies and heavy-duty straps.'
      }
    ],
    rating: null,
    review: null,
    workerReviews: [],
    createdAt: '2026-11-05T09:10:00Z'
  },
  {
    id: 'CRW-1002',
    customerId: 'cust_david',
    customerName: 'David Miller',
    neighborhoodId: 'lakewood',
    neighborhoodName: 'Lakewood / East Dallas',
    address: '6820 Lakewood Blvd, Dallas, TX 75214',
    serviceCategory: 'tv_mounting',
    serviceTitle: 'TV Mounting (65" Living Room)',
    timingType: 'scheduled',
    scheduledDate: '2026-11-06',
    scheduledTime: '14:00',
    estimatedDurationHours: 1.5,
    workersNeeded: 1,
    serviceDetails: {
      tvSize: '65 inch',
      wallType: 'Drywall with wood studs',
      bracketSupplied: 'Yes, customer has full-motion bracket',
      wireConcealment: 'Surface raceway',
      notes: 'Mounting above fireplace console.'
    },
    pricing: {
      customerSubtotal: 109,
      bookingFee: 10,
      customerTotal: 119,
      workerPayoutPerPerson: 75,
      totalWorkerPayouts: 75,
      grossPlatformRevenue: 44
    },
    workerAssignments: [
      {
        slotId: 'slot_1',
        roleTitle: 'Mounting Specialist',
        status: 'assigned',
        assignedProId: 'pro_elena',
        assignedProName: 'Elena Rodriguez',
        assignedAt: '2026-11-05T10:00:00Z',
        payout: 75
      }
    ],
    overallStatus: 'fully_confirmed',
    partialFulfillmentNotice: null,
    messages: [
      {
        id: 'msg_3',
        senderRole: 'system',
        senderName: 'Crewly Match',
        timestamp: '10:00 AM',
        text: 'Elena Rodriguez accepted your TV mounting booking.'
      }
    ],
    rating: null,
    review: null,
    workerReviews: [],
    createdAt: '2026-11-05T09:45:00Z'
  },
  {
    id: 'CRW-1003',
    customerId: 'cust_david',
    customerName: 'David Miller',
    neighborhoodId: 'lakewood',
    neighborhoodName: 'Lakewood / East Dallas',
    address: '6820 Lakewood Blvd, Dallas, TX 75214',
    serviceCategory: 'lawn_mowing',
    serviceTitle: 'Lawn Mowing & Basic Care',
    timingType: 'scheduled',
    scheduledDate: '2026-11-04',
    scheduledTime: '11:00',
    estimatedDurationHours: 1,
    workersNeeded: 1,
    serviceDetails: {
      lotSize: 'Medium yard (up to 1/4 acre)',
      gateAccess: 'Standard 36-inch gate',
      requiredEquipment: ['lawn_mower', 'string_trimmer'],
      edgeTrimming: true,
      notes: 'Front and back yard. Please close backyard gate when done.'
    },
    pricing: {
      customerSubtotal: 55,
      bookingFee: 10,
      customerTotal: 65,
      workerPayoutPerPerson: 35,
      totalWorkerPayouts: 35,
      grossPlatformRevenue: 30
    },
    workerAssignments: [
      {
        slotId: 'slot_1',
        roleTitle: 'Lawn Care Specialist',
        status: 'completed',
        assignedProId: 'pro_carlos',
        assignedProName: 'Carlos Mendez',
        assignedAt: '2026-11-04T08:00:00Z',
        payout: 35,
        payoutReleased: true
      }
    ],
    overallStatus: 'completed',
    partialFulfillmentNotice: null,
    messages: [
      {
        id: 'msg_4',
        senderRole: 'system',
        senderName: 'Crewly Match',
        timestamp: '11:00 AM',
        text: 'Carlos Mendez marked job completed.'
      }
    ],
    rating: 5,
    review: null,
    workerReviews: [
      {
        slotId: 'slot_1',
        proId: 'pro_carlos',
        proName: 'Carlos Mendez',
        roleTitle: 'Lawn Care Specialist',
        stars: 5,
        comment: 'Carlos did a phenomenal job! Edges are super crisp and cleaned up all clippings from the driveway.',
        date: '2026-11-04',
        disputed: false
      }
    ],
    createdAt: '2026-11-03T14:20:00Z'
  },
  {
    id: 'CRW-1004',
    customerId: 'cust_sarah',
    customerName: 'Sarah Jenkins',
    neighborhoodId: 'uptown',
    neighborhoodName: 'Uptown Dallas',
    address: '2800 McKinney Ave, Apt 402, Dallas, TX 75204',
    serviceCategory: 'moving',
    serviceTitle: 'Moving & Lifting Assistance (Upcoming Weekend)',
    timingType: 'scheduled',
    scheduledDate: '2026-11-15',
    scheduledTime: '10:00',
    estimatedDurationHours: 3,
    workersNeeded: 2,
    serviceDetails: {
      workersNeeded: 2,
      hours: 3,
      truckNeeded: false,
      stairsElevator: 'Elevator access available',
      largeItemsCount: 'Sofa, king bed, dining table, 15 boxes',
      notes: 'Upcoming weekend move. Need 2 movers.'
    },
    pricing: {
      customerSubtotal: 240,
      bookingFee: 10,
      customerTotal: 250,
      workerPayoutPerPerson: 75,
      totalWorkerPayouts: 150,
      grossPlatformRevenue: 100
    },
    workerAssignments: [
      {
        slotId: 'slot_1',
        roleTitle: 'Lead Mover',
        status: 'assigned',
        assignedProId: 'pro_marcus',
        assignedProName: 'Marcus Davis',
        assignedAt: '2026-11-10T09:15:00Z',
        payout: 75
      },
      {
        slotId: 'slot_2',
        roleTitle: 'Assistant Mover',
        status: 'unassigned',
        assignedProId: null,
        assignedProName: null,
        assignedAt: null,
        payout: 75
      }
    ],
    overallStatus: 'partially_filled',
    partialFulfillmentNotice: '1 of 2 workers assigned. Crewly is matching your 2nd mover.',
    messages: [
      {
        id: 'msg_1004_1',
        senderRole: 'system',
        senderName: 'Crewly Match',
        timestamp: '09:15 AM',
        text: 'Marcus Davis has accepted the Lead Mover assignment.'
      }
    ],
    rating: null,
    review: null,
    workerReviews: [],
    createdAt: '2026-11-10T09:10:00Z'
  }
];

// ---------------------------------------------------------------------------
// Fictional Demonstration Initial Records for Stage 3 Admin/Dispatch
// (Product Lead Adjustment 4: Explicitly labeled as fictional demo data)
// ---------------------------------------------------------------------------

export const INITIAL_SUPPORT_CASES = [
  {
    caseId: 'CASE-101',
    category: 'support',
    bookingId: 'CRW-1004',
    customerId: 'cust_sarah',
    proId: null,
    issueType: 'missing_second_mover',
    priority: 'high',
    status: 'open',
    title: 'Unfilled Second Mover on 2-Person Moving Booking',
    notes: [
      {
        noteId: 'note_101_1',
        author: 'Dallas Dispatch Lead (Fictional Demo Seed)',
        timestamp: '2026-11-10T09:20:00.000Z',
        text: 'Lead mover slot assigned to Marcus Davis. Assistant Mover slot 2 remains open; awaiting qualified mover candidate.'
      }
    ],
    createdAt: '2026-11-10T09:20:00.000Z',
    updatedAt: '2026-11-10T09:20:00.000Z'
  }
];

export const INITIAL_AUDIT_LOG = [
  {
    auditId: 'audit_init_seed_1',
    timestamp: '2026-11-05T09:15:00.000Z',
    adminName: 'Crewly Dispatch System (Fictional Demo Seed)',
    actionType: 'worker_assigned',
    bookingId: 'CRW-1001',
    proId: 'pro_marcus',
    slotId: 'slot_1',
    previousValue: 'unassigned',
    newValue: 'assigned',
    reason: 'Baseline marketplace worker assignment (Fictional demonstration seed)'
  },
  {
    auditId: 'audit_init_seed_2',
    timestamp: '2026-11-05T10:00:00.000Z',
    adminName: 'Crewly Dispatch System (Fictional Demo Seed)',
    actionType: 'worker_assigned',
    bookingId: 'CRW-1002',
    proId: 'pro_elena',
    slotId: 'slot_1',
    previousValue: 'unassigned',
    newValue: 'assigned',
    reason: 'Single-worker TV mounting dispatch (Fictional demonstration seed)'
  },
  {
    auditId: 'audit_init_seed_3',
    timestamp: '2026-11-10T09:15:00.000Z',
    adminName: 'Crewly Dispatch System (Fictional Demo Seed)',
    actionType: 'worker_assigned',
    bookingId: 'CRW-1004',
    proId: 'pro_marcus',
    slotId: 'slot_1',
    previousValue: 'unassigned',
    newValue: 'assigned',
    reason: 'Advance moving booking initial crew assignment (Fictional demonstration seed)'
  }
];

// ---------------------------------------------------------------------------
// Stage 4 Phase 4.2: AI-Assisted Dispatch Configuration (Offline Safe / No Credentials)
// ---------------------------------------------------------------------------
export const AI_DISPATCH_CONFIG = {
  // Phase 4.2 global default keeps live proxy off for hosted GitHub Pages / file:// safety.
  // Phase 4.4 activates the local loopback proxy ONLY on approved local development origins.
  PROXY_ENABLED: false,
  PROXY_ENDPOINT: null,
  LOCAL_PROXY_ENDPOINT: 'http://127.0.0.1:8787/api/dispatch/recommend',
  LOCAL_PROXY_ALLOWED_ORIGINS: ['http://localhost:8000', 'http://127.0.0.1:8000'],
  REQUEST_TIMEOUT_MS: 10000,
  MAX_OPEN_SLOTS_IN_PROMPT: 4,
  MAX_ELIGIBLE_CANDIDATES_IN_PROMPT: 10,
  MAX_RECOMMENDATIONS_PER_SLOT: 3,
  MAX_COMBINATION_PLANS: 3,
  REASON_MAX_CHARS: 240,
  BULLET_MAX_CHARS: 140,
  ALLOWED_AUDIT_ACTIONS: [
    'ai_dispatch_recommended',
    'ai_dispatch_fallback_used',
    'ai_dispatch_recommendation_rejected'
  ],
  PROVENANCE_LABELS: {
    LIVE_AI: 'Live Gemini AI Recommendation (Advisory Only — Admin Approval Required)',
    MOCK_TEST_MODE: 'Mock AI Response — Test Mode (Simulated Inference — No Live Gemini Call)',
    FALLBACK: 'Deterministic Rules-Based Ranking (Offline Fallback — No LLM Called)',
    ZERO_ELIGIBLE: 'Deterministic Rules Engine — Zero Eligible Pros Available (No LLM Called)'
  },
  NEIGHBORHOOD_LIMITATION_NOTE:
    'Neighborhood matching compares Dallas pilot zone labels only and does not measure GPS proximity, real-time traffic, or driving ETAs.',
  TRUST_LIMITATIONS_DISCLOSURE:
    'Demonstration Limitation: Current marketplace state and eligibility rules reside in browser localStorage. Future server proxies must treat client-supplied eligibility as untrusted hints rather than production authority and must enforce authentication before any public deployment.',
  // Transparent, adjustable rules-based fallback scoring model (Adjustment 5).
  // Eligibility via canProAcceptSlot() ALWAYS takes strict priority over scoring weights.
  FALLBACK_SCORING_WEIGHTS: {
    SAME_NEIGHBORHOOD_POINTS: 20,
    TIER_POINTS: {
      Platinum: 14,
      Gold: 11,
      Silver: 7,
      Bronze: 4
    },
    RELIABILITY_MULTIPLIER: 0.35,
    RATING_MULTIPLIER: 8,
    COMPLETED_JOB_POINT_RATE: 0.5,
    COMPLETED_JOB_BONUS_CAP: 15,
    ACTIVE_WORKLOAD_PENALTY: 6
  }
};
