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
  INITIAL_PROS,
  INITIAL_CUSTOMERS,
  INITIAL_BOOKINGS
} from './data.js';

const STORAGE_KEY = 'crewly_marketplace_state_v1';

// ---------------------------------------------------------------------------
// 0. Dallas Pilot Local Time & Helpers
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

  if (timingType === 'asap') {
    finalDate = dallasNow.dateStr;
    finalTime = dallasNow.timeStr;
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
export function canProAcceptSlot(proId, bookingId, slotId) {
  const state = loadState();
  const pro = state.pros.find(p => p.id === proId);
  const booking = state.bookings.find(b => b.id === bookingId);

  if (!pro) return { allowed: false, reason: 'Worker profile not found.' };
  if (!booking) return { allowed: false, reason: 'Booking not found.' };

  const slot = booking.workerAssignments.find(s => s.slotId === slotId);
  if (!slot) return { allowed: false, reason: 'Assignment slot not found.' };

  // Rule 0: PAST SCHEDULE CHECK (Cannot accept appointments that have already passed)
  const dallasNow = getDallasLocalNow();
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

  // Rule 5: SCHEDULE CONFLICT DETECTION
  const conflictingBooking = state.bookings.find(other => {
    if (other.id === booking.id) return false;
    if (other.overallStatus === 'completed' || other.overallStatus === 'cancelled') return false;

    // Is pro assigned to any slot in this other booking?
    const proIsAssigned = other.workerAssignments.some(s =>
      s.assignedProId === pro.id && s.status !== 'completed'
    );
    if (!proIsAssigned) return false;

    // Compare date & time proximity
    if (other.scheduledDate === booking.scheduledDate) {
      const thisTimeHour = parseInt((booking.scheduledTime || '10:00').split(':')[0], 10);
      const otherTimeHour = parseInt((other.scheduledTime || '10:00').split(':')[0], 10);
      // If within 2 hours of each other on same day, flag as schedule conflict
      if (!isNaN(thisTimeHour) && !isNaN(otherTimeHour) && Math.abs(thisTimeHour - otherTimeHour) < 2) {
        return true;
      }
    }
    return false;
  });

  if (conflictingBooking) {
    return {
      allowed: false,
      reason: `Schedule Conflict: You are already assigned to booking ${conflictingBooking.id} on ${conflictingBooking.scheduledDate} around ${conflictingBooking.scheduledTime}.`
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
  pro.earnings.pendingBalance += slot.payout;

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
      pro.earnings.pendingBalance = Math.max(0, pro.earnings.pendingBalance - slot.payout);
      pro.earnings.availableBalance += slot.payout;
      pro.earnings.lifetimeEarned += slot.payout;
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
// 9. Simulated Instant Cash-Out & Reviews
// ---------------------------------------------------------------------------
export function simulateProCashOut(proId, method = 'instant') {
  const state = loadState();
  const pro = state.pros.find(p => p.id === proId);
  if (!pro || !pro.earnings) return { success: false, error: 'Worker not found.' };

  const currentAvailable = pro.earnings.availableBalance;
  if (currentAvailable <= 0) {
    return { success: false, error: 'No available funds to cash out.' };
  }

  const fee = method === 'instant' ? 1.50 : 0.00;
  const netAmount = Math.max(0, currentAvailable - fee);

  pro.earnings.availableBalance = 0;
  saveState(state);

  return {
    success: true,
    withdrawn: currentAvailable,
    fee,
    netAmount,
    method: method === 'instant' ? 'Instant Transfer (Dallas Chase Debit Card ****4012)' : 'Standard ACH (2 Business Days)',
    notice: 'Simulated payout ledger only — No actual banking transfer occurs.'
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
