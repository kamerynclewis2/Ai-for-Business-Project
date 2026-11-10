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
  INITIAL_BOOKINGS
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
  const urlParams = new URLSearchParams(window.location.search);
  const roleFromUrl = urlParams.get('role');
  if (roleFromUrl === 'customer' || roleFromUrl === 'pro' || roleFromUrl === 'admin') {
    sessionStorage.setItem('crewly_active_role', roleFromUrl);
    return roleFromUrl;
  }
  const roleFromSession = sessionStorage.getItem('crewly_active_role');
  if (roleFromSession) {
    return roleFromSession;
  }
  return 'customer';
}

export function setActiveRole(role) {
  sessionStorage.setItem('crewly_active_role', role);
  const url = new URL(window.location.href);
  url.searchParams.set('role', role);
  window.history.replaceState({}, '', url.toString());
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
      return resetStateToSeed();
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.bookings || !parsed.pros) {
      return resetStateToSeed();
    }
    return migrateStateIfNeeded(parsed);
  } catch (err) {
    console.warn('Error loading Crewly state from localStorage; resetting to seed.', err);
    return resetStateToSeed();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // Dispatch a local custom event so this same window's UI updates
  window.dispatchEvent(new CustomEvent('crewly-state-updated', { detail: state }));
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
    lastResetTimestamp: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
  window.dispatchEvent(new CustomEvent('crewly-state-updated', { detail: initialState }));
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
    slot.payoutReleased = true;
    if (pro && pro.earnings) {
      // Keep dollar balance fields as floating-point; use round-trip cents for precision
      pro.earnings.pendingBalance  = Math.max(0, Math.round((pro.earnings.pendingBalance  - slot.payout) * 100) / 100);
      pro.earnings.availableBalance = Math.round((pro.earnings.availableBalance + slot.payout) * 100) / 100;
      pro.earnings.lifetimeEarned   = Math.round((pro.earnings.lifetimeEarned   + slot.payout) * 100) / 100;

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
  const allCompleted = booking.workerAssignments.every(s => s.status === 'completed');
  const anyInProgress = booking.workerAssignments.some(s => s.status === 'in_progress');
  const anyArrived = booking.workerAssignments.some(s => s.status === 'arrived');
  const anyTraveling = booking.workerAssignments.some(s => s.status === 'traveling');

  if (unassignedCount > 0) {
    booking.overallStatus = (booking.workerAssignments.length - unassignedCount) > 0 ? 'partially_filled' : 'waiting_for_pros';
  } else if (allCompleted) {
    booking.overallStatus = 'completed';
  } else if (anyInProgress) {
    booking.overallStatus = 'in_progress';
  } else if (anyArrived) {
    booking.overallStatus = 'arrived';
  } else if (anyTraveling) {
    booking.overallStatus = 'traveling';
  }

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

export function flagReviewDispute(bookingId, proId, reason) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking) return { success: false, error: 'Booking not found.' };

  // Flag the specific Pro's review in workerReviews (new schema)
  const proReview = (booking.workerReviews || []).find(r => r.proId === proId);
  if (proReview) {
    proReview.disputed = true;
    proReview.disputeReason = reason || 'Pro requested platform investigation of review conditions.';
    saveState(state);
    return { success: true, booking };
  }

  // Backward compat: flag old-format single review if workerReviews is empty
  if (booking.review) {
    booking.review.disputed = true;
    booking.review.disputeReason = reason || 'Pro requested platform investigation of review conditions.';
    saveState(state);
    return { success: true, booking };
  }

  return { success: false, error: 'No review found for this worker on this booking.' };
}
