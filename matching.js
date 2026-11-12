/**
 * Crewly Matching, State & Business Logic Engine
 * Course: INSY 3331: Artificial Intelligence for Business
 * Pilot Market: Dallas, Texas
 */

import {
  PRICING_RATES,
  DALLAS_NEIGHBORHOODS,
  DALLAS_SERVICE_ZIPS,
  lookupDallasZip,
  ASAP_MATCHING_WINDOW_MINUTES,
  ASAP_DISPATCH_BUFFER_MINUTES,
  WALLET_CONFIG,
  AI_DISPATCH_CONFIG,
  INITIAL_PROS,
  INITIAL_CUSTOMERS,
  INITIAL_BOOKINGS,
  INITIAL_SUPPORT_CASES,
  INITIAL_AUDIT_LOG
} from './data.js';

const STORAGE_KEY = 'crewly_marketplace_state_v1';

// ---------------------------------------------------------------------------
// 0. Dallas Pilot Local Time & Scheduling Helpers
// ---------------------------------------------------------------------------
export function getDallasLocalNow() {
  const now = new Date();
  const dallasFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = dallasFormatter.formatToParts(now);
  const partMap = {};
  parts.forEach(p => partMap[p.type] = p.value);
  const hour = partMap.hour === '24' ? '00' : partMap.hour;
  const dateStr = `${partMap.year}-${partMap.month}-${partMap.day}`;
  const timeStr = `${hour}:${partMap.minute}`;
  return { dateStr, timeStr, fullDate: new Date(`${dateStr}T${timeStr}:00`) };
}

export function isAsapExpired(booking, nowMs) {
  if (!booking || booking.timingType !== 'asap') return false;
  if (!booking.asapExpiresAt) return false;
  const current = typeof nowMs === 'number' ? nowMs : Date.now();
  return current > new Date(booking.asapExpiresAt).getTime();
}

export function getAsapRemainingMinutes(booking, nowMs) {
  if (!booking || booking.timingType !== 'asap') return 0;
  if (!booking.asapExpiresAt) return 0;
  const current = typeof nowMs === 'number' ? nowMs : Date.now();
  const diffMs = new Date(booking.asapExpiresAt).getTime() - current;
  return Math.max(0, Math.ceil(diffMs / (60 * 1000)));
}

/**
 * Returns a coordinated work interval [startMin, endMin] for an assignment.
 * All Pros on the same multi-worker booking share this coordinated work period.
 * Uses realistic transit/arrival assumptions (30m buffer for ASAP dispatch).
 */
export function getBookingWorkInterval(booking) {
  const durationMinutes = Math.round((parseFloat(booking.estimatedDurationHours) || 1.5) * 60);

  let startMin = 600; // default 10:00 AM
  const timeStr = booking.scheduledTime || '10:00';
  if (timeStr.includes(':')) {
    const [h, m] = timeStr.split(':').map(Number);
    if (!isNaN(h) && !isNaN(m)) {
      startMin = h * 60 + m;
    }
  }

  // For ASAP bookings, work starts after realistic travel/arrival buffer
  if (booking.timingType === 'asap') {
    startMin += (ASAP_DISPATCH_BUFFER_MINUTES || 30);
  }

  const endMin = startMin + durationMinutes;
  return {
    date: booking.scheduledDate,
    startMin,
    endMin,
    durationMinutes
  };
}

// ---------------------------------------------------------------------------
// Wallet Utility Helpers (Stage 2)
// ---------------------------------------------------------------------------

/**
 * Convert floating-point dollar balance to integer cents.
 * Math.round prevents accumulated float noise (e.g. 2.9999999 → 300).
 */
export function dollarsToCents(dollars) {
  return Math.round((dollars || 0) * 100);
}

/**
 * Convert integer cents to a formatted dollar string.
 * Always returns two decimal places (e.g. 7500 → "75.00").
 */
export function centsToDollars(cents) {
  return ((cents || 0) / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// 1. Multi-Tab Session & Role Separation
// ---------------------------------------------------------------------------
export function getActiveRole() {
  if (typeof window !== 'undefined' && window.location && typeof URLSearchParams !== 'undefined') {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const roleFromUrl = urlParams.get('role');
      if (roleFromUrl === 'customer' || roleFromUrl === 'pro' || roleFromUrl === 'admin') {
        sessionStorage.setItem('crewly_active_role', roleFromUrl);
        return roleFromUrl;
      }
    } catch (e) {
      // Safe fallback
    }
  }
  const roleFromSession = sessionStorage.getItem('crewly_active_role');
  if (roleFromSession) {
    return roleFromSession;
  }
  return 'customer';
}

export function setActiveRole(role) {
  sessionStorage.setItem('crewly_active_role', role);
  if (typeof window !== 'undefined' && window.location) {
    if (typeof URL !== 'undefined' && window.history && window.history.replaceState) {
      try {
        const url = new URL(window.location.href || 'http://localhost/index.html');
        url.searchParams.set('role', role);
        window.history.replaceState({}, '', url.toString());
      } catch (e) {
        // Safe fallback in test or constrained environments
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2a. State Migration (Schema Upgrades — Preserves Existing Data)
// ---------------------------------------------------------------------------
function migrateStateIfNeeded(state) {
  let dirty = false;

  // Ensure activeCustomerId is always initialized
  if (!state.activeCustomerId) {
    state.activeCustomerId = 'cust_sarah';
    dirty = true;
  }

  state.bookings = (state.bookings || []).map(b => {
    // Ensure every booking has customerId associated
    if (!b.customerId) {
      if (b.customerName && b.customerName.includes('David')) {
        b.customerId = 'cust_david';
      } else {
        b.customerId = 'cust_sarah';
      }
      dirty = true;
    }

    // --- Migrate: ASAP window fields on existing bookings ---
    if (b.timingType === 'asap') {
      if (!b.asapRequestedAt) {
        b.asapRequestedAt = b.createdAt || new Date().toISOString();
        dirty = true;
      }
      if (!b.asapExpiresAt) {
        const reqTime = new Date(b.asapRequestedAt).getTime();
        b.asapExpiresAt = new Date(reqTime + (ASAP_MATCHING_WINDOW_MINUTES || 60) * 60 * 1000).toISOString();
        b.asapMatchingWindowMinutes = ASAP_MATCHING_WINDOW_MINUTES || 60;
        dirty = true;
      }
    }

    // --- Migrate: per-slot payoutReleased flag ---
    // For slots already in 'completed' status with no payoutReleased flag,
    // mark as already released so historical completed jobs cannot generate
    // duplicate earnings credits on future interactions.
    b.workerAssignments = (b.workerAssignments || []).map(slot => {
      if (slot.status === 'completed' && slot.payoutReleased === undefined) {
        slot.payoutReleased = true;
        dirty = true;
      }
      return slot;
    });

    // --- Migrate: per-worker workerReviews array ---
    // Convert old single booking.review to the new per-worker workerReviews[].
    // The old booking.review field is preserved as null after migration so
    // the booking schema remains stable.
    if (!b.workerReviews) {
      if (b.review && b.review.stars) {
        // Attribute the legacy review to the first completed assigned slot
        const targetSlot = b.workerAssignments.find(
          s => s.assignedProId && s.status === 'completed'
        );
        b.workerReviews = targetSlot
          ? [{
              slotId: targetSlot.slotId,
              proId: targetSlot.assignedProId,
              proName: targetSlot.assignedProName,
              roleTitle: targetSlot.roleTitle,
              stars: b.review.stars,
              comment: b.review.comment || '',
              date: b.review.date || new Date().toISOString().split('T')[0],
              disputed: b.review.disputed || false
            }]
          : [];
      } else {
        b.workerReviews = [];
      }
      dirty = true;
    }

    // --- Migrate: sanitize payout amounts from customer-visible system messages ---
    // Strips worker payout dollar figures from Crewly Dispatch system messages.
    // Customer and Pro authored messages (senderRole !== 'system') are never
    // modified — only system-generated dispatch notifications are sanitized.
    b.messages = (b.messages || []).map(m => {
      if (m.senderRole === 'system') {
        const original = m.text;
        // Pattern 1: "Name joined as Role ($75 payout)." or "Name joined as Role ($75 offered payout)." →
        //            "Name has accepted the Role assignment."
        m.text = m.text.replace(
          /^(.+?) joined as (.+?)\s*\(\$[\d.]+\s*(?:offered\s*)?payout\)\.?$/i,
          '$1 has accepted the $2 assignment.'
        );
        // Pattern 2: Generic cleanup for any other remaining payout references in system messages
        m.text = m.text.replace(/\s*\((?:worker\s*)?(?:offered\s*)?payout(?:\s*of)?\s*\$[\d,.]+\)/gi, '');
        m.text = m.text.replace(/\s*\(\$[\d,.]+\s*(?:offered\s*)?payout\)/gi, '');
        if (m.text !== original) dirty = true;
      }
      return m;
    });

    return b;
  });

  // ---------------------------------------------------------------------------
  // --- Migrate: Wallet Schema v2 (Transaction Ledger) ---
  // Gate: runs only once per stored state. Safe across repeated page loads.
  // Does NOT recalculate, reset, or add to any numeric balance fields.
  // ---------------------------------------------------------------------------
  if (!state.walletSchemaVersion || state.walletSchemaVersion < WALLET_CONFIG.SCHEMA_VERSION) {
    const migrationTimestamp = new Date().toISOString();
    const migrationDate = migrationTimestamp.split('T')[0];

    (state.pros || []).forEach(pro => {
      // Ensure earnings object exists
      if (!pro.earnings) {
        pro.earnings = { availableBalance: 0, pendingBalance: 0, lifetimeEarned: 0 };
      }
      // Ensure walletTransactions array exists
      if (!Array.isArray(pro.earnings.walletTransactions)) {
        pro.earnings.walletTransactions = [];
      }

      // Insert opening-balance snapshot only if none already present.
      // This is a reference record only — it documents the pre-Stage-2
      // balance without affecting any numeric totals.
      const hasOpeningSnapshot = pro.earnings.walletTransactions.some(
        t => t.type === 'opening_balance_snapshot'
      );
      if (!hasOpeningSnapshot) {
        pro.earnings.walletTransactions.push({
          txId: `txn_${pro.id}_opening_v2`,
          proId: pro.id,
          type: 'opening_balance_snapshot',
          bookingId: null,
          slotId: null,
          description: 'Crewly Dallas Pilot — Prior earnings summary (not a new credit). Balance carried forward from pre-Stage-2 records.',
          // Snapshot values in cents for reference — do NOT use to modify balances
          snapshotAvailableCents: dollarsToCents(pro.earnings.availableBalance),
          snapshotPendingCents:   dollarsToCents(pro.earnings.pendingBalance),
          snapshotLifetimeCents:  dollarsToCents(pro.earnings.lifetimeEarned),
          amountCents:  0,   // Explicitly zero — no balance change
          feeCents:     0,
          netCents:     0,
          isoTimestamp: migrationTimestamp,
          displayDate:  migrationDate,
          status:       'historical_snapshot',
          isSimulated:  true,
          isHistoricalImport: true
        });
        dirty = true;
      }

      // Insert historical-import records for completed assignments that were
      // already paid before Stage 2. These are reference-only records:
      // they do NOT credit any balance (the payout is already in availableBalance
      // via the opening snapshot above).
      (state.bookings || []).forEach(b => {
        (b.workerAssignments || []).forEach(slot => {
          if (
            slot.assignedProId === pro.id &&
            slot.status === 'completed' &&
            slot.payoutReleased === true
          ) {
            const histTxId = `txn_${pro.id}_hist_${b.id}_${slot.slotId}`;
            const alreadyImported = pro.earnings.walletTransactions.some(
              t => t.txId === histTxId
            );
            if (!alreadyImported) {
              const jobDate = (slot.assignedAt || b.scheduledDate || migrationDate).split('T')[0];
              pro.earnings.walletTransactions.push({
                txId: histTxId,
                proId: pro.id,
                type: 'historical_job_import',
                bookingId:   b.id,
                slotId:      slot.slotId,
                description: `${b.serviceTitle || 'Job'} — ${slot.roleTitle || 'Worker'} (historical record — already included in opening balance; no duplicate credit)`,
                amountCents: dollarsToCents(slot.payout),
                feeCents:    0,
                netCents:    dollarsToCents(slot.payout),
                isoTimestamp: slot.assignedAt || b.createdAt || migrationTimestamp,
                displayDate:  jobDate,
                status:       'historical_import',
                isSimulated:  true,
                isHistoricalImport: true
              });
              dirty = true;
            }
          }
        });
      });
    });

    state.walletSchemaVersion = WALLET_CONFIG.SCHEMA_VERSION;
    dirty = true;
  }

  // ---------------------------------------------------------------------------
  // --- Migrate: Stage 3 Admin & Dispatch Schema v3 ---
  // Gate: runs only once per stored state.
  // ---------------------------------------------------------------------------
  if (!state.adminSchemaVersion || state.adminSchemaVersion < 3) {
    if (!Array.isArray(state.adminAuditLog)) {
      state.adminAuditLog = JSON.parse(JSON.stringify(INITIAL_AUDIT_LOG || []));
      dirty = true;
    }
    if (!Array.isArray(state.supportCases)) {
      state.supportCases = JSON.parse(JSON.stringify(INITIAL_SUPPORT_CASES || []));
      dirty = true;
    }

    // Ensure valid future demo booking CRW-1004 is present for dispatch demonstration
    const hasCrw1004 = (state.bookings || []).some(b => b.id === 'CRW-1004');
    if (!hasCrw1004) {
      const crw1004Seed = INITIAL_BOOKINGS.find(b => b.id === 'CRW-1004');
      if (crw1004Seed) {
        state.bookings.push(JSON.parse(JSON.stringify(crw1004Seed)));
        dirty = true;
      }
    }

    state.adminSchemaVersion = 3;
    dirty = true;
  }

  // Stage 3.5: Reconcile active booking status if workers have progressed into active states
  if (Array.isArray(state.bookings)) {
    state.bookings.forEach(b => {
      if (b && b.overallStatus !== 'cancelled') {
        const isActive = b.workerAssignments && b.workerAssignments.some(s => ['traveling', 'arrived', 'in_progress', 'completed'].includes(s.status));
        if (isActive && b.overallStatus === 'fully_confirmed') {
          recalculateBookingStatus(b);
          dirty = true;
        }
      }
    });
  }

  if (dirty) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  return state;
}

// ---------------------------------------------------------------------------
// 2. Central State Hydration & Storage
// ---------------------------------------------------------------------------
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return migrateStateIfNeeded(resetStateToSeed());
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.bookings || !parsed.pros) {
      return migrateStateIfNeeded(resetStateToSeed());
    }
    return migrateStateIfNeeded(parsed);
  } catch (err) {
    console.warn('Error loading Crewly state from localStorage; resetting to seed.', err);
    return migrateStateIfNeeded(resetStateToSeed());
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // Dispatch a local custom event so this same window's UI updates
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('crewly-state-updated', { detail: state }));
  }
}

export function resetStateToSeed() {
  const initialState = {
    version: '1.0.0',
    pilotMarket: 'Dallas, Texas',
    rates: PRICING_RATES,
    neighborhoods: DALLAS_NEIGHBORHOODS,
    pros: JSON.parse(JSON.stringify(INITIAL_PROS)),
    customers: JSON.parse(JSON.stringify(INITIAL_CUSTOMERS)),
    bookings: JSON.parse(JSON.stringify(INITIAL_BOOKINGS)),
    activeProId: 'pro_marcus',
    activeCustomerId: 'cust_sarah',
    adminSchemaVersion: 3,
    adminAuditLog: JSON.parse(JSON.stringify(INITIAL_AUDIT_LOG || [])),
    supportCases: JSON.parse(JSON.stringify(INITIAL_SUPPORT_CASES || [])),
    lastResetTimestamp: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('crewly-state-updated', { detail: initialState }));
  }
  return initialState;
}

// ---------------------------------------------------------------------------
// 3. Pricing Calculation Logic (Strict Separation of Visibility)
// ---------------------------------------------------------------------------
export function calculatePricing(serviceCategory, options = {}) {
  const rateConfig = PRICING_RATES[serviceCategory];
  if (!rateConfig) {
    throw new Error(`Unknown service category: ${serviceCategory}`);
  }

  const bookingFee = PRICING_RATES.bookingFee; // $10 standard demo platform fee

  if (rateConfig.type === 'hourly') {
    const workers = Math.max(1, parseInt(options.workersNeeded || 2, 10));
    const hours = Math.max(1, parseFloat(options.hours || 3));
    
    const customerSubtotal = workers * hours * rateConfig.customerRate;
    const customerTotal = customerSubtotal + bookingFee;
    const workerPayoutPerPerson = hours * rateConfig.proPayout;
    const totalWorkerPayouts = workers * workerPayoutPerPerson;
    const grossPlatformRevenue = customerTotal - totalWorkerPayouts; // Gross before expenses

    return {
      serviceCategory,
      rateType: 'hourly',
      workersNeeded: workers,
      hours,
      customerRatePerHour: rateConfig.customerRate,
      customerSubtotal,
      bookingFee,
      customerTotal,
      workerPayoutPerPerson,
      totalWorkerPayouts,
      grossPlatformRevenue,
      disclaimer: 'Demonstration assumptions — Dallas pilot market'
    };
  } else {
    // Fixed Price services (TV Mounting, Wall Mounting, Assembly, Disassembly, Lawn Mowing)
    let unitMultiplier = 1;
    if (options.itemCount) {
      unitMultiplier = Math.max(1, parseInt(options.itemCount, 10));
    }

    const customerSubtotal = rateConfig.customerRate * unitMultiplier;
    const customerTotal = customerSubtotal + bookingFee;
    const workerPayoutPerPerson = rateConfig.proPayout * unitMultiplier;
    const totalWorkerPayouts = workerPayoutPerPerson;
    const grossPlatformRevenue = customerTotal - totalWorkerPayouts;

    return {
      serviceCategory,
      rateType: 'fixed',
      workersNeeded: 1,
      hours: options.estimatedDurationHours || (serviceCategory === 'tv_mounting' ? 1.5 : 1),
      customerSubtotal,
      bookingFee,
      customerTotal,
      workerPayoutPerPerson,
      totalWorkerPayouts,
      grossPlatformRevenue,
      disclaimer: 'Demonstration assumptions — Dallas pilot market'
    };
  }
}

// ---------------------------------------------------------------------------
// 4. Job Assignment Decomposition for Multi-Worker Jobs
// ---------------------------------------------------------------------------
export function createBooking({
  customerId,
  address,
  zipCode,
  serviceCategory,
  timingType,
  scheduledDate,
  scheduledTime,
  intakeDetails
}) {
  const dallasNow = getDallasLocalNow();

  // Validate timing (Priority 2: Prevent Past-Date Bookings)
  let finalDate = scheduledDate;
  let finalTime = scheduledTime;
  let asapRequestedAt = null;
  let asapExpiresAt = null;

  if (timingType === 'asap') {
    const nowMs = Date.now();
    asapRequestedAt = new Date(nowMs).toISOString();
    asapExpiresAt = new Date(nowMs + (ASAP_MATCHING_WINDOW_MINUTES || 60) * 60 * 1000).toISOString();
    finalDate = dallasNow.dateStr;
    finalTime = dallasNow.timeStr; // Valid HH:MM timestamp
  } else {
    if (!finalDate || finalDate < dallasNow.dateStr) {
      throw new Error(`Scheduled date (${finalDate || 'unspecified'}) cannot be in the past.`);
    }
    if (finalDate === dallasNow.dateStr && finalTime && finalTime < dallasNow.timeStr) {
      throw new Error(`Scheduled time (${finalTime}) has already passed today. Please pick an upcoming time.`);
    }
  }

  // Validate Location & ZIP code (Priority 4: Simplify Service Location)
  const zipResult = lookupDallasZip(zipCode);
  if (!zipResult.valid) {
    throw new Error(zipResult.message);
  }

  const state = loadState();
  const customer = state.customers.find(c => c.id === customerId) || state.customers[0];
  const rateConfig = state.rates[serviceCategory];

  const workersCount = serviceCategory === 'moving'
    ? Math.max(1, parseInt(intakeDetails.workersNeeded || 2, 10))
    : 1;

  const hours = serviceCategory === 'moving'
    ? Math.max(1, parseFloat(intakeDetails.hours || 3))
    : (serviceCategory === 'tv_mounting' ? 1.5 : 1);

  const pricing = calculatePricing(serviceCategory, {
    workersNeeded: workersCount,
    hours: hours,
    itemCount: intakeDetails.itemCount || 1
  });

  // Create discrete assignment slots for every required worker
  const workerAssignments = [];
  for (let i = 1; i <= workersCount; i++) {
    const roleTitle = serviceCategory === 'moving'
      ? (i === 1 ? 'Lead Mover' : `Mover (Position ${i})`)
      : `${rateConfig.name} Specialist`;

    workerAssignments.push({
      slotId: `slot_${i}`,
      roleTitle,
      status: 'unassigned', // 'unassigned' | 'assigned' | 'traveling' | 'arrived' | 'in_progress' | 'completed'
      assignedProId: null,
      assignedProName: null,
      assignedAt: null,
      payout: pricing.workerPayoutPerPerson,
      payoutReleased: false
    });
  }

  const newBooking = {
    id: `CRW-${Math.floor(1000 + Math.random() * 9000)}`,
    customerId: customer.id,
    customerName: customer.name,
    neighborhoodId: zipResult.neighborhoodId,
    neighborhoodName: zipResult.areaName,
    zipCode: zipResult.zip,
    address: address || customer.address,
    serviceCategory,
    serviceTitle: rateConfig.name,
    timingType: timingType || 'scheduled',
    scheduledDate: finalDate,
    scheduledTime: finalTime || '10:00',
    asapRequestedAt,
    asapExpiresAt,
    asapMatchingWindowMinutes: timingType === 'asap' ? (ASAP_MATCHING_WINDOW_MINUTES || 60) : null,
    estimatedDurationHours: hours,
    workersNeeded: workersCount,
    serviceDetails: intakeDetails,
    pricing,
    workerAssignments,
    overallStatus: 'waiting_for_pros',
    partialFulfillmentNotice: workersCount > 1
      ? `0 of ${workersCount} workers assigned. Looking for qualified Dallas Pros.`
      : 'Waiting for qualified Dallas Pro to accept.',
    messages: [
      {
        id: `msg_${Date.now()}`,
        senderRole: 'system',
        senderName: 'Crewly Dispatch',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `Booking received for ${rateConfig.name} in ${zipResult.areaName} (${zipResult.zip}). Matching Dallas Pros...`
      }
    ],
    rating: null,
    review: null,
    workerReviews: [],
    createdAt: new Date().toISOString()
  };

  state.bookings.unshift(newBooking);
  saveState(state);

  // Trigger optional Auto-Book evaluation
  evaluateAutoBookForBooking(newBooking.id);

  return newBooking;
}

