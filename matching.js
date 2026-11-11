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