// ---------------------------------------------------------------------------
// 5. Rule-Based Eligibility & Conflict Check Engine
// ---------------------------------------------------------------------------
export function canProAcceptSlot(proId, bookingId, slotId, options = {}) {
  const state = loadState();
  const pro = state.pros.find(p => p.id === proId);
  const booking = state.bookings.find(b => b.id === bookingId);

  if (!pro) return { allowed: false, reason: 'Worker profile not found.' };
  if (!booking) return { allowed: false, reason: 'Booking not found.' };

  const slot = booking.workerAssignments.find(s => s.slotId === slotId);
  if (!slot) return { allowed: false, reason: 'Assignment slot not found.' };

  // Rule 0: EXPIRATION CHECK (Separated ASAP matching window vs Scheduled exact appointment)
  const dallasNow = getDallasLocalNow();
  const currentMs = (options && typeof options.currentTimeMs === 'number') ? options.currentTimeMs : Date.now();

  if (booking.timingType === 'asap') {
    // Priority 1 & 2: ASAP requests remain available during the configurable 60m matching window
    if (isAsapExpired(booking, currentMs)) {
      return {
        allowed: false,
        reason: 'ASAP matching window has expired. Waiting for customer to extend search (+30 min) or reschedule.'
      };
    }
  } else {
    // Scheduled appointments require future date & time
    if (booking.scheduledDate) {
      if (booking.scheduledDate < dallasNow.dateStr) {
        return {
          allowed: false,
          reason: `Schedule Expired: This appointment was scheduled for ${booking.scheduledDate}, which has already passed.`
        };
      }
      if (booking.scheduledDate === dallasNow.dateStr && booking.scheduledTime && booking.scheduledTime.includes(':')) {
        if (booking.scheduledTime < dallasNow.timeStr) {
          return {
            allowed: false,
            reason: `Schedule Expired: Scheduled time (${booking.scheduledTime}) has already passed today.`
          };
        }
      }
    }
  }

  // Rule 1: Slot already filled
  if (slot.status !== 'unassigned') {
    return {
      allowed: false,
      reason: `This position is already filled by ${slot.assignedProName || 'another Pro'}.`
    };
  }

  // Rule 2: Cannot claim multiple positions on the same multi-worker job
  const alreadyOnJob = booking.workerAssignments.some(s => s.assignedProId === pro.id);
  if (alreadyOnJob) {
    return {
      allowed: false,
      reason: 'You are already assigned to another worker position on this booking.'
    };
  }

  // Rule 3: PREDEFINED VERIFIED SERVICE SKILLS (Self-reported notes are not enough!)
  const isSkillVerified = pro.verifiedSkills && pro.verifiedSkills.includes(booking.serviceCategory);
  if (!isSkillVerified) {
    return {
      allowed: false,
      reason: `Ineligible: Requires platform-verified skill for "${booking.serviceTitle}". Self-reported experience does not grant access.`
    };
  }

  // Rule 4: REQUIRED EQUIPMENT VERIFICATION (Especially for Lawn Care)
  if (booking.serviceCategory === 'lawn_mowing') {
    const hasVerifiedMower = pro.verifiedEquipment && pro.verifiedEquipment.some(eq =>
      eq.includes('mower') || eq === 'self_propelled_mower'
    );
    if (!hasVerifiedMower) {
      return {
        allowed: false,
        reason: 'Ineligible: Missing platform-verified lawn equipment (push or self-propelled mower).'
      };
    }
  }

  // Rule 5: REALISTIC WORK-PERIOD SCHEDULE CONFLICT DETECTION (Adjustment 2)
  // Calculates conflicts using the expected work period rather than only the original request minute.
  // All Pros on the same moving booking share one coordinated estimated work window.
  const thisInterval = getBookingWorkInterval(booking);

  const conflictingBooking = state.bookings.find(other => {
    if (other.id === booking.id) return false;
    if (other.overallStatus === 'completed' || other.overallStatus === 'cancelled') return false;

    // Is pro assigned to any active slot in this other booking?
    const proIsAssigned = other.workerAssignments.some(s =>
      s.assignedProId === pro.id && s.status !== 'completed'
    );
    if (!proIsAssigned) return false;

    // Compare date & interval overlap
    if (other.scheduledDate === booking.scheduledDate) {
      const otherInterval = getBookingWorkInterval(other);
      // Interval overlap check: [startA, endA) overlaps [startB, endB)
      const overlaps = (thisInterval.startMin < otherInterval.endMin && otherInterval.startMin < thisInterval.endMin);
      if (overlaps) {
        return true;
      }
    }
    return false;
  });

  if (conflictingBooking) {
    const otherInterval = getBookingWorkInterval(conflictingBooking);
    const formatMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return {
      allowed: false,
      reason: `Schedule Conflict: You are already assigned to booking ${conflictingBooking.id} on ${conflictingBooking.scheduledDate} (work window ${formatMin(otherInterval.startMin)}–${formatMin(otherInterval.endMin)}).`
    };
  }

  // Rule 6: PRO WEEKLY AVAILABILITY CHECK
  if (booking.scheduledDate) {
    const dateObj = new Date(booking.scheduledDate + 'T12:00:00');
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[dateObj.getDay()];
    const daySchedule = pro.weeklyAvailability && pro.weeklyAvailability[dayName];

    if (!daySchedule || !daySchedule.enabled) {
      return {
        allowed: false,
        reason: `Outside Availability: Your weekly schedule marks ${dayName} as an unavailable day.`
      };
    }
  }

  return { allowed: true, reason: 'Eligible and verified for this assignment.' };
}

// ---------------------------------------------------------------------------
// 6. Pro Slot Acceptance & Multi-Worker State Transitions
// ---------------------------------------------------------------------------
export function assignProToSlot(bookingId, slotId, proId) {
  const check = canProAcceptSlot(proId, bookingId, slotId);
  if (!check.allowed) {
    return { success: false, error: check.reason };
  }

  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  const pro = state.pros.find(p => p.id === proId);
  const slot = booking.workerAssignments.find(s => s.slotId === slotId);

  slot.assignedProId = pro.id;
  slot.assignedProName = pro.name;
  slot.assignedAt = new Date().toISOString();
  slot.status = 'assigned';

  // Calculate filled slots count
  const totalSlots = booking.workerAssignments.length;
  const assignedSlots = booking.workerAssignments.filter(s => s.status !== 'unassigned').length;

  if (assignedSlots === totalSlots) {
    booking.overallStatus = 'fully_confirmed';
    booking.partialFulfillmentNotice = null;
  } else {
    booking.overallStatus = 'partially_filled';
    booking.partialFulfillmentNotice = `${assignedSlots} of ${totalSlots} workers assigned. Crewly is matching remaining position(s).`;
  }

  // Update Pro's pending balance
  if (!pro.earnings) {
    pro.earnings = { availableBalance: 0, pendingBalance: 0, lifetimeEarned: 0 };
  }
  pro.earnings.pendingBalance = Math.round(((pro.earnings.pendingBalance || 0) + slot.payout) * 100) / 100;

  // Add system message to timeline
  booking.messages.push({
    id: `msg_${Date.now()}`,
    senderRole: 'system',
    senderName: 'Crewly Dispatch',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text: `${pro.name} has accepted the ${slot.roleTitle} assignment.`
  });

  saveState(state);
  return { success: true, booking, slot };
}

/**
 * Reconciles and recalculates a booking's overallStatus from its worker assignments.
 * Established Crewly rules:
 * - 'cancelled' bookings remain permanently cancelled.
 * - 'completed' only when EVERY required assignment is completed.
 * - 'in_progress' when any worker is in_progress or partially completed.
 * - 'arrived' when any worker has arrived (and none in progress yet).
 * - 'traveling' when any worker is traveling (and none arrived/in progress yet).
 * - 'partially_filled' when some slots are assigned and some unassigned.
 * - 'waiting_for_pros' when all slots are unassigned.
 * - 'fully_confirmed' when all slots are assigned and pre-work.
 */
export function recalculateBookingStatus(booking) {
  if (!booking) return null;
  if (booking.overallStatus === 'cancelled') return 'cancelled';

  const assignments = booking.workerAssignments || [];
  if (assignments.length === 0) {
    booking.overallStatus = 'waiting_for_pros';
    return booking.overallStatus;
  }

  const unassignedCount = assignments.filter(s => s.status === 'unassigned').length;
  const allCompleted = assignments.every(s => s.status === 'completed');
  const anyInProgress = assignments.some(s => s.status === 'in_progress');
  const anyCompleted = assignments.some(s => s.status === 'completed');
  const anyArrived = assignments.some(s => s.status === 'arrived');
  const anyTraveling = assignments.some(s => s.status === 'traveling');

  if (unassignedCount > 0) {
    const assignedCount = assignments.length - unassignedCount;
    booking.overallStatus = assignedCount > 0 ? 'partially_filled' : 'waiting_for_pros';
    if (!booking.partialFulfillmentNotice) {
      booking.partialFulfillmentNotice = assignedCount > 0
        ? `${assignedCount} of ${assignments.length} workers assigned. Crewly is matching remaining position(s).`
        : 'Seeking available Dallas Pros to fulfill your request.';
    }
  } else if (allCompleted) {
    booking.overallStatus = 'completed';
    booking.partialFulfillmentNotice = null;
  } else if (anyInProgress || anyCompleted) {
    booking.overallStatus = 'in_progress';
    booking.partialFulfillmentNotice = null;
  } else if (anyArrived) {
    booking.overallStatus = 'arrived';
    booking.partialFulfillmentNotice = null;
  } else if (anyTraveling) {
    booking.overallStatus = 'traveling';
    booking.partialFulfillmentNotice = null;
  } else {
    booking.overallStatus = 'fully_confirmed';
    booking.partialFulfillmentNotice = null;
  }

  return booking.overallStatus;
}

// ---------------------------------------------------------------------------
// 7. Pro Job Lifecycle Transitions (En Route, Arrived, In Progress, Completed)
// ---------------------------------------------------------------------------
export function updateProAssignmentStatus(bookingId, slotId, newStatus) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { success: false, error: 'Booking not found.' };

  const slot = booking.workerAssignments.find(s => s.slotId === slotId);
  if (!slot) return { success: false, error: 'Slot not found.' };

  // Guard against completing or modifying an already completed assignment
  if (slot.status === 'completed') {
    return { success: false, error: 'This assignment has already been completed and finalized.' };
  }

  // Guard against repeated identical status calls (prevents duplicate activity messages)
  if (slot.status === newStatus) {
    return { success: false, error: `Assignment is already marked as ${newStatus}.` };
  }

  // Priority 3 Guard: Enforce Required Crew Size for Active Work
  // If a booking requires multiple workers and not all slots are assigned,
  // workers cannot start traveling, arrive, start work, or complete the job.
  const unassignedCount = booking.workerAssignments.filter(s => s.status === 'unassigned').length;
  if (booking.workersNeeded > 1 && unassignedCount > 0) {
    if (['traveling', 'arrived', 'in_progress', 'completed'].includes(newStatus)) {
      return {
        success: false,
        error: `Cannot begin or advance work: This multi-worker booking requires ${booking.workersNeeded} Pros (${booking.workerAssignments.length - unassignedCount} of ${booking.workersNeeded} assigned). Work can only start once all positions are filled.`
      };
    }
  }

  const pro = state.pros.find(p => p.id === slot.assignedProId);

  slot.status = newStatus;

  // Timeline message
  const statusLabels = {
    traveling: 'is en route to the location (Simulated Dallas Transit).',
    arrived: 'has arrived on site.',
    in_progress: 'started the job.',
    completed: 'marked the assignment as completed.'
  };

  if (statusLabels[newStatus]) {
    booking.messages.push({
      id: `msg_${Date.now()}`,
      senderRole: 'system',
      senderName: 'Crewly Dispatch',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `${slot.assignedProName || 'Pro'} ${statusLabels[newStatus]}`
    });
  }

  // Per-slot earnings release with idempotency guard.
  // Each Pro's payout is released when THEIR OWN slot completes.
  // The customer booking remains active until every worker finishes.
  // The payoutReleased flag prevents duplicate credits if the completion
  // action is triggered more than once on the same slot.
  if (newStatus === 'completed' && !slot.payoutReleased) {
    if (pro && pro.earnings) {
      const slotPayoutCents = dollarsToCents(slot.payout || 0);
      const currentPendingCents = dollarsToCents(pro.earnings.pendingBalance || 0);

      // Financial Discrepancy Check (Product Lead Adjustment 1)
      if (currentPendingCents < slotPayoutCents) {
        return {
          success: false,
          error: 'Financial Discrepancy Detected for ' + (pro.name || 'Pro') + ': Pending balance ($' + centsToDollars(currentPendingCents) + ') is less than assignment payout ($' + centsToDollars(slotPayoutCents) + '). Completion rejected to prevent balance corruption.'
        };
      }

      slot.payoutReleased = true;
      const newPendingCents = currentPendingCents - slotPayoutCents;
      const currentAvailableCents = dollarsToCents(pro.earnings.availableBalance || 0);
      const newAvailableCents = currentAvailableCents + slotPayoutCents;
      const currentLifetimeCents = dollarsToCents(pro.earnings.lifetimeEarned || 0);
      const newLifetimeCents = currentLifetimeCents + slotPayoutCents;

      // Keep dollar balance fields as floating-point; use round-trip cents for precision
      pro.earnings.pendingBalance  = Number(centsToDollars(newPendingCents));
      pro.earnings.availableBalance = Number(centsToDollars(newAvailableCents));
      pro.earnings.lifetimeEarned   = Number(centsToDollars(newLifetimeCents));

      // Record earnings_credit transaction in the wallet ledger.
      // Guard: skip if a record for this exact booking+slot already exists
      // (protects against future edge-case double-calls despite payoutReleased).
      if (!Array.isArray(pro.earnings.walletTransactions)) {
        pro.earnings.walletTransactions = [];
      }
      const earnTxId = `txn_${pro.id}_earn_${bookingId}_${slotId}`;
      const alreadyRecorded = pro.earnings.walletTransactions.some(t => t.txId === earnTxId);
      if (!alreadyRecorded) {
        const dallasNow = getDallasLocalNow();
        pro.earnings.walletTransactions.push({
          txId:         earnTxId,
          proId:        pro.id,
          type:         'earnings_credit',
          bookingId:    bookingId,
          slotId:       slotId,
          description:  `${booking.serviceTitle || 'Job'} — ${slot.roleTitle || 'Worker'} (${booking.customerName || 'Customer'})`,
          amountCents:  dollarsToCents(slot.payout),
          feeCents:     0,
          netCents:     dollarsToCents(slot.payout),
          isoTimestamp: new Date().toISOString(),
          displayDate:  dallasNow.dateStr,
          status:       'completed',
          isSimulated:  true,
          isHistoricalImport: false
        });
      }
    }
  }

  // Update overall booking status based on combined slot statuses
  recalculateBookingStatus(booking);

  saveState(state);
  return { success: true, booking, slot };
}

// ---------------------------------------------------------------------------
// 8. Auto-Book Runner for Scheduled Jobs
// ---------------------------------------------------------------------------
export function evaluateAutoBookForBooking(bookingId) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking || booking.overallStatus === 'completed' || booking.overallStatus === 'cancelled') {
    return;
  }

  // Find unassigned slots
  const unassignedSlots = booking.workerAssignments.filter(s => s.status === 'unassigned');
  if (unassignedSlots.length === 0) return;

  // Search through pros with Auto-Book enabled
  for (const slot of unassignedSlots) {
    for (const pro of state.pros) {
      if (!pro.autoBookEnabled) continue;
      if (slot.payout < (pro.autoBookMinPayout || 0)) continue;

      const check = canProAcceptSlot(pro.id, booking.id, slot.slotId);
      if (check.allowed) {
        // Auto-assign this pro!
        assignProToSlot(booking.id, slot.slotId, pro.id);
        break; // Slot is filled, move to next slot
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8b. ASAP Extension & Rescheduling Logic (Stage 1.2 Adjustment 3)
// ---------------------------------------------------------------------------
export function extendAsapBooking(bookingId, additionalMinutes = 30) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { success: false, error: 'Booking not found.' };
  if (booking.timingType !== 'asap') {
    return { success: false, error: 'Only ASAP bookings can have their search window extended.' };
  }

  // Calculate new deadline from the later of current time or existing deadline
  const currentMs = Date.now();
  const existingDeadlineMs = booking.asapExpiresAt ? new Date(booking.asapExpiresAt).getTime() : currentMs;
  const baseMs = Math.max(currentMs, existingDeadlineMs);
  const newDeadlineMs = baseMs + (additionalMinutes * 60 * 1000);

  booking.asapExpiresAt = new Date(newDeadlineMs).toISOString();
  booking.asapMatchingWindowMinutes = (booking.asapMatchingWindowMinutes || 60) + additionalMinutes;

  // An expired booking must become eligible again for matching on the job board
  const totalSlots = booking.workerAssignments.length;
  const assignedSlots = booking.workerAssignments.filter(s => s.status !== 'unassigned').length;
  if (assignedSlots < totalSlots) {
    booking.overallStatus = assignedSlots > 0 ? 'partially_filled' : 'waiting_for_pros';
    booking.partialFulfillmentNotice = `${assignedSlots} of ${totalSlots} workers assigned. Crewly is matching remaining position(s).`;
  }

  booking.messages.push({
    id: `msg_${Date.now()}`,
    senderRole: 'system',
    senderName: 'Crewly Dispatch',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text: `Customer extended Pro search window by ${additionalMinutes} minutes. Dispatch active on Dallas Job Board.`
  });

  saveState(state);
  return { success: true, booking, newExpiresAt: booking.asapExpiresAt };
}

export function rescheduleBooking(bookingId, { newDate, newTime }) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { success: false, error: 'Booking not found.' };
  if (booking.overallStatus === 'completed' || booking.overallStatus === 'cancelled') {
    return { success: false, error: 'Completed or cancelled bookings cannot be rescheduled.' };
  }

  const dallasNow = getDallasLocalNow();

  // Validate that new appointment is strictly in the future
  if (!newDate || newDate < dallasNow.dateStr) {
    return { success: false, error: `Scheduled date (${newDate || 'empty'}) cannot be in the past.` };
  }
  if (newDate === dallasNow.dateStr && (!newTime || newTime < dallasNow.timeStr)) {
    return { success: false, error: `Scheduled time (${newTime}) has already passed today.` };
  }

  // Update booking schedule
  booking.timingType = 'scheduled';
  booking.scheduledDate = newDate;
  booking.scheduledTime = newTime;
  delete booking.asapExpiresAt;
  delete booking.asapRequestedAt;

  // Recheck existing worker assignments for conflicts
  // Requirement: Do not silently retain assignments that no longer fit the updated schedule.
  // Snapshot current assignments before rechecking
  const assignedSlotsInfo = booking.workerAssignments
    .filter(s => s.assignedProId)
    .map(s => ({
      slotId: s.slotId,
      proId: s.assignedProId,
      proName: s.assignedProName,
      payout: s.payout
    }));

  // Temporarily mark slots unassigned and save state so canProAcceptSlot evaluates with new schedule
  booking.workerAssignments.forEach(slot => {
    slot.status = 'unassigned';
    slot.assignedProId = null;
    slot.assignedProName = null;
  });
  saveState(state);

  const unassignedPros = [];
  assignedSlotsInfo.forEach(info => {
    const currentState = loadState();
    const currentBooking = currentState.bookings.find(b => b.id === bookingId);
    const slot = currentBooking ? currentBooking.workerAssignments.find(s => s.slotId === info.slotId) : null;
    if (!slot) return;

    const check = canProAcceptSlot(info.proId, bookingId, slot.slotId);
    if (check.allowed) {
      // Worker fits the rescheduled time! Reassign
      slot.assignedProId = info.proId;
      slot.assignedProName = info.proName;
      slot.status = 'assigned';
      saveState(currentState);
    } else {
      // Worker has a conflict with the new time! Remove and deduct pending balance
      unassignedPros.push({ name: info.proName, reason: check.reason });
      const pro = currentState.pros.find(p => p.id === info.proId);
      if (pro && pro.earnings) {
        pro.earnings.pendingBalance = Math.max(0, (pro.earnings.pendingBalance || 0) - (info.payout || 0));
      }
      saveState(currentState);
    }
  });

  // Reload latest state to compute overall status and dispatch notification
  const finalState = loadState();
  const finalBooking = finalState.bookings.find(b => b.id === bookingId);
  const totalSlots = finalBooking.workerAssignments.length;
  const assignedSlots = finalBooking.workerAssignments.filter(s => s.status !== 'unassigned').length;
  if (assignedSlots === totalSlots) {
    finalBooking.overallStatus = 'fully_confirmed';
    finalBooking.partialFulfillmentNotice = null;
  } else {
    finalBooking.overallStatus = assignedSlots > 0 ? 'partially_filled' : 'waiting_for_pros';
    finalBooking.partialFulfillmentNotice = `${assignedSlots} of ${totalSlots} workers assigned. Crewly is matching remaining position(s).`;
  }

  let statusMsg = `Booking rescheduled to ${newDate} at ${newTime}.`;
  if (unassignedPros.length > 0) {
    statusMsg += ` Note: ${unassignedPros.map(p => `${p.name} unassigned (${p.reason})`).join(', ')}.`;
  }

  finalBooking.messages.push({
    id: `msg_${Date.now()}`,
    senderRole: 'system',
    senderName: 'Crewly Dispatch',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text: statusMsg
  });

  saveState(finalState);
  return { success: true, booking: finalBooking, unassignedPros };
}

// ---------------------------------------------------------------------------
// 9. Simulated Instant Cash-Out & Reviews (Stage 2 Pro Wallet)
// ---------------------------------------------------------------------------
export function simulateProCashOut(proId, options = {}) {
  // Support both legacy signature: simulateProCashOut(proId, 'instant')
  // and new signature: simulateProCashOut(proId, { method, requestedAmountDollars, requestedAmountCents, requestId })
  let method = 'instant';
  let requestedAmountCents = null;
  let requestId = null;

  if (typeof options === 'string') {
    method = options;
  } else if (typeof options === 'object' && options !== null) {
    method = options.method || 'instant';
    requestId = options.requestId || null;
    if (typeof options.requestedAmountCents === 'number') {
      requestedAmountCents = Math.round(options.requestedAmountCents);
    } else if (typeof options.requestedAmountDollars === 'number') {
      requestedAmountCents = dollarsToCents(options.requestedAmountDollars);
    }
  }

  const state = loadState();
  const pro = state.pros.find(p => p.id === proId);
  if (!pro || !pro.earnings) return { success: false, error: 'Worker not found.' };

  if (!Array.isArray(pro.earnings.walletTransactions)) {
    pro.earnings.walletTransactions = [];
  }

  // Idempotency check with stable requestId (Product Lead Requirement 3)
  if (requestId) {
    const existingTx = pro.earnings.walletTransactions.find(t => t.requestId === requestId);
    if (existingTx) {
      return {
        success: true,
        alreadyProcessed: true,
        transaction: existingTx,
        withdrawnDollars: existingTx.amountCents / 100,
        feeDollars: existingTx.feeCents / 100,
        netAmountDollars: existingTx.netCents / 100,
        remainingAvailableDollars: pro.earnings.availableBalance,
        method: existingTx.methodLabel,
        notice: WALLET_CONFIG.SIMULATED_DISCLAIMER
      };
    }
  }

  const availableCents = dollarsToCents(pro.earnings.availableBalance);
  if (availableCents <= 0) {
    return { success: false, error: 'No available funds to cash out.' };
  }

  // If no specific amount was requested, default to full available balance
  const targetAmountCents = (typeof requestedAmountCents === 'number' && requestedAmountCents > 0)
    ? requestedAmountCents
    : availableCents;

  // Validation 1: Must be positive integer
  if (targetAmountCents <= 0) {
    return { success: false, error: 'Withdrawal amount must be greater than zero.' };
  }

  // Validation 2: Cannot exceed available balance
  if (targetAmountCents > availableCents) {
    return {
      success: false,
      error: `Requested withdrawal ($${(targetAmountCents / 100).toFixed(2)}) exceeds available balance ($${(availableCents / 100).toFixed(2)}).`
    };
  }

  // Validation 3: Fee calculation & instant fee exceeding requested amount guard
  const feeCents = method === 'instant'
    ? WALLET_CONFIG.INSTANT_CASHOUT_FEE_CENTS
    : WALLET_CONFIG.STANDARD_CASHOUT_FEE_CENTS;

  if (method === 'instant' && targetAmountCents <= feeCents) {
    return {
      success: false,
      error: `Instant Cash-Out requires a withdrawal amount greater than the $${(feeCents / 100).toFixed(2)} simulated fee.`
    };
  }

  const netCents = Math.max(0, targetAmountCents - feeCents);

  // Accounting: Deduct targetAmountCents from availableBalance in dollars
  const remainingCents = availableCents - targetAmountCents;
  pro.earnings.availableBalance = Math.round(remainingCents) / 100;
  // IMPORTANT: lifetimeEarned must NEVER decrease on cash-out!

  const dallasNow = getDallasLocalNow();
  const txId = `txn_${pro.id}_cashout_${Date.now()}`;
  const effectiveRequestId = requestId || txId;

  const transaction = {
    txId,
    requestId: effectiveRequestId,
    proId: pro.id,
    type: method === 'instant' ? 'cashout_instant' : 'cashout_standard',
    bookingId: null,
    slotId: null,
    method,
    methodLabel: method === 'instant' ? WALLET_CONFIG.INSTANT_LABEL : WALLET_CONFIG.STANDARD_LABEL,
    description: method === 'instant'
      ? `Instant Cash-Out — Dallas Debit Card ****4012 (simulated)`
      : `Standard ACH Transfer — Bank of Texas ****8921 (simulated)`,
    amountCents: targetAmountCents,
    feeCents,
    netCents,
    isoTimestamp: new Date().toISOString(),
    displayDate: dallasNow.dateStr,
    status: method === 'instant' ? 'simulated_instant_confirmed' : 'simulated_processing',
    statusLabel: method === 'instant' ? 'Simulated Transfer Confirmed' : 'Simulated Processing (1–2 Days)',
    isSimulated: true,
    isHistoricalImport: false,
    disclaimer: WALLET_CONFIG.SIMULATED_DISCLAIMER
  };

  pro.earnings.walletTransactions.unshift(transaction);
  saveState(state);

  return {
    success: true,
    transaction,
    withdrawnDollars: targetAmountCents / 100,
    feeDollars: feeCents / 100,
    netAmountDollars: netCents / 100,
    remainingAvailableDollars: pro.earnings.availableBalance,
    method: transaction.methodLabel,
    notice: WALLET_CONFIG.SIMULATED_DISCLAIMER
  };
}

/**
 * Returns wallet metrics and transaction records for a specific Pro.
 */
export function getProWalletSummary(proId) {
  const state = loadState();
  const pro = state.pros.find(p => p.id === proId);
  if (!pro) return null;

  const earnings = pro.earnings || { availableBalance: 0, pendingBalance: 0, lifetimeEarned: 0, walletTransactions: [] };
  const txs = earnings.walletTransactions || [];

  return {
    proId: pro.id,
    proName: pro.name,
    availableBalance: earnings.availableBalance,
    pendingBalance: earnings.pendingBalance,
    lifetimeEarned: earnings.lifetimeEarned,
    transactions: txs,
    counts: {
      all: txs.length,
      earnings: txs.filter(t => t.type === 'earnings_credit' || t.type === 'historical_job_import').length,
      cashouts: txs.filter(t => t.type === 'cashout_instant' || t.type === 'cashout_standard').length
    }
  };
}

export function submitWorkerReview(bookingId, slotId, { rating, comment }) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { success: false, error: 'Booking not found.' };

  // Validation 1: Booking must be in completed status
  if (booking.overallStatus !== 'completed') {
    return { success: false, error: 'Reviews can only be submitted for completed bookings.' };
  }

  const slot = booking.workerAssignments.find(s => s.slotId === slotId);
  if (!slot) return { success: false, error: 'Worker assignment not found.' };
  if (!slot.assignedProId) return { success: false, error: 'No Pro is assigned to this position.' };

  // Validation 2: Worker assignment slot must be completed
  if (slot.status !== 'completed') {
    return { success: false, error: 'Reviews can only be submitted for completed worker assignments.' };
  }

  // Validation 3: Rating must be an integer between 1 and 5
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return { success: false, error: 'Review rating must be an integer between 1 and 5.' };
  }

  // Validation 4: Prevent duplicate review for the same worker assignment slot
  if (!booking.workerReviews) booking.workerReviews = [];
  if (booking.workerReviews.some(r => r.slotId === slotId)) {
    return { success: false, error: 'You have already submitted a review for this worker.' };
  }

  const pro = state.pros.find(p => p.id === slot.assignedProId);

  // Record the per-worker review
  booking.workerReviews.push({
    slotId,
    proId: slot.assignedProId,
    proName: slot.assignedProName,
    roleTitle: slot.roleTitle,
    stars: ratingNum,
    comment: comment || '',
    date: new Date().toISOString().split('T')[0],
    disputed: false
  });

  // Update the Pro's rating using correct weighted average over their review history.
  // Uses pro.reviewCount (verified review count), not completed job count.
  if (pro) {
    const oldCount = pro.reviewCount || 0;
    const oldRating = pro.rating || 0;
    const newCount = oldCount + 1;
    pro.rating = Number(((oldRating * oldCount + ratingNum) / newCount).toFixed(2));
    pro.reviewCount = newCount;
  }

  // Preserve a booking-level rating field for reference
  booking.rating = ratingNum;

  saveState(state);
  return { success: true, booking };
}

// ---------------------------------------------------------------------------
// 13. Stage 3 Admin & Dispatch Operations Engine (Phase 1)
// ---------------------------------------------------------------------------

/**
 * Rules-Based Operational Alerts Engine (Deterministic — Not Generative AI).
 * Computes live operational items requiring human dispatcher attention.
 */
export function getOperationalAlerts(state) {
  if (!state || !Array.isArray(state.bookings)) return [];
  const alerts = [];
  const dallasNow = getDallasLocalNow();
  const nowMs = Date.now();

  state.bookings.forEach(b => {
    // 1. Unfilled / Partially Filled Multi-Worker or Single-Worker Bookings
    if (b.overallStatus === 'partially_filled') {
      const totalSlots = b.workerAssignments ? b.workerAssignments.length : (b.workersNeeded || 1);
      const assignedCount = b.workerAssignments ? b.workerAssignments.filter(s => s.status !== 'unassigned').length : 0;
      const missingCount = totalSlots - assignedCount;
      alerts.push({
        id: 'alert_partial_' + b.id,
        bookingId: b.id,
        level: 'warning',
        badge: 'Staffing Shortage',
        title: 'Staffing Shortage: ' + missingCount + ' of ' + totalSlots + ' workers needed on ' + b.id,
        reason: (b.serviceTitle || 'Booking') + ' for ' + (b.customerName || 'Customer') + ' requires ' + totalSlots + ' workers, but only ' + assignedCount + ' assigned. Crewly requires a full crew before work can start.',
        actionLabel: 'Inspect Dispatch',
        targetPanel: 'dispatch',
        createdAt: b.createdAt
      });
    } else if (b.overallStatus === 'waiting_for_pros') {
      alerts.push({
        id: 'alert_waiting_' + b.id,
        bookingId: b.id,
        level: 'info',
        badge: 'Unassigned Booking',
        title: 'Unassigned Booking: No Pros assigned yet on ' + b.id,
        reason: 'New booking request for ' + (b.serviceTitle || 'Service') + ' (' + (b.neighborhoodName || 'Dallas') + ') is waiting for eligible Dallas Pros to accept.',
        actionLabel: 'Inspect Dispatch',
        targetPanel: 'dispatch',
        createdAt: b.createdAt
      });
    }

    // 2. Expired ASAP Matching Window
    if (b.timingType === 'asap') {
      const isExpired = isAsapExpired(b, nowMs);
      const hasUnassignedSlots = b.workerAssignments && b.workerAssignments.some(s => s.status === 'unassigned');
      if (isExpired && hasUnassignedSlots && b.overallStatus !== 'completed' && b.overallStatus !== 'cancelled') {
        alerts.push({
          id: 'alert_asap_expired_' + b.id,
          bookingId: b.id,
          level: 'critical',
          badge: 'ASAP Window Expired',
          title: 'ASAP Matching Expired: ' + b.id + ' (' + (b.serviceTitle || 'Service') + ')',
          reason: '60-minute on-demand matching window lapsed before all positions were filled. Awaiting customer search extension (+30 min) or rescheduling.',
          actionLabel: 'View Booking',
          targetPanel: 'dispatch',
          createdAt: b.asapExpiresAt || b.createdAt
        });
      }
    }

    // 3. Same-Day Scheduled Booking Approaching with Unfilled Positions
    if (b.timingType === 'scheduled' && b.scheduledDate && b.overallStatus !== 'completed' && b.overallStatus !== 'cancelled') {
      const hasUnassignedSlots = b.workerAssignments && b.workerAssignments.some(s => s.status === 'unassigned');
      
      // Historical appointments past scheduled date (Phase 1 Refinement 1)
      if (b.scheduledDate < dallasNow.dateStr) {
        alerts.push({
          id: 'alert_historical_past_' + b.id,
          bookingId: b.id,
          level: 'critical',
          badge: 'Historical Review Required',
          title: 'Historical Appointment Date Passed: ' + b.id + ' (' + b.scheduledDate + ')',
          reason: 'This appointment was scheduled for ' + b.scheduledDate + ', which has already passed. Cannot dispatch workers to past dates. Requires customer rescheduling or administrative closing.',
          actionLabel: 'Review in Dispatch',
          targetPanel: 'dispatch',
          createdAt: b.createdAt
        });
      } else if (hasUnassignedSlots && b.scheduledDate === dallasNow.dateStr) {
        alerts.push({
          id: 'alert_same_day_' + b.id,
          bookingId: b.id,
          level: 'critical',
          badge: 'Same-Day Unfilled',
          title: 'Same-Day Appointment Unfilled: ' + b.id + ' at ' + (b.scheduledTime || 'TBD'),
          reason: 'Appointment is scheduled for today in Dallas, but required crew positions remain unfilled.',
          actionLabel: 'Prioritize Dispatch',
          targetPanel: 'dispatch',
          createdAt: b.createdAt
        });
      }
    }
  });

  // 4. Open Support Cases
  if (Array.isArray(state.supportCases)) {
    state.supportCases.forEach(sc => {
      if (sc.status === 'open' || sc.status === 'under_review') {
        alerts.push({
          id: 'alert_case_' + sc.caseId,
          caseId: sc.caseId,
          bookingId: sc.bookingId,
          level: (sc.priority === 'high' || sc.priority === 'critical') ? 'critical' : 'warning',
          badge: 'Support: ' + sc.priority.toUpperCase(),
          title: 'Support Ticket [' + sc.caseId + ']: ' + sc.title,
          reason: 'Customer support case regarding booking ' + (sc.bookingId || 'N/A') + ' has status "' + sc.status + '". Requires dispatcher review.',
          actionLabel: 'View Support Case',
          targetPanel: 'support',
          createdAt: sc.createdAt
        });
      }
    });
  }

  return alerts;
}

/**
 * Transparent Financial Operations Calculator.
 * Fulfills Product Lead Adjustment 5:
 * Distinguishes projected GBV, completed GBV, booking fees, worker payouts,
 * and estimated platform gross margin. Explicitly avoids labeling gross revenue
 * or charges as net profit.
 */
export function getAdminFinancialSummary(state) {
  if (!state) return null;

  let projectedGrossBookingValueCents = 0;
  let completedGrossBookingValueCents = 0;
  let totalGrossBookingValueCents = 0;
  let totalBookingFeesCents = 0;
  let totalWorkerCompensationCents = 0;
  let completedWorkerPayoutsCents = 0;
  let pendingWorkerPayoutsCents = 0;

  (state.bookings || []).forEach(b => {
    const custTotalCents = dollarsToCents(b.pricing ? b.pricing.customerTotal : 0);
    const feeCents = dollarsToCents(b.pricing ? b.pricing.bookingFee : 0);
    const workerPayoutsCents = dollarsToCents(b.pricing ? b.pricing.totalWorkerPayouts : 0);

    totalGrossBookingValueCents += custTotalCents;
    totalBookingFeesCents += feeCents;
    totalWorkerCompensationCents += workerPayoutsCents;

    if (b.overallStatus === 'completed') {
      completedGrossBookingValueCents += custTotalCents;
      completedWorkerPayoutsCents += workerPayoutsCents;
    } else if (b.overallStatus !== 'cancelled') {
      projectedGrossBookingValueCents += custTotalCents;
      pendingWorkerPayoutsCents += workerPayoutsCents;
    }
  });

  const projectedGrossMarginCents = projectedGrossBookingValueCents - pendingWorkerPayoutsCents;
  const completedGrossMarginCents = completedGrossBookingValueCents - completedWorkerPayoutsCents;
  const platformGrossMarginCents = totalGrossBookingValueCents - totalWorkerCompensationCents;

  let totalSimulatedCashoutCents = 0;
  let instantCashoutCount = 0;
  let standardCashoutCount = 0;
  let totalCashoutFeesCents = 0;
  let totalAvailableWorkerBalanceCents = 0;
  let totalPendingWorkerBalanceCents = 0;

  (state.pros || []).forEach(p => {
    if (p.earnings) {
      totalAvailableWorkerBalanceCents += dollarsToCents(p.earnings.availableBalance || 0);
      totalPendingWorkerBalanceCents += dollarsToCents(p.earnings.pendingBalance || 0);

      (p.earnings.walletTransactions || []).forEach(t => {
        if (t.type === 'cashout_instant' || t.type === 'cashout_standard') {
          totalSimulatedCashoutCents += (t.amountCents || 0);
          totalCashoutFeesCents += (t.feeCents || 0);
          if (t.type === 'cashout_instant') instantCashoutCount++;
          else standardCashoutCount++;
        }
      });
    }
  });

  return {
    projectedGrossBookingValue: centsToDollars(projectedGrossBookingValueCents),
    completedGrossBookingValue: centsToDollars(completedGrossBookingValueCents),
    totalGrossBookingValue: centsToDollars(totalGrossBookingValueCents),
    totalBookingFees: centsToDollars(totalBookingFeesCents),
    totalWorkerCompensation: centsToDollars(totalWorkerCompensationCents),
    completedWorkerPayouts: centsToDollars(completedWorkerPayoutsCents),
    pendingWorkerPayouts: centsToDollars(pendingWorkerPayoutsCents),
    projectedGrossMargin: centsToDollars(projectedGrossMarginCents),
    completedGrossMargin: centsToDollars(completedGrossMarginCents),
    platformGrossMargin: centsToDollars(platformGrossMarginCents),
    totalSimulatedCashouts: centsToDollars(totalSimulatedCashoutCents),
    totalCashoutFees: centsToDollars(totalCashoutFeesCents),
    instantCashoutCount: instantCashoutCount,
    standardCashoutCount: standardCashoutCount,
    totalAvailableWorkerBalance: centsToDollars(totalAvailableWorkerBalanceCents),
    totalPendingWorkerBalance: centsToDollars(totalPendingWorkerBalanceCents),
    educationalProfitDisclaimer: 'Gross customer payments and platform gross margin are NOT net profit. Commercial net profit must deduct payment processing fees (2.9% + $0.30/transaction), dispute reserves, worker background checks, and customer support operations.'
  };
}

/**
 * Aggregates operational counts for the Admin Dashboard.
 */
export function getAdminOperationalMetrics(state) {
  if (!state) return null;
  const bookings = state.bookings || [];
  const pros = state.pros || [];

  let totalRequests = bookings.length;
  let waitingCount = 0;
  let partiallyFilledCount = 0;
  let fullyConfirmedCount = 0;
  let inProgressCount = 0;
  let completedCount = 0;
  let cancelledCount = 0;
  let expiredAsapCount = 0;

  const nowMs = Date.now();

  bookings.forEach(b => {
    if (b.overallStatus === 'waiting_for_pros') waitingCount++;
    else if (b.overallStatus === 'partially_filled') partiallyFilledCount++;
    else if (b.overallStatus === 'fully_confirmed') fullyConfirmedCount++;
    else if (b.overallStatus === 'in_progress' || b.overallStatus === 'arrived' || b.overallStatus === 'traveling') inProgressCount++;
    else if (b.overallStatus === 'completed') completedCount++;
    else if (b.overallStatus === 'cancelled') cancelledCount++;

    if (b.timingType === 'asap' && isAsapExpired(b, nowMs)) {
      const hasUnassigned = b.workerAssignments && b.workerAssignments.some(s => s.status === 'unassigned');
      if (hasUnassigned) expiredAsapCount++;
    }
  });

  const alerts = getOperationalAlerts(state);
  const needsAttentionCount = alerts.length;

  const dallasNow = getDallasLocalNow();
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayDateObj = new Date(dallasNow.dateStr + 'T12:00:00');
  const todayDayName = daysOfWeek[todayDateObj.getDay()];

  let availableProsTodayCount = 0;
  pros.forEach(p => {
    if (p.weeklyAvailability && p.weeklyAvailability[todayDayName] && p.weeklyAvailability[todayDayName].enabled) {
      availableProsTodayCount++;
    }
  });

  return {
    totalRequests: totalRequests,
    waitingCount: waitingCount,
    partiallyFilledCount: partiallyFilledCount,
    fullyConfirmedCount: fullyConfirmedCount,
    inProgressCount: inProgressCount,
    completedCount: completedCount,
    cancelledCount: cancelledCount,
    expiredAsapCount: expiredAsapCount,
    needsAttentionCount: needsAttentionCount,
    registeredProsCount: pros.length,
    availableProsTodayCount: availableProsTodayCount,
    activeProsCount: pros.length,
    alerts: alerts
  };
}

// ---------------------------------------------------------------------------
// 14. Stage 3 Phase 2: Human-Controlled Dispatch Management Engine
// ---------------------------------------------------------------------------

/**
 * Append-only Administrative Audit Logger (Section 5).
 * Records every approved assignment, unassignment, and rejected attempt.
 */
export function logAdminAudit(state, entry) {
  if (!state) return null;
  if (!Array.isArray(state.adminAuditLog)) {
    state.adminAuditLog = [];
  }

  const auditRecord = {
    auditId: 'audit_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    timestamp: new Date().toISOString(),
    adminName: entry.adminName || 'Dallas Dispatch Lead (Demo)',
    actionType: entry.actionType,
    bookingId: entry.bookingId || null,
    caseId: entry.caseId || null,
    proId: entry.proId || null,
    slotId: entry.slotId || null,
    previousValue: entry.previousValue || null,
    newValue: entry.newValue || null,
    reason: entry.reason || 'No reason provided',
    verificationSource: entry.verificationSource || null,
    status: entry.status || 'success'
  };

  state.adminAuditLog.unshift(auditRecord);
  return auditRecord;
}

/**
 * Evaluates candidate Pros for a specific unfilled assignment slot.
 * Reuses canProAcceptSlot for 100% eligibility consistency (Rule 0-6).
 */
export function getProCandidatesForSlot(bookingId, slotId, options = {}) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return [];

  const slot = booking.workerAssignments.find(s => s.slotId === slotId);
  if (!slot) return [];

  return state.pros.map(pro => {
    const check = canProAcceptSlot(pro.id, bookingId, slotId, options);
    return {
      pro: pro,
      eligible: check.allowed,
      reason: check.reason
    };
  });
}

/**
 * Manual Administrative Pro Assignment (Section 3).
 * Reuses existing assignProToSlot engine; enforces eligibility rules with zero bypass;
 * records append-only audit event; notifies users with sanitized dispatch message.
 */
export function adminAssignPro(bookingId, slotId, proId, adminReason, options = {}) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { success: false, error: 'Booking not found.' };

  const slot = booking.workerAssignments.find(s => s.slotId === slotId);
  if (!slot) return { success: false, error: 'Assignment slot not found.' };

  if (slot.status !== 'unassigned') {
    return { success: false, error: 'Slot is already ' + slot.status + ' (assigned to ' + (slot.assignedProName || 'another Pro') + ').' };
  }

  const cleanReason = (adminReason || '').trim();
  if (!cleanReason) {
    return { success: false, error: 'Administrative reason is required for manual dispatch assignment.' };
  }

  // Enforce eligibility rules via canProAcceptSlot (NO BYPASS!)
  const check = canProAcceptSlot(proId, bookingId, slotId, options);
  if (!check.allowed) {
    const adminName = options.adminName || 'Dallas Dispatch Lead (Demo)';
    logAdminAudit(state, {
      actionType: 'assignment_rejected',
      bookingId: bookingId,
      slotId: slotId,
      proId: proId,
      adminName: adminName,
      previousValue: 'unassigned',
      newValue: 'unassigned',
      reason: 'Rejected: ' + check.reason + ' (Admin reason: ' + cleanReason + ')',
      status: 'failed'
    });
    saveState(state);
    return { success: false, error: check.reason };
  }

  const pro = state.pros.find(p => p.id === proId);
  if (!pro) return { success: false, error: 'Pro profile not found.' };

  // Reuse proven assignProToSlot engine (handles slot assignment, status calc, pending balance, system message)
  const assignResult = assignProToSlot(bookingId, slotId, proId);
  if (!assignResult.success) {
    return assignResult;
  }

  // Reload state and append audit log
  const updatedState = loadState();
  const adminName = options.adminName || 'Dallas Dispatch Lead (Demo)';

  logAdminAudit(updatedState, {
    actionType: 'worker_assigned',
    bookingId: bookingId,
    slotId: slotId,
    proId: proId,
    adminName: adminName,
    previousValue: 'unassigned',
    newValue: 'assigned (' + pro.name + ')',
    reason: cleanReason,
    status: 'success'
  });

  saveState(updatedState);
  const finalBooking = updatedState.bookings.find(b => b.id === bookingId);
  return {
    success: true,
    booking: finalBooking,
    slot: finalBooking.workerAssignments.find(s => s.slotId === slotId)
  };
}

/**
 * Administrative Worker Unassignment (Section 4).
 * Reverses pending earnings with integer-cent precision; guards against in-progress/completed work;
 * restores vacant position to matching engine; records audit event.
 */
export function adminUnassignPro(bookingId, slotId, proId, adminReason, options = {}) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { success: false, error: 'Booking not found.' };

  const slot = booking.workerAssignments.find(s => s.slotId === slotId);
  if (!slot) return { success: false, error: 'Assignment slot not found.' };

  if (slot.assignedProId !== proId) {
    return { success: false, error: 'Worker ID mismatch for this assignment.' };
  }

  // Strict Pre-Work Status Guard (Section 4)
  if (slot.status === 'completed') {
    return { success: false, error: 'Cannot unassign a completed assignment. Historical completed earnings and wallet records are protected.' };
  }
  if (slot.status === 'in_progress' || slot.status === 'arrived' || slot.status === 'traveling') {
    return { success: false, error: 'Cannot unassign active assignment (' + slot.status + '). Work is already underway. Escalate to support/dispute resolution.' };
  }
  if (slot.status !== 'assigned') {
    return { success: false, error: 'Cannot unassign slot with status "' + slot.status + '". Only assigned pre-work slots can be unassigned.' };
  }

  const cleanReason = (adminReason || '').trim();
  if (!cleanReason) {
    return { success: false, error: 'Administrative reason is required for worker unassignment.' };
  }

  // Financial Integrity Check on Pending Earnings (Product Lead Adjustment 1)
  const pro = state.pros.find(p => p.id === proId);
  if (!pro) return { success: false, error: 'Assigned Pro record not found.' };

  const slotPayoutCents = dollarsToCents(slot.payout || 0);
  const currentPendingCents = dollarsToCents(pro.earnings ? pro.earnings.pendingBalance : 0);

  // Inconsistency check: Reject and report rather than silently forcing balance to zero
  if (currentPendingCents < slotPayoutCents) {
    return {
      success: false,
      error: 'Financial Discrepancy Detected: Pro pending balance ($' + centsToDollars(currentPendingCents) + ') is less than assignment payout ($' + centsToDollars(slotPayoutCents) + '). Action rejected to prevent balance corruption.'
    };
  }

  // Safe integer-cent deduction
  const newPendingCents = currentPendingCents - slotPayoutCents;
  pro.earnings.pendingBalance = Number(centsToDollars(newPendingCents));

  // Reopen vacant slot
  const prevProName = slot.assignedProName || pro.name;
  const prevRoleTitle = slot.roleTitle || 'Assignment';
  slot.status = 'unassigned';
  slot.assignedProId = null;
  slot.assignedProName = null;
  slot.assignedAt = null;

  // Recalculate booking status
  const totalSlots = booking.workerAssignments.length;
  const assignedSlots = booking.workerAssignments.filter(s => s.status !== 'unassigned').length;

  if (assignedSlots === 0) {
    booking.overallStatus = 'waiting_for_pros';
    booking.partialFulfillmentNotice = 'Seeking available Dallas Pros to fulfill your request.';
  } else {
    booking.overallStatus = 'partially_filled';
    booking.partialFulfillmentNotice = assignedSlots + ' of ' + totalSlots + ' workers assigned. Crewly is matching remaining position(s).';
  }

  // Sanitized customer dispatch notification (No payout, no internal reason)
  booking.messages.push({
    id: 'msg_' + Date.now(),
    senderRole: 'system',
    senderName: 'Crewly Dispatch',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text: 'Crewly Dispatch updated crew staffing for ' + prevRoleTitle + '. Matching replacement Pro.'
  });

  // Append-only audit record
  const adminName = options.adminName || 'Dallas Dispatch Lead (Demo)';
  logAdminAudit(state, {
    actionType: 'worker_unassigned',
    bookingId: bookingId,
    slotId: slotId,
    proId: proId,
    adminName: adminName,
    previousValue: 'assigned (' + prevProName + ')',
    newValue: 'unassigned',
    reason: cleanReason,
    status: 'success'
  });

  saveState(state);
  return {
    success: true,
    booking: booking,
    slot: slot,
    reversedPendingCents: slotPayoutCents,
    proNewPendingBalance: pro.earnings.pendingBalance
  };
}

// ---------------------------------------------------------------------------
// Stage 3.5: Admin Booking Cancellation & Verified Completion
// ---------------------------------------------------------------------------

/**
 * Validates whether a booking is eligible for ordinary administrative cancellation.
 * (Product Lead Adjustment 2: All-or-Nothing pre-work validation).
 *
 * Eligible:
 * - waiting_for_pros
 * - partially_filled (pre-work)
 * - fully_confirmed (pre-work, no worker has started traveling or work)
 *
 * Blocked:
 * - Any worker is traveling, arrived, or in_progress (escalate to Customer Support)
 * - Any worker has completed or received released payout (escalate to Customer Support)
 * - Booking is already completed or cancelled
 */
export function canBookingBeCancelled(booking) {
  if (!booking) return { allowed: false, reason: 'Booking not found.' };

  if (booking.overallStatus === 'cancelled') {
    return { allowed: false, reason: 'Booking is already cancelled.' };
  }
  if (booking.overallStatus === 'completed') {
    return {
      allowed: false,
      reason: 'Completed bookings cannot be cancelled. All assignments have finalized and payouts have been released. Please escalate to Customer Support.',
      escalationToSupport: true
    };
  }

  const slots = booking.workerAssignments || [];

  // Active work guard: traveling, arrived, in_progress
  const activeSlot = slots.find(s => ['traveling', 'arrived', 'in_progress'].includes(s.status));
  if (activeSlot) {
    return {
      allowed: false,
      reason: `Cannot cancel: ${activeSlot.assignedProName || 'Worker'} is currently ${activeSlot.status}. Work is underway. Ordinary cancellation is blocked. Please escalate to Customer Support for manual review.`,
      escalationToSupport: true,
      activeSlot
    };
  }

  // Completed payout guard: protect historical completed earnings
  const completedSlot = slots.find(s => s.status === 'completed' || s.payoutReleased);
  if (completedSlot) {
    return {
      allowed: false,
      reason: `Cannot cancel: Worker payout has already been released for ${completedSlot.assignedProName || 'Worker'}. Historical completed earnings are protected. Please escalate to Customer Support.`,
      escalationToSupport: true,
      completedSlot
    };
  }

  return { allowed: true };
}

/**
 * Administrative All-or-Nothing Booking Cancellation (Stage 3.5 Section 2).
 *
 * Reverses pending earnings using exact integer cents; releases all pre-work worker positions;
 * preserves historical cancellation snapshot on the booking; excludes from Pro Job Board;
 * logs administrative audit trail; pushes sanitized customer message without payout leak.
 *
 * Note on Atomicity: localStorage does not provide ACID multi-document transactions.
 * All pre-validation checks are performed across all assigned workers prior to any state modification
 * to ensure in-memory consistency.
 */
export function adminCancelBooking(bookingId, adminReason, options = {}) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { success: false, error: 'Booking not found.' };

  const adminName = options.adminName || 'Dallas Dispatch Lead (Demo)';
  const requestId = options.requestId || null;

  // Idempotency check: if already cancelled with same requestId or already cancelled
  if (booking.overallStatus === 'cancelled') {
    if (requestId && booking.cancellationRequestId === requestId) {
      return {
        success: true,
        alreadyProcessed: true,
        booking: booking,
        snapshot: booking.cancellationSnapshot,
        message: 'Booking was already cancelled with this request ID.'
      };
    }
    return { success: false, error: 'Booking is already cancelled.' };
  }

  const cleanReason = (adminReason || '').trim();
  if (!cleanReason) {
    return { success: false, error: 'Administrative cancellation reason is required.' };
  }

  // 1. Overall booking eligibility check
  const check = canBookingBeCancelled(booking);
  if (!check.allowed) {
    logAdminAudit(state, {
      actionType: 'admin_lifecycle_action_rejected',
      bookingId: bookingId,
      adminName: adminName,
      previousValue: booking.overallStatus,
      newValue: booking.overallStatus,
      reason: `Cancellation rejected: ${check.reason}`,
      status: 'failed'
    });
    saveState(state);
    return { success: false, error: check.reason, escalationToSupport: check.escalationToSupport };
  }

  // 2. All-or-Nothing pre-validation across all assigned slots (Adjustment 2)
  const assignedSlots = (booking.workerAssignments || []).filter(s => s.status === 'assigned' && s.assignedProId);
  const financialItems = [];

  for (const slot of assignedSlots) {
    const pro = state.pros.find(p => p.id === slot.assignedProId);
    if (!pro) {
      return { success: false, error: `Assigned worker profile not found (${slot.assignedProId}). Cancellation rejected.` };
    }
    const currentPendingCents = dollarsToCents(pro.earnings ? pro.earnings.pendingBalance : 0);
    const slotPayoutCents = dollarsToCents(slot.payout || 0);

    if (currentPendingCents < slotPayoutCents) {
      const err = `Financial Discrepancy Detected for ${pro.name}: Pending balance ($${centsToDollars(currentPendingCents)}) is less than assignment payout ($${centsToDollars(slotPayoutCents)}). Cancellation rejected to prevent balance corruption.`;
      logAdminAudit(state, {
        actionType: 'admin_lifecycle_action_rejected',
        bookingId: bookingId,
        proId: pro.id,
        slotId: slot.slotId,
        adminName: adminName,
        previousValue: booking.overallStatus,
        newValue: booking.overallStatus,
        reason: err,
        status: 'failed'
      });
      saveState(state);
      return { success: false, error: err, escalationToSupport: true };
    }

    financialItems.push({
      slot,
      pro,
      currentPendingCents,
      slotPayoutCents
    });
  }

  // 3. Execute all-or-nothing cancellation and snapshot preservation (Adjustment 3)
  const previousStatus = booking.overallStatus;
  const cancellationTime = new Date().toISOString();
  const effectiveRequestId = requestId || ('cancel_' + bookingId + '_' + Date.now());
  const formerWorkers = [];

  for (const item of financialItems) {
    const { slot, pro, currentPendingCents, slotPayoutCents } = item;

    // Deduct pending earnings safely
    const newPendingCents = currentPendingCents - slotPayoutCents;
    pro.earnings.pendingBalance = Number(centsToDollars(newPendingCents));

    formerWorkers.push({
      slotId: slot.slotId,
      roleTitle: slot.roleTitle,
      proId: pro.id,
      proName: pro.name,
      payoutDollarsReversed: slot.payout,
      payoutCentsReversed: slotPayoutCents
    });

    // Mark slot unassigned
    slot.status = 'unassigned';
    slot.assignedProId = null;
    slot.assignedProName = null;
    slot.assignedAt = null;
  }

  // Update booking record
  booking.overallStatus = 'cancelled';
  booking.previousOverallStatus = previousStatus;
  booking.cancelledAt = cancellationTime;
  booking.cancelledBy = adminName;
  booking.cancellationReason = cleanReason;
  booking.cancellationRequestId = effectiveRequestId;
  booking.partialFulfillmentNotice = 'Booking cancelled by Crewly Dispatch (Pending Manual Review — No Refund Processed).';

  booking.cancellationSnapshot = {
    bookingId: booking.id,
    previousStatus: previousStatus,
    cancelledAt: cancellationTime,
    cancelledBy: adminName,
    reason: cleanReason,
    cancellationRequestId: effectiveRequestId,
    formerWorkers: formerWorkers
  };

  // Sanitized customer message (Adjustment 5: No payout amounts, no internal notes)
  if (!Array.isArray(booking.messages)) {
    booking.messages = [];
  }
  booking.messages.push({
    id: 'msg_' + Date.now(),
    senderRole: 'system',
    senderName: 'Crewly Dispatch',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text: 'This booking has been cancelled by Crewly Dispatch. (Status: Cancelled — Pending Manual Review — No Refund Processed).'
  });

  // Append-only audit record
  logAdminAudit(state, {
    actionType: 'booking_canceled',
    bookingId: booking.id,
    adminName: adminName,
    previousValue: previousStatus,
    newValue: 'cancelled',
    reason: cleanReason,
    status: 'success'
  });

  saveState(state);

  return {
    success: true,
    booking: booking,
    snapshot: booking.cancellationSnapshot
  };
}

/**
 * Validates whether an individual worker assignment can be administratively verified and completed.
 * (Product Lead Adjustment 1 & 4).
 *
 * Rules:
 * - Booking must be active (not cancelled, not completed)
 * - Assignment status must be actively 'in_progress'
 * - Assignment must not be already completed or payout released
 * - Full required crew size must have been assembled
 */
export function canSlotBeAdminCompleted(booking, slot) {
  if (!booking) return { allowed: false, reason: 'Booking not found.' };
  if (!slot) return { allowed: false, reason: 'Assignment slot not found.' };

  if (booking.overallStatus === 'cancelled') {
    return { allowed: false, reason: 'Cannot complete an assignment on a cancelled booking.' };
  }
  if (slot.status === 'completed' || slot.payoutReleased) {
    return { allowed: false, reason: 'This assignment has already been completed and finalized.' };
  }
  if (slot.status === 'unassigned' || !slot.assignedProId) {
    return { allowed: false, reason: 'Cannot complete an unassigned position. A qualified Pro must be assigned first.' };
  }
  if (slot.status !== 'in_progress') {
    return {
      allowed: false,
      reason: `Assignment status is "${slot.status}". Administrative verified completion is only permitted for assignments actively in progress.`,
      escalationToSupport: true
    };
  }

  // Verify full crew assembly for multi-worker bookings
  const unassignedSlots = (booking.workerAssignments || []).filter(s => s.status === 'unassigned');
  if (booking.workersNeeded > 1 && unassignedSlots.length > 0) {
    return {
      allowed: false,
      reason: `Cannot complete: Required crew size (${booking.workersNeeded}) was never fully assembled (${unassignedSlots.length} unassigned positions remain).`,
      escalationToSupport: true
    };
  }

  return { allowed: true };
}

/**
 * Admin-Verified Job Completion (Stage 3.5 Section 3).
 *
 * Reuses the proven updateProAssignmentStatus() completion engine (Product Lead Adjustment 1).
 * Requires affirmative documented verification with demo simulation labeling (Adjustment 4).
 * Records append-only audit trail and sanitized customer notification.
 */
export function adminVerifyAndCompleteAssignment(bookingId, slotId, proId, verificationData, options = {}) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { success: false, error: 'Booking not found.' };

  const slot = (booking.workerAssignments || []).find(s => s.slotId === slotId);
  if (!slot) return { success: false, error: 'Assignment slot not found.' };

  if (slot.assignedProId !== proId) {
    return { success: false, error: 'Worker ID mismatch for this assignment.' };
  }

  const adminName = options.adminName || 'Dallas Dispatch Lead (Demo)';

  // 1. Check eligibility
  const check = canSlotBeAdminCompleted(booking, slot);
  if (!check.allowed) {
    logAdminAudit(state, {
      actionType: 'admin_lifecycle_action_rejected',
      bookingId: bookingId,
      slotId: slotId,
      proId: proId,
      adminName: adminName,
      previousValue: slot.status,
      newValue: slot.status,
      reason: `Admin completion rejected: ${check.reason}`,
      status: 'failed'
    });
    saveState(state);
    return { success: false, error: check.reason, escalationToSupport: check.escalationToSupport };
  }

  // 2. Validate affirmative verification requirements (Adjustment 4)
  if (!verificationData || typeof verificationData !== 'object') {
    return { success: false, error: 'Affirmative completion verification data is required.' };
  }

  const cleanExplanation = (verificationData.explanation || '').trim();
  if (!cleanExplanation) {
    return { success: false, error: 'Internal administrative explanation is required for verified completion.' };
  }

  if (verificationData.confirmed !== true) {
    return { success: false, error: 'Affirmative confirmation checkbox is required to verify completion.' };
  }

  const verificationSource = (verificationData.verificationSource || verificationData.source || 'Customer Direct Phone Confirmation (Demo Simulation)').trim();

  // 3. Delegate to existing updateProAssignmentStatus (Adjustment 1)
  const completionResult = updateProAssignmentStatus(bookingId, slotId, 'completed');
  if (!completionResult.success) {
    logAdminAudit(state, {
      actionType: 'admin_lifecycle_action_rejected',
      bookingId: bookingId,
      slotId: slotId,
      proId: proId,
      adminName: adminName,
      previousValue: slot.status,
      newValue: slot.status,
      reason: `Shared completion failed: ${completionResult.error}`,
      status: 'failed'
    });
    saveState(state);
    return completionResult;
  }

  // 4. Reload updated state to record administrative audit without overwriting completion changes
  const updatedState = loadState();
  const finalBooking = updatedState.bookings.find(b => b.id === bookingId);
  const finalSlot = finalBooking.workerAssignments.find(s => s.slotId === slotId);

  logAdminAudit(updatedState, {
    actionType: 'admin_completion_verified',
    bookingId: bookingId,
    slotId: slotId,
    proId: proId,
    adminName: adminName,
    previousValue: 'in_progress',
    newValue: 'completed',
    reason: cleanExplanation,
    verificationSource: verificationSource,
    status: 'success'
  });

  // Sanitized customer message
  if (!Array.isArray(finalBooking.messages)) {
    finalBooking.messages = [];
  }
  finalBooking.messages.push({
    id: 'msg_' + Date.now(),
    senderRole: 'system',
    senderName: 'Crewly Dispatch',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text: `${finalSlot.assignedProName || 'Pro'} completed the assignment (Verified by Crewly Dispatch).`
  });

  saveState(updatedState);

  return {
    success: true,
    booking: finalBooking,
    slot: finalSlot,
    verificationSource: verificationSource
  };
}

// ---------------------------------------------------------------------------
// Stage 3 Phase 3: Supporting Administrative Operations
// ---------------------------------------------------------------------------

/**
 * Safe HTML Escaping for User-Provided Text (Product Lead Adjustment 4)
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Worker Directory & Availability Inspection (Adjustment 5).
 * Distinguishes:
 * 1. Registered Pros (total onboarded)
 * 2. Available Pros Today (weeklyAvailability enabled for current Dallas day)
 * 3. Pro profiles with verified skills, equipment, reliability, active assignments, completed jobs.
 */
export function getProDirectorySummary(state) {
  if (!state) return null;
  const dallasNow = getDallasLocalNow();
  const dayNamesLower = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayNamesCap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayDateObj = (dallasNow && dallasNow.fullDate) ? dallasNow.fullDate : new Date();
  const dayIdx = isNaN(todayDateObj.getDay()) ? new Date().getDay() : todayDateObj.getDay();
  const todayNameLower = dayNamesLower[dayIdx];
  const todayNameCap = dayNamesCap[dayIdx];

  const skillLabels = {
    moving: 'Moving & Lifting',
    tv_mounting: 'TV Mounting',
    wall_mounting: 'Wall Mounting & Shelving',
    furniture_assembly: 'Furniture Assembly',
    furniture_disassembly: 'Furniture Disassembly',
    lawn_mowing: 'Lawn Care & Mowing'
  };

  const equipLabels = {
    heavy_duty_dolly: 'Heavy-Duty Hand Truck',
    moving_straps: 'Moving & Lifting Straps',
    impact_driver: 'Impact Driver & Drill Kit',
    stud_finder: 'Precision Stud Finder',
    ladder: 'Multi-Position Stepladder',
    self_propelled_mower: 'Commercial Lawn Mower',
    string_trimmer: 'Precision Edger / Trimmer',
    leaf_blower: 'High-Velocity Leaf Blower'
  };

  const pros = (state.pros || []).map(pro => {
    // Check day availability (support both capitalized and lowercase day keys)
    const availObj = pro.weeklyAvailability
      ? (pro.weeklyAvailability[todayNameCap] || pro.weeklyAvailability[todayNameLower])
      : null;
    const isAvailableToday = !!(availObj && availObj.enabled);
    const todayHours = isAvailableToday
      ? `${availObj.start} – ${availObj.end}`
      : 'Off Duty';

    // Count active assignments across state.bookings
    let activeAssignmentsCount = 0;
    (state.bookings || []).forEach(b => {
      if (b.overallStatus !== 'completed' && b.overallStatus !== 'cancelled') {
        (b.workerAssignments || []).forEach(slot => {
          if (slot.assignedProId === pro.id && slot.status !== 'unassigned') {
            activeAssignmentsCount++;
          }
        });
      }
    });

    // Completed jobs count
    let completedJobsCount = 0;
    (state.bookings || []).forEach(b => {
      (b.workerAssignments || []).forEach(slot => {
        if (slot.assignedProId === pro.id && slot.status === 'completed') {
          completedJobsCount++;
        }
      });
    });

    const verifiedServices = (pro.verifiedSkills || pro.verifiedServices || []).map(s => skillLabels[s] || s);
    const verifiedEquipment = (pro.verifiedEquipment || []).map(e => equipLabels[e] || e);

    return {
      id: pro.id,
      name: pro.name,
      avatar: pro.avatar,
      tier: pro.tier || 'Bronze',
      rating: pro.rating,
      reviewCount: pro.reviewCount || 0,
      reliabilityScore: pro.reliabilityScore || 95,
      verifiedServices: verifiedServices,
      verifiedEquipment: verifiedEquipment,
      verifiedBadges: pro.verifiedBadges || [],
      isAvailableToday: isAvailableToday,
      todayHours: todayHours,
      weeklyAvailability: pro.weeklyAvailability || {},
      activeAssignmentsCount: activeAssignmentsCount,
      completedJobsCount: completedJobsCount,
      serviceAreaPreferences: pro.preferredZipCodes || ['75201', '75202', '75204', '75206', '75208', '75214', '75219'],
      availableBalance: pro.earnings ? pro.earnings.availableBalance : 0,
      pendingBalance: pro.earnings ? pro.earnings.pendingBalance : 0,
      lifetimeEarned: pro.earnings ? pro.earnings.lifetimeEarned : 0
    };
  });

  const registeredProsCount = pros.length;
  const availableProsTodayCount = pros.filter(p => p.isAvailableToday).length;

  return {
    todayName: todayNameCap,
    dallasNow: dallasNow,
    registeredProsCount: registeredProsCount,
    availableProsTodayCount: availableProsTodayCount,
    pros: pros
  };
}

/**
 * Booking-Specific Pro Eligibility Inspector (Adjustment 5).
 * Evaluates canProAcceptSlot for all slots on the booking.
 */
export function getBookingProEligibility(bookingId, proId, options = {}) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { eligible: false, reason: 'Booking not found.' };

  const pro = state.pros.find(p => p.id === proId);
  if (!pro) return { eligible: false, reason: 'Pro not found.' };

  const slots = booking.workerAssignments || [];
  if (slots.length === 0) return { eligible: false, reason: 'No worker assignment positions on this booking.' };

  // Evaluate each slot
  const slotEvaluations = slots.map(slot => {
    // If the slot is already assigned to THIS pro, they are currently assigned
    if (slot.assignedProId === proId) {
      return {
        slotId: slot.slotId,
        roleTitle: slot.roleTitle,
        status: slot.status,
        allowed: true,
        reason: 'Currently assigned to this position'
      };
    }
    const check = canProAcceptSlot(proId, bookingId, slot.slotId, options);
    return {
      slotId: slot.slotId,
      roleTitle: slot.roleTitle,
      status: slot.status,
      allowed: check.allowed,
      reason: check.reason
    };
  });

  const hasEligibleSlot = slotEvaluations.some(e => e.allowed);
  // Find most informative reason if not eligible: prioritize open/unassigned slots first
  const openSlotDisqualification = slotEvaluations.find(e => !e.allowed && e.status === 'unassigned');
  const firstDisqualification = openSlotDisqualification || slotEvaluations.find(e => !e.allowed);
  const primaryReason = hasEligibleSlot
    ? 'Eligible for open assignment slot'
    : (firstDisqualification ? firstDisqualification.reason : 'Not eligible');

  return {
    bookingId: bookingId,
    proId: proId,
    proName: pro.name,
    eligible: hasEligibleSlot,
    primaryReason: primaryReason,
    slotEvaluations: slotEvaluations
  };
}

/**
 * Create Support or Trust & Safety Case (Adjustment 1 & 4).
 * Enforces unified case schema, idempotency, audit logging, and customer privacy.
 */
export function createSupportCase(caseData, adminName = 'Dallas Dispatch Lead (Demo)') {
  const state = loadState();
  if (!Array.isArray(state.supportCases)) {
    state.supportCases = [];
  }

  const title = (caseData.title || '').trim();
  if (!title) {
    return { success: false, error: 'Case title is required.' };
  }

  // Idempotency / Duplicate Prevention (Product Lead Adjustment 1)
  if (caseData.idempotencyKey) {
    const existing = state.supportCases.find(c => c.idempotencyKey === caseData.idempotencyKey);
    if (existing) {
      return { success: true, case: existing, deduplicated: true };
    }
  }

  // Also check if an active case already exists for the same booking and identical title
  if (caseData.bookingId) {
    const duplicate = state.supportCases.find(c =>
      c.bookingId === caseData.bookingId &&
      c.title.toLowerCase() === title.toLowerCase() &&
      c.status !== 'resolved'
    );
    if (duplicate) {
      return { success: false, error: `An active case (${duplicate.caseId}) already exists for this booking with the same title.` };
    }
  }

  // Generate stable case ID: e.g. CASE-102
  const nextNum = 101 + state.supportCases.length;
  const caseId = caseData.caseId || `CASE-${nextNum}`;
  const nowIso = new Date().toISOString();

  const category = caseData.category || (caseData.issueType === 'review_dispute' ? 'trust_safety' : 'support');
  const initialNoteText = (caseData.initialNote || caseData.description || '').trim();

  const initialNotes = [];
  if (initialNoteText) {
    initialNotes.push({
      noteId: `note_${caseId}_1`,
      author: adminName,
      timestamp: nowIso,
      text: initialNoteText
    });
  }

  const newCase = {
    caseId: caseId,
    idempotencyKey: caseData.idempotencyKey || null,
    category: category,
    bookingId: caseData.bookingId || null,
    customerId: caseData.customerId || null,
    proId: caseData.proId || null,
    reviewSlotId: caseData.reviewSlotId || null,
    issueType: caseData.issueType || 'general',
    priority: caseData.priority || 'medium',
    status: 'open',
    title: title,
    notes: initialNotes,
    createdAt: nowIso,
    updatedAt: nowIso,
    resolvedAt: null
  };

  state.supportCases.unshift(newCase);

  // Append audit event
  logAdminAudit(state, {
    actionType: 'support_case_created',
    bookingId: newCase.bookingId,
    caseId: newCase.caseId,
    proId: newCase.proId,
    adminName: adminName,
    previousValue: 'none',
    newValue: `Created ${newCase.caseId} (${newCase.priority} priority - ${newCase.issueType})`,
    reason: `Initial Case: ${title}`,
    status: 'success'
  });

  saveState(state);
  return { success: true, case: newCase };
}

/**
 * Update Support or Trust & Safety Case Status (Adjustment 1).
 */
export function updateSupportCaseStatus(caseId, newStatus, adminReason, adminName = 'Dallas Dispatch Lead (Demo)') {
  const state = loadState();
  if (!Array.isArray(state.supportCases)) return { success: false, error: 'No support cases in state.' };

  const targetCase = state.supportCases.find(c => c.caseId === caseId);
  if (!targetCase) return { success: false, error: `Case ${caseId} not found.` };

  const validStatuses = ['open', 'under_review', 'resolved'];
  if (!validStatuses.includes(newStatus)) {
    return { success: false, error: `Invalid status "${newStatus}". Must be one of: open, under_review, resolved.` };
  }

  const cleanReason = (adminReason || '').trim();
  if (!cleanReason) {
    return { success: false, error: 'Administrative reason is required when updating case status.' };
  }

  const previousStatus = targetCase.status;
  const nowIso = new Date().toISOString();

  targetCase.status = newStatus;
  targetCase.updatedAt = nowIso;
  if (newStatus === 'resolved') {
    targetCase.resolvedAt = nowIso;
  } else {
    targetCase.resolvedAt = null;
  }

  // Append internal system note to case history
  const noteId = `note_${caseId}_${targetCase.notes.length + 1}`;
  targetCase.notes.push({
    noteId: noteId,
    author: adminName,
    timestamp: nowIso,
    text: `Status changed from ${previousStatus.toUpperCase()} to ${newStatus.toUpperCase()}. Reason: ${cleanReason}`
  });

  // Log to admin audit trail
  logAdminAudit(state, {
    actionType: 'support_case_status_updated',
    caseId: caseId,
    bookingId: targetCase.bookingId,
    proId: targetCase.proId,
    adminName: adminName,
    previousValue: previousStatus,
    newValue: newStatus,
    reason: cleanReason,
    status: 'success'
  });

  saveState(state);
  return { success: true, case: targetCase, previousStatus: previousStatus };
}

/**
 * Add Internal Dispatcher Note to Case (Adjustment 1 & 4).
 * Never leaks to booking.messages or customer dashboards.
 */
export function addSupportCaseNote(caseId, noteText, authorName = 'Dallas Dispatch Lead (Demo)') {
  const state = loadState();
  if (!Array.isArray(state.supportCases)) return { success: false, error: 'No support cases in state.' };

  const targetCase = state.supportCases.find(c => c.caseId === caseId);
  if (!targetCase) return { success: false, error: `Case ${caseId} not found.` };

  const cleanText = (noteText || '').trim();
  if (!cleanText) {
    return { success: false, error: 'Note text cannot be empty.' };
  }

  const nowIso = new Date().toISOString();
  const noteId = `note_${caseId}_${targetCase.notes.length + 1}`;
  const newNote = {
    noteId: noteId,
    author: authorName,
    timestamp: nowIso,
    text: cleanText
  };

  targetCase.notes.push(newNote);
  targetCase.updatedAt = nowIso;

  // Log to audit log
  logAdminAudit(state, {
    actionType: 'support_case_note_added',
    caseId: caseId,
    bookingId: targetCase.bookingId,
    proId: targetCase.proId,
    adminName: authorName,
    previousValue: `Notes: ${targetCase.notes.length - 1}`,
    newValue: `Notes: ${targetCase.notes.length}`,
    reason: `Added dispatcher note: ${cleanText.slice(0, 50)}${cleanText.length > 50 ? '...' : ''}`,
    status: 'success'
  });

  saveState(state);
  return { success: true, note: newNote, case: targetCase };
}

/**
 * Flag Review as Disputed (Adjustment 2).
 * Strictly preserves:
 * 1. Original review star rating (review.stars)
 * 2. Original comment text
 * 3. Pro average rating and review count
 * 4. Customer profile (no penalties)
 * 5. Pro status (no suspension)
 * Creates/links a Trust & Safety case in state.supportCases.
 */
export function flagReviewDispute(bookingId, slotOrProId, disputeReason, adminName = 'Dallas Dispatch Lead (Demo)') {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { success: false, error: 'Booking not found.' };

  const reviews = booking.workerReviews || [];
  let review = reviews.find(r => r.slotId === slotOrProId || r.proId === slotOrProId);
  if (!review && booking.review) {
    review = booking.review;
  }
  if (!review) return { success: false, error: 'Review not found for this assignment slot or worker.' };

  const cleanReason = (disputeReason || '').trim();
  if (!cleanReason) {
    return { success: false, error: 'Dispute reason is required.' };
  }

  // Idempotency: If already disputed, return existing case
  if (review.disputed && review.disputeCaseId) {
    const existingCase = (state.supportCases || []).find(c => c.caseId === review.disputeCaseId);
    if (existingCase) {
      return { success: true, booking, review, case: existingCase, alreadyDisputed: true };
    }
  }

  // Create unified Trust & Safety case
  const nextNum = 201 + (state.supportCases || []).filter(c => c.category === 'trust_safety').length;
  const caseId = `CASE-TS-${nextNum}`;
  const nowIso = new Date().toISOString();

  // Mark review as disputed, store case reference WITHOUT altering stars or Pro rating
  review.disputed = true;
  review.disputeCaseId = caseId;
  review.disputeStatus = 'under_investigation';
  review.disputeFlaggedAt = nowIso;
  review.disputeReason = cleanReason;

  if (!Array.isArray(state.supportCases)) {
    state.supportCases = [];
  }

  const effectiveSlotId = review.slotId || (typeof slotOrProId === 'string' && slotOrProId.startsWith('slot_') ? slotOrProId : 'slot_1');
  const effectiveProId = review.proId || (typeof slotOrProId === 'string' && slotOrProId.startsWith('pro_') ? slotOrProId : null);

  const trustCase = {
    caseId: caseId,
    category: 'trust_safety',
    bookingId: bookingId,
    customerId: booking.customerId || null,
    proId: effectiveProId,
    reviewSlotId: effectiveSlotId,
    issueType: 'review_dispute',
    priority: 'high',
    status: 'under_review',
    title: `Review Dispute: ${review.proName || 'Worker'} on ${booking.serviceTitle || bookingId}`,
    disputeDetails: {
      originalStars: review.stars,
      originalComment: review.comment,
      proId: effectiveProId,
      proName: review.proName,
      slotId: effectiveSlotId
    },
    notes: [
      {
        noteId: `note_${caseId}_1`,
        author: adminName,
        timestamp: nowIso,
        text: `Review flagged for Trust & Safety investigation: ${cleanReason}. Original Rating: ${review.stars}★ (Preserved; no worker suspension or rating deduction applied).`
      }
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
    resolvedAt: null
  };

  state.supportCases.unshift(trustCase);

  // Append audit event
  logAdminAudit(state, {
    actionType: 'review_dispute_flagged',
    caseId: caseId,
    bookingId: bookingId,
    slotId: effectiveSlotId,
    proId: effectiveProId,
    adminName: adminName,
    previousValue: 'undisputed',
    newValue: `disputed (${caseId})`,
    reason: cleanReason,
    status: 'success'
  });

  saveState(state);
  return { success: true, booking, review, case: trustCase };
}

/**
 * Resolve or Update Trust & Safety Case (Adjustment 2).
 * Preserves rating integrity.
 */
export function updateTrustCaseResolution(caseId, resolutionStatus, investigationNotes, adminName = 'Dallas Dispatch Lead (Demo)') {
  const state = loadState();
  if (!Array.isArray(state.supportCases)) return { success: false, error: 'No support cases in state.' };

  const trustCase = state.supportCases.find(c => c.caseId === caseId);
  if (!trustCase) return { success: false, error: `Trust & Safety case ${caseId} not found.` };

  const cleanNotes = (investigationNotes || '').trim();
  if (!cleanNotes) {
    return { success: false, error: 'Investigation findings or resolution notes are required.' };
  }

  const validResolutions = ['under_investigation', 'verified_valid', 'dispute_resolved'];
  if (!validResolutions.includes(resolutionStatus)) {
    return { success: false, error: `Invalid resolution "${resolutionStatus}". Must be: under_investigation, verified_valid, dispute_resolved.` };
  }

  const nowIso = new Date().toISOString();
  const prevStatus = trustCase.status;

  trustCase.status = (resolutionStatus === 'dispute_resolved' || resolutionStatus === 'verified_valid') ? 'resolved' : 'under_review';
  trustCase.resolution = resolutionStatus;
  trustCase.updatedAt = nowIso;
  if (trustCase.status === 'resolved') {
    trustCase.resolvedAt = nowIso;
  }

  // Update associated review status badge if present
  if (trustCase.bookingId && trustCase.reviewSlotId) {
    const booking = (state.bookings || []).find(b => b.id === trustCase.bookingId);
    if (booking && booking.workerReviews) {
      const review = booking.workerReviews.find(r => r.slotId === trustCase.reviewSlotId);
      if (review) {
        review.disputeStatus = resolutionStatus;
      }
    }
  }

  // Append note
  trustCase.notes.push({
    noteId: `note_${caseId}_${trustCase.notes.length + 1}`,
    author: adminName,
    timestamp: nowIso,
    text: `Investigation resolution: ${resolutionStatus.toUpperCase()}. Findings: ${cleanNotes}`
  });

  // Log audit
  logAdminAudit(state, {
    actionType: 'trust_case_updated',
    caseId: caseId,
    bookingId: trustCase.bookingId,
    proId: trustCase.proId,
    adminName: adminName,
    previousValue: prevStatus,
    newValue: resolutionStatus,
    reason: cleanNotes,
    status: 'success'
  });

  saveState(state);
  return { success: true, case: trustCase };
}

// ---------------------------------------------------------------------------
// Stage 4 Phase 4.2: Offline AI-Assisted Dispatch Privacy, Trust & Fallback Engine
// ---------------------------------------------------------------------------

const DAY_NAMES_SUNDAY_FIRST = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

const ALLOWED_SCOPE_STRING_FIELDS = [
  'truckOption', 'stairsOption', 'stairsElevator', 'tvSize',
  'wallType', 'bracket', 'yardSize', 'gateAccess', 'lotSize'
];

const ALLOWED_RISK_CODES = new Set([
  'thin_candidate_pool',
  'asap_urgency',
  'multi_worker_coordination',
  'neighborhood_travel',
  'reliability_watch',
  'zero_eligible_slot',
  'insufficient_multiworker_supply',
  'availability_boundary'
]);

const ALLOWED_RISK_SEVERITIES = new Set(['low', 'medium', 'high']);

const ALLOWED_NEXT_ACTIONS = new Set([
  'approve_top_candidate',
  'review_risks_before_assign',
  'extend_asap_window',
  'escalate_support_case'
]);

/**
 * Removes script tags, markup delimiters, inline event handlers, and control
 * characters from external/AI strings before storing or displaying text.
 */
export function sanitizeAiText(text, maxLen = 240) {
  if (text === null || text === undefined) return '';
  let clean = String(text);
  clean = clean.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ');
  clean = clean.replace(/<[^>]*>/g, ' ');
  clean = clean.replace(/[<>]/g, '');
  clean = clean.replace(/javascript\s*:/gi, '');
  clean = clean.replace(/\bon[a-z]{2,18}\s*=/gi, '');
  clean = clean.replace(/[\u0000-\u001F\u007F]/g, ' ');
  clean = clean.replace(/\s+/g, ' ').trim();
  if (clean.length > maxLen) {
    clean = clean.slice(0, Math.max(0, maxLen - 3)).trimEnd() + '...';
  }
  return clean;
}

function fnv1aDigest(input) {
  const str = String(input || '');
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c + (i & 0xff));
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return 'fp_' + h1.toString(36).padStart(7, '0') + '_' + h2.toString(36).padStart(7, '0');
}

function getBookingTargetWeekday(booking) {
  if (booking && booking.scheduledDate) {
    const dt = new Date(booking.scheduledDate + 'T12:00:00');
    if (!isNaN(dt.getTime())) {
      return DAY_NAMES_SUNDAY_FIRST[dt.getDay()];
    }
  }
  const dallasNow = getDallasLocalNow();
  return DAY_NAMES_SUNDAY_FIRST[dallasNow.fullDate.getDay()];
}

function isMatchingNeighborhood(proNeighborhood, booking) {
  if (!proNeighborhood || !booking) return false;
  const a = String(proNeighborhood).trim().toLowerCase();
  const bookingName = String(booking.neighborhoodName || '').trim().toLowerCase();
  if (bookingName && a === bookingName) return true;

  if (booking.neighborhoodId) {
    const targetZone = (DALLAS_NEIGHBORHOODS || []).find(n => n.id === booking.neighborhoodId);
    if (targetZone && targetZone.name.toLowerCase() === a) {
      return true;
    }
  }

  const knownZone = (DALLAS_NEIGHBORHOODS || []).find(n =>
    n.name.toLowerCase() === a || (bookingName && n.name.toLowerCase() === bookingName)
  );
  if (!knownZone || !bookingName) return false;
  const token = knownZone.name.toLowerCase().split(/[\s/]+/)[0];
  return a.includes(token) && bookingName.includes(token);
}

/**
 * Evaluates whether a booking is currently open for administrative dispatch advice.
 * Mirrors Rule 0 (expiration), terminal status exclusions, and active-work protection.
 */
function evaluateBookingDispatchStatus(booking, options = {}) {
  if (!booking) {
    return { dispatchable: false, openSlots: [], reason: 'Booking not found.' };
  }
  if (booking.overallStatus === 'cancelled') {
    return { dispatchable: false, openSlots: [], reason: 'Cancelled bookings cannot receive dispatch assignments.' };
  }
  if (booking.overallStatus === 'completed') {
    return { dispatchable: false, openSlots: [], reason: 'Completed bookings are already finalized.' };
  }

  const currentMs = (options && typeof options.currentTimeMs === 'number')
    ? options.currentTimeMs
    : Date.now();
  const dallasNow = getDallasLocalNow();

  if (booking.timingType === 'asap') {
    if (isAsapExpired(booking, currentMs)) {
      return {
        dispatchable: false,
        openSlots: [],
        reason: 'ASAP matching window has expired. Extend the ASAP window or escalate before assigning workers.'
      };
    }
  } else if (booking.scheduledDate) {
    if (booking.scheduledDate < dallasNow.dateStr) {
      return {
        dispatchable: false,
        openSlots: [],
        reason: `Scheduled appointment date (${booking.scheduledDate}) has already passed.`
      };
    }
    if (
      booking.scheduledDate === dallasNow.dateStr &&
      booking.scheduledTime &&
      booking.scheduledTime.includes(':') &&
      booking.scheduledTime < dallasNow.timeStr
    ) {
      return {
        dispatchable: false,
        openSlots: [],
        reason: `Scheduled appointment time (${booking.scheduledTime}) has already passed today.`
      };
    }
  }

  const slots = Array.isArray(booking.workerAssignments) ? booking.workerAssignments : [];
  const activeWorkSlot = slots.find(s => ['traveling', 'arrived', 'in_progress'].includes(s.status));
  if (activeWorkSlot) {
    return {
      dispatchable: false,
      openSlots: [],
      reason: `Active field work (${activeWorkSlot.status}) is already underway on this booking.`
    };
  }

  const openSlots = slots
    .filter(s => s.status === 'unassigned')
    .slice()
    .sort((a, b) => String(a.slotId).localeCompare(String(b.slotId)));

  if (openSlots.length === 0) {
    return {
      dispatchable: false,
      openSlots: [],
      reason: 'All worker positions on this booking are already assigned.'
    };
  }

  return {
    dispatchable: true,
    openSlots,
    reason: 'Booking is open for dispatch evaluation.'
  };
}

function classifyDisqualificationBucket(reasonStr) {
  const lower = String(reasonStr || '').toLowerCase();
  if (lower.includes('already assigned')) return 'alreadyAssignedOnBooking';
  if (lower.includes('already filled')) return 'slotAlreadyFilled';
  if (lower.includes('verified skill')) return 'missingCredential';
  if (lower.includes('equipment') || lower.includes('mower')) return 'missingEquipment';
  if (lower.includes('schedule conflict')) return 'scheduleConflict';
  if (lower.includes('weekly schedule') || lower.includes('unavailable')) return 'outsideAvailability';
  if (lower.includes('expired') || lower.includes('passed')) return 'expiredWindow';
  return 'other';
}

function buildAllowedScopeSummary(booking) {
  const details = (booking && booking.serviceDetails && typeof booking.serviceDetails === 'object')
    ? booking.serviceDetails
    : {};
  const summary = {
    workersRequired: Math.max(1, parseInt(booking.workersNeeded || details.workersNeeded || 1, 10)),
    estimatedDurationHours: Number(booking.estimatedDurationHours || details.hours || 1)
  };
  if (typeof details.truckNeeded === 'boolean') {
    summary.truckNeeded = details.truckNeeded;
  }
  if (typeof details.edgeTrimming === 'boolean') {
    summary.edgeTrimming = details.edgeTrimming;
  }
  ALLOWED_SCOPE_STRING_FIELDS.forEach(key => {
    if (details[key] !== undefined && details[key] !== null && String(details[key]).trim() !== '') {
      summary[key] = sanitizeAiText(details[key], 64);
    }
  });
  if (Array.isArray(details.requiredEquipment) && details.requiredEquipment.length > 0) {
    summary.requiredEquipment = details.requiredEquipment
      .slice(0, 6)
      .map(item => sanitizeAiText(item, 40));
  }
  // Explicitly omit customer notes (serviceDetails.notes) to prevent free-text PII leakage.
  return summary;
}

function computeProWorkloadCounts(proId, state) {
  let activeAssignmentsCount = 0;
  let completedJobsCount = 0;
  (state.bookings || []).forEach(b => {
    const isTerminal = b.overallStatus === 'completed' || b.overallStatus === 'cancelled';
    (b.workerAssignments || []).forEach(slot => {
      if (slot.assignedProId !== proId) return;
      if (slot.status === 'completed') {
        completedJobsCount++;
      } else if (!isTerminal && slot.status !== 'unassigned') {
        activeAssignmentsCount++;
      }
    });
  });
  return { activeAssignmentsCount, completedJobsCount };
}

/**
 * Computes a deterministic state fingerprint for a dispatch recommendation.
 * Detects changes to the booking itself, all open slot statuses, worker skills/equipment/
 * weekly availability for the target day, and active schedule conflicts across other bookings.
 */
export function computeBookingDispatchFingerprint(bookingId, options = {}) {
  const state = loadState();
  const booking = (state.bookings || []).find(b => b.id === bookingId);
  const statusCheck = evaluateBookingDispatchStatus(booking, options);

  if (!booking) {
    return {
      valid: false,
      dispatchable: false,
      bookingId: bookingId || null,
      bookingStatus: null,
      openSlotIds: [],
      fingerprint: null,
      reason: statusCheck.reason
    };
  }

  const currentMs = (options && typeof options.currentTimeMs === 'number')
    ? options.currentTimeMs
    : Date.now();
  const weekday = getBookingTargetWeekday(booking);

  const canonicalSlots = (booking.workerAssignments || [])
    .slice()
    .sort((a, b) => String(a.slotId).localeCompare(String(b.slotId)))
    .map(s => ({
      slotId: s.slotId,
      roleTitle: s.roleTitle,
      status: s.status,
      assignedProId: s.assignedProId || null
    }));

  const canonicalPros = (state.pros || [])
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(pro => {
      const avail = pro.weeklyAvailability ? pro.weeklyAvailability[weekday] : null;
      return {
        id: pro.id,
        tier: pro.tier || 'Bronze',
        rating: pro.rating || 0,
        reliabilityScore: pro.reliabilityScore || 0,
        homeNeighborhood: pro.homeNeighborhood || '',
        verifiedSkills: (pro.verifiedSkills || []).slice().sort(),
        verifiedEquipment: (pro.verifiedEquipment || []).slice().sort(),
        dayAvailability: avail ? { enabled: !!avail.enabled, start: avail.start || '', end: avail.end || '' } : null
      };
    });

  // Track active assignments across ALL bookings so any schedule overlap change invalidates cache.
  const canonicalScheduleState = (state.bookings || [])
    .filter(b => b.overallStatus !== 'cancelled' && b.overallStatus !== 'completed')
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(b => ({
      id: b.id,
      overallStatus: b.overallStatus,
      scheduledDate: b.scheduledDate || '',
      scheduledTime: b.scheduledTime || '',
      estimatedDurationHours: b.estimatedDurationHours || 1,
      activePros: (b.workerAssignments || [])
        .filter(s => s.assignedProId && s.status !== 'completed' && s.status !== 'unassigned')
        .sort((a, b2) => String(a.slotId).localeCompare(String(b2.slotId)))
        .map(s => `${s.slotId}:${s.assignedProId}:${s.status}`)
    }))
    .filter(entry => entry.activePros.length > 0);

  const liveSlotMatrix = statusCheck.openSlots.map(slot => ({
    slotId: slot.slotId,
    allowedPros: (state.pros || [])
      .slice()
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .filter(p => canProAcceptSlot(p.id, booking.id, slot.slotId, options).allowed)
      .map(p => p.id)
  }));

  const snapshot = {
    booking: {
      id: booking.id,
      overallStatus: booking.overallStatus,
      timingType: booking.timingType,
      scheduledDate: booking.scheduledDate || null,
      scheduledTime: booking.scheduledTime || null,
      estimatedDurationHours: booking.estimatedDurationHours || 1,
      asapExpiresAt: booking.asapExpiresAt || null,
      asapExpired: booking.timingType === 'asap' ? isAsapExpired(booking, currentMs) : false,
      serviceCategory: booking.serviceCategory,
      neighborhoodId: booking.neighborhoodId || null
    },
    weekday,
    canonicalSlots,
    canonicalPros,
    canonicalScheduleState,
    liveSlotMatrix
  };

  return {
    valid: true,
    dispatchable: statusCheck.dispatchable,
    bookingId: booking.id,
    bookingStatus: booking.overallStatus,
    openSlotIds: statusCheck.openSlots.map(s => s.slotId),
    fingerprint: fnv1aDigest(JSON.stringify(snapshot)),
    reason: statusCheck.reason
  };
}

/**
 * Evaluates feasible non-overlapping crew assignments across open slots.
 * Maximizes distinct slots covered first, then summed candidate score,
 * ensuring one Pro can NEVER be assigned to multiple positions on the same booking.
 */
function findFeasibleCrewCombinations(openSlots, scoredBySlotMap, maxPlans = 3) {
  const slots = Array.isArray(openSlots) ? openSlots : [];
  if (slots.length === 0) {
    return { plans: [], maxFillableOpenSlots: 0 };
  }

  const perSlotLists = slots.map(slot => {
    const candidates = (scoredBySlotMap.get(slot.slotId) || []).slice(0, 8);
    // Append null option so backtracking handles slots that must remain unfilled when supply is tight.
    return [...candidates, null];
  });

  const collected = [];
  const usedPros = new Set();
  const currentAssign = [];

  function backtrack(idx, filledCount, scoreSum) {
    if (idx === slots.length) {
      if (filledCount > 0) {
        collected.push({
          filledSlotCount: filledCount,
          combinedScore: Math.round(scoreSum * 100) / 100,
          assignments: currentAssign.filter(a => a.proId !== null)
        });
      }
      return;
    }

    const slot = slots[idx];
    const choices = perSlotLists[idx];
    for (let i = 0; i < choices.length; i++) {
      const candidate = choices[i];
      if (candidate === null) {
        currentAssign.push({ slotId: slot.slotId, roleTitle: slot.roleTitle, proId: null, displayName: null });
        backtrack(idx + 1, filledCount, scoreSum);
        currentAssign.pop();
        continue;
      }

      if (usedPros.has(candidate.proId)) {
        continue; // Enforce strict distinctness: one worker cannot hold 2 slots on same booking.
      }

      usedPros.add(candidate.proId);
      currentAssign.push({
        slotId: slot.slotId,
        roleTitle: slot.roleTitle,
        proId: candidate.proId,
        displayName: candidate.displayName,
        score: candidate.preferenceScore !== undefined ? candidate.preferenceScore : candidate.deterministicScore
      });
      const stepScore = candidate.preferenceScore !== undefined ? candidate.preferenceScore : (candidate.deterministicScore || 0);
      backtrack(idx + 1, filledCount + 1, scoreSum + stepScore);
      currentAssign.pop();
      usedPros.delete(candidate.proId);
    }
  }

  backtrack(0, 0, 0);

  if (collected.length === 0) {
    return { plans: [], maxFillableOpenSlots: 0 };
  }

  collected.sort((a, b) => {
    if (b.filledSlotCount !== a.filledSlotCount) return b.filledSlotCount - a.filledSlotCount;
    return b.combinedScore - a.combinedScore;
  });

  const maxFillableOpenSlots = collected[0].filledSlotCount;
  const seenKeys = new Set();
  const topPlans = [];

  for (let i = 0; i < collected.length && topPlans.length < maxPlans; i++) {
    const plan = collected[i];
    const sig = plan.assignments.map(a => `${a.slotId}=${a.proId}`).join('|');
    if (seenKeys.has(sig)) continue;
    seenKeys.add(sig);

    const namesSummary = plan.assignments
      .map(a => `${a.displayName} -> ${a.roleTitle}`)
      .join('; ');

    topPlans.push({
      planRank: topPlans.length + 1,
      filledSlotCount: plan.filledSlotCount,
      totalOpenSlots: slots.length,
      fullCrewCovered: plan.filledSlotCount === slots.length,
      combinedScore: plan.combinedScore,
      assignments: plan.assignments.map(({ slotId, roleTitle, proId, displayName }) => ({
        slotId, roleTitle, proId, displayName
      })),
      summary: `${namesSummary} (${plan.filledSlotCount} of ${slots.length} open position${slots.length === 1 ? '' : 's'} covered).`
    });
  }

  return { plans: topPlans, maxFillableOpenSlots };
}

function buildStaffingFeasibility(openSlots, slotSupply, maxFillableOpenSlots) {
  const openSlotCount = openSlots.length;
  const zeroEligibleSlotIds = slotSupply.filter(s => s.eligibleCount === 0).map(s => s.slotId);
  const slotsWithCandidatesCount = openSlotCount - zeroEligibleSlotIds.length;
  const fullCrewFeasible = openSlotCount > 0 && maxFillableOpenSlots === openSlotCount;

  let shortageStatus = 'sufficient_supply';
  let cannotCompletelyStaffReason = null;

  if (maxFillableOpenSlots === 0) {
    shortageStatus = 'zero_eligible';
    cannotCompletelyStaffReason =
      'Zero verified and available Dallas Pros satisfy Crewly eligibility rules for any open position on this booking.';
  } else if (!fullCrewFeasible) {
    shortageStatus = 'insufficient_supply';
    if (zeroEligibleSlotIds.length > 0) {
      cannotCompletelyStaffReason =
        `Insufficient supply: open position(s) ${zeroEligibleSlotIds.join(', ')} have 0 eligible Pros; AI cannot invent candidates.`;
    } else {
      cannotCompletelyStaffReason =
        `Insufficient unique workers: only ${maxFillableOpenSlots} of ${openSlotCount} open positions can be staffed simultaneously because one Pro cannot fill multiple slots on the same booking.`;
    }
  } else {
    const minSlotCount = Math.min(...slotSupply.map(s => s.eligibleCount));
    if (minSlotCount <= 1 || (openSlotCount > 1 && new Set(slotSupply.flatMap(s => s.eligibleProIds)).size <= openSlotCount)) {
      shortageStatus = 'tight_supply';
    }
  }

  return {
    openSlotCount,
    slotsWithCandidatesCount,
    zeroEligibleSlotIds,
    maxFillableOpenSlots,
    fullCrewFeasible,
    shortageStatus,
    cannotCompletelyStaffReason
  };
}

/**
 * Builds a strict field-allowlisted, privacy-preserving dispatch request payload.
 * Never mutates state. Runs deterministic canProAcceptSlot() prefiltering per open slot.
 * Strips all customer PII, street addresses, pricing/payout figures, Pro phone/earnings,
 * private notes, support cases, audit logs, and credentials.
 */
export function buildSanitizedAiDispatchPayload(bookingId, options = {}) {
  const state = loadState();
  const booking = (state.bookings || []).find(b => b.id === bookingId);
  const statusCheck = evaluateBookingDispatchStatus(booking, options);
  const fpInfo = computeBookingDispatchFingerprint(bookingId, options);

  if (!statusCheck.dispatchable) {
    return {
      ok: false,
      dispatchable: false,
      bookingId: bookingId || null,
      fingerprint: fpInfo.fingerprint,
      error: statusCheck.reason,
      limitationsDisclosure: AI_DISPATCH_CONFIG.TRUST_LIMITATIONS_DISCLOSURE
    };
  }

  const currentMs = (options && typeof options.currentTimeMs === 'number')
    ? options.currentTimeMs
    : Date.now();
  const weekday = getBookingTargetWeekday(booking);
  const openSlots = statusCheck.openSlots.slice(0, AI_DISPATCH_CONFIG.MAX_OPEN_SLOTS_IN_PROMPT);

  const disqualificationBuckets = {
    alreadyAssignedOnBooking: 0,
    slotAlreadyFilled: 0,
    missingCredential: 0,
    missingEquipment: 0,
    scheduleConflict: 0,
    outsideAvailability: 0,
    expiredWindow: 0,
    other: 0
  };

  const candidateEligibleSlots = new Map();
  const slotSupply = [];
  const crewSlotCandidateStubs = new Map();

  openSlots.forEach(slot => {
    const candidates = getProCandidatesForSlot(booking.id, slot.slotId, options);
    const eligibleIds = [];

    candidates.forEach(entry => {
      if (entry.eligible) {
        eligibleIds.push(entry.pro.id);
        if (!candidateEligibleSlots.has(entry.pro.id)) {
          candidateEligibleSlots.set(entry.pro.id, []);
        }
        candidateEligibleSlots.get(entry.pro.id).push(slot.slotId);
      } else {
        const bucket = classifyDisqualificationBucket(entry.reason);
        disqualificationBuckets[bucket] = (disqualificationBuckets[bucket] || 0) + 1;
      }
    });

    slotSupply.push({
      slotId: slot.slotId,
      roleTitle: sanitizeAiText(slot.roleTitle, 64),
      eligibleProIds: eligibleIds,
      eligibleCount: eligibleIds.length,
      zeroEligible: eligibleIds.length === 0
    });

    crewSlotCandidateStubs.set(
      slot.slotId,
      eligibleIds.map(proId => ({ proId, displayName: proId, deterministicScore: 1 }))
    );
  });

  // Strict allowlist mapping for eligible workers ONLY.
  const eligibleCandidates = Array.from(candidateEligibleSlots.keys())
    .sort()
    .slice(0, AI_DISPATCH_CONFIG.MAX_ELIGIBLE_CANDIDATES_IN_PROMPT)
    .map(proId => {
      const pro = (state.pros || []).find(p => p.id === proId);
      const dayAvail = pro.weeklyAvailability ? pro.weeklyAvailability[weekday] : null;
      const workload = computeProWorkloadCounts(pro.id, state);
      const neighborhoodLabel = sanitizeAiText(pro.homeNeighborhood || 'Dallas Pilot', 48);

      return {
        proId: pro.id,
        displayName: sanitizeAiText(pro.name, 64),
        tier: pro.tier || 'Bronze',
        rating: Number(pro.rating || 0),
        reviewCount: Number(pro.reviewCount || 0),
        reliabilityScore: Number(pro.reliabilityScore || 0),
        homeNeighborhood: neighborhoodLabel,
        sameNeighborhoodAsBooking: isMatchingNeighborhood(pro.homeNeighborhood, booking),
        verifiedSkills: Array.isArray(pro.verifiedSkills) ? [...pro.verifiedSkills].slice(0, 12) : [],
        verifiedEquipment: Array.isArray(pro.verifiedEquipment) ? [...pro.verifiedEquipment].slice(0, 12) : [],
        dayAvailabilityWindow: dayAvail && dayAvail.enabled
          ? `${dayAvail.start}-${dayAvail.end}`
          : null,
        activeAssignmentsCount: workload.activeAssignmentsCount,
        completedJobsCount: workload.completedJobsCount,
        eligibleForSlotIds: candidateEligibleSlots.get(pro.id)
      };
    });

  const feasibleCheck = findFeasibleCrewCombinations(openSlots, crewSlotCandidateStubs, 1);
  const staffingFeasibility = buildStaffingFeasibility(
    openSlots,
    slotSupply,
    feasibleCheck.maxFillableOpenSlots
  );

  const filledPositionsCount = (booking.workerAssignments || [])
    .filter(s => s.status !== 'unassigned')
    .length;

  const bookingContext = {
    bookingId: booking.id,
    serviceCategory: booking.serviceCategory,
    serviceTitle: sanitizeAiText(booking.serviceTitle, 80),
    neighborhoodName: sanitizeAiText(booking.neighborhoodName || 'Dallas Pilot', 64),
    timingType: booking.timingType || 'scheduled',
    scheduledDate: booking.scheduledDate || null,
    scheduledTime: booking.scheduledTime || null,
    targetWeekday: weekday,
    estimatedDurationHours: Number(booking.estimatedDurationHours || 1),
    asapRemainingMinutes: booking.timingType === 'asap'
      ? getAsapRemainingMinutes(booking, currentMs)
      : null,
    scopeSummary: buildAllowedScopeSummary(booking),
    alreadyAssignedCount: filledPositionsCount,
    totalSlotsCount: (booking.workerAssignments || []).length,
    openSlots: openSlots.map(s => ({
      slotId: s.slotId,
      roleTitle: sanitizeAiText(s.roleTitle, 64)
    }))
  };

  return {
    ok: true,
    dispatchable: true,
    bookingId: booking.id,
    fingerprint: fpInfo.fingerprint,
    zeroEligibleOverall: staffingFeasibility.maxFillableOpenSlots === 0,
    staffingFeasibility,
    payload: {
      schemaVersion: 'crewly_ai_dispatch_request_v1',
      bookingContext,
      eligibleCandidates,
      slotSupply,
      disqualifiedSummary: {
        totalDisqualificationChecksFailed: Object.values(disqualificationBuckets).reduce((a, b) => a + b, 0),
        reasonsCount: disqualificationBuckets
      },
      constraints: {
        neighborhoodNote: AI_DISPATCH_CONFIG.NEIGHBORHOOD_LIMITATION_NOTE,
        advisoryOnly: true,
        distinctProPerBookingRequired: true
      }
    },
    limitationsDisclosure: AI_DISPATCH_CONFIG.TRUST_LIMITATIONS_DISCLOSURE
  };
}

function scoreCandidateDeterministically(candidate, weights) {
  const tierMap = weights.TIER_POINTS || {};
  const sameNeighborhoodPoints = candidate.sameNeighborhoodAsBooking
    ? Number(weights.SAME_NEIGHBORHOOD_POINTS || 0)
    : 0;
  const tierPoints = Number(tierMap[candidate.tier] || 0);
  const reliabilityPoints = Math.round(candidate.reliabilityScore * Number(weights.RELIABILITY_MULTIPLIER || 0) * 100) / 100;
  const ratingPoints = Math.round(candidate.rating * Number(weights.RATING_MULTIPLIER || 0) * 100) / 100;
  const completedJobsBonus = Math.min(
    Number(weights.COMPLETED_JOB_BONUS_CAP || 0),
    Math.round(candidate.completedJobsCount * Number(weights.COMPLETED_JOB_POINT_RATE || 0) * 100) / 100
  );
  const activeWorkloadPenalty = Math.round(
    candidate.activeAssignmentsCount * Number(weights.ACTIVE_WORKLOAD_PENALTY || 0) * 100
  ) / 100;

  const totalScore = Math.round(
    (sameNeighborhoodPoints + tierPoints + reliabilityPoints + ratingPoints + completedJobsBonus - activeWorkloadPenalty) * 100
  ) / 100;

  return {
    totalScore,
    scoreBreakdown: {
      sameNeighborhoodPoints,
      tierPoints,
      reliabilityPoints,
      ratingPoints,
      completedJobsBonus,
      activeWorkloadPenalty
    }
  };
}

function buildCandidateRationaleLines(candidate, bookingContext, scored) {
  const bullets = [
    `Verified qualification & conflict check passed for ${bookingContext.serviceTitle}.`
  ];
  if (candidate.sameNeighborhoodAsBooking) {
    bullets.push(`Same Dallas pilot neighborhood label (${candidate.homeNeighborhood}) — zone match only, not live GPS or driving ETA.`);
  } else {
    bullets.push(`Home Dallas pilot zone: ${candidate.homeNeighborhood} (cross-zone label only; no live driving ETA calculated).`);
  }
  bullets.push(
    `Supporting context: ${candidate.tier} tier, ${candidate.rating} rating (${candidate.reviewCount} reviews), ${candidate.reliabilityScore}% reliability, ${candidate.completedJobsCount} completed jobs.`
  );

  let cautionNote = '';
  if (candidate.activeAssignmentsCount > 0) {
    cautionNote = `Currently holding ${candidate.activeAssignmentsCount} other active assignment(s); confirm non-overlapping transit window.`;
  } else if (bookingContext.timingType === 'asap' && typeof bookingContext.asapRemainingMinutes === 'number' && bookingContext.asapRemainingMinutes <= 15) {
    cautionNote = `ASAP window has ~${bookingContext.asapRemainingMinutes} min remaining; confirm rapid readiness before assigning.`;
  }

  const fitSummary = sanitizeAiText(
    `Rules score ${scored.totalScore}: verified for ${bookingContext.serviceTitle}; ${candidate.reliabilityScore}% reliability (${candidate.tier} supporting context).`,
    140
  );

  return { bullets, cautionNote, fitSummary };
}

function deriveOperationalRisks(bookingContext, staffingFeasibility, fallbackModeRisks = []) {
  const risks = [...fallbackModeRisks];
  const addRisk = (severity, code, message) => {
    if (risks.length < 5 && !risks.some(r => r.code === code && r.message === message)) {
      risks.push({ severity, code, message: sanitizeAiText(message, 160) });
    }
  };

  if (staffingFeasibility.zeroEligibleSlotIds.length > 0) {
    addRisk(
      'high',
      'zero_eligible_slot',
      `Zero verified available candidates for slot(s): ${staffingFeasibility.zeroEligibleSlotIds.join(', ')}. Manual outreach or Support escalation needed.`
    );
  }
  if (!staffingFeasibility.fullCrewFeasible && staffingFeasibility.maxFillableOpenSlots > 0) {
    addRisk(
      'high',
      'insufficient_multiworker_supply',
      staffingFeasibility.cannotCompletelyStaffReason || 'Insufficient unique workers to staff all open positions.'
    );
  } else if (staffingFeasibility.shortageStatus === 'tight_supply') {
    addRisk(
      'medium',
      'thin_candidate_pool',
      'Tight Dallas supply: only 1 eligible candidate available for at least one open position.'
    );
  }

  if (bookingContext.timingType === 'asap' && typeof bookingContext.asapRemainingMinutes === 'number') {
    if (bookingContext.asapRemainingMinutes <= 15) {
      addRisk(
        'high',
        'asap_urgency',
        `ASAP dispatch window expiring soon (~${bookingContext.asapRemainingMinutes} min left).`
      );
    } else if (bookingContext.asapRemainingMinutes <= 30) {
      addRisk(
        'medium',
        'asap_urgency',
        `ASAP request with ~${bookingContext.asapRemainingMinutes} min matching time remaining.`
      );
    }
  }

  if (bookingContext.totalSlotsCount > 1) {
    addRisk(
      'low',
      'multi_worker_coordination',
      `Multi-worker booking (${bookingContext.alreadyAssignedCount} filled, ${staffingFeasibility.openSlotCount} open): workers remain in coordinated crew staging until full crew confirmation.`
    );
  }

  return risks;
}

function chooseRecommendedNextAction(bookingContext, staffingFeasibility, risks) {
  if (staffingFeasibility.maxFillableOpenSlots === 0) {
    if (bookingContext.timingType === 'asap' && (bookingContext.asapRemainingMinutes || 0) <= 15) {
      return 'extend_asap_window';
    }
    return 'escalate_support_case';
  }
  if (!staffingFeasibility.fullCrewFeasible) {
    if (bookingContext.timingType === 'asap') return 'extend_asap_window';
    return 'escalate_support_case';
  }
  if (risks.some(r => r.severity === 'high' || r.severity === 'medium')) {
    return 'review_risks_before_assign';
  }
  return 'approve_top_candidate';
}

/**
 * Computes a deterministic, transparent rules-based dispatch ranking without invoking any LLM.
 * Explicitly labels provenance as offline/fallback and uses configurable scoring weights.
 */
export function computeDeterministicFallbackRanking(
  bookingId,
  fallbackReason = 'offline_rules_fallback',
  options = {}
) {
  const prepared = buildSanitizedAiDispatchPayload(bookingId, options);
  if (!prepared.dispatchable) {
    return {
      ok: false,
      dispatchable: false,
      bookingId: bookingId || null,
      fingerprint: prepared.fingerprint,
      error: prepared.error,
      provenance: {
        source: 'deterministic_rules_fallback',
        isLiveAi: false,
        isMockTestMode: false,
        label: AI_DISPATCH_CONFIG.PROVENANCE_LABELS.FALLBACK,
        fallbackReason: sanitizeAiText(fallbackReason, 64),
        model: null,
        disclaimer: `Advisory only — booking is not currently dispatchable. ${AI_DISPATCH_CONFIG.NEIGHBORHOOD_LIMITATION_NOTE}`
      },
      limitationsDisclosure: prepared.limitationsDisclosure
    };
  }

  const weights = AI_DISPATCH_CONFIG.FALLBACK_SCORING_WEIGHTS;
  const { bookingContext, eligibleCandidates, slotSupply } = prepared.payload;
  const candidateMap = new Map(eligibleCandidates.map(c => [c.proId, c]));
  const scoredBySlotMap = new Map();

  slotSupply.forEach(supply => {
    const scoredCandidates = supply.eligibleProIds
      .map(proId => candidateMap.get(proId))
      .filter(Boolean)
      .map(candidate => {
        const scored = scoreCandidateDeterministically(candidate, weights);
        const textLines = buildCandidateRationaleLines(candidate, bookingContext, scored);
        return {
          proId: candidate.proId,
          displayName: candidate.displayName,
          tier: candidate.tier,
          rating: candidate.rating,
          reviewCount: candidate.reviewCount,
          reliabilityScore: candidate.reliabilityScore,
          homeNeighborhood: candidate.homeNeighborhood,
          sameNeighborhoodAsBooking: candidate.sameNeighborhoodAsBooking,
          deterministicScore: scored.totalScore,
          scoreBreakdown: scored.scoreBreakdown,
          fitSummary: textLines.fitSummary,
          rationaleBullets: textLines.bullets,
          cautionNote: textLines.cautionNote
        };
      })
      .sort((a, b) => {
        if (b.deterministicScore !== a.deterministicScore) return b.deterministicScore - a.deterministicScore;
        return String(a.proId).localeCompare(String(b.proId));
      })
      .slice(0, AI_DISPATCH_CONFIG.MAX_RECOMMENDATIONS_PER_SLOT)
      .map((item, idx) => ({ rank: idx + 1, ...item }));

    scoredBySlotMap.set(supply.slotId, scoredCandidates);
  });

  const crewComboResult = findFeasibleCrewCombinations(
    bookingContext.openSlots,
    scoredBySlotMap,
    AI_DISPATCH_CONFIG.MAX_COMBINATION_PLANS
  );
  const topPlan = crewComboResult.plans[0] || null;
  const primaryBySlot = new Map(
    topPlan ? topPlan.assignments.map(a => [a.slotId, a.proId]) : []
  );

  const slotRecommendations = slotSupply.map(supply => {
    const ranked = scoredBySlotMap.get(supply.slotId) || [];
    const primaryProId = primaryBySlot.get(supply.slotId) || null;
    const primaryObj = ranked.find(c => c.proId === primaryProId) || ranked[0] || null;
    const draftReason = primaryObj
      ? sanitizeAiText(
          `[Rules-Based Ranking] Suggesting ${primaryObj.displayName} for ${supply.roleTitle} (${bookingContext.bookingId}) based on verified skills, ${primaryObj.reliabilityScore}% reliability, and pilot zone context.`,
          AI_DISPATCH_CONFIG.REASON_MAX_CHARS
        )
      : '';

    return {
      slotId: supply.slotId,
      roleTitle: supply.roleTitle,
      supplyStatus: supply.eligibleCount === 0 ? 'zero_eligible' : 'candidates_available',
      eligibleCount: supply.eligibleCount,
      recommendedPrimaryProId: primaryProId,
      rankedCandidates: ranked,
      draftAdminReason: draftReason
    };
  });

  const staffingFeasibility = buildStaffingFeasibility(
    bookingContext.openSlots,
    slotSupply,
    crewComboResult.maxFillableOpenSlots
  );
  const operationalRisks = deriveOperationalRisks(bookingContext, staffingFeasibility);
  const recommendedNextAction = chooseRecommendedNextAction(bookingContext, staffingFeasibility, operationalRisks);
  const cleanFallbackReason = sanitizeAiText(fallbackReason, 64) || 'offline_rules_fallback';

  return {
    ok: true,
    dispatchable: true,
    bookingId: bookingContext.bookingId,
    fingerprint: prepared.fingerprint,
    generatedAt: new Date().toISOString(),
    provenance: {
      source: prepared.zeroEligibleOverall ? 'zero_eligible_short_circuit' : 'deterministic_rules_fallback',
      isLiveAi: false,
      isMockTestMode: false,
      label: prepared.zeroEligibleOverall
        ? AI_DISPATCH_CONFIG.PROVENANCE_LABELS.ZERO_ELIGIBLE
        : AI_DISPATCH_CONFIG.PROVENANCE_LABELS.FALLBACK,
      fallbackReason: cleanFallbackReason,
      model: null,
      scoringWeightsUsed: weights,
      disclaimer: `Deterministic fallback ranking only (no LLM called). ${AI_DISPATCH_CONFIG.NEIGHBORHOOD_LIMITATION_NOTE} Admin approval required.`
    },
    staffingFeasibility,
    slotRecommendations,
    recommendedCrewPlans: crewComboResult.plans,
    operationalRisks,
    recommendedNextAction,
    validationReport: {
      rejectedCandidateCount: 0,
      rejectedDetails: [],
      staleDetected: false,
      revalidatedAgainstFreshState: true
    },
    limitationsDisclosure: prepared.limitationsDisclosure
  };
}

/**
 * Explicit Trust Boundary for external Gemini responses.
 * Treats AI output as untrusted JSON: validates schema shape, booking/slot identity,
 * freshness fingerprint, XSS sanitization, multi-worker distinctness, and live
 * canProAcceptSlot() eligibility before returning normalized advice or falling back.
 */
export function validateAndNormalizeAiRecommendation(rawAiResponse, bookingId, options = {}) {
  const prepared = buildSanitizedAiDispatchPayload(bookingId, options);
  if (!prepared.dispatchable) {
    return {
      ok: false,
      dispatchable: false,
      bookingId: bookingId || null,
      fingerprint: prepared.fingerprint,
      error: prepared.error,
      provenance: {
        source: 'rejected_booking_not_dispatchable',
        isLiveAi: false,
        isMockTestMode: false,
        label: AI_DISPATCH_CONFIG.PROVENANCE_LABELS.FALLBACK,
        fallbackReason: 'booking_not_dispatchable',
        model: null,
        disclaimer: prepared.error
      },
      validationReport: {
        rejectedCandidateCount: 0,
        rejectedDetails: [prepared.error],
        staleDetected: false,
        revalidatedAgainstFreshState: true
      }
    };
  }

  // Freshness fingerprint guard detects booking, worker availability, and conflict shifts.
  if (options && options.expectedFingerprint && options.expectedFingerprint !== prepared.fingerprint) {
    const fallback = computeDeterministicFallbackRanking(bookingId, 'stale_state_fingerprint_mismatch', options);
    fallback.validationReport.staleDetected = true;
    fallback.validationReport.rejectedDetails.push(
      'Recommendation rejected: booking status, worker availability, or schedule conflict state changed.'
    );
    return fallback;
  }

  // Zero eligible candidates deterministically -> never promote AI hallucinations over empty supply.
  if (prepared.zeroEligibleOverall) {
    const zeroResult = computeDeterministicFallbackRanking(bookingId, 'zero_eligible_workers_in_state', options);
    zeroResult.validationReport.rejectedDetails.push(
      'Deterministic prefilter found 0 eligible Pros; AI suggestions cannot bypass eligibility rules.'
    );
    return zeroResult;
  }

  let parsed = rawAiResponse;
  if (typeof rawAiResponse === 'string') {
    try {
      parsed = JSON.parse(rawAiResponse);
    } catch (e) {
      const fallback = computeDeterministicFallbackRanking(bookingId, 'invalid_ai_json', options);
      fallback.validationReport.rejectedDetails.push('Malformed JSON returned by AI service.');
      return fallback;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const fallback = computeDeterministicFallbackRanking(bookingId, 'invalid_ai_structure', options);
    fallback.validationReport.rejectedDetails.push('AI response root must be a JSON object.');
    return fallback;
  }

  if (parsed.bookingId !== bookingId || !Array.isArray(parsed.slotRecommendations)) {
    const fallback = computeDeterministicFallbackRanking(bookingId, 'ai_booking_mismatch_or_missing_slots', options);
    fallback.validationReport.rejectedDetails.push(
      `AI response bookingId mismatch or missing slotRecommendations for ${bookingId}.`
    );
    return fallback;
  }

  const state = loadState();
  const { bookingContext, eligibleCandidates, slotSupply } = prepared.payload;
  const weights = AI_DISPATCH_CONFIG.FALLBACK_SCORING_WEIGHTS;
  const safeCandidateMap = new Map(eligibleCandidates.map(c => [c.proId, c]));
  const openSlotIdSet = new Set(bookingContext.openSlots.map(s => s.slotId));

  const rejectedDetails = [];
  let rejectedCandidateCount = 0;

  // Map AI slot entries cleanly by valid open slotId; record bogus/filled slots as rejected.
  const aiSlotEntryMap = new Map();
  parsed.slotRecommendations.forEach(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.slotId !== 'string') {
      rejectedDetails.push('Ignored malformed slotRecommendation item.');
      return;
    }
    if (!openSlotIdSet.has(entry.slotId)) {
      rejectedDetails.push(`Ignored non-open or unknown slot "${sanitizeAiText(entry.slotId, 32)}".`);
      return;
    }
    if (!aiSlotEntryMap.has(entry.slotId)) {
      aiSlotEntryMap.set(entry.slotId, entry);
    }
  });

  const validatedBySlotMap = new Map();

  slotSupply.forEach(supply => {
    const aiSlot = aiSlotEntryMap.get(supply.slotId);
    const seenPros = new Set();
    const verifiedList = [];

    if (aiSlot && Array.isArray(aiSlot.rankedCandidates)) {
      aiSlot.rankedCandidates.forEach((cand, idx) => {
        if (!cand || typeof cand !== 'object' || typeof cand.proId !== 'string') {
          rejectedCandidateCount++;
          rejectedDetails.push(`Slot ${supply.slotId}: malformed candidate item at index ${idx}.`);
          return;
        }
        const proId = sanitizeAiText(cand.proId, 48);
        if (seenPros.has(proId)) {
          rejectedCandidateCount++;
          rejectedDetails.push(`Slot ${supply.slotId}: duplicate candidate "${proId}" skipped.`);
          return;
        }

        const pro = (state.pros || []).find(p => p.id === proId);
        if (!pro) {
          rejectedCandidateCount++;
          rejectedDetails.push(`Slot ${supply.slotId}: hallucinated unknown Pro "${proId}" rejected.`);
          return;
        }

        // Re-verify live deterministic eligibility against current state!
        const liveCheck = canProAcceptSlot(proId, bookingId, supply.slotId, options);
        if (!liveCheck.allowed) {
          rejectedCandidateCount++;
          rejectedDetails.push(`Slot ${supply.slotId}: Pro "${proId}" failed live eligibility check (${liveCheck.reason}).`);
          return;
        }

        const safeCandidate = safeCandidateMap.get(proId);
        if (!safeCandidate) {
          rejectedCandidateCount++;
          rejectedDetails.push(`Slot ${supply.slotId}: Pro "${proId}" excluded outside sanitized allowlist.`);
          return;
        }

        seenPros.add(proId);
        const detScored = scoreCandidateDeterministically(safeCandidate, weights);
        const aiOrderRank = verifiedList.length + 1;
        // Weight AI rank ordering gently on top of deterministic score while respecting combination distinctness.
        const preferenceScore = ((AI_DISPATCH_CONFIG.MAX_RECOMMENDATIONS_PER_SLOT + 2 - aiOrderRank) * 1000) + detScored.totalScore;

        const cleanBullets = Array.isArray(cand.rationaleBullets)
          ? cand.rationaleBullets.slice(0, 3).map(b => sanitizeAiText(b, AI_DISPATCH_CONFIG.BULLET_MAX_CHARS)).filter(Boolean)
          : [];
        if (cleanBullets.length === 0) {
          cleanBullets.push(`Verified eligible for ${supply.roleTitle} via Crewly qualification rules.`);
        }

        if (verifiedList.length < AI_DISPATCH_CONFIG.MAX_RECOMMENDATIONS_PER_SLOT) {
          verifiedList.push({
            rank: aiOrderRank,
            proId: safeCandidate.proId,
            displayName: safeCandidate.displayName,
            tier: safeCandidate.tier,
            rating: safeCandidate.rating,
            reviewCount: safeCandidate.reviewCount,
            reliabilityScore: safeCandidate.reliabilityScore,
            homeNeighborhood: safeCandidate.homeNeighborhood,
            sameNeighborhoodAsBooking: safeCandidate.sameNeighborhoodAsBooking,
            deterministicScore: detScored.totalScore,
            preferenceScore,
            fitSummary: sanitizeAiText(cand.fitSummary, 140) || `Verified fit for ${supply.roleTitle}.`,
            rationaleBullets: cleanBullets,
            cautionNote: sanitizeAiText(cand.cautionNote, 120)
          });
        }
      });
    }

    validatedBySlotMap.set(supply.slotId, verifiedList);
  });

  const crewComboResult = findFeasibleCrewCombinations(
    bookingContext.openSlots,
    validatedBySlotMap,
    AI_DISPATCH_CONFIG.MAX_COMBINATION_PLANS
  );

  // If all AI selections were rejected or cover fewer open slots jointly than verified supply allows,
  // reject the incomplete AI subset and fall back cleanly to the deterministic crew solver.
  if (crewComboResult.maxFillableOpenSlots < prepared.staffingFeasibility.maxFillableOpenSlots) {
    const reasonCode = crewComboResult.maxFillableOpenSlots === 0
      ? 'ai_candidates_rejected_by_rules'
      : 'ai_incomplete_crew_combination';
    const fallback = computeDeterministicFallbackRanking(bookingId, reasonCode, options);
    fallback.validationReport.rejectedCandidateCount = rejectedCandidateCount;
    fallback.validationReport.rejectedDetails = [
      ...rejectedDetails,
      `AI selection covered only ${crewComboResult.maxFillableOpenSlots} of ${prepared.staffingFeasibility.maxFillableOpenSlots} feasible open slots; restored deterministic crew ranking.`
    ];
    return fallback;
  }

  const topPlan = crewComboResult.plans[0] || null;
  const primaryBySlot = new Map(
    topPlan ? topPlan.assignments.map(a => [a.slotId, a.proId]) : []
  );

  const staffingFeasibility = buildStaffingFeasibility(
    bookingContext.openSlots,
    slotSupply,
    crewComboResult.maxFillableOpenSlots
  );

  const slotRecommendations = slotSupply.map(supply => {
    const ranked = (validatedBySlotMap.get(supply.slotId) || []).map(({ preferenceScore, ...rest }) => rest);
    const primaryProId = primaryBySlot.get(supply.slotId) || null;
    const aiSlot = aiSlotEntryMap.get(supply.slotId);
    const rawFirstAiProId = (aiSlot && Array.isArray(aiSlot.rankedCandidates) && aiSlot.rankedCandidates[0])
      ? aiSlot.rankedCandidates[0].proId
      : null;
    const rawDraft = (aiSlot && rawFirstAiProId === primaryProId)
      ? sanitizeAiText(aiSlot.draftAdminReason, AI_DISPATCH_CONFIG.REASON_MAX_CHARS)
      : '';
    const primaryObj = ranked.find(c => c.proId === primaryProId) || null;

    const draftAdminReason = primaryObj
      ? (rawDraft || sanitizeAiText(
          `[AI Advisory Draft] Recommended ${primaryObj.displayName} for ${supply.roleTitle} (${bookingId}). Verified eligible via Crewly rules.`,
          AI_DISPATCH_CONFIG.REASON_MAX_CHARS
        ))
      : '';

    return {
      slotId: supply.slotId,
      roleTitle: supply.roleTitle,
      supplyStatus: supply.eligibleCount === 0 ? 'zero_eligible' : 'candidates_available',
      eligibleCount: supply.eligibleCount,
      recommendedPrimaryProId: primaryProId,
      rankedCandidates: ranked,
      draftAdminReason
    };
  });

  const sanitizedAiRisks = Array.isArray(parsed.operationalRisks)
    ? parsed.operationalRisks
        .slice(0, 4)
        .filter(r => r && typeof r === 'object' && r.message)
        .map(r => ({
          severity: ALLOWED_RISK_SEVERITIES.has(r.severity) ? r.severity : 'medium',
          code: ALLOWED_RISK_CODES.has(r.code) ? r.code : 'reliability_watch',
          message: sanitizeAiText(r.message, 160)
        }))
    : [];

  // Authoritative staffing & ASAP urgency checks always supplement/override AI risk notes.
  const operationalRisks = deriveOperationalRisks(bookingContext, staffingFeasibility, sanitizedAiRisks);
  let recommendedNextAction = ALLOWED_NEXT_ACTIONS.has(parsed.recommendedNextAction)
    ? parsed.recommendedNextAction
    : chooseRecommendedNextAction(bookingContext, staffingFeasibility, operationalRisks);
  if (!staffingFeasibility.fullCrewFeasible) {
    recommendedNextAction = chooseRecommendedNextAction(bookingContext, staffingFeasibility, operationalRisks);
  }

  const isMockTestMode = Boolean(
    options && (
      options.isSimulatedTestMode === true ||
      options.inferenceSource === 'mock_ai_test_mode'
    )
  );
  const explicitSource = options && typeof options.inferenceSource === 'string'
    ? options.inferenceSource.trim()
    : '';
  const providerName = (options && options.provider === 'openai') || explicitSource === 'live_openai_ai'
    ? 'openai'
    : ((options && options.provider === 'gemini') || explicitSource === 'live_gemini_ai' ? 'gemini' : null);
  const defaultModel = providerName === 'openai' ? 'gpt-6-luna' : 'ai-api-validated';
  const modelName = (options && typeof options.model === 'string' && options.model.trim())
    ? sanitizeAiText(options.model, 64)
    : defaultModel;

  const provenanceSource = isMockTestMode
    ? 'mock_ai_test_mode'
    : (providerName === 'openai' ? 'live_openai_ai' : 'live_gemini_ai');
  const resolvedProvider = providerName || (provenanceSource === 'live_openai_ai' ? 'openai' : 'gemini');
  const provenanceLabel = isMockTestMode
    ? AI_DISPATCH_CONFIG.PROVENANCE_LABELS.MOCK_TEST_MODE
    : (resolvedProvider === 'openai'
      ? AI_DISPATCH_CONFIG.PROVENANCE_LABELS.LIVE_OPENAI_AI
      : AI_DISPATCH_CONFIG.PROVENANCE_LABELS.LIVE_GEMINI_AI);
  const provenanceDisclaimer = isMockTestMode
    ? `Simulated AI test response re-verified by deterministic Crewly eligibility rules (No live AI API call). ${AI_DISPATCH_CONFIG.NEIGHBORHOOD_LIMITATION_NOTE} Human Admin approval required.`
    : `Advisory ${resolvedProvider === 'openai' ? 'OpenAI' : 'Gemini'} AI ranking re-verified by deterministic Crewly eligibility rules. ${AI_DISPATCH_CONFIG.NEIGHBORHOOD_LIMITATION_NOTE} Human Admin approval required.`;

  return {
    ok: true,
    dispatchable: true,
    bookingId: bookingContext.bookingId,
    fingerprint: prepared.fingerprint,
    generatedAt: new Date().toISOString(),
    provenance: {
      source: provenanceSource,
      provider: isMockTestMode ? (providerName || 'mock') : resolvedProvider,
      isLiveAi: !isMockTestMode,
      isMockTestMode,
      label: provenanceLabel,
      fallbackReason: null,
      model: modelName,
      disclaimer: provenanceDisclaimer
    },
    staffingFeasibility,
    slotRecommendations,
    recommendedCrewPlans: crewComboResult.plans,
    operationalRisks,
    recommendedNextAction,
    validationReport: {
      rejectedCandidateCount,
      rejectedDetails,
      staleDetected: false,
      revalidatedAgainstFreshState: true
    },
    limitationsDisclosure: prepared.limitationsDisclosure
  };
}

/**
 * Revalidates a previously generated recommendation envelope against fresh marketplace state
 * before displaying to an Admin AND again immediately prior to Admin assignment approval.
 * Read-only: zero state mutations.
 */
export function verifyRecommendationFreshness(recommendation, bookingId, options = {}) {
  const current = computeBookingDispatchFingerprint(bookingId, options);
  const staleReasons = [];

  if (!recommendation || typeof recommendation !== 'object') {
    staleReasons.push('No recommendation object provided.');
  } else if (recommendation.bookingId !== bookingId) {
    staleReasons.push(`Booking mismatch: expected ${bookingId}, got ${recommendation.bookingId || 'none'}.`);
  }

  if (!current.valid || !current.dispatchable) {
    staleReasons.push(current.reason || 'Booking is no longer eligible for dispatch.');
  }

  if (recommendation && recommendation.fingerprint && current.fingerprint && recommendation.fingerprint !== current.fingerprint) {
    staleReasons.push(
      'Marketplace state changed since recommendation was generated (booking, worker schedule, or schedule conflicts modified).'
    );
  }

  let targetSlotAllowed = true;
  if (options && options.slotId && options.proId) {
    const check = canProAcceptSlot(options.proId, bookingId, options.slotId, options);
    if (!check.allowed) {
      targetSlotAllowed = false;
      staleReasons.push(`Candidate ${options.proId} is no longer eligible for ${options.slotId}: ${check.reason}`);
    }
  }

  const fresh = staleReasons.length === 0;
  return {
    fresh,
    allowedForApproval: fresh && targetSlotAllowed && current.dispatchable,
    bookingId: bookingId || null,
    currentFingerprint: current.fingerprint,
    openSlotIds: current.openSlotIds,
    staleReasons,
    reason: fresh
      ? 'Recommendation matches live booking and worker availability state.'
      : staleReasons[0]
  };
}

function redactSensitivePatterns(text) {
  return String(text || '')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted-key]')
    .replace(/\bsk-(?:proj-|svcacct-|admin-)?[0-9A-Za-z_-]{16,}\b/g, '[redacted-key]')
    .replace(/\bBearer\s+[0-9A-Za-z._-]{16,}\b/gi, '[redacted-token]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[redacted-phone]');
}

/**
 * Append-only sanitized audit logging helper for Stage 4 AI dispatch advisory events.
 * Strictly prohibits persisting PII, street addresses, phone numbers, balances, or keys.
 */
export function logAiDispatchAuditEvent(entry = {}) {
  const allowedActions = AI_DISPATCH_CONFIG.ALLOWED_AUDIT_ACTIONS || [];
  if (!entry || !allowedActions.includes(entry.actionType)) {
    return {
      success: false,
      error: `Invalid AI audit actionType "${entry ? entry.actionType : ''}". Must be one of: ${allowedActions.join(', ')}.`
    };
  }

  const state = loadState();
  const isFallback = entry.actionType === 'ai_dispatch_fallback_used';
  const isRejected = entry.actionType === 'ai_dispatch_recommendation_rejected';
  const verificationSource = sanitizeAiText(
    entry.verificationSource ||
      (isFallback
        ? 'Deterministic Rules Fallback (Offline)'
        : isRejected
          ? 'AI Trust Boundary Re-Validation'
          : 'Live Gemini AI Advisory (No Autonomous Action)'),
    96
  );

  const rawReason = entry.reason || 'AI advisory evaluation logged.';
  const cleanReason = sanitizeAiText(
    redactSensitivePatterns(rawReason),
    AI_DISPATCH_CONFIG.REASON_MAX_CHARS
  );

  const auditRecord = logAdminAudit(state, {
    actionType: entry.actionType,
    bookingId: entry.bookingId ? sanitizeAiText(entry.bookingId, 32) : null,
    slotId: entry.slotId ? sanitizeAiText(entry.slotId, 32) : null,
    proId: entry.proId ? sanitizeAiText(entry.proId, 48) : null,
    adminName: sanitizeAiText(entry.adminName || 'Dallas Dispatch Lead (Demo)', 64),
    previousValue: sanitizeAiText(entry.previousValue || 'advisory_requested', 64),
    newValue: sanitizeAiText(entry.newValue || (isFallback ? 'rules_fallback_shown' : 'advisory_presented'), 64),
    reason: cleanReason,
    verificationSource,
    status: isRejected ? 'failed' : 'success'
  });

  saveState(state);
  return { success: true, auditRecord };
}

// ---------------------------------------------------------------------------
// Stage 4 Phase 4.4: Local Proxy Transport & Eligibility Orchestration
// ---------------------------------------------------------------------------

/**
 * Evaluates whether a booking is currently dispatchable for AI/fallback advice.
 * Delegates strictly to Stage 4.2 evaluateBookingDispatchStatus() rules.
 */
export function getBookingAiDispatchEligibility(bookingId, options = {}) {
  const state = loadState();
  const booking = (state.bookings || []).find(b => b.id === bookingId);
  return evaluateBookingDispatchStatus(booking, options);
}

/**
 * Determines whether the browser is running in an approved local development origin
 * where calling Crewly's local loopback proxy (127.0.0.1:8787) is permitted.
 * Hosted deployments (e.g. GitHub Pages) and file:// origins remain safely offline.
 */
export function resolveAiDispatchProxyConfig(options = {}) {
  const allowedOrigins = Array.isArray(AI_DISPATCH_CONFIG.LOCAL_PROXY_ALLOWED_ORIGINS)
    ? AI_DISPATCH_CONFIG.LOCAL_PROXY_ALLOWED_ORIGINS
    : ['http://localhost:8000', 'http://127.0.0.1:8000'];

  if (options && options.forceOffline === true) {
    return {
      enabled: false,
      endpoint: null,
      origin: null,
      mode: 'offline_fallback_only',
      reason: 'Offline fallback mode selected; local Gemini proxy skipped.'
    };
  }

  let currentOrigin = '';
  if (options && typeof options.locationOrigin === 'string') {
    currentOrigin = options.locationOrigin.trim();
  } else if (typeof window !== 'undefined' && window.location && typeof window.location.origin === 'string') {
    currentOrigin = window.location.origin.trim();
  }

  const endpointCandidate = (options && typeof options.proxyEndpoint === 'string' && options.proxyEndpoint.trim())
    ? options.proxyEndpoint.trim()
    : AI_DISPATCH_CONFIG.LOCAL_PROXY_ENDPOINT;

  const isLocalEndpoint = typeof endpointCandidate === 'string' && (
    endpointCandidate.startsWith('http://127.0.0.1:') ||
    endpointCandidate.startsWith('http://localhost:')
  );

  if (!currentOrigin || !allowedOrigins.includes(currentOrigin) || !isLocalEndpoint) {
    return {
      enabled: false,
      endpoint: null,
      origin: currentOrigin || null,
      mode: 'offline_fallback_only',
      reason: 'Running outside approved local dev server (http://localhost:8000); using offline Crewly rules fallback.'
    };
  }

  return {
    enabled: true,
    endpoint: endpointCandidate,
    origin: currentOrigin,
    mode: 'local_proxy_ready',
    reason: 'Local loopback proxy endpoint enabled for development.'
  };
}

function buildFallbackDispatchEnvelope(bookingId, reasonCode, noticeText, prepared, options = {}) {
  const rec = computeDeterministicFallbackRanking(bookingId, reasonCode, options);
  if (!options.skipAuditLog) {
    logAiDispatchAuditEvent({
      actionType: 'ai_dispatch_fallback_used',
      bookingId,
      reason: sanitizeAiText(
        redactSensitivePatterns(`${noticeText} (${reasonCode})`),
        AI_DISPATCH_CONFIG.REASON_MAX_CHARS
      )
    });
  }
  return {
    ok: !!(rec && rec.ok),
    dispatchable: !!(rec && rec.dispatchable),
    bookingId: bookingId || null,
    staleDetected: false,
    startFingerprint: prepared ? prepared.fingerprint : null,
    recommendation: rec,
    fallbackNotice: sanitizeAiText(redactSensitivePatterns(noticeText), 180)
  };
}

/**
 * Coordinates Stage 4.2 sanitization, local loopback proxy invocation (when running on
 * approved local dev origins), freshness revalidation, and deterministic fallback.
 * Never embeds API credentials and never executes autonomous assignments.
 */
export async function requestAiDispatchAdvice(bookingId, options = {}) {
  const prepared = buildSanitizedAiDispatchPayload(bookingId, options);
  if (!prepared.dispatchable) {
    return {
      ok: false,
      dispatchable: false,
      bookingId: bookingId || null,
      staleDetected: false,
      startFingerprint: prepared.fingerprint,
      error: prepared.error,
      recommendation: null,
      fallbackNotice: prepared.error
    };
  }

  if (prepared.zeroEligibleOverall) {
    return buildFallbackDispatchEnvelope(
      bookingId,
      'zero_eligible_workers_in_state',
      'Zero eligible Pros passed Crewly rules; skipped Gemini proxy.',
      prepared,
      options
    );
  }

  const proxyCfg = resolveAiDispatchProxyConfig(options);
  if (!proxyCfg.enabled) {
    return buildFallbackDispatchEnvelope(
      bookingId,
      'local_proxy_disabled_origin',
      proxyCfg.reason,
      prepared,
      options
    );
  }

  const fetchFn = (options && typeof options.fetchFn === 'function')
    ? options.fetchFn
    : (typeof fetch === 'function' ? fetch : null);

  if (!fetchFn) {
    return buildFallbackDispatchEnvelope(
      bookingId,
      'fetch_unavailable',
      'Fetch API unavailable in this environment; showing offline rules-based ranking.',
      prepared,
      options
    );
  }

  const timeoutMs = (options && typeof options.timeoutMs === 'number' && options.timeoutMs > 0)
    ? options.timeoutMs
    : (AI_DISPATCH_CONFIG.REQUEST_TIMEOUT_MS || 10000);

  let abortCtrl = null;
  let timeoutId = null;
  let proxyJson = null;

  try {
    if (typeof AbortController !== 'undefined') {
      abortCtrl = new AbortController();
      if (typeof setTimeout === 'function') {
        timeoutId = setTimeout(() => {
          try { abortCtrl.abort(); } catch (e) {}
        }, timeoutMs);
      }
    }

    const fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prepared.payload)
    };
    if (abortCtrl) fetchOptions.signal = abortCtrl.signal;

    const response = await fetchFn(proxyCfg.endpoint, fetchOptions);
    let parsedBody = null;
    try {
      parsedBody = await response.json();
    } catch (jsonErr) {
      parsedBody = null;
    }

    if (!response.ok || !parsedBody || parsedBody.ok !== true) {
      const code = sanitizeAiText((parsedBody && parsedBody.code) || `proxy_http_${response.status}`, 48);
      const friendlyNotice = code === 'proxy_not_configured'
        ? 'Local AI proxy disabled (no API key configured); showing Crewly rules-based fallback.'
        : (code === 'rate_limit_exceeded' || code === 'duplicate_request_throttled' || code === 'upstream_rate_limited')
          ? 'Rate limit active on local AI proxy; showing Crewly rules-based fallback.'
          : (code === 'upstream_timeout')
            ? 'Upstream AI request timed out; showing Crewly rules-based fallback.'
            : `Local AI proxy unavailable (${code}); showing Crewly rules-based fallback.`;
      return buildFallbackDispatchEnvelope(bookingId, code, friendlyNotice, prepared, options);
    }

    proxyJson = parsedBody;
  } catch (err) {
    const isTimeout = err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('timeout'));
    return buildFallbackDispatchEnvelope(
      bookingId,
      isTimeout ? 'proxy_timeout' : 'proxy_unreachable',
      isTimeout
        ? 'Local AI proxy request timed out; showing offline Crewly rules-based fallback.'
        : 'Local AI proxy not reachable at 127.0.0.1:8787; showing offline Crewly rules-based fallback.',
      prepared,
      options
    );
  } finally {
    if (timeoutId !== null && typeof clearTimeout === 'function') {
      clearTimeout(timeoutId);
    }
  }

  // Revalidate booking & candidate state before normalizing to catch cross-tab shifts mid-request.
  const freshAfterFetch = computeBookingDispatchFingerprint(bookingId, options);
  if (!freshAfterFetch.valid || !freshAfterFetch.dispatchable || freshAfterFetch.fingerprint !== prepared.fingerprint) {
    if (!options.skipAuditLog) {
      logAiDispatchAuditEvent({
        actionType: 'ai_dispatch_recommendation_rejected',
        bookingId,
        previousValue: prepared.fingerprint,
        newValue: freshAfterFetch.fingerprint || 'not_dispatchable',
        reason: 'Discarded in-flight AI dispatch advice because booking or worker availability changed.'
      });
    }
    return {
      ok: false,
      dispatchable: !!freshAfterFetch.dispatchable,
      bookingId: prepared.bookingId,
      staleDetected: true,
      startFingerprint: prepared.fingerprint,
      currentFingerprint: freshAfterFetch.fingerprint,
      recommendation: null,
      error: freshAfterFetch.dispatchable
        ? 'Booking or worker availability changed while advice was loading; stale advice discarded.'
        : (freshAfterFetch.reason || 'Booking is no longer eligible for dispatch; stale advice discarded.')
    };
  }

  if (proxyJson.shortCircuitedZeroEligible) {
    return buildFallbackDispatchEnvelope(
      bookingId,
      'zero_eligible_workers_in_state',
      'Zero eligible candidates reported; using Crewly deterministic rules.',
      prepared,
      options
    );
  }

  // Only real fetch responses explicitly marked by the local proxy as genuine live inference
  // (isSimulatedTestMode === false && inferenceSource in ['live_openai_ai', 'live_gemini_ai'] && liveAiAttempted === true)
  // may display Live AI provenance; test mocks and injected fetchFn always map to Mock Test Mode.
  const usesInjectedMockFetch = Boolean(options && typeof options.fetchFn === 'function');
  const isVerifiedLiveOpenAI = proxyJson.inferenceSource === 'live_openai_ai' && proxyJson.provider === 'openai';
  const isVerifiedLiveGemini = proxyJson.inferenceSource === 'live_gemini_ai';
  const backendVerifiedLive = (
    !usesInjectedMockFetch &&
    (isVerifiedLiveOpenAI || isVerifiedLiveGemini) &&
    proxyJson.isSimulatedTestMode === false &&
    proxyJson.liveAiAttempted === true
  );
  const resolvedProvider = (proxyJson.provider === 'openai' || proxyJson.provider === 'gemini')
    ? proxyJson.provider
    : (isVerifiedLiveOpenAI ? 'openai' : 'gemini');
  const resolvedInferenceSource = backendVerifiedLive
    ? (isVerifiedLiveOpenAI ? 'live_openai_ai' : 'live_gemini_ai')
    : 'mock_ai_test_mode';

  const normalized = validateAndNormalizeAiRecommendation(proxyJson.recommendation, bookingId, {
    ...options,
    expectedFingerprint: prepared.fingerprint,
    provider: resolvedProvider,
    model: proxyJson.model,
    inferenceSource: resolvedInferenceSource,
    isSimulatedTestMode: !backendVerifiedLive
  });

  if (normalized.validationReport && normalized.validationReport.staleDetected) {
    if (!options.skipAuditLog) {
      logAiDispatchAuditEvent({
        actionType: 'ai_dispatch_recommendation_rejected',
        bookingId,
        previousValue: prepared.fingerprint,
        newValue: normalized.fingerprint || 'stale',
        reason: 'AI response rejected due to state fingerprint change.'
      });
    }
    return {
      ok: false,
      dispatchable: true,
      bookingId: prepared.bookingId,
      staleDetected: true,
      startFingerprint: prepared.fingerprint,
      recommendation: null,
      error: 'Booking or worker state changed before AI advice could be displayed.'
    };
  }

  if (normalized.provenance && (normalized.provenance.isLiveAi || normalized.provenance.isMockTestMode)) {
    const rejectedCount = normalized.validationReport ? normalized.validationReport.rejectedCandidateCount : 0;
    const isMockMode = Boolean(normalized.provenance.isMockTestMode && !normalized.provenance.isLiveAi);
    const isOpenAiLive = !isMockMode && (
      normalized.provenance.source === 'live_openai_ai' || normalized.provenance.provider === 'openai'
    );
    const liveAuditLabel = isOpenAiLive
      ? `Live OpenAI AI — ${normalized.provenance.model}`
      : `Live Gemini AI (${normalized.provenance.model})`;
    const sourceNoun = isMockMode ? 'simulated Mock AI test-mode' : (isOpenAiLive ? 'live OpenAI' : 'live Gemini');
    if (!options.skipAuditLog) {
      logAiDispatchAuditEvent({
        actionType: 'ai_dispatch_recommended',
        bookingId,
        verificationSource: isMockMode
          ? `Mock AI Response — Test Mode (${normalized.provenance.model})`
          : liveAuditLabel,
        reason: rejectedCount > 0
          ? `Presented ${sourceNoun} advisory ranking; stripped ${rejectedCount} ineligible/unknown suggestion(s).`
          : `Presented ${sourceNoun} advisory ranking (all candidates verified by Crewly rules).`
      });
    }
    return {
      ok: true,
      dispatchable: true,
      bookingId: prepared.bookingId,
      staleDetected: false,
      startFingerprint: prepared.fingerprint,
      recommendation: normalized,
      fallbackNotice: rejectedCount > 0
        ? `Crewly rules removed ${rejectedCount} unverified/ineligible ${isMockMode ? 'simulated AI' : 'AI'} suggestion(s) automatically.`
        : null
    };
  }

  const fallbackCode = (normalized.provenance && normalized.provenance.fallbackReason) || 'ai_validation_fallback';
  if (!options.skipAuditLog) {
    logAiDispatchAuditEvent({
      actionType: 'ai_dispatch_fallback_used',
      bookingId,
      reason: `AI output rejected by Crewly Trust Boundary (${fallbackCode}); rules-based fallback displayed.`
    });
  }
  return {
    ok: true,
    dispatchable: true,
    bookingId: prepared.bookingId,
    staleDetected: false,
    startFingerprint: prepared.fingerprint,
    recommendation: normalized,
    fallbackNotice: 'AI response did not pass Crewly eligibility verification; showing deterministic rules-based fallback.'
  };
}
