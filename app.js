/**
 * Crewly Application Controller & UI Renderer
 * Course: INSY 3331: Artificial Intelligence for Business
 * Pilot Market: Dallas, Texas
 */

import {
  PRICING_RATES,
  DALLAS_NEIGHBORHOODS,
  DALLAS_SERVICE_ZIPS,
  lookupDallasZip,
  WALLET_CONFIG,
  INITIAL_PROS,
  INITIAL_CUSTOMERS
} from './data.js';

import {
  getActiveRole,
  setActiveRole,
  loadState,
  saveState,
  resetStateToSeed,
  calculatePricing,
  createBooking,
  canProAcceptSlot,
  assignProToSlot,
  updateProAssignmentStatus,
  simulateProCashOut,
  submitWorkerReview,
  flagReviewDispute,
  getDallasLocalNow,
  isAsapExpired,
  getAsapRemainingMinutes,
  extendAsapBooking,
  rescheduleBooking,
  getProWalletSummary,
  dollarsToCents,
  centsToDollars,
  getOperationalAlerts,
  getAdminFinancialSummary,
  getAdminOperationalMetrics,
  getProCandidatesForSlot,
  adminAssignPro,
  adminUnassignPro,
  logAdminAudit,
  escapeHtml,
  getProDirectorySummary,
  getBookingProEligibility,
  createSupportCase,
  updateSupportCaseStatus,
  addSupportCaseNote,
  updateTrustCaseResolution,
  canBookingBeCancelled,
  adminCancelBooking,
  canSlotBeAdminCompleted,
  adminVerifyAndCompleteAssignment,
  recalculateBookingStatus
} from './matching.js';

// Global UI State
let currentSelectedService = 'moving';
let pendingReviewBookingId = null;
let pendingReviewSlotId = null;
let pendingReviewWorkerName = null;
let pendingReviewRoleTitle = null;
let currentRatingSelection = 5;
let currentJobBoardFilter = 'available';
let pendingRescheduleBookingId = null;
let currentWalletFilter = 'all'; // 'all' | 'earnings' | 'cashouts'
let isCashoutSubmitting = false;

// Stage 3.5 Dispatch Modal State
let pendingAdminCancelBookingId = null;
let pendingAdminVerifyBookingId = null;
let pendingAdminVerifySlotId = null;
let pendingAdminVerifyProId = null;
let pendingAdminVerifyProName = null;

// Stage 3 Phase 2 Admin Dispatch Modal State
let pendingAdminAssignBookingId = null;
let pendingAdminAssignSlotId = null;
let selectedAdminCandidateProId = null;
let pendingAdminUnassignBookingId = null;
let pendingAdminUnassignSlotId = null;
let pendingAdminUnassignProId = null;
let pendingAdminUnassignProName = null;

// ---------------------------------------------------------------------------
// Timing Formatting Utility (Separates human labels from valid ISO/time values)
// ---------------------------------------------------------------------------
export function formatBookingTiming(booking) {
  if (!booking) return '';
  if (booking.timingType === 'asap') {
    const expired = isAsapExpired(booking);
    const hasUnassigned = (booking.workerAssignments || []).some(s => s.status === 'unassigned');
    const isCompleted = booking.overallStatus === 'completed';
    const isCancelled = booking.overallStatus === 'cancelled';

    if (isCompleted || isCancelled) {
      return `ASAP Dispatch • ${booking.scheduledDate} (${booking.scheduledTime})`;
    }
    if (hasUnassigned && expired) {
      return `ASAP — Window Expired (Requested: ${booking.scheduledTime})`;
    }
    if (hasUnassigned) {
      const remaining = getAsapRemainingMinutes(booking);
      return `ASAP — Seeking Pros (${remaining}m window remaining)`;
    }
    return `ASAP Dispatch • Requested at ${booking.scheduledTime}`;
  }
  return `Scheduled: ${booking.scheduledDate} at ${booking.scheduledTime}`;
}

// ---------------------------------------------------------------------------
// Toast Notification Utility
// ---------------------------------------------------------------------------
function showToast(message, icon = '✓') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span style="font-size: 1.1rem;">${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ---------------------------------------------------------------------------
// Role & Tab Management (Independent Multi-Tab Operation)
// ---------------------------------------------------------------------------
function initRoleSwitcher() {
  const customerBtn = document.getElementById('role-btn-customer');
  const proBtn = document.getElementById('role-btn-pro');
  const adminBtn = document.getElementById('role-btn-admin');
  const openTabBtn = document.getElementById('btn-open-dual-tab');

  const updateRoleUI = (role) => {
    const customerSection = document.getElementById('customer-view-section');
    const proSection = document.getElementById('pro-view-section');
    const adminSection = document.getElementById('admin-view-section');

    customerBtn.classList.remove('active');
    proBtn.classList.remove('active', 'pro-mode');
    if (adminBtn) adminBtn.classList.remove('active', 'admin-mode');

    if (role === 'admin') {
      if (adminBtn) adminBtn.classList.add('active', 'admin-mode');
      if (customerSection) customerSection.style.display = 'none';
      if (proSection) proSection.style.display = 'none';
      if (adminSection) adminSection.style.display = 'block';
    } else if (role === 'pro') {
      proBtn.classList.add('active', 'pro-mode');
      if (customerSection) customerSection.style.display = 'none';
      if (proSection) proSection.style.display = 'block';
      if (adminSection) adminSection.style.display = 'none';
    } else {
      customerBtn.classList.add('active');
      if (customerSection) customerSection.style.display = 'block';
      if (proSection) proSection.style.display = 'none';
      if (adminSection) adminSection.style.display = 'none';
    }
  };

  customerBtn.addEventListener('click', () => {
    setActiveRole('customer');
    updateRoleUI('customer');
    renderAll();
  });

  proBtn.addEventListener('click', () => {
    setActiveRole('pro');
    updateRoleUI('pro');
    renderAll();
  });

  if (adminBtn) {
    adminBtn.addEventListener('click', () => {
      setActiveRole('admin');
      updateRoleUI('admin');
      renderAll();
    });
  }

  openTabBtn.addEventListener('click', () => {
    const currentRole = getActiveRole();
    let targetRole = 'customer';
    if (currentRole === 'customer') targetRole = 'pro';
    else if (currentRole === 'pro') targetRole = 'admin';
    else if (currentRole === 'admin') targetRole = 'customer';

    const targetUrl = `${window.location.origin}${window.location.pathname}?role=${targetRole}`;
    window.open(targetUrl, '_blank');
    const roleLabel = targetRole === 'admin' ? 'Crewly Admin' : (targetRole === 'pro' ? 'Crewly Pro' : 'Customer');
    showToast(`Opened ${roleLabel} view in a new browser tab for multi-screen demonstration.`);
  });

  // Apply initial role
  const activeRole = getActiveRole();
  updateRoleUI(activeRole);
}

// ---------------------------------------------------------------------------
// Render Customer Service Cards
// ---------------------------------------------------------------------------
function renderServiceCards() {
  const container = document.getElementById('service-cards-container');
  if (!container) return;

  const services = [
    { key: 'moving', icon: '🚚', badge: 'Popular • Multi-Worker Teams' },
    { key: 'tv_mounting', icon: '📺', badge: 'Guaranteed Flat Rate' },
    { key: 'wall_mounting', icon: '🖼️', badge: 'Precision Anchoring' },
    { key: 'furniture_assembly', icon: '📦', badge: 'IKEA & Wayfair Ready' },
    { key: 'furniture_disassembly', icon: '🔧', badge: 'Moving Preparation' },
    { key: 'lawn_mowing', icon: '🌱', badge: 'Verified Mower Required' }
  ];

  container.innerHTML = services.map(s => {
    const config = PRICING_RATES[s.key];
    const rateText = config.type === 'hourly'
      ? `$${config.customerRate} <span class="rate-unit">/ worker-hr</span>`
      : `$${config.customerRate} <span class="rate-unit">flat rate</span>`;

    return `
      <div class="service-card" data-service="${s.key}">
        <div>
          <div class="service-card-header">
            <div class="service-icon-box">${s.icon}</div>
            <div>
              <h3 class="service-name">${config.name}</h3>
              <span class="service-badge-pill featured">${s.badge}</span>
            </div>
          </div>
          <p class="service-description">${config.description}</p>
        </div>

        <div>
          <div class="service-pricing-row">
            <span class="rate-label">Customer Upfront Rate</span>
            <div class="rate-amount">${rateText}</div>
          </div>
          <button class="btn-book-service btn-open-booking" data-service="${s.key}">
            <span>Book Service</span> ➔
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach booking click handlers
  container.querySelectorAll('.btn-open-booking').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const serviceKey = e.currentTarget.getAttribute('data-service');
      openIntakeModal(serviceKey);
    });
  });
}

// ---------------------------------------------------------------------------
// Dynamic Guided Intake Modal
// ---------------------------------------------------------------------------
function openIntakeModal(serviceKey) {
  currentSelectedService = serviceKey;
  const config = PRICING_RATES[serviceKey];
  const modal = document.getElementById('intake-modal');
  const title = document.getElementById('intake-modal-title');
  const questionsContainer = document.getElementById('dynamic-intake-questions');

  title.textContent = `Book ${config.name}`;

  // Populate dynamic questions based on service
  if (serviceKey === 'moving') {
    questionsContainer.innerHTML = `
      <div style="background: #EFF6FF; border-left: 4px solid var(--accent-blue); padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem; color: #1E40AF;">
        <strong>Multi-Worker Moving Request:</strong> You can select 2 or more movers. Crewly will create independent worker assignments and confirm your booking once all positions are filled.
      </div>
      <div class="form-group">
        <label class="form-label">Number of Movers Needed:</label>
        <select id="intake-moving-workers" class="form-select">
          <option value="1">1 Worker (Light lifting assistance)</option>
          <option value="2" selected>2 Workers (Recommended for apartments / bulky furniture)</option>
          <option value="3">3 Workers (Multi-bedroom home / heavy pieces)</option>
          <option value="4">4 Workers (Full residential move)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Estimated Duration (Hours):</label>
        <select id="intake-moving-hours" class="form-select">
          <option value="2">2 Hours ($40/worker-hr)</option>
          <option value="3" selected>3 Hours (Standard 1-2 bedroom move)</option>
          <option value="4">4 Hours</option>
          <option value="5">5 Hours</option>
          <option value="6">6 Hours</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Moving Scope & Equipment:</label>
        <select id="intake-moving-truck" class="form-select">
          <option value="labor_only" selected>Labor Only (Customer has rental truck / POD / internal move)</option>
          <option value="truck_required">Pickup Truck assistance needed (Pros bring dollies & straps)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Access & Stairs:</label>
        <select id="intake-moving-stairs" class="form-select">
          <option value="elevator">Elevator access available (Dallas high-rise)</option>
          <option value="ground_floor">Ground floor (no stairs)</option>
          <option value="stairs_1_flight">1 Flight of stairs</option>
          <option value="stairs_multi">2+ Flights of stairs</option>
        </select>
      </div>
    `;
  } else if (serviceKey === 'tv_mounting') {
    questionsContainer.innerHTML = `
      <div class="form-group">
        <label class="form-label">TV Screen Size:</label>
        <select id="intake-tv-size" class="form-select">
          <option value="up_to_55">Up to 55 inches</option>
          <option value="55_to_75" selected>55 to 75 inches (Standard living room)</option>
          <option value="over_75">Over 75 inches</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Wall Surface Type:</label>
        <select id="intake-tv-wall" class="form-select">
          <option value="drywall" selected>Drywall (Standard wood or metal studs)</option>
          <option value="brick_fireplace">Brick or Stone Fireplace</option>
          <option value="concrete">Concrete or Masonry</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Mounting Bracket:</label>
        <select id="intake-tv-bracket" class="form-select">
          <option value="customer_owns" selected>I already have my own mounting bracket</option>
          <option value="pro_provides">I need the Pro to supply a full-motion bracket (+$35)</option>
        </select>
      </div>
    `;
  } else if (serviceKey === 'lawn_mowing') {
    questionsContainer.innerHTML = `
      <div style="background: #ECFDF5; border-left: 4px solid var(--brand-emerald); padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem; color: #065F46;">
        <strong>Verified Equipment Notice:</strong> Only Crewly Pros with platform-verified commercial lawn mowers and string trimmers can accept this job.
      </div>
      <div class="form-group">
        <label class="form-label">Approximate Yard Lot Size:</label>
        <select id="intake-lawn-size" class="form-select">
          <option value="small">Small yard (Townhome / Patio home under 0.15 acre)</option>
          <option value="medium" selected>Standard residential lot (Up to 0.25 acre)</option>
          <option value="large">Large lot (0.25 to 0.50 acre)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Backyard Gate Access:</label>
        <select id="intake-lawn-gate" class="form-select">
          <option value="standard" selected>Standard pedestrian gate (36 inches or wider)</option>
          <option value="narrow">Narrow gate (under 32 inches)</option>
          <option value="open">Open / No fence gate</option>
        </select>
      </div>
    `;
  } else if (serviceKey === 'furniture_assembly' || serviceKey === 'furniture_disassembly') {
    questionsContainer.innerHTML = `
      <div class="form-group">
        <label class="form-label">Furniture Type & Complexity:</label>
        <select id="intake-furniture-type" class="form-select">
          <option value="bed_frame" selected>Bed Frame / Platform Bed (with headboard)</option>
          <option value="dresser">Dresser (6+ drawers)</option>
          <option value="desk">Office Desk or Standing Desk</option>
          <option value="dining_set">Dining Table & Chairs</option>
          <option value="outdoor_patio">Outdoor Patio Furniture</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Number of Items:</label>
        <select id="intake-furniture-count" class="form-select">
          <option value="1" selected>1 Item ($${config.customerRate})</option>
          <option value="2">2 Items ($${config.customerRate * 2})</option>
          <option value="3">3 Items ($${config.customerRate * 3})</option>
        </select>
      </div>
    `;
  } else {
    // Wall Mounting
    questionsContainer.innerHTML = `
      <div class="form-group">
        <label class="form-label">Items to Mount:</label>
        <select id="intake-mount-type" class="form-select">
          <option value="shelves" selected>Floating Shelves (Set of 2-3)</option>
          <option value="mirrors">Heavy Decorative Mirror</option>
          <option value="artwork">Framed Art Gallery Wall</option>
          <option value="curtains">Curtain Rods & Drapes</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Number of Mounting Tasks:</label>
        <select id="intake-mount-count" class="form-select">
          <option value="1" selected>1 Mounting Task ($${config.customerRate})</option>
          <option value="2">2 Mounting Tasks ($${config.customerRate * 2})</option>
        </select>
      </div>
    `;
  }

  // Default address & ZIP from active customer (Priority 1 & 4)
  const state = loadState();
  const activeCustomer = state.customers.find(c => c.id === state.activeCustomerId) || state.customers[0];
  const addressInput = document.getElementById('input-address');
  const zipInput = document.getElementById('input-zip');
  
  if (addressInput) addressInput.value = activeCustomer.address || '';
  
  // Extract or default ZIP code
  const zipMatch = (activeCustomer.address || '').match(/\b(75\d{3})\b/);
  const defaultZip = zipMatch ? zipMatch[1] : '75204';
  if (zipInput) {
    zipInput.value = defaultZip;
    updateZipIndicator(defaultZip);
  }

  // Set minimum scheduled date to today in Dallas time (Priority 2)
  const dallasNow = getDallasLocalNow();
  const dateInput = document.getElementById('input-scheduled-date');
  if (dateInput) {
    dateInput.min = dallasNow.dateStr;
    // Default scheduled date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateInput.value = tomorrow.toISOString().split('T')[0];
  }

  // Attach live calculation listeners
  setupIntakeCalculationListeners();
  recalculateIntakePrice();

  modal.classList.add('open');
}

function updateZipIndicator(zip) {
  const indicator = document.getElementById('zip-area-indicator');
  if (!indicator) return;
  const res = lookupDallasZip(zip);
  if (res.valid) {
    indicator.innerHTML = `<span style="color: var(--brand-emerald);">✓ ${res.areaName}</span>`;
  } else if (zip && zip.length >= 5) {
    indicator.innerHTML = `<span style="color: var(--accent-red);">⚠️ Unsupported ZIP</span>`;
  } else {
    indicator.innerHTML = `<span style="color: var(--text-muted); font-size: 0.75rem;">Enter 5-digit Dallas ZIP</span>`;
  }
}

function setupIntakeCalculationListeners() {
  const form = document.getElementById('intake-form');
  form.querySelectorAll('select, input').forEach(input => {
    input.addEventListener('change', recalculateIntakePrice);
    input.addEventListener('input', recalculateIntakePrice);
  });

  // Live ZIP validation listener
  const zipInput = document.getElementById('input-zip');
  if (zipInput) {
    zipInput.addEventListener('input', (e) => {
      updateZipIndicator(e.target.value);
    });
  }

  // Timing radio toggle
  form.querySelectorAll('input[name="timingType"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const scheduledFields = document.getElementById('scheduled-datetime-fields');
      if (e.target.value === 'scheduled') {
        scheduledFields.style.display = 'grid';
      } else {
        scheduledFields.style.display = 'none';
      }
    });
  });
}

function recalculateIntakePrice() {
  const workersInput = document.getElementById('intake-moving-workers');
  const hoursInput = document.getElementById('intake-moving-hours');
  const countInput = document.getElementById('intake-furniture-count') || document.getElementById('intake-mount-count');

  const workersNeeded = workersInput ? parseInt(workersInput.value, 10) : 1;
  const hours = hoursInput ? parseFloat(hoursInput.value) : 1;
  const itemCount = countInput ? parseInt(countInput.value, 10) : 1;

  const quote = calculatePricing(currentSelectedService, {
    workersNeeded,
    hours,
    itemCount
  });

  document.getElementById('quote-service-desc').textContent = currentSelectedService === 'moving'
    ? `Service Subtotal (${workersNeeded} Movers × ${hours} hrs @ $40/hr):`
    : `Service Subtotal (${itemCount} Task @ $${quote.customerSubtotal / itemCount}):`;

  document.getElementById('quote-subtotal').textContent = `$${quote.customerSubtotal.toFixed(2)}`;
  document.getElementById('quote-booking-fee').textContent = `$${quote.bookingFee.toFixed(2)}`;
  document.getElementById('quote-customer-total').textContent = `$${quote.customerTotal.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Submit Booking Handler
// ---------------------------------------------------------------------------
function handleBookingSubmit(e) {
  e.preventDefault();
  const state = loadState();
  const dallasNow = getDallasLocalNow();

  const address = (document.getElementById('input-address')?.value || '').trim();
  const zipCode = (document.getElementById('input-zip')?.value || '').trim();
  const notes = document.getElementById('input-notes')?.value || '';

  if (!address) {
    showToast('Please enter a service street address.', '⚠️');
    return;
  }

  // Validate ZIP (Priority 4)
  const zipCheck = lookupDallasZip(zipCode);
  if (!zipCheck.valid) {
    showToast(zipCheck.message, '⚠️');
    return;
  }

  const timingTypeRadio = document.querySelector('input[name="timingType"]:checked');
  const timingType = timingTypeRadio ? timingTypeRadio.value : 'asap';
  
  let scheduledDate = dallasNow.dateStr;
  let scheduledTime = dallasNow.timeStr;

  if (timingType === 'scheduled') {
    scheduledDate = document.getElementById('input-scheduled-date').value;
    scheduledTime = document.getElementById('input-scheduled-time').value;

    // Validate past dates and times (Priority 2)
    if (!scheduledDate || scheduledDate < dallasNow.dateStr) {
      showToast(`Scheduled date (${scheduledDate || 'empty'}) cannot be in the past.`, '⚠️');
      return;
    }
    if (scheduledDate === dallasNow.dateStr && scheduledTime && scheduledTime < dallasNow.timeStr) {
      showToast(`Scheduled time (${scheduledTime}) has already passed today. Please choose an upcoming time slot.`, '⚠️');
      return;
    }
  }

  // Gather category details
  const intakeDetails = { notes };
  if (currentSelectedService === 'moving') {
    intakeDetails.workersNeeded = parseInt(document.getElementById('intake-moving-workers').value, 10);
    intakeDetails.hours = parseFloat(document.getElementById('intake-moving-hours').value);
    intakeDetails.truckOption = document.getElementById('intake-moving-truck').value;
    intakeDetails.stairsOption = document.getElementById('intake-moving-stairs').value;
  } else if (currentSelectedService === 'tv_mounting') {
    intakeDetails.tvSize = document.getElementById('intake-tv-size').value;
    intakeDetails.wallType = document.getElementById('intake-tv-wall').value;
    intakeDetails.bracket = document.getElementById('intake-tv-bracket').value;
  } else if (currentSelectedService === 'lawn_mowing') {
    intakeDetails.yardSize = document.getElementById('intake-lawn-size').value;
    intakeDetails.gateAccess = document.getElementById('intake-lawn-gate').value;
    intakeDetails.requiredEquipment = ['lawn_mower', 'string_trimmer'];
  }

  try {
    const booking = createBooking({
      customerId: state.activeCustomerId,
      address,
      zipCode,
      serviceCategory: currentSelectedService,
      timingType,
      scheduledDate,
      scheduledTime,
      intakeDetails
    });

    document.getElementById('intake-modal').classList.remove('open');
    showToast(`Booking ${booking.id} created! Dispatched to Dallas Job Board for ${zipCheck.areaName}.`);
    renderAll();
  } catch (err) {
    showToast(err.message || 'Error creating booking.', '⚠️');
  }
}

// ---------------------------------------------------------------------------
// Render Customer Active Bookings & Tracking
// ---------------------------------------------------------------------------
function renderCustomerActiveBookings() {
  const container = document.getElementById('customer-active-bookings-container');
  if (!container) return;

  const state = loadState();
  const currentCustomerId = state.activeCustomerId;
  const activeBookings = state.bookings.filter(b =>
    b.customerId === currentCustomerId &&
    b.overallStatus !== 'completed' &&
    b.overallStatus !== 'cancelled'
  );

  if (activeBookings.length === 0) {
    container.innerHTML = `
      <div style="background: white; border: 1px dashed var(--border-dark); border-radius: var(--radius-lg); padding: 32px; text-align: center; color: var(--text-muted);">
        <div style="font-size: 2rem; margin-bottom: 8px;">📋</div>
        <strong>No active bookings right now.</strong>
        <p style="font-size: 0.85rem; margin-top: 4px;">Select a service above to book your Dallas home project.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = activeBookings.map(b => {
    // Stepper node active states
    const statusMap = {
      waiting_for_pros: 1,
      partially_filled: 2,
      fully_confirmed: 3,
      traveling: 4,
      arrived: 5,
      in_progress: 5,
      completed: 6
    };
    const currentStep = statusMap[b.overallStatus] || 1;

    const isAsap = b.timingType === 'asap';
    const isExpired = isAsap && isAsapExpired(b);
    const hasUnassigned = b.workerAssignments.some(s => s.status === 'unassigned');

    // Status Badge
    let statusBadgeHtml = '';
    if (isExpired && hasUnassigned) {
      statusBadgeHtml = `<span class="status-badge waiting" style="background: #FEF3C7; color: #92400E; border: 1px solid #F59E0B;">⏱️ Window Expired</span>`;
    } else if (b.overallStatus === 'partially_filled') {
      statusBadgeHtml = `<span class="status-badge partially_filled">⚠️ Partially Filled (${b.workerAssignments.filter(s => s.status !== 'unassigned').length}/${b.workerAssignments.length} Assigned)</span>`;
    } else if (b.overallStatus === 'waiting_for_pros') {
      statusBadgeHtml = `<span class="status-badge waiting">⏳ Waiting for Pros</span>`;
    } else if (b.overallStatus === 'fully_confirmed') {
      statusBadgeHtml = `<span class="status-badge confirmed">✓ Fully Confirmed</span>`;
    } else if (b.overallStatus === 'in_progress' || b.overallStatus === 'arrived' || b.overallStatus === 'traveling') {
      statusBadgeHtml = `<span class="status-badge in_progress">⚡ Active (${b.overallStatus})</span>`;
    }

    // Partial fulfillment alert banner (Mandatory for multi-worker jobs) & ASAP Expired recovery banner
    let alertBannerHtml = '';
    if (isExpired && hasUnassigned) {
      alertBannerHtml = `
        <div class="asap-expired-banner" style="background: #FFFBEB; border: 1px solid #F59E0B; border-radius: var(--radius-md); padding: 14px 16px; margin: 12px 0 16px 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 240px;">
              <strong style="color: #92400E; display: flex; align-items: center; gap: 6px;">
                <span>⏱️</span> ASAP Matching Window Expired
              </strong>
              <div style="font-size: 0.83rem; color: #78350F; margin-top: 4px;">
                Pros are currently busy in your area. You can extend our search for another 30 minutes, or reschedule for a convenient future time.
              </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn-extend-asap" data-booking-id="${b.id}" style="padding: 8px 14px; background: #D97706; color: white; border: none; border-radius: var(--radius-sm); font-weight: 700; font-size: 0.82rem; cursor: pointer;">
                + Extend Search (+30 min)
              </button>
              <button class="btn-open-reschedule" data-booking-id="${b.id}" style="padding: 8px 14px; background: white; border: 1px solid #D97706; color: #92400E; border-radius: var(--radius-sm); font-weight: 700; font-size: 0.82rem; cursor: pointer;">
                📅 Reschedule
              </button>
            </div>
          </div>
        </div>
      `;
    } else if (b.overallStatus === 'partially_filled' || b.overallStatus === 'waiting_for_pros') {
      alertBannerHtml = `
        <div class="partial-fulfillment-alert">
          <span style="font-size: 1.2rem;">⚠️</span>
          <div style="flex: 1;">
            <strong>Booking Not Fully Confirmed Yet:</strong>
            ${b.partialFulfillmentNotice}
          </div>
          <div>
            <button class="btn-open-reschedule" data-booking-id="${b.id}" style="padding: 4px 10px; background: white; border: 1px solid var(--border-dark); border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; cursor: pointer; color: var(--text-secondary);">
              📅 Reschedule
            </button>
          </div>
        </div>
      `;
    }

    // Worker assignments slots breakdown
    const workerSlotsHtml = b.workerAssignments.map((slot, idx) => {
      const isAssigned = slot.status !== 'unassigned';
      return `
        <div class="worker-slot-card">
          <div class="worker-slot-header">
            <span class="slot-role-name">${slot.roleTitle}</span>
            <span class="slot-status-pill ${slot.status}">${slot.status.toUpperCase()}</span>
          </div>
          <div class="worker-details">
            <span class="worker-avatar">${isAssigned ? '👷' : '⏳'}</span>
            <div>
              <strong>${isAssigned ? slot.assignedProName : 'Searching Dallas Pros...'}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted);">
                ${isAssigned ? `Assigned Position • Status: ${slot.status}` : 'Open Assignment Slot'}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Messages timeline
    const messagesHtml = (b.messages || []).map(m => `
      <div style="font-size: 0.8rem; margin-bottom: 6px; padding: 6px 10px; background: ${m.senderRole === 'system' ? '#F1F5F9' : '#ECFDF5'}; border-radius: var(--radius-sm);">
        <strong style="color: var(--primary-navy);">${m.senderName}:</strong> ${m.text}
        <span style="font-size: 0.7rem; color: var(--text-muted); margin-left: 6px;">${m.timestamp}</span>
      </div>
    `).join('');

    return `
      <div class="booking-tracking-card" data-booking-id="${b.id}">
        <div class="booking-header">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span class="booking-id-tag">${b.id}</span>
              <h3 style="font-size: 1.2rem; font-weight: 800; color: var(--primary-navy);">${b.serviceTitle}</h3>
            </div>
            <div style="font-size: 0.84rem; color: var(--text-secondary);">
              📍 ${b.neighborhoodName} • <strong>${formatBookingTiming(b)}</strong>
            </div>
          </div>
          <div>
            ${statusBadgeHtml}
          </div>
        </div>

        ${alertBannerHtml}

        <!-- 6-Stage Stepper -->
        <div class="tracking-stepper">
          <div class="step-node ${currentStep >= 1 ? (currentStep === 1 ? 'active' : 'completed') : ''}">
            <div class="step-circle">${currentStep > 1 ? '✓' : '1'}</div>
            <div class="step-label">Requested</div>
          </div>
          <div class="step-node ${currentStep >= 2 ? (currentStep === 2 ? 'active' : 'completed') : ''}">
            <div class="step-circle">${currentStep > 2 ? '✓' : '2'}</div>
            <div class="step-label">Matching</div>
          </div>
          <div class="step-node ${currentStep >= 3 ? (currentStep === 3 ? 'active' : 'completed') : ''}">
            <div class="step-circle">${currentStep > 3 ? '✓' : '3'}</div>
            <div class="step-label">Confirmed</div>
          </div>
          <div class="step-node ${currentStep >= 4 ? (currentStep === 4 ? 'active' : 'completed') : ''}">
            <div class="step-circle">${currentStep > 4 ? '✓' : '4'}</div>
            <div class="step-label">En Route</div>
          </div>
          <div class="step-node ${currentStep >= 5 ? (currentStep === 5 ? 'active' : 'completed') : ''}">
            <div class="step-circle">${currentStep > 5 ? '✓' : '5'}</div>
            <div class="step-label">In Progress</div>
          </div>
          <div class="step-node ${currentStep >= 6 ? 'completed' : ''}">
            <div class="step-circle">6</div>
            <div class="step-label">Completed</div>
          </div>
        </div>

        <!-- Worker Slots Grid -->
        <div style="margin-top: 20px;">
          <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px;">
            Assigned Dallas Crewly Pros (${b.workerAssignments.length} Worker Slots):
          </div>
          <div class="worker-slots-grid">
            ${workerSlotsHtml}
          </div>
        </div>

        <!-- Pricing Summary (Customer View strictly sees Total + Disclosed Fee) -->
        <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 12px 16px; margin: 16px 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div style="font-size: 0.85rem; color: var(--text-secondary);">
            Service Subtotal: <strong>$${b.pricing.customerSubtotal.toFixed(2)}</strong> + Platform Booking Fee: <strong>$${b.pricing.bookingFee.toFixed(2)}</strong>
          </div>
          <div style="font-size: 1.1rem; font-weight: 800; color: var(--primary-navy);">
            Customer Total: <span style="color: var(--brand-emerald);">$${b.pricing.customerTotal.toFixed(2)}</span>
          </div>
        </div>

        <!-- In-App Communication Log (Simulated) -->
        <div style="margin-top: 16px; border-top: 1px solid var(--border-light); padding-top: 14px;">
          <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px;">
            Job Activity & Communication Log:
          </div>
          <div style="max-height: 120px; overflow-y: auto; margin-bottom: 10px;">
            ${messagesHtml}
          </div>

          <!-- Quick Message Sender -->
          <div style="display: flex; gap: 8px;">
            <input type="text" class="form-input input-customer-chat" data-booking-id="${b.id}" placeholder="Type a message to your assigned Dallas Pro..." style="padding: 8px 12px; font-size: 0.85rem;">
            <button class="btn-open-tab btn-send-customer-msg" data-booking-id="${b.id}" style="padding: 8px 14px; background: var(--primary-navy); color: white; border-radius: var(--radius-md);">
              Send
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach customer chat send handlers
  container.querySelectorAll('.btn-send-customer-msg').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      const input = container.querySelector(`.input-customer-chat[data-booking-id="${bookingId}"]`);
      if (!input || !input.value.trim()) return;

      const state = loadState();
      const booking = state.bookings.find(b => b.id === bookingId);
      if (booking) {
        booking.messages.push({
          id: `msg_${Date.now()}`,
          senderRole: 'customer',
          senderName: booking.customerName || 'Customer',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: input.value.trim()
        });
        saveState(state);
        input.value = '';
        renderCustomerActiveBookings();
      }
    });
  });

  // Attach Extend ASAP Search handlers
  container.querySelectorAll('.btn-extend-asap').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      const res = extendAsapBooking(bookingId, 30);
      if (res.success) {
        showToast(`Extended search for ${bookingId} by 30 minutes! Looking for pros.`, '⏳');
        renderAll();
      } else {
        showToast(res.error || 'Failed to extend search.', '⚠️');
      }
    });
  });

  // Attach Reschedule modal trigger handlers
  container.querySelectorAll('.btn-open-reschedule').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      pendingRescheduleBookingId = bookingId;
      const state = loadState();
      const b = state.bookings.find(bk => bk.id === bookingId);
      const dallasNow = getDallasLocalNow();

      const modal = document.getElementById('reschedule-modal');
      const subtitle = document.getElementById('reschedule-modal-subtitle');
      const dateInput = document.getElementById('input-reschedule-date');
      const timeInput = document.getElementById('input-reschedule-time');

      if (subtitle && b) {
        subtitle.textContent = `Rescheduling Booking ${b.id} (${b.serviceTitle})`;
      }
      if (dateInput) {
        dateInput.min = dallasNow.dateStr;
        dateInput.value = b && b.scheduledDate >= dallasNow.dateStr ? b.scheduledDate : dallasNow.dateStr;
      }
      if (timeInput) {
        timeInput.value = '10:00';
      }
      if (modal) {
        modal.classList.add('open');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Render Customer Past Bookings & Review Modal
// ---------------------------------------------------------------------------
function renderCustomerPastBookings() {
  const container = document.getElementById('customer-past-bookings-container');
  if (!container) return;

  const state = loadState();
  const currentCustomerId = state.activeCustomerId;
  const completed = state.bookings.filter(b =>
    b.customerId === currentCustomerId &&
    b.overallStatus === 'completed'
  );

  if (completed.length === 0) {
    container.innerHTML = `
      <div style="background: white; border: 1px dashed var(--border-dark); border-radius: var(--radius-lg); padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No completed bookings yet.
      </div>
    `;
    return;
  }

  container.innerHTML = completed.map(b => {
    // Per-worker review section: one card per assigned Pro slot.
    // Customers see only service prices and totals — no payout information.
    const workerReviews = b.workerReviews || [];
    const assignedSlots = b.workerAssignments.filter(s => s.assignedProId);

    const workerReviewSectionHtml = assignedSlots.length > 0 ? `
      <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-light);">
        <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 10px;">
          Worker Reviews (${assignedSlots.length} ${assignedSlots.length === 1 ? 'Worker' : 'Workers'}):
        </div>
        ${assignedSlots.map(slot => {
          const existingReview = workerReviews.find(r => r.slotId === slot.slotId);
          if (existingReview) {
            return `
              <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 12px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <span style="font-weight: 700; font-size: 0.88rem; color: var(--primary-navy);">
                    👷 ${existingReview.proName}
                    <span style="font-weight: 400; color: var(--text-muted);">— ${existingReview.roleTitle}</span>
                  </span>
                  <span style="font-size: 0.72rem; color: var(--text-muted);">${existingReview.date}</span>
                </div>
                <div style="font-size: 0.88rem; color: var(--brand-emerald); font-weight: 700; margin-bottom: 4px;">
                  ${'⭐'.repeat(existingReview.stars)} ${existingReview.stars} Star${existingReview.stars !== 1 ? 's' : ''}
                </div>
                ${existingReview.comment
                  ? `<p style="font-size: 0.82rem; color: var(--text-secondary); font-style: italic; margin: 0;">"${existingReview.comment}"</p>`
                  : ''}
                ${existingReview.disputed
                  ? '<div style="font-size: 0.72rem; color: var(--accent-red); font-weight: 600; margin-top: 4px;">⚠️ Disputed by Pro (Investigation Pending)</div>'
                  : ''}
              </div>
            `;
          } else {
            return `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: #F8FAFC; border: 1px dashed var(--border-dark); border-radius: var(--radius-md); margin-bottom: 10px;">
                <span style="font-size: 0.85rem; color: var(--text-secondary);">
                  👷 <strong>${slot.assignedProName}</strong>
                  <span style="color: var(--text-muted);">— ${slot.roleTitle}</span>
                </span>
                <button class="btn-open-review"
                  data-booking-id="${b.id}"
                  data-slot-id="${slot.slotId}"
                  data-pro-name="${slot.assignedProName}"
                  data-role-title="${slot.roleTitle}"
                  style="padding: 6px 14px; font-size: 0.82rem; font-weight: 600; background: var(--primary-navy); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; white-space: nowrap;">
                  ⭐ Review
                </button>
              </div>
            `;
          }
        }).join('')}
      </div>
    ` : '';

    return `
      <div style="background: white; border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 18px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <span class="booking-id-tag">${b.id}</span>
            <strong style="margin-left: 6px; color: var(--primary-navy);">${b.serviceTitle}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
              Completed in ${b.neighborhoodName} • Customer Paid: $${b.pricing.customerTotal.toFixed(2)}
            </div>
          </div>
          <span class="status-badge completed">✓ Completed</span>
        </div>
        ${workerReviewSectionHtml}
      </div>
    `;
  }).join('');

  // Attach per-worker review triggers
  container.querySelectorAll('.btn-open-review').forEach(btn => {
    btn.addEventListener('click', (e) => {
      pendingReviewBookingId = e.currentTarget.getAttribute('data-booking-id');
      pendingReviewSlotId = e.currentTarget.getAttribute('data-slot-id');
      pendingReviewWorkerName = e.currentTarget.getAttribute('data-pro-name');
      pendingReviewRoleTitle = e.currentTarget.getAttribute('data-role-title');

      // Update modal worker context line
      const workerInfoEl = document.getElementById('review-modal-worker-info');
      if (workerInfoEl) {
        workerInfoEl.textContent = `${pendingReviewWorkerName} — ${pendingReviewRoleTitle}`;
      }

      // Reset star selection to 5 stars for each new review
      currentRatingSelection = 5;
      const starText = document.getElementById('star-rating-text');
      if (starText) starText.textContent = '5 Stars (Excellent Service)';
      document.querySelectorAll('#star-rating-selector span').forEach(s => {
        s.style.opacity = '1';
      });
      const reviewTextArea = document.getElementById('input-review-text');
      if (reviewTextArea) reviewTextArea.value = '';

      document.getElementById('review-modal').classList.add('open');
    });
  });
}

// ---------------------------------------------------------------------------
// Render Crewly Pro View (Profile, Verified Badges, Earnings, Job Board)
// ---------------------------------------------------------------------------
function renderProDashboard() {
  const state = loadState();
  const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];

  // Pro Header stats
  document.getElementById('pro-name-display').textContent = activePro.name;
  document.getElementById('pro-avatar-display').textContent = activePro.avatar;
  document.getElementById('pro-rating-display').textContent = activePro.rating.toFixed(2);
  document.getElementById('pro-reviews-display').textContent = activePro.reviewCount;
  document.getElementById('pro-neighborhood-display').textContent = activePro.homeNeighborhood;
  document.getElementById('pro-reliability-display').textContent = `${activePro.reliabilityScore}%`;

  const tierBadge = document.getElementById('pro-tier-display');
  tierBadge.className = `tier-badge ${activePro.tier.toLowerCase()}`;
  tierBadge.textContent = `${activePro.tier} Pro`;

  // Predefined Verified Badges (Strict enforcement: self-reported notes do not grant access)
  const badgesContainer = document.getElementById('pro-verified-badges');
  badgesContainer.innerHTML = (activePro.verifiedBadges || []).map(b =>
    `<span class="verified-credential-chip">${b.label}</span>`
  ).join('');

  // Auto-book toggle status
  const autobookCheckbox = document.getElementById('pro-autobook-toggle');
  autobookCheckbox.checked = !!activePro.autoBookEnabled;

  // Earnings Display
  const availableVal = activePro.earnings?.availableBalance || 0;
  const pendingVal = activePro.earnings?.pendingBalance || 0;
  const lifetimeVal = activePro.earnings?.lifetimeEarned || 0;

  document.getElementById('pro-stat-available').textContent = `$${availableVal.toFixed(2)}`;
  document.getElementById('pro-stat-pending').textContent = `$${pendingVal.toFixed(2)}`;
  document.getElementById('pro-stat-lifetime').textContent = `$${lifetimeVal.toFixed(2)}`;

  const walletProName = document.getElementById('wallet-pro-name');
  if (walletProName) walletProName.textContent = activePro.name;

  // Render Pro Wallet Transaction Ledger (Stage 2)
  renderProWalletTransactions(activePro);

  // Populate Pro selector dropdown
  const proSelector = document.getElementById('pro-selector');
  proSelector.innerHTML = state.pros.map(p =>
    `<option value="${p.id}" ${p.id === activePro.id ? 'selected' : ''}>${p.name} (${p.tier} • ${p.verifiedSkills.join(', ')})</option>`
  ).join('');

  renderProActiveAssignments(activePro);
  renderProCompletedJobs(activePro);
  renderProJobBoard(activePro);
}

// ---------------------------------------------------------------------------
// Render Pro Wallet Transaction Ledger & Filter Tabs (Stage 2)
// ---------------------------------------------------------------------------
function renderProWalletTransactions(activePro) {
  const container = document.getElementById('wallet-transactions-container');
  if (!container) return;

  const rawTxs = activePro.earnings?.walletTransactions || [];

  // Update count badges
  const countAll = rawTxs.length;
  const countEarnings = rawTxs.filter(t => t.type === 'earnings_credit' || t.type === 'historical_job_import' || t.type === 'opening_balance_snapshot').length;
  const countCashouts = rawTxs.filter(t => t.type === 'cashout_instant' || t.type === 'cashout_standard').length;

  const elAll = document.getElementById('wallet-count-all');
  const elEarnings = document.getElementById('wallet-count-earnings');
  const elCashouts = document.getElementById('wallet-count-cashouts');
  if (elAll) elAll.textContent = countAll;
  if (elEarnings) elEarnings.textContent = countEarnings;
  if (elCashouts) elCashouts.textContent = countCashouts;

  // Filter pills visual state
  const btnAll = document.getElementById('wallet-filter-all');
  const btnEarnings = document.getElementById('wallet-filter-earnings');
  const btnCashouts = document.getElementById('wallet-filter-cashouts');

  const setFilterPillState = (btn, isActive) => {
    if (!btn) return;
    if (isActive) {
      btn.classList.add('active');
      btn.style.background = 'var(--primary-navy)';
      btn.style.color = 'white';
      btn.style.borderColor = 'var(--primary-navy)';
    } else {
      btn.classList.remove('active');
      btn.style.background = 'white';
      btn.style.color = 'var(--text-secondary)';
      btn.style.borderColor = 'var(--border-light)';
    }
  };

  setFilterPillState(btnAll, currentWalletFilter === 'all');
  setFilterPillState(btnEarnings, currentWalletFilter === 'earnings');
  setFilterPillState(btnCashouts, currentWalletFilter === 'cashouts');

  let filteredTxs = rawTxs;
  if (currentWalletFilter === 'earnings') {
    filteredTxs = rawTxs.filter(t => t.type === 'earnings_credit' || t.type === 'historical_job_import' || t.type === 'opening_balance_snapshot');
  } else if (currentWalletFilter === 'cashouts') {
    filteredTxs = rawTxs.filter(t => t.type === 'cashout_instant' || t.type === 'cashout_standard');
  }

  if (filteredTxs.length === 0) {
    const emptyMsgs = {
      all: `No wallet activity recorded yet for ${activePro.name}.`,
      earnings: `No job earnings credited yet for ${activePro.name}. Complete jobs on the board to earn payouts.`,
      cashouts: `No cash-out withdrawals requested yet. Click "Cash Out Funds" above when you have available earnings.`
    };
    container.innerHTML = `
      <div style="background: white; border: 1px dashed var(--border-dark); border-radius: var(--radius-md); padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        ${emptyMsgs[currentWalletFilter] || 'No transactions found.'}
      </div>
    `;
    return;
  }

  container.innerHTML = filteredTxs.map(tx => {
    const isEarnings = tx.type === 'earnings_credit' || tx.type === 'historical_job_import';
    const isSnapshot = tx.type === 'opening_balance_snapshot';
    const isCashout = tx.type === 'cashout_instant' || tx.type === 'cashout_standard';

    let cardClass = isEarnings ? 'earnings' : (isCashout ? 'cashout' : 'snapshot');
    let iconClass = cardClass;
    let iconSymbol = isEarnings ? '💰' : (isCashout ? (tx.type === 'cashout_instant' ? '⚡' : '🏦') : '📋');

    let amountFormatted = '';
    let amountColor = 'var(--text-primary)';
    if (isEarnings) {
      amountFormatted = `+$${(tx.amountCents / 100).toFixed(2)}`;
      amountColor = 'var(--brand-emerald)';
    } else if (isCashout) {
      amountFormatted = `-$${(tx.amountCents / 100).toFixed(2)}`;
      amountColor = 'var(--accent-red)';
    } else {
      amountFormatted = '$0.00';
      amountColor = 'var(--text-muted)';
    }

    let statusBadge = '';
    if (tx.status === 'completed') {
      statusBadge = `<span class="slot-status-pill completed">✓ CREDITED</span>`;
    } else if (tx.status === 'simulated_instant_confirmed') {
      statusBadge = `<span class="slot-status-pill in_progress" style="background:#ECFDF5; color:var(--brand-emerald); border-color:#A7F3D0;">✓ CONFIRMED (SIMULATED)</span>`;
    } else if (tx.status === 'simulated_processing') {
      statusBadge = `<span class="slot-status-pill assigned" style="background:#EFF6FF; color:#1E40AF;">⏳ PROCESSING (1-2 DAYS)</span>`;
    } else if (tx.status === 'historical_snapshot') {
      statusBadge = `<span class="slot-status-pill unassigned" style="background:#FEF3C7; color:#92400E;">SNAPSHOT</span>`;
    } else if (tx.status === 'historical_import') {
      statusBadge = `<span class="slot-status-pill completed">HISTORICAL</span>`;
    }

    return `
      <div class="wallet-tx-card ${cardClass}">
        <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 260px;">
          <div class="wallet-tx-icon ${iconClass}">
            ${iconSymbol}
          </div>
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 2px;">
              <strong style="color: var(--primary-navy); font-size: 0.92rem;">${tx.description}</strong>
              ${statusBadge}
            </div>
            <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <span>📅 ${tx.displayDate || (tx.isoTimestamp ? tx.isoTimestamp.split('T')[0] : '')}</span>
              <span style="font-family: monospace; font-size: 0.75rem;">ID: ${tx.txId}</span>
              ${tx.bookingId ? `<span>Booking: <strong>${tx.bookingId}</strong></span>` : ''}
              ${tx.feeCents > 0 ? `<span>Fee: -$${(tx.feeCents / 100).toFixed(2)}</span>` : ''}
              ${isCashout ? `<span style="color: var(--brand-emerald); font-weight: 700;">Net: $${(tx.netCents / 100).toFixed(2)}</span>` : ''}
            </div>
          </div>
        </div>

        <div style="text-align: right; display: flex; align-items: center; gap: 14px;">
          <div>
            <div style="font-size: 1.25rem; font-weight: 800; color: ${amountColor};">
              ${amountFormatted}
            </div>
            <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">
              ${isEarnings ? 'Earned Payout' : (isCashout ? 'Withdrawn' : 'Baseline Reference')}
            </div>
          </div>
          ${
            isCashout
              ? `<button class="btn-open-tab btn-view-receipt" data-tx-id="${tx.txId}" style="padding: 6px 12px; font-size: 0.76rem; border-radius: var(--radius-sm); white-space: nowrap; cursor: pointer;">
                  🧾 Receipt
                </button>`
              : ''
          }
        </div>
      </div>
    `;
  }).join('');

  // Attach Receipt button listeners
  container.querySelectorAll('.btn-view-receipt').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const txId = e.currentTarget.getAttribute('data-tx-id');
      const tx = rawTxs.find(t => t.txId === txId);
      if (tx) {
        openReceiptModal(tx, activePro.name);
      }
    });
  });
}

// Render Pro Active Assignments
function renderProActiveAssignments(activePro) {
  const container = document.getElementById('pro-active-assignments-container');
  if (!container) return;

  const state = loadState();
  // Find bookings where this Pro is assigned to at least one active slot
  const assignedBookings = state.bookings.filter(b =>
    b.overallStatus !== 'completed' &&
    b.overallStatus !== 'cancelled' &&
    b.workerAssignments.some(s => s.assignedProId === activePro.id && s.status !== 'completed')
  );

  if (assignedBookings.length === 0) {
    container.innerHTML = `
      <div style="background: white; border: 1px dashed var(--border-dark); border-radius: var(--radius-lg); padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        You have no active in-progress assignments. Browse the Dallas Job Board below to accept tasks.
      </div>
    `;
    return;
  }

  container.innerHTML = assignedBookings.map(b => {
    const slot = b.workerAssignments.find(s => s.assignedProId === activePro.id);
    const totalSlots = b.workerAssignments.length;
    const assignedSlots = b.workerAssignments.filter(s => s.status !== 'unassigned').length;
    const isCrewIncomplete = b.workersNeeded > 1 && assignedSlots < totalSlots;

    return `
      <div class="booking-tracking-card" style="border-left: 4px solid var(--brand-emerald);">
        <div class="booking-header">
          <div>
            <span class="booking-id-tag">${b.id}</span>
            <strong style="margin-left: 6px; font-size: 1.1rem; color: var(--primary-navy);">${b.serviceTitle}</strong>
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">
              Role: <strong>${slot.roleTitle}</strong> • Location: <strong>${b.neighborhoodName} (${b.address})</strong>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 1.35rem; font-weight: 800; color: var(--brand-emerald);">$${slot.payout.toFixed(2)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;">Your Offered Payout</div>
          </div>
        </div>

        <div style="margin: 14px 0; font-size: 0.85rem; color: var(--text-secondary);">
          <strong>${formatBookingTiming(b)}</strong> • Customer: <strong>${b.customerName}</strong>
        </div>

        ${
          isCrewIncomplete
            ? `
              <div style="background: #FEF3C7; border: 1px solid #F59E0B; color: #92400E; padding: 10px 14px; border-radius: var(--radius-sm); margin: 12px 0; font-size: 0.82rem; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.2rem;">⏳</span>
                <div>
                  <strong>Crew In Formation (${assignedSlots} of ${totalSlots} assigned):</strong>
                  Work can only begin once all required worker positions are filled. You will be able to start once your co-worker accepts.
                </div>
              </div>
            `
            : ''
        }

        <!-- Pro Action Lifecycle Stepper Buttons -->
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; border-top: 1px solid var(--border-light); padding-top: 14px;">
          <button class="btn-open-tab btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="traveling" ${isCrewIncomplete || slot.status === 'traveling' ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
            🚗 Mark En Route
          </button>
          <button class="btn-open-tab btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="arrived" ${isCrewIncomplete || slot.status === 'arrived' ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
            📍 Mark Arrived
          </button>
          <button class="btn-open-tab btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="in_progress" ${isCrewIncomplete || slot.status === 'in_progress' ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
            🔨 Start Work
          </button>
          <button class="btn-book-service btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="completed" ${isCrewIncomplete ? 'disabled style="opacity:0.5; cursor:not-allowed; width: auto; padding: 6px 16px; background: var(--text-muted);"' : 'style="width: auto; padding: 6px 16px; background: var(--brand-emerald);"'}>
            ✓ Complete & Finalize Payout
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach status transition handlers
  container.querySelectorAll('.btn-pro-action').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const button = e.currentTarget;
      if (button.disabled) return;
      button.disabled = true;

      const bookingId = button.getAttribute('data-booking-id');
      const slotId = button.getAttribute('data-slot-id');
      const newStatus = button.getAttribute('data-status');

      const result = updateProAssignmentStatus(bookingId, slotId, newStatus);
      if (result.success) {
        showToast(`Job status updated: ${newStatus.toUpperCase()}`);
        renderAll();
      } else {
        showToast(result.error || 'Status update could not be completed.', '⚠️');
        button.disabled = false;
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Render Pro Completed-Job History (Priority 6)
// ---------------------------------------------------------------------------
function renderProCompletedJobs(activePro) {
  const container = document.getElementById('pro-completed-jobs-container');
  if (!container) return;

  const state = loadState();
  const completedRecords = [];

  (state.bookings || []).forEach(b => {
    (b.workerAssignments || []).forEach(slot => {
      if (slot.assignedProId === activePro.id && slot.status === 'completed') {
        const review = (b.workerReviews || []).find(r => r.slotId === slot.slotId);
        completedRecords.push({
          bookingId: b.id,
          serviceTitle: b.serviceTitle,
          roleTitle: slot.roleTitle,
          customerName: b.customerName,
          completionDate: (review && review.date) || (slot.assignedAt ? slot.assignedAt.split('T')[0] : b.scheduledDate),
          payout: slot.payout,
          review
        });
      }
    });
  });

  if (completedRecords.length === 0) {
    container.innerHTML = `
      <div style="background: white; border: 1px dashed var(--border-dark); border-radius: var(--radius-lg); padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No completed tasks yet for ${activePro.name}. Complete active assignments from the job board to build your earnings record.
      </div>
    `;
    return;
  }

  container.innerHTML = completedRecords.map(item => {
    const ratingDisplay = item.review && item.review.stars
      ? `<span style="color: var(--brand-emerald); font-weight: 700;">${'⭐'.repeat(item.review.stars)} ${item.review.stars} Star Rating</span>`
      : `<span style="color: var(--text-muted); font-style: italic;">Not rated</span>`;

    return `
      <div style="background: white; border: 1px solid var(--border-light); border-left: 4px solid var(--brand-emerald); border-radius: var(--radius-md); padding: 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span class="booking-id-tag">${item.bookingId}</span>
            <strong style="color: var(--primary-navy);">${item.serviceTitle} — ${item.roleTitle}</strong>
          </div>
          <div style="font-size: 0.82rem; color: var(--text-secondary);">
            Customer: <strong>${item.customerName}</strong> • Completed: <strong>${item.completionDate}</strong>
          </div>
          <div style="font-size: 0.82rem; margin-top: 4px;">
            Rating Received: ${ratingDisplay}
            ${item.review && item.review.comment ? `<span style="color: var(--text-muted); font-style: italic; margin-left: 8px;">"${item.review.comment}"</span>` : ''}
          </div>
        </div>

        <div style="text-align: right;">
          <div style="font-size: 1.3rem; font-weight: 800; color: var(--brand-emerald);">
            +$${item.payout.toFixed(2)}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;">
            Earned Payout
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// Render Pro Job Board with Filters & Eligibility (Priority 5)
// ---------------------------------------------------------------------------
function renderProJobBoard(activePro) {
  const container = document.getElementById('pro-job-board-container');
  if (!container) return;

  const state = loadState();
  const dallasNow = getDallasLocalNow();

  const openBookings = state.bookings.filter(b =>
    b.overallStatus !== 'completed' &&
    b.overallStatus !== 'cancelled' &&
    b.workerAssignments.some(s => s.status === 'unassigned')
  );

  // Collect all unassigned slots and categorize
  const allJobItems = [];
  openBookings.forEach(b => {
    const unassignedSlots = b.workerAssignments.filter(s => s.status === 'unassigned');
    unassignedSlots.forEach(slot => {
      const eligibility = canProAcceptSlot(activePro.id, b.id, slot.slotId);
      const isPast = b.timingType === 'asap'
        ? isAsapExpired(b)
        : (b.scheduledDate < dallasNow.dateStr || (b.scheduledDate === dallasNow.dateStr && b.scheduledTime && b.scheduledTime < dallasNow.timeStr));
      const isFuture = b.timingType !== 'asap' && b.scheduledDate > dallasNow.dateStr;

      allJobItems.push({
        booking: b,
        slot,
        eligibility,
        isPast,
        isFuture,
        isAvailable: eligibility.allowed && !isPast,
        isUpcoming: eligibility.allowed && isFuture,
        isIneligible: !eligibility.allowed || isPast
      });
    });
  });

  // Calculate counts for filter pills
  const countAvailable = allJobItems.filter(item => item.isAvailable).length;
  const countUpcoming = allJobItems.filter(item => item.isUpcoming).length;
  const countIneligible = allJobItems.filter(item => item.isIneligible).length;

  const countAvailableEl = document.getElementById('count-filter-available');
  const countUpcomingEl = document.getElementById('count-filter-upcoming');
  const countIneligibleEl = document.getElementById('count-filter-ineligible');
  if (countAvailableEl) countAvailableEl.textContent = countAvailable;
  if (countUpcomingEl) countUpcomingEl.textContent = countUpcoming;
  if (countIneligibleEl) countIneligibleEl.textContent = countIneligible;

  // Filter button active state styles
  const btnAvailable = document.getElementById('job-filter-available');
  const btnUpcoming = document.getElementById('job-filter-upcoming');
  const btnIneligible = document.getElementById('job-filter-ineligible');

  const setFilterBtnStyle = (btn, isActive) => {
    if (!btn) return;
    if (isActive) {
      btn.style.background = 'var(--primary-navy)';
      btn.style.color = 'white';
      btn.style.border = '1px solid var(--primary-navy)';
    } else {
      btn.style.background = 'white';
      btn.style.color = 'var(--text-secondary)';
      btn.style.border = '1px solid var(--border-light)';
    }
  };

  setFilterBtnStyle(btnAvailable, currentJobBoardFilter === 'available');
  setFilterBtnStyle(btnUpcoming, currentJobBoardFilter === 'upcoming');
  setFilterBtnStyle(btnIneligible, currentJobBoardFilter === 'ineligible');

  // Filter items according to active pill
  let filteredItems = [];
  if (currentJobBoardFilter === 'available') {
    filteredItems = allJobItems.filter(item => item.isAvailable);
  } else if (currentJobBoardFilter === 'upcoming') {
    filteredItems = allJobItems.filter(item => item.isUpcoming);
  } else {
    filteredItems = allJobItems.filter(item => item.isIneligible);
  }

  if (filteredItems.length === 0) {
    const emptyMessages = {
      available: `No currently available positions match your qualifications and availability for today. Check "Upcoming Jobs" to schedule future dates.`,
      upcoming: `No upcoming future jobs scheduled right now. Check back as new customer requests arrive.`,
      ineligible: `No ineligible or conflicting jobs found on the board.`
    };
    container.innerHTML = `
      <div style="background: white; border: 1px dashed var(--border-dark); border-radius: var(--radius-lg); padding: 32px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
        ${emptyMessages[currentJobBoardFilter] || 'No jobs in this category.'}
      </div>
    `;
    return;
  }

  container.innerHTML = filteredItems.map(item => {
    const b = item.booking;
    const slot = item.slot;
    const eligibility = item.eligibility;

    return `
      <div class="job-board-card ${eligibility.allowed ? '' : 'ineligible'}">
        <div class="job-card-header">
          <div class="job-title-group">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="booking-id-tag">${b.id}</span>
              <h3>${b.serviceTitle} — ${slot.roleTitle}</h3>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
              Customer: ${b.customerName} (${b.neighborhoodName}${b.zipCode ? ' ' + b.zipCode : ''})
            </div>
          </div>
          
          <!-- Pro Payout Only (Strict separation: customer fees and platform margins are hidden) -->
          <div class="job-payout-badge">
            <div class="job-payout-amount">$${slot.payout.toFixed(2)}</div>
            <div class="job-payout-label">Your Offered Payout</div>
          </div>
        </div>

        <div class="job-meta-row">
          <div class="job-meta-item">📍 Area: <strong>${b.neighborhoodName}</strong></div>
          <div class="job-meta-item">📅 Date: <strong>${b.scheduledDate}</strong></div>
          <div class="job-meta-item">⏰ Schedule: <strong>${b.timingType === 'asap' ? (isAsapExpired(b) ? 'ASAP (Window Expired)' : `ASAP — Seeking Pros (${b.scheduledTime})`) : b.scheduledTime}</strong></div>
          <div class="job-meta-item">⏱️ Duration: <strong>${b.estimatedDurationHours} hrs</strong></div>
        </div>

        <!-- Eligibility Evaluation Output -->
        ${
          eligibility.allowed
            ? `
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; border-top: 1px solid var(--border-light); padding-top: 12px;">
                <span style="font-size: 0.82rem; color: var(--brand-emerald); font-weight: 700;">
                  ✓ You are eligible & verified for this task
                </span>
                <button class="btn-book-service btn-accept-job" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" style="width: auto; padding: 8px 20px;">
                  Accept Job ($${slot.payout.toFixed(2)})
                </button>
              </div>
            `
            : `
              <div style="margin-top: 12px; border-top: 1px solid var(--border-light); padding-top: 10px;">
                <div class="ineligible-reason-badge">
                  <span>⚠️</span>
                  <span>${eligibility.reason}</span>
                </div>
              </div>
            `
        }
      </div>
    `;
  }).join('');

  // Attach job acceptance clicks
  container.querySelectorAll('.btn-accept-job').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      const slotId = e.currentTarget.getAttribute('data-slot-id');

      const res = assignProToSlot(bookingId, slotId, activePro.id);
      if (res.success) {
        showToast(`Accepted ${slotId} on ${bookingId}! Added to your active assignments.`);
        renderAll();
      } else {
        showToast(res.error || 'Could not accept job.', '⚠️');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Administrative / Demo Marketplace Metrics Modal
// ---------------------------------------------------------------------------
function openAdminMetricsModal() {
  const state = loadState();
  const modal = document.getElementById('admin-modal');

  let totalCustomerBillings = 0;
  let totalWorkerPayouts = 0;
  let partiallyFilledCount = 0;
  let confirmedCount = 0;
  let completedCount = 0;

  state.bookings.forEach(b => {
    totalCustomerBillings += (b.pricing.customerTotal || 0);
    totalWorkerPayouts += (b.pricing.totalWorkerPayouts || 0);

    if (b.overallStatus === 'partially_filled') partiallyFilledCount++;
    else if (b.overallStatus === 'fully_confirmed' || b.overallStatus === 'in_progress') confirmedCount++;
    else if (b.overallStatus === 'completed') completedCount++;
  });

  const grossRevenue = totalCustomerBillings - totalWorkerPayouts;

  document.getElementById('metric-customer-billings').textContent = `$${totalCustomerBillings.toFixed(2)}`;
  document.getElementById('metric-worker-payouts').textContent = `$${totalWorkerPayouts.toFixed(2)}`;
  document.getElementById('metric-gross-revenue').textContent = `$${grossRevenue.toFixed(2)}`;

  document.getElementById('metric-partially-filled-count').textContent = partiallyFilledCount;
  document.getElementById('metric-confirmed-count').textContent = confirmedCount;
  document.getElementById('metric-completed-count').textContent = completedCount;

  modal.classList.add('open');
}

// ---------------------------------------------------------------------------
// Stage 3: Admin & Dispatch Dashboard (Phase 1)
// ---------------------------------------------------------------------------
function initAdminSubnav() {
  const tabs = document.querySelectorAll('.admin-subnav-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabName = e.currentTarget.getAttribute('data-tab');
      if (tabName) switchAdminTab(tabName);
    });
  });
}

function switchAdminTab(tabName) {
  const tabs = document.querySelectorAll('.admin-subnav-btn');
  tabs.forEach(t => {
    if (t.getAttribute('data-tab') === tabName) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  const panels = document.querySelectorAll('.admin-tab-panel');
  panels.forEach(p => {
    if (p.id === `admin-panel-${tabName}`) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });

  // Re-render corresponding panel when tab is switched
  if (tabName === 'workers') renderAdminWorkers();
  else if (tabName === 'support') renderAdminSupport();
  else if (tabName === 'finance') renderAdminFinance();
  else if (tabName === 'trust') renderAdminTrustSafety();
  else if (tabName === 'dispatch') renderAdminDispatchList();
  else if (tabName === 'audit') renderAdminAuditTable();
}

function renderAdminDashboard() {
  const state = loadState();
  const metrics = getAdminOperationalMetrics(state);
  const fin = getAdminFinancialSummary(state);
  if (!metrics || !fin) return;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  // Operational metrics
  setEl('admin-stat-total-bookings', metrics.totalRequests);
  setEl('admin-stat-partially-filled', metrics.partiallyFilledCount);
  setEl('admin-stat-open-bookings', metrics.waitingCount);
  setEl('admin-stat-confirmed-bookings', metrics.fullyConfirmedCount + metrics.inProgressCount);
  setEl('admin-stat-completed-bookings', metrics.completedCount);
  setEl('admin-stat-expired-asap', metrics.expiredAsapCount);
  setEl('admin-badge-alerts-count', metrics.needsAttentionCount);
  setEl('admin-stat-available-pros-today', metrics.availableProsTodayCount || 0);
  setEl('admin-stat-registered-pros', metrics.registeredProsCount || 0);

  // Financial integrity metrics (Product Lead Adjustment 5 & Phase 1 Refinement 3)
  setEl('admin-fin-projected-gbv', `$${fin.projectedGrossBookingValue}`);
  setEl('admin-fin-completed-gbv', `$${fin.completedGrossBookingValue}`);
  setEl('admin-fin-booking-fees', `$${fin.totalBookingFees}`);
  setEl('admin-fin-worker-pay', `$${fin.totalWorkerCompensation}`);
  setEl('admin-fin-worker-pending', `$${fin.pendingWorkerPayouts}`);
  setEl('admin-fin-worker-released', `$${fin.completedWorkerPayouts}`);
  setEl('admin-fin-completed-margin', `$${fin.completedGrossMargin || '0.00'}`);
  setEl('admin-fin-projected-margin', `$${fin.projectedGrossMargin || '0.00'}`);
  setEl('admin-fin-gross-margin', `$${fin.platformGrossMargin}`);
  setEl('admin-fin-simulated-cashouts', `$${fin.totalSimulatedCashouts}`);
  setEl('admin-fin-cashout-count', fin.instantCashoutCount + fin.standardCashoutCount);
  setEl('admin-fin-cashout-fees', `$${fin.totalCashoutFees}`);
  setEl('admin-disclaimer-margin-val', `$${fin.platformGrossMargin}`);

  // Render rules-based alerts list
  const alertsContainer = document.getElementById('admin-alerts-container');
  if (alertsContainer) {
    if (metrics.alerts.length === 0) {
      alertsContainer.innerHTML = `
        <div style="background: white; border-radius: var(--radius-md); padding: 36px 20px; text-align: center; border: 1px solid var(--border-light); color: var(--text-secondary);">
          <div style="font-size: 2rem; margin-bottom: 8px;">✓</div>
          <strong style="color: var(--primary-navy);">All Systems Operating Normally</strong>
          <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--text-muted);">
            No staffing shortages, expired matching windows, or unresolved customer support cases.
          </p>
        </div>
      `;
    } else {
      alertsContainer.innerHTML = metrics.alerts.map(a => `
        <div class="admin-alert-card ${a.level}">
          <div style="flex: 1;">
            <div class="admin-alert-header">
              <span class="admin-alert-badge ${a.level}">${a.badge}</span>
              <span class="admin-alert-title">${a.title}</span>
            </div>
            <div class="admin-alert-reason">${a.reason}</div>
          </div>
          <div>
            <button class="admin-alert-action-btn" data-target-tab="${a.targetPanel || 'overview'}">
              ${a.actionLabel || 'Inspect'} →
            </button>
          </div>
        </div>
      `).join('');

      alertsContainer.querySelectorAll('.admin-alert-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const targetTab = e.currentTarget.getAttribute('data-target-tab');
          if (targetTab) switchAdminTab(targetTab);
        });
      });
    }
  }

  // Render Phase 2 & Phase 3 Consoles
  renderAdminDispatchList();
  renderAdminWorkers();
  renderAdminSupport();
  renderAdminFinance();
  renderAdminTrustSafety();
  renderAdminAuditTable();
}

// ---------------------------------------------------------------------------
// Stage 3 Phase 2: Dispatch Management Console
// ---------------------------------------------------------------------------
function renderAdminDispatchList() {
  const container = document.getElementById('admin-dispatch-bookings-list');
  if (!container) return;

  const state = loadState();
  const searchInput = document.getElementById('admin-dispatch-search');
  const filterSelect = document.getElementById('admin-dispatch-filter-status');

  const searchTerm = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const statusFilter = (filterSelect && filterSelect.value) ? filterSelect.value : 'all';
  const dallasNow = getDallasLocalNow();

  let bookings = state.bookings || [];

  // Filter by search query
  if (searchTerm) {
    bookings = bookings.filter(b =>
      b.id.toLowerCase().includes(searchTerm) ||
      (b.customerName || '').toLowerCase().includes(searchTerm) ||
      (b.serviceTitle || '').toLowerCase().includes(searchTerm) ||
      (b.neighborhoodName || '').toLowerCase().includes(searchTerm)
    );
  }

  // Filter by operational status
  if (statusFilter === 'partially_filled') {
    bookings = bookings.filter(b => b.overallStatus === 'partially_filled');
  } else if (statusFilter === 'waiting_for_pros') {
    bookings = bookings.filter(b => b.overallStatus === 'waiting_for_pros');
  } else if (statusFilter === 'fully_confirmed') {
    bookings = bookings.filter(b => ['fully_confirmed', 'traveling', 'arrived', 'in_progress'].includes(b.overallStatus));
  } else if (statusFilter === 'completed') {
    bookings = bookings.filter(b => b.overallStatus === 'completed');
  } else if (statusFilter === 'historical_past') {
    bookings = bookings.filter(b => b.timingType === 'scheduled' && b.scheduledDate && b.scheduledDate < dallasNow.dateStr && b.overallStatus !== 'completed');
  }

  if (bookings.length === 0) {
    container.innerHTML = `
      <div style="background: white; border-radius: var(--radius-md); padding: 40px 20px; text-align: center; border: 1px solid var(--border-light); color: var(--text-secondary);">
        <div style="font-size: 1.8rem; margin-bottom: 8px;">🔍</div>
        <strong>No bookings match your dispatch filter criteria.</strong>
        <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--text-muted);">
          Try searching for a different Booking ID or clearing status filters.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = bookings.map(b => {
    const isPast = b.timingType === 'scheduled' && b.scheduledDate && b.scheduledDate < dallasNow.dateStr && b.overallStatus !== 'completed';
    const totalSlots = b.workerAssignments ? b.workerAssignments.length : (b.workersNeeded || 1);
    const assignedSlots = b.workerAssignments ? b.workerAssignments.filter(s => s.status !== 'unassigned').length : 0;

    let statusBadgeHtml = '';
    if (b.overallStatus === 'cancelled') {
      statusBadgeHtml = `<span class="badge" style="background: #FEE2E2; color: #DC2626; font-weight: 800;">🚫 Cancelled Record</span>`;
    } else if (isPast) {
      statusBadgeHtml = `<span class="badge" style="background: #FEE2E2; color: #DC2626; font-weight: 800;">📅 Historical Date Passed (${b.scheduledDate})</span>`;
    } else if (b.overallStatus === 'partially_filled') {
      statusBadgeHtml = `<span class="badge badge-pending" style="background: #FEF3C7; color: #92400E; font-weight: 800;">⚠️ Partially Filled (${assignedSlots}/${totalSlots})</span>`;
    } else if (b.overallStatus === 'waiting_for_pros') {
      statusBadgeHtml = `<span class="badge badge-open">⏳ Open / Seeking Pros</span>`;
    } else if (b.overallStatus === 'fully_confirmed') {
      statusBadgeHtml = `<span class="badge badge-confirmed">✓ Fully Confirmed</span>`;
    } else if (b.overallStatus === 'in_progress') {
      statusBadgeHtml = `<span class="badge" style="background: #DBEAFE; color: #1D4ED8; font-weight: 800; border: 1px solid #93C5FD;">⚡ In Progress</span>`;
    } else if (b.overallStatus === 'arrived') {
      statusBadgeHtml = `<span class="badge" style="background: #FEF3C7; color: #92400E; font-weight: 800; border: 1px solid #FCD34D;">📍 Arrived On Site</span>`;
    } else if (b.overallStatus === 'traveling') {
      statusBadgeHtml = `<span class="badge" style="background: #E0E7FF; color: #3730A3; font-weight: 800; border: 1px solid #C7D2FE;">🚗 En Route / Traveling</span>`;
    } else if (b.overallStatus === 'completed') {
      statusBadgeHtml = `<span class="badge" style="background: #E2E8F0; color: #475569;">🏁 Completed</span>`;
    } else {
      statusBadgeHtml = `<span class="badge">${b.overallStatus}</span>`;
    }

    const timingLabel = b.timingType === 'asap'
      ? `<span style="color: #2563EB; font-weight: 700;">⚡ ASAP On-Demand</span>`
      : `📅 ${b.scheduledDate} at ${b.scheduledTime || 'TBD'}`;

    // Stage 3.5 Cancellation Evaluation
    const cancelCheck = canBookingBeCancelled(b);
    let cancelActionHtml = '';
    if (b.overallStatus === 'cancelled') {
      const byWhom = (b.cancellationSnapshot && b.cancellationSnapshot.cancelledBy) ? b.cancellationSnapshot.cancelledBy : (b.cancelledBy || 'Dispatch');
      cancelActionHtml = `<span style="font-size: 0.75rem; color: #DC2626; background: #FEF2F2; padding: 3px 8px; border-radius: var(--radius-sm); font-weight: 700;">🚫 Cancelled (${escapeHtml(byWhom)})</span>`;
    } else if (cancelCheck.allowed) {
      cancelActionHtml = `<button class="btn-cancel-booking" data-booking-id="${b.id}" title="Cancel booking and safely reverse pending worker earnings">🚫 Cancel Booking</button>`;
    } else if (cancelCheck.escalationToSupport) {
      cancelActionHtml = `
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <span style="font-size: 0.72rem; color: #991B1B; background: #FEF2F2; padding: 3px 8px; border-radius: var(--radius-sm); font-weight: 700;">🔒 Cancel Restricted</span>
          <button class="btn-support-escalate" data-booking-id="${b.id}" data-customer-id="${b.customerId}" title="${escapeHtml(cancelCheck.reason)}">🎫 Support Escalation</button>
        </div>
      `;
    }

    const slotsHtml = (b.workerAssignments || []).map(slot => {
      const isAssigned = slot.status !== 'unassigned' && slot.assignedProId;
      const isCompleted = slot.status === 'completed';
      const isUnderway = slot.status === 'in_progress' || slot.status === 'arrived' || slot.status === 'traveling';

      let actionHtml = '';
      if (!isAssigned) {
        if (isPast) {
          actionHtml = `<button class="btn-assign-slot" style="background: #94A3B8; cursor: not-allowed;" title="Appointment date in past; customer must reschedule" disabled>✕ Historical (Reschedule Req.)</button>`;
        } else if (b.overallStatus === 'cancelled') {
          actionHtml = `<span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">Booking Cancelled</span>`;
        } else {
          actionHtml = `<button class="btn-assign-slot" data-booking-id="${b.id}" data-slot-id="${slot.slotId}">🔍 Assign / Replace Pro</button>`;
        }
      } else if (slot.status === 'in_progress') {
        actionHtml = `
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <span style="font-size: 0.75rem; color: #2563EB; font-weight: 700; background: #DBEAFE; padding: 4px 10px; border-radius: var(--radius-sm);">🔒 In Progress</span>
            <button class="btn-verify-complete" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-pro-id="${slot.assignedProId}" data-pro-name="${escapeHtml(slot.assignedProName)}">✓ Verify & Complete</button>
          </div>
        `;
      } else if (isCompleted) {
        actionHtml = `<span style="font-size: 0.75rem; color: #059669; font-weight: 700; background: #ECFDF5; padding: 4px 10px; border-radius: var(--radius-sm);">✓ Payout Released (Protected)</span>`;
      } else if (slot.status === 'traveling' || slot.status === 'arrived') {
        actionHtml = `<span style="font-size: 0.75rem; color: #2563EB; font-weight: 700; background: #DBEAFE; padding: 4px 10px; border-radius: var(--radius-sm);">${slot.status === 'traveling' ? '🚗 En Route' : '📍 Arrived On Site'}</span>`;
      } else {
        // Assigned pre-work: eligible for administrative unassignment
        actionHtml = `<button class="btn-unassign-slot" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-pro-id="${slot.assignedProId}" data-pro-name="${slot.assignedProName}">✕ Unassign Worker</button>`;
      }

      return `
        <div class="dispatch-slot-card ${isAssigned ? 'assigned' : 'unassigned'}">
          <div>
            <div class="dispatch-slot-role">${slot.roleTitle || 'Worker Slot'}</div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
              ${isAssigned ? `Assigned to: <strong style="color: var(--primary-navy);">${slot.assignedProName}</strong>` : `<span style="color: #D97706; font-weight: 700;">⭕ Position Open — Seeking Pro</span>`}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <div class="dispatch-slot-payout">Worker Pay: $${slot.payout.toFixed(2)}</div>
            ${actionHtml}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="dispatch-booking-card" id="dispatch-card-${b.id}">
        <div class="dispatch-card-header">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <h3 class="dispatch-card-title">${b.serviceTitle}</h3>
              ${statusBadgeHtml}
            </div>
            <div class="dispatch-card-meta" style="margin-top: 6px;">
              <span>🆔 <strong>${b.id}</strong></span>
              <span>👤 Customer: <strong>${b.customerName}</strong></span>
              <span>📍 ${b.neighborhoodName} (${b.address || ''})</span>
              <span>${timingLabel}</span>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
            <div>
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; text-align: right;">Customer Total</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: var(--primary-navy); text-align: right;">$${(b.pricing?.customerTotal || 0).toFixed(2)}</div>
            </div>
            ${cancelActionHtml}
          </div>
        </div>

        <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px;">
          Crew Staffing Requirement (${assignedSlots} of ${totalSlots} positions filled):
        </div>
        <div class="dispatch-slots-container">
          ${slotsHtml}
        </div>
      </div>
    `;
  }).join('');

  // Wire assign clicks
  container.querySelectorAll('.btn-assign-slot:not([disabled])').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      const slotId = e.currentTarget.getAttribute('data-slot-id');
      openAdminAssignModal(bookingId, slotId);
    });
  });

  // Wire unassign clicks
  container.querySelectorAll('.btn-unassign-slot').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      const slotId = e.currentTarget.getAttribute('data-slot-id');
      const proId = e.currentTarget.getAttribute('data-pro-id');
      const proName = e.currentTarget.getAttribute('data-pro-name');
      openAdminUnassignModal(bookingId, slotId, proId, proName);
    });
  });

  // Wire cancel clicks
  container.querySelectorAll('.btn-cancel-booking').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      openAdminCancelModal(bookingId);
    });
  });

  // Wire verify complete clicks
  container.querySelectorAll('.btn-verify-complete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      const slotId = e.currentTarget.getAttribute('data-slot-id');
      const proId = e.currentTarget.getAttribute('data-pro-id');
      const proName = e.currentTarget.getAttribute('data-pro-name');
      openAdminVerifyCompleteModal(bookingId, slotId, proId, proName);
    });
  });

  // Wire support escalation clicks
  container.querySelectorAll('.btn-support-escalate').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      const customerId = e.currentTarget.getAttribute('data-customer-id');
      openSupportCaseForBooking(bookingId, customerId, 'Cancellation Review Escalation', 'Administrator attempted cancellation on active booking. Escalated for manual customer support coordination.');
    });
  });
}

// ---------------------------------------------------------------------------
// Stage 3 Phase 2: Administrative Audit Trail Renderer
// ---------------------------------------------------------------------------
function renderAdminAuditTable() {
  const container = document.getElementById('admin-audit-table-container');
  if (!container) return;

  const state = loadState();
  const filterSelect = document.getElementById('admin-audit-filter-action');
  const actionFilter = (filterSelect && filterSelect.value) ? filterSelect.value : 'all';

  let logs = state.adminAuditLog || [];

  if (actionFilter !== 'all') {
    logs = logs.filter(l => l.actionType === actionFilter);
  }

  if (logs.length === 0) {
    container.innerHTML = `
      <div style="padding: 36px 20px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
        No administrative audit events recorded for action filter "${actionFilter}".
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table class="audit-table">
      <thead>
        <tr>
          <th>Date & Time</th>
          <th>Action Type</th>
          <th>Operator</th>
          <th>Reference ID</th>
          <th>Slot / Target</th>
          <th>Status Transition</th>
          <th>Administrative Reason</th>
        </tr>
      </thead>
      <tbody>
        ${logs.map(log => {
          const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
          const badgeClass = log.actionType || 'worker_assigned';
          const isFailed = log.status === 'failed';
          const refDisplay = log.bookingId
            ? `<code style="background: var(--bg-card-alt); padding: 2px 6px; border-radius: var(--radius-sm); font-size: 0.78rem;">${escapeHtml(log.bookingId)}</code>`
            : (log.caseId ? `<code style="background: #EEF2FF; color: #4338CA; padding: 2px 6px; border-radius: var(--radius-sm); font-size: 0.78rem;">${escapeHtml(log.caseId)}</code>` : '—');
          const targetDisplay = log.slotId || log.proId || '—';

          return `
            <tr>
              <td style="white-space: nowrap; font-family: monospace; font-size: 0.78rem;">${dateStr}</td>
              <td>
                <span class="audit-badge ${badgeClass}" style="${isFailed ? 'background: #FEE2E2; color: #DC2626;' : ''}">
                  ${isFailed ? '⚠️ REJECTED' : log.actionType.replace(/_/g, ' ')}
                </span>
              </td>
              <td><strong>${escapeHtml(log.adminName || 'Demo Dispatch')}</strong></td>
              <td>${refDisplay}</td>
              <td>${escapeHtml(targetDisplay)}</td>
              <td><span style="color: var(--text-muted);">${escapeHtml(log.previousValue || '—')}</span> → <strong>${escapeHtml(log.newValue || '—')}</strong></td>
              <td style="max-width: 280px; line-height: 1.3; font-size: 0.8rem;">${escapeHtml(log.reason)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Stage 3 Phase 2: Administrative Modals Handlers
// ---------------------------------------------------------------------------
function openAdminAssignModal(bookingId, slotId) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  const slot = booking ? booking.workerAssignments.find(s => s.slotId === slotId) : null;
  if (!booking || !slot) return;

  pendingAdminAssignBookingId = bookingId;
  pendingAdminAssignSlotId = slotId;
  selectedAdminCandidateProId = null;

  // Booking Summary
  const summaryEl = document.getElementById('admin-assign-booking-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div><strong>Booking:</strong> ${booking.id} — ${booking.serviceTitle}</div>
      <div><strong>Customer:</strong> ${booking.customerName} (${booking.neighborhoodName})</div>
      <div><strong>Timing:</strong> ${booking.timingType === 'asap' ? 'ASAP (On-Demand)' : `${booking.scheduledDate} at ${booking.scheduledTime || 'TBD'}`}</div>
      <div><strong>Position:</strong> ${slot.roleTitle} (Worker Payout: $${slot.payout.toFixed(2)})</div>
    `;
  }

  // Candidates List
  const candidatesContainer = document.getElementById('admin-assign-candidates-list');
  const candidates = getProCandidatesForSlot(bookingId, slotId);

  if (candidatesContainer) {
    candidatesContainer.innerHTML = candidates.map(c => {
      const pro = c.pro;
      const isEligible = c.eligible;
      return `
        <label class="candidate-pro-card ${isEligible ? 'eligible' : 'ineligible'}" style="display: flex; gap: 12px; align-items: center;">
          <input type="radio" name="adminCandidatePro" value="${pro.id}" ${isEligible ? '' : 'disabled'}>
          <div style="font-size: 1.4rem;">${pro.avatar || '👷'}</div>
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="color: var(--primary-navy);">${pro.name}</strong>
              <span class="tier-badge ${pro.tier.toLowerCase()}">${pro.tier}</span>
              <span style="font-size: 0.78rem; color: var(--text-muted);">⭐ ${pro.rating} (${pro.reviewCount} reviews)</span>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">
              📍 ${pro.homeNeighborhood} • Reliability: ${pro.reliabilityScore}%
            </div>
            <div style="font-size: 0.75rem; margin-top: 4px;">
              ${isEligible
                ? `<span style="color: #059669; font-weight: 700;">✓ Eligible and verified for this slot</span>`
                : `<span style="color: #DC2626; font-weight: 600;">✕ Disqualified: ${c.reason}</span>`
              }
            </div>
          </div>
        </label>
      `;
    }).join('');

    candidatesContainer.querySelectorAll('input[name="adminCandidatePro"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        selectedAdminCandidateProId = e.target.value;
        updateAdminAssignConfirmButtonState();
      });
    });
  }

  // Reset inputs
  const reasonInput = document.getElementById('input-admin-assign-reason');
  if (reasonInput) reasonInput.value = '';

  const confirmCheck = document.getElementById('check-admin-assign-confirm');
  if (confirmCheck) confirmCheck.checked = false;

  updateAdminAssignConfirmButtonState();

  const modal = document.getElementById('admin-assign-modal');
  if (modal) modal.classList.add('open');
}

function updateAdminAssignConfirmButtonState() {
  const confirmBtn = document.getElementById('btn-confirm-admin-assign');
  const confirmCheck = document.getElementById('check-admin-assign-confirm');
  const hasPro = !!selectedAdminCandidateProId;
  const isChecked = confirmCheck ? confirmCheck.checked : false;

  if (confirmBtn) {
    confirmBtn.disabled = !(hasPro && isChecked);
  }
}

function handleConfirmAdminAssign() {
  const reasonInput = document.getElementById('input-admin-assign-reason');
  const reason = (reasonInput ? reasonInput.value : '').trim();

  if (!selectedAdminCandidateProId) {
    showToast('Please select an eligible Pro to assign.', '⚠️');
    return;
  }
  if (!reason) {
    showToast('Administrative reason is required for dispatch record.', '⚠️');
    return;
  }

  const res = adminAssignPro(pendingAdminAssignBookingId, pendingAdminAssignSlotId, selectedAdminCandidateProId, reason);
  if (res.success) {
    showToast(`Successfully assigned worker to ${pendingAdminAssignSlotId}. Booking updated.`);
    const modal = document.getElementById('admin-assign-modal');
    if (modal) modal.classList.remove('open');
    renderAll();
  } else {
    showToast(res.error || 'Failed to assign Pro.', '⚠️');
  }
}

function openAdminUnassignModal(bookingId, slotId, proId, proName) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  const slot = booking ? booking.workerAssignments.find(s => s.slotId === slotId) : null;
  if (!booking || !slot) return;

  pendingAdminUnassignBookingId = bookingId;
  pendingAdminUnassignSlotId = slotId;
  pendingAdminUnassignProId = proId;
  pendingAdminUnassignProName = proName;

  const warningEl = document.getElementById('admin-unassign-warning-box');
  if (warningEl) {
    warningEl.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 4px;">Unassignment Notice:</div>
      <div>You are removing <strong>${proName}</strong> from the <strong>${slot.roleTitle}</strong> position on booking <strong>${booking.id}</strong>.</div>
      <div style="margin-top: 6px;">Worker's pending earnings credit of <strong>$${slot.payout.toFixed(2)}</strong> will be safely reversed. The position will reopen as unassigned on the Dallas Dispatch Board.</div>
    `;
  }

  const reasonInput = document.getElementById('input-admin-unassign-reason');
  if (reasonInput) reasonInput.value = '';

  const confirmCheck = document.getElementById('check-admin-unassign-confirm');
  if (confirmCheck) confirmCheck.checked = false;

  const confirmBtn = document.getElementById('btn-confirm-admin-unassign');
  if (confirmBtn) confirmBtn.disabled = true;

  const modal = document.getElementById('admin-unassign-modal');
  if (modal) modal.classList.add('open');
}

function handleConfirmAdminUnassign() {
  const reasonInput = document.getElementById('input-admin-unassign-reason');
  const reason = (reasonInput ? reasonInput.value : '').trim();

  if (!reason) {
    showToast('Administrative reason is required for worker unassignment.', '⚠️');
    return;
  }

  const res = adminUnassignPro(pendingAdminUnassignBookingId, pendingAdminUnassignSlotId, pendingAdminUnassignProId, reason);
  if (res.success) {
    showToast(`Worker unassigned. Pending earnings reversed and position reopened.`);
    const modal = document.getElementById('admin-unassign-modal');
    if (modal) modal.classList.remove('open');
    renderAll();
  } else {
    showToast(res.error || 'Failed to unassign worker.', '⚠️');
  }
}

// ---------------------------------------------------------------------------
// Stage 3.5: Admin Booking Cancellation & Verified Completion Modals
// ---------------------------------------------------------------------------
function openAdminCancelModal(bookingId) {
  const state = loadState();
  const booking = (state.bookings || []).find(b => b.id === bookingId);
  if (!booking) return;

  const check = canBookingBeCancelled(booking);
  if (!check.allowed) {
    showToast(check.reason, '⚠️');
    return;
  }

  pendingAdminCancelBookingId = bookingId;

  const summaryEl = document.getElementById('admin-cancel-summary-box');
  if (summaryEl) {
    const assignedSlots = (booking.workerAssignments || []).filter(s => s.status !== 'unassigned');
    const totalPendingReversed = assignedSlots.reduce((sum, s) => sum + (s.payout || 0), 0);
    const workerListHtml = assignedSlots.length > 0
      ? `<ul style="margin: 6px 0 0 16px; padding: 0;">` +
        assignedSlots.map(s => `<li><strong>${escapeHtml(s.assignedProName || 'Pro')}</strong> (${escapeHtml(s.roleTitle)}): $${(s.payout || 0).toFixed(2)} pending</li>`).join('') +
        `</ul>`
      : `<span style="font-style: italic;">No workers currently assigned.</span>`;

    summaryEl.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 4px;">Cancellation Confirmation for Booking ${escapeHtml(booking.id)}</div>
      <div><strong>Service:</strong> ${escapeHtml(booking.serviceTitle)} | <strong>Customer:</strong> ${escapeHtml(booking.customerName)} (${escapeHtml(booking.neighborhoodName)})</div>
      <div><strong>Current Status:</strong> <span style="text-transform: capitalize;">${escapeHtml(booking.overallStatus.replace(/_/g, ' '))}</span> | <strong>Timing:</strong> ${booking.timingType === 'asap' ? 'ASAP' : escapeHtml(booking.scheduledDate + ' ' + (booking.scheduledTime || ''))}</div>
      <div style="margin-top: 8px; border-top: 1px dashed rgba(220,38,38,0.3); padding-top: 8px;">
        <strong>Assigned Pros Subject to Pending Earnings Reversal (${assignedSlots.length}):</strong>
        ${workerListHtml}
        <div style="margin-top: 6px; font-weight: 700; color: #991B1B;">
          Total Pending Payout Reversal: $${totalPendingReversed.toFixed(2)}
        </div>
      </div>
    `;
  }

  const reasonInput = document.getElementById('input-admin-cancel-reason');
  if (reasonInput) reasonInput.value = '';

  const confirmCheck = document.getElementById('check-admin-cancel-confirm');
  if (confirmCheck) confirmCheck.checked = false;

  const confirmBtn = document.getElementById('btn-confirm-admin-cancel');
  if (confirmBtn) confirmBtn.disabled = true;

  const modal = document.getElementById('modal-admin-cancel-booking');
  if (modal) modal.classList.add('open');
}

function closeAdminCancelModal() {
  const modal = document.getElementById('modal-admin-cancel-booking');
  if (modal) modal.classList.remove('open');
  pendingAdminCancelBookingId = null;
}

function handleConfirmAdminCancel() {
  if (!pendingAdminCancelBookingId) return;

  const reasonInput = document.getElementById('input-admin-cancel-reason');
  const reason = (reasonInput ? reasonInput.value : '').trim();

  if (!reason) {
    showToast('Administrative reason is required for booking cancellation.', '⚠️');
    return;
  }

  const confirmCheck = document.getElementById('check-admin-cancel-confirm');
  if (!confirmCheck || !confirmCheck.checked) {
    showToast('Please confirm the cancellation authorization checkbox.', '⚠️');
    return;
  }

  const res = adminCancelBooking(pendingAdminCancelBookingId, reason, {
    adminId: 'admin_demo_01',
    adminName: 'Admin Dispatcher (Demo)'
  });

  if (res.success) {
    showToast(`Booking ${pendingAdminCancelBookingId} cancelled. Pending payouts reversed and customer notified.`);
    closeAdminCancelModal();
    renderAll();
  } else {
    showToast(res.error || 'Failed to cancel booking.', '⚠️');
  }
}

function openAdminVerifyCompleteModal(bookingId, slotId, proId, proName) {
  const state = loadState();
  const booking = (state.bookings || []).find(b => b.id === bookingId);
  const slot = booking ? (booking.workerAssignments || []).find(s => s.slotId === slotId) : null;
  if (!booking || !slot) return;

  const check = canSlotBeAdminCompleted(booking, slot);
  if (!check.allowed) {
    showToast(check.reason, '⚠️');
    return;
  }

  pendingAdminVerifyBookingId = bookingId;
  pendingAdminVerifySlotId = slotId;
  pendingAdminVerifyProId = proId;
  pendingAdminVerifyProName = proName;

  const summaryEl = document.getElementById('admin-verify-summary-box');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 4px;">Job Completion Verification for ${escapeHtml(proName)}</div>
      <div><strong>Booking:</strong> ${escapeHtml(booking.id)} — ${escapeHtml(booking.serviceTitle)}</div>
      <div><strong>Customer:</strong> ${escapeHtml(booking.customerName)} (${escapeHtml(booking.neighborhoodName)})</div>
      <div><strong>Position:</strong> ${escapeHtml(slot.roleTitle)} | <strong>Worker Payout:</strong> $${(slot.payout || 0).toFixed(2)}</div>
      <div style="margin-top: 8px; border-top: 1px dashed rgba(5,150,105,0.3); padding-top: 8px;">
        Releasing this payout will transition worker status from <strong>in_progress</strong> to <strong>completed</strong>, transfer <strong>$${(slot.payout || 0).toFixed(2)}</strong> from pending to available balance, and record an earnings credit.
      </div>
    `;
  }

  const explanationInput = document.getElementById('input-admin-verify-explanation');
  if (explanationInput) explanationInput.value = '';

  const confirmCheck = document.getElementById('check-admin-verify-confirm');
  if (confirmCheck) confirmCheck.checked = false;

  const confirmBtn = document.getElementById('btn-confirm-admin-verify');
  if (confirmBtn) confirmBtn.disabled = true;

  const modal = document.getElementById('modal-admin-verify-complete');
  if (modal) modal.classList.add('open');
}

function closeAdminVerifyCompleteModal() {
  const modal = document.getElementById('modal-admin-verify-complete');
  if (modal) modal.classList.remove('open');
  const confirmCheck = document.getElementById('check-admin-verify-confirm');
  if (confirmCheck) confirmCheck.checked = false;
  const confirmBtn = document.getElementById('btn-confirm-admin-verify');
  if (confirmBtn) confirmBtn.disabled = true;
  pendingAdminVerifyBookingId = null;
  pendingAdminVerifySlotId = null;
  pendingAdminVerifyProId = null;
  pendingAdminVerifyProName = null;
}

function handleConfirmAdminVerify() {
  if (!pendingAdminVerifyBookingId || !pendingAdminVerifySlotId || !pendingAdminVerifyProId) return;

  const sourceSelect = document.getElementById('select-admin-verify-source');
  const source = sourceSelect ? sourceSelect.value : 'Customer Direct Phone Confirmation (Demo Simulation)';

  const explanationInput = document.getElementById('input-admin-verify-explanation');
  const explanation = (explanationInput ? explanationInput.value : '').trim();

  if (!explanation) {
    showToast('Documented verification notes and explanation are required.', '⚠️');
    return;
  }

  const confirmCheck = document.getElementById('check-admin-verify-confirm');
  const isConfirmed = !!(confirmCheck && confirmCheck.checked);
  if (!isConfirmed) {
    showToast('Affirmative confirmation checkbox is required to verify completion.', '⚠️');
    return;
  }

  const res = adminVerifyAndCompleteAssignment(
    pendingAdminVerifyBookingId,
    pendingAdminVerifySlotId,
    pendingAdminVerifyProId,
    {
      source: source,
      verificationSource: source,
      explanation: explanation,
      confirmed: isConfirmed
    },
    {
      adminId: 'admin_demo_01',
      adminName: 'Admin Dispatcher (Demo)'
    }
  );

  if (res.success) {
    showToast(`Assignment completed and $${(res.payoutDollars || 0).toFixed(2)} earnings released to ${pendingAdminVerifyProName}.`);
    closeAdminVerifyCompleteModal();
    renderAll();
  } else {
    showToast(res.error || 'Failed to verify assignment completion.', '⚠️');
  }
}

function openSupportCaseForBooking(bookingId, customerId, subjectPrefix, initialNote) {
  const state = loadState();
  const booking = (state.bookings || []).find(b => b.id === bookingId);
  const bookingSelect = document.getElementById('select-case-booking');
  if (bookingSelect) {
    const activeBookings = (state.bookings || []).filter(b => b.overallStatus !== 'cancelled');
    bookingSelect.innerHTML = `<option value="">None / General Marketplace</option>` +
      activeBookings.map(b => `<option value="${b.id}" ${b.id === bookingId ? 'selected' : ''}>${b.id} — ${b.serviceTitle} (${b.customerName})</option>`).join('');
    bookingSelect.value = bookingId || '';
  }

  const catSelect = document.getElementById('select-case-category');
  if (catSelect) catSelect.value = 'support';

  const prioSelect = document.getElementById('select-case-priority');
  if (prioSelect) prioSelect.value = 'high';

  const typeSelect = document.getElementById('select-case-issuetype');
  if (typeSelect) typeSelect.value = 'cancellation_request';

  const titleInput = document.getElementById('input-case-title');
  if (titleInput) titleInput.value = `${subjectPrefix} - ${booking ? booking.serviceTitle : bookingId}`;

  const noteInput = document.getElementById('input-case-initial-note');
  if (noteInput) noteInput.value = initialNote || '';

  const confirmCheck = document.getElementById('check-create-case-confirm');
  if (confirmCheck) confirmCheck.checked = true;

  const submitBtn = document.getElementById('btn-submit-create-case');
  if (submitBtn) submitBtn.disabled = false;

  const createCaseModal = document.getElementById('modal-admin-create-case');
  if (createCaseModal) createCaseModal.classList.add('open');
}

// ---------------------------------------------------------------------------
// Stage 3 Phase 3: Worker Directory & Availability Inspection
// ---------------------------------------------------------------------------
function renderAdminWorkers() {
  const state = loadState();
  const summary = getProDirectorySummary(state);
  if (!summary) return;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('admin-workers-stat-registered', summary.registeredProsCount);
  setEl('admin-workers-stat-available-today', summary.availableProsTodayCount);
  setEl('admin-workers-stat-today-name', `Dallas Local Day: ${summary.todayName.toUpperCase()}`);

  const totalActiveAssignments = summary.pros.reduce((acc, p) => acc + p.activeAssignmentsCount, 0);
  setEl('admin-workers-stat-active-assignments', totalActiveAssignments);

  // Populate Booking Eligibility Inspector dropdown
  const bookingSelect = document.getElementById('admin-inspector-booking-select');
  const detailsContainer = document.getElementById('admin-inspector-booking-details');
  if (bookingSelect) {
    const activeBookings = (state.bookings || []).filter(b => b.overallStatus !== 'completed' && b.overallStatus !== 'cancelled');
    const prevSelected = bookingSelect.value;
    bookingSelect.innerHTML = activeBookings.map(b =>
      `<option value="${b.id}" ${b.id === prevSelected ? 'selected' : ''}>${b.id} — ${b.serviceTitle} (${b.customerName})</option>`
    ).join('');

    const currentBookingId = bookingSelect.value || (activeBookings[0] ? activeBookings[0].id : null);
    if (currentBookingId && detailsContainer) {
      detailsContainer.style.display = 'block';
      const booking = state.bookings.find(b => b.id === currentBookingId);
      if (booking) {
        const slotsHtml = (booking.workerAssignments || []).map(s => {
          const isFilled = s.status !== 'unassigned';
          return `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; background: ${isFilled ? '#ECFDF5' : '#FEF3C7'}; color: ${isFilled ? '#065F46' : '#92400E'}; border: 1px solid ${isFilled ? '#A7F3D0' : '#FDE68A'}; margin-right: 6px;">
            ${escapeHtml(s.roleTitle)}: ${isFilled ? 'Assigned (' + escapeHtml(s.assignedProName) + ')' : 'Vacant'}
          </span>`;
        }).join('');

        // Evaluate all 4 Pros for this booking
        const evaluations = summary.pros.map(pro => {
          const evalRes = getBookingProEligibility(booking.id, pro.id);
          return { pro, evalRes };
        });

        detailsContainer.innerHTML = `
          <div style="background: #F8FAFC; border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: 12px; font-size: 0.82rem;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; margin-bottom: 6px;">
              <div>
                <strong style="color: var(--primary-navy); font-size: 0.9rem;">${escapeHtml(booking.serviceTitle)}</strong>
                <span style="color: var(--text-secondary); margin-left: 8px;">(${booking.id})</span>
              </div>
              <div>
                <span class="badge" style="background: #EEF2FF; color: #4338CA; border: 1px solid #C7D2FE; font-size: 0.72rem; padding: 2px 8px; border-radius: 10px; font-weight: 700;">
                  Customer: ${escapeHtml(booking.customerName)}
                </span>
              </div>
            </div>
            <div style="color: var(--text-secondary); font-size: 0.78rem; margin-bottom: 6px;">
              📍 ${escapeHtml(booking.address || 'Dallas, TX')} | 🗓️ ${booking.timingType === 'asap' ? 'ASAP Request' : (booking.scheduledDate + ' at ' + booking.scheduledTime)}
            </div>
            <div>${slotsHtml}</div>
          </div>

          <h4 style="margin: 0 0 8px 0; font-size: 0.82rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.4px;">
            Dallas Pro Eligibility Evaluation for ${booking.id}
          </h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px;">
            ${evaluations.map(({ pro, evalRes }) => {
              const isAssigned = evalRes.slotEvaluations.some(e => e.status === 'assigned' && e.reason.includes('Currently assigned'));
              let badgeColor = '#EF4444';
              let badgeBg = '#FEE2E2';
              let statusText = '✗ Ineligible';

              if (isAssigned) {
                badgeColor = '#4338CA';
                badgeBg = '#EEF2FF';
                statusText = '✓ Assigned to Job';
              } else if (evalRes.eligible) {
                badgeColor = '#059669';
                badgeBg = '#ECFDF5';
                statusText = '✓ Eligible for Slot';
              }

              return `
                <div style="background: white; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 8px 12px; font-size: 0.8rem;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <strong style="color: var(--primary-navy);">${escapeHtml(pro.name)}</strong>
                    <span style="font-size: 0.7rem; font-weight: 800; padding: 1px 6px; border-radius: 8px; background: ${badgeBg}; color: ${badgeColor};">
                      ${statusText}
                    </span>
                  </div>
                  <div style="font-size: 0.72rem; color: ${evalRes.eligible || isAssigned ? 'var(--text-secondary)' : '#DC2626'}; line-height: 1.3;">
                    ${escapeHtml(evalRes.primaryReason)}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }
    } else if (detailsContainer) {
      detailsContainer.style.display = 'none';
    }
  }

  // Populate Worker Roster Grid
  const rosterGrid = document.getElementById('admin-workers-roster-grid');
  if (rosterGrid) {
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    rosterGrid.innerHTML = summary.pros.map(pro => {
      const tierClass = (pro.tier || 'bronze').toLowerCase();
      const servicesPills = (pro.verifiedServices || []).map(s =>
        `<span class="worker-badge-pill verified">✓ ${escapeHtml(s)}</span>`
      ).join('');
      const equipPills = (pro.verifiedEquipment || []).map(eq =>
        `<span class="worker-badge-pill equipment">🛠️ ${escapeHtml(eq)}</span>`
      ).join('');
      const zipPills = (pro.serviceAreaPreferences || []).map(z =>
        `<span style="display: inline-block; padding: 1px 5px; font-size: 0.68rem; background: #F1F5F9; border-radius: 3px; color: var(--text-secondary); margin-right: 3px;">${z}</span>`
      ).join('');

      const availabilityGridHtml = dayKeys.map((key, idx) => {
        const isToday = key === summary.todayName;
        const isEnabled = pro.weeklyAvailability && pro.weeklyAvailability[key] && pro.weeklyAvailability[key].enabled;
        return `
          <div class="worker-day-cell ${isEnabled ? 'active-day' : ''} ${isToday ? 'today-cell' : ''}">
            <div style="font-weight: ${isToday ? '800' : '600'};">${dayLabels[idx]}</div>
            <div style="font-size: 0.6rem;">${isEnabled ? 'ON' : 'OFF'}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="worker-card">
          <div class="worker-card-header">
            <div class="worker-identity">
              <div class="worker-avatar">${pro.avatar || '👷'}</div>
              <div>
                <h3 style="margin: 0 0 2px 0; font-size: 1.05rem; color: var(--primary-navy);">${escapeHtml(pro.name)}</h3>
                <span class="worker-tier-badge ${tierClass}">${escapeHtml(pro.tier)} Tier</span>
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700; color: #F59E0B; font-size: 0.95rem;">
                ★ ${pro.rating ? pro.rating.toFixed(1) : '5.0'}
              </div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">${pro.reviewCount} verified reviews</div>
            </div>
          </div>

          <div style="display: flex; gap: 8px; align-items: center; font-size: 0.78rem;">
            <span style="background: #ECFDF5; color: #065F46; padding: 2px 8px; border-radius: 10px; font-weight: 700;">
              ${pro.reliabilityScore}% Reliability
            </span>
            <span style="color: var(--text-muted);">|</span>
            <span style="color: ${pro.isAvailableToday ? '#059669' : 'var(--text-muted)'}; font-weight: 600;">
              ${pro.isAvailableToday ? '● ' + pro.todayHours : '○ Off Duty Today'}
            </span>
          </div>

          <div>
            <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 6px;">
              Verified Service Qualifications
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${servicesPills}
            </div>
          </div>

          <div>
            <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 6px;">
              Verified Equipment & Credentials
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${equipPills}
              <span class="worker-badge-pill" style="background: #F0FDF4; color: #166534; border-color: #86EFAC;">🛡️ TX DPS Check Passed</span>
            </div>
          </div>

          <div>
            <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 6px;">
              Weekly Availability Schedule
            </div>
            <div class="worker-availability-grid">
              ${availabilityGridHtml}
            </div>
          </div>

          <div style="background: #F8FAFC; border-radius: var(--radius-sm); padding: 8px 12px; font-size: 0.78rem; display: flex; justify-content: space-between;">
            <div><strong>Active Workload:</strong> ${pro.activeAssignmentsCount} tasks</div>
            <div><strong>Completed Jobs:</strong> ${pro.completedJobsCount} jobs</div>
          </div>

          <div>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 4px;">Dallas Pilot ZIP Territory:</div>
            <div>${zipPills}</div>
          </div>

          <div style="font-size: 0.68rem; color: var(--text-muted); font-style: italic; border-top: 1px solid var(--border-light); padding-top: 8px;">
            ⚠️ Demonstration Profile — Credentials & equipment simulated for INSY 3331.
          </div>
        </div>
      `;
    }).join('');
  }
}

// ---------------------------------------------------------------------------
// Stage 3 Phase 3: Customer Support Case Management
// ---------------------------------------------------------------------------
let currentActiveCaseId = null;

function renderAdminSupport() {
  const state = loadState();
  const cases = state.supportCases || [];

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  const totalCount = cases.length;
  const openCount = cases.filter(c => c.status === 'open').length;
  const reviewCount = cases.filter(c => c.status === 'under_review').length;
  const resolvedCount = cases.filter(c => c.status === 'resolved').length;

  setEl('admin-support-stat-total', totalCount);
  setEl('admin-support-stat-open', openCount);
  setEl('admin-support-stat-review', reviewCount);
  setEl('admin-support-stat-resolved', resolvedCount);

  const searchInput = document.getElementById('admin-support-search');
  const statusFilter = document.getElementById('admin-support-filter-status');
  const priorityFilter = document.getElementById('admin-support-filter-priority');

  const searchTerm = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const selectedStatus = (statusFilter && statusFilter.value) ? statusFilter.value : 'all';
  const selectedPriority = (priorityFilter && priorityFilter.value) ? priorityFilter.value : 'all';

  let filtered = cases;
  if (selectedStatus !== 'all') {
    filtered = filtered.filter(c => c.status === selectedStatus);
  }
  if (selectedPriority !== 'all') {
    filtered = filtered.filter(c => c.priority === selectedPriority);
  }
  if (searchTerm) {
    filtered = filtered.filter(c =>
      (c.caseId || '').toLowerCase().includes(searchTerm) ||
      (c.title || '').toLowerCase().includes(searchTerm) ||
      (c.bookingId || '').toLowerCase().includes(searchTerm) ||
      (c.customerId || '').toLowerCase().includes(searchTerm)
    );
  }

  const container = document.getElementById('admin-support-cases-list');
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="background: white; border-radius: var(--radius-md); padding: 36px 20px; text-align: center; border: 1px solid var(--border-light); color: var(--text-muted); font-size: 0.88rem;">
        No support cases matching the current filters.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(c => {
    const latestNote = c.notes && c.notes.length > 0 ? c.notes[c.notes.length - 1] : null;
    const priorityClass = (c.priority || 'medium').toLowerCase();
    const statusClass = (c.status || 'open').toLowerCase();
    const dateFormatted = c.createdAt ? new Date(c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

    return `
      <div class="support-case-card">
        <div style="flex: 1;">
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap;">
            <code style="font-weight: 800; font-size: 0.82rem; background: #EEF2FF; color: #4338CA; padding: 2px 8px; border-radius: 4px;">${c.caseId}</code>
            <span class="case-priority-badge ${priorityClass}">${c.priority}</span>
            <span class="case-status-badge ${statusClass}">${(c.status || 'open').replace('_', ' ')}</span>
            <span style="font-size: 0.75rem; color: var(--text-muted);">Created: ${dateFormatted}</span>
          </div>

          <h3 style="margin: 0 0 6px 0; font-size: 1rem; color: var(--primary-navy);">
            ${escapeHtml(c.title)}
          </h3>

          <div style="display: flex; gap: 14px; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 8px; flex-wrap: wrap;">
            <span><strong>Booking:</strong> ${c.bookingId ? `<code style="background: #F1F5F9; padding: 1px 5px; border-radius: 3px;">${c.bookingId}</code>` : 'None / General'}</span>
            <span><strong>Customer:</strong> ${c.customerId ? escapeHtml(c.customerId) : 'Marketplace'}</span>
            <span><strong>Issue:</strong> ${escapeHtml(c.issueType || 'General')}</span>
          </div>

          ${latestNote ? `
            <div style="background: #F8FAFC; border-left: 3px solid var(--primary-teal); padding: 8px 12px; border-radius: var(--radius-sm); font-size: 0.78rem; color: var(--text-primary);">
              <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px;">
                <span>🔒 <strong>${escapeHtml(latestNote.author)}</strong></span>
                <span>${latestNote.timestamp ? new Date(latestNote.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </div>
              <div style="line-height: 1.3;">${escapeHtml(latestNote.text)}</div>
            </div>
          ` : ''}
        </div>

        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
          <button class="btn btn-primary btn-open-case-detail" data-case-id="${c.caseId}" style="padding: 6px 14px; font-size: 0.8rem; background: var(--primary-navy); color: white; border: none; border-radius: var(--radius-sm); cursor: pointer; white-space: nowrap;">
            Inspect Case →
          </button>
          <span style="font-size: 0.72rem; color: var(--text-muted);">${c.notes ? c.notes.length : 0} internal notes</span>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-open-case-detail').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const caseId = e.currentTarget.getAttribute('data-case-id');
      if (caseId) openCaseDetailModal(caseId);
    });
  });
}

function openCaseDetailModal(caseId) {
  const state = loadState();
  const targetCase = (state.supportCases || []).find(c => c.caseId === caseId);
  if (!targetCase) return;

  currentActiveCaseId = caseId;
  const modal = document.getElementById('modal-admin-case-detail');
  if (!modal) return;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('case-detail-badge-id', targetCase.caseId);
  setEl('case-detail-title', targetCase.title);
  setEl('case-detail-booking-id', targetCase.bookingId || 'None / General');
  setEl('case-detail-customer-name', targetCase.customerId || 'Marketplace');
  setEl('case-detail-issue-type', targetCase.issueType || 'General');
  setEl('case-detail-created-at', targetCase.createdAt ? new Date(targetCase.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

  const statusBadge = document.getElementById('case-detail-badge-status');
  if (statusBadge) {
    statusBadge.textContent = (targetCase.status || 'open').toUpperCase().replace('_', ' ');
    statusBadge.className = `case-status-badge ${(targetCase.status || 'open').toLowerCase()}`;
  }

  const priorityBadge = document.getElementById('case-detail-badge-priority');
  if (priorityBadge) {
    priorityBadge.textContent = (targetCase.priority || 'medium').toUpperCase();
    priorityBadge.className = `case-priority-badge ${(targetCase.priority || 'medium').toLowerCase()}`;
  }

  const statusSelect = document.getElementById('case-detail-select-status');
  if (statusSelect) {
    statusSelect.value = targetCase.status;
  }

  const reasonInput = document.getElementById('case-detail-status-reason');
  if (reasonInput) reasonInput.value = '';

  const noteInput = document.getElementById('input-case-detail-new-note');
  if (noteInput) noteInput.value = '';

  renderCaseDetailNotesTimeline(targetCase);
  modal.classList.add('open');
}

function renderCaseDetailNotesTimeline(targetCase) {
  const timeline = document.getElementById('case-detail-notes-timeline');
  if (!timeline) return;

  if (!targetCase.notes || targetCase.notes.length === 0) {
    timeline.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 12px;">No internal notes recorded yet.</div>`;
    return;
  }

  timeline.innerHTML = targetCase.notes.map(n => {
    const timeStr = n.timestamp ? new Date(n.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="case-note-item">
        <div class="case-note-meta">
          <strong>🔒 ${escapeHtml(n.author)}</strong>
          <span>${timeStr}</span>
        </div>
        <div style="line-height: 1.35; color: var(--text-primary);">${escapeHtml(n.text)}</div>
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// Stage 3 Phase 3: Financial Operations & Master Platform Ledger
// ---------------------------------------------------------------------------
function renderAdminFinance() {
  const state = loadState();
  const fin = getAdminFinancialSummary(state);
  if (!fin) return;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('admin-fin-panel-projected-gbv', `$${fin.projectedGrossBookingValue}`);
  setEl('admin-fin-panel-completed-gbv', `$${fin.completedGrossBookingValue}`);
  setEl('admin-fin-panel-fees', `$${fin.totalBookingFees}`);
  setEl('admin-fin-panel-worker-comp', `$${fin.totalWorkerCompensation}`);
  setEl('admin-fin-panel-completed-margin', `$${fin.completedGrossMargin || '0.00'}`);
  setEl('admin-fin-panel-projected-margin', `$${fin.projectedGrossMargin || '0.00'}`);
  setEl('admin-fin-panel-total-margin', `$${fin.platformGrossMargin}`);
  setEl('admin-fin-panel-cashouts', `$${fin.totalSimulatedCashouts}`);
  setEl('admin-fin-panel-cashouts-count', `${fin.instantCashoutCount + fin.standardCashoutCount} simulated withdrawals ($${fin.totalCashoutFees} fees)`);

  // Populate Pro Wallets Summary Table
  const prosTableBody = document.getElementById('admin-finance-pros-table-body');
  if (prosTableBody) {
    prosTableBody.innerHTML = (state.pros || []).map(pro => {
      const avail = pro.earnings ? pro.earnings.availableBalance : 0;
      const pend = pro.earnings ? pro.earnings.pendingBalance : 0;
      const life = pro.earnings ? pro.earnings.lifetimeEarned : 0;
      const txs = pro.earnings ? (pro.earnings.walletTransactions || []) : [];
      const cashoutsCount = txs.filter(t => t.type === 'cashout_instant' || t.type === 'cashout_standard').length;
      const tierClass = (pro.tier || 'bronze').toLowerCase();

      return `
        <tr style="border-bottom: 1px solid var(--border-light);">
          <td style="padding: 10px 14px; font-weight: 600; color: var(--primary-navy);">
            ${escapeHtml(pro.name)}
          </td>
          <td style="padding: 10px 14px;">
            <span class="worker-tier-badge ${tierClass}">${escapeHtml(pro.tier)}</span>
          </td>
          <td style="padding: 10px 14px; font-weight: 700; color: #059669;">
            $${avail.toFixed(2)}
          </td>
          <td style="padding: 10px 14px; font-weight: 700; color: #D97706;">
            $${pend.toFixed(2)}
          </td>
          <td style="padding: 10px 14px; font-weight: 700; color: var(--primary-navy);">
            $${life.toFixed(2)}
          </td>
          <td style="padding: 10px 14px;">
            ${cashoutsCount} withdrawals
          </td>
          <td style="padding: 10px 14px;">
            <span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 8px; background: #ECFDF5; color: #059669; font-weight: 700;">ACTIVE</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Populate Master Platform Transaction Ledger
  const ledgerTableBody = document.getElementById('admin-finance-ledger-table-body');
  const typeFilter = document.getElementById('admin-finance-ledger-filter-type');
  const selectedType = (typeFilter && typeFilter.value) ? typeFilter.value : 'all';

  if (ledgerTableBody) {
    let allTransactions = [];
    (state.pros || []).forEach(pro => {
      if (pro.earnings && Array.isArray(pro.earnings.walletTransactions)) {
        pro.earnings.walletTransactions.forEach(tx => {
          allTransactions.push({
            ...tx,
            proName: pro.name,
            proId: pro.id
          });
        });
      }
    });

    // Sort descending by timestamp
    allTransactions.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    if (selectedType !== 'all') {
      allTransactions = allTransactions.filter(t => t.type === selectedType);
    }

    if (allTransactions.length === 0) {
      ledgerTableBody.innerHTML = `
        <tr>
          <td colspan="10" style="padding: 24px; text-align: center; color: var(--text-muted);">
            No wallet transactions found for filter "${selectedType}".
          </td>
        </tr>
      `;
      return;
    }

    ledgerTableBody.innerHTML = allTransactions.map(tx => {
      const timeStr = tx.timestamp ? new Date(tx.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      const grossStr = `$${centsToDollars(tx.amountCents || 0)}`;
      const feeStr = `$${centsToDollars(tx.feeCents || 0)}`;
      const netCents = tx.netAmountCents !== undefined ? tx.netAmountCents : (tx.amountCents || 0);
      const netStr = `$${centsToDollars(netCents)}`;
      const isCashout = tx.type === 'cashout_instant' || tx.type === 'cashout_standard';

      let typeBadge = `<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: #F1F5F9; color: var(--text-secondary);">${escapeHtml(tx.type)}</span>`;
      if (tx.type === 'earnings_credit') {
        typeBadge = `<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: #ECFDF5; color: #047857; font-weight: 700;">Earnings Credit</span>`;
      } else if (tx.type === 'cashout_instant') {
        typeBadge = `<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: #FEF3C7; color: #B45309; font-weight: 700;">Instant Cash-Out</span>`;
      } else if (tx.type === 'cashout_standard') {
        typeBadge = `<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: #EFF6FF; color: #1E40AF; font-weight: 700;">Standard ACH</span>`;
      } else if (tx.type === 'opening_balance_snapshot') {
        typeBadge = `<span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: #F3E8FF; color: #7E22CE;">Opening Snapshot</span>`;
      }

      return `
        <tr style="border-bottom: 1px solid var(--border-light);">
          <td style="padding: 10px 14px; white-space: nowrap; font-family: monospace; font-size: 0.75rem;">${timeStr}</td>
          <td style="padding: 10px 14px; font-weight: 600;">${escapeHtml(tx.proName)}</td>
          <td style="padding: 10px 14px;"><code style="font-size: 0.75rem; background: #F1F5F9; padding: 1px 5px; border-radius: 3px;">${escapeHtml(tx.id || tx.transactionId || '—')}</code></td>
          <td style="padding: 10px 14px;">${typeBadge}</td>
          <td style="padding: 10px 14px; font-size: 0.78rem;">${escapeHtml(tx.bookingId || tx.requestId || '—')}</td>
          <td style="padding: 10px 14px; font-weight: 600;">${grossStr}</td>
          <td style="padding: 10px 14px; color: ${tx.feeCents ? '#DC2626' : 'var(--text-muted)'};">${feeStr}</td>
          <td style="padding: 10px 14px; font-weight: 700; color: #059669;">${netStr}</td>
          <td style="padding: 10px 14px; font-size: 0.72rem;">${escapeHtml(tx.status || 'confirmed')}</td>
          <td style="padding: 10px 14px;">
            ${isCashout ? `<button class="btn btn-receipt-view" data-pro-id="${tx.proId}" data-tx-id="${tx.id || tx.transactionId}" style="padding: 2px 8px; font-size: 0.72rem; background: #F8FAFC; border: 1px solid var(--border-light); border-radius: 4px; cursor: pointer;">Receipt</button>` : '—'}
          </td>
        </tr>
      `;
    }).join('');

    ledgerTableBody.querySelectorAll('.btn-receipt-view').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const proId = e.currentTarget.getAttribute('data-pro-id');
        const txId = e.currentTarget.getAttribute('data-tx-id');
        if (proId && txId) {
          openReceiptModalForTransaction(proId, txId);
        }
      });
    });
  }
}

function openReceiptModalForTransaction(proId, txId) {
  const state = loadState();
  const pro = state.pros.find(p => p.id === proId);
  if (!pro || !pro.earnings) return;

  const tx = (pro.earnings.walletTransactions || []).find(t => (t.id || t.transactionId) === txId);
  if (!tx) return;

  const modal = document.getElementById('receipt-modal');
  if (!modal) return;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('receipt-id', tx.id || tx.transactionId);
  setEl('receipt-pro-name', pro.name);
  setEl('receipt-method', tx.type === 'cashout_instant' ? 'Instant Debit Card Transfer' : 'Standard Bank Transfer (ACH)');
  setEl('receipt-gross', `$${centsToDollars(tx.amountCents || 0)}`);
  setEl('receipt-fee', `$${centsToDollars(tx.feeCents || 0)}`);
  setEl('receipt-net', `$${centsToDollars(tx.netAmountCents !== undefined ? tx.netAmountCents : tx.amountCents)}`);
  setEl('receipt-status', (tx.status || 'confirmed').toUpperCase());

  modal.classList.add('open');
}

// ---------------------------------------------------------------------------
// Stage 3 Phase 3: Trust & Safety Review Inspection & Dispute Management
// ---------------------------------------------------------------------------
let currentActiveTrustReview = null;

function renderAdminTrustSafety() {
  const state = loadState();
  const filterSelect = document.getElementById('admin-trust-filter-status');
  const selectedFilter = (filterSelect && filterSelect.value) ? filterSelect.value : 'all';

  let allReviews = [];
  (state.bookings || []).forEach(b => {
    if (Array.isArray(b.workerReviews)) {
      b.workerReviews.forEach(r => {
        allReviews.push({
          ...r,
          bookingId: b.id,
          customerName: b.customerName || 'Customer',
          customerId: b.customerId,
          serviceTitle: b.serviceTitle
        });
      });
    }
  });

  if (selectedFilter === 'undisputed') {
    allReviews = allReviews.filter(r => !r.disputed);
  } else if (selectedFilter === 'disputed') {
    allReviews = allReviews.filter(r => r.disputed && r.disputeStatus !== 'dispute_resolved' && r.disputeStatus !== 'verified_valid');
  } else if (selectedFilter === 'resolved') {
    allReviews = allReviews.filter(r => r.disputeStatus === 'dispute_resolved' || r.disputeStatus === 'verified_valid');
  }

  const container = document.getElementById('admin-trust-reviews-list');
  if (!container) return;

  if (allReviews.length === 0) {
    container.innerHTML = `
      <div style="background: white; border-radius: var(--radius-md); padding: 36px 20px; text-align: center; border: 1px solid var(--border-light); color: var(--text-muted); font-size: 0.88rem;">
        No customer reviews matching filter "${selectedFilter}".
      </div>
    `;
    return;
  }

  container.innerHTML = allReviews.map(r => {
    const starsStr = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
    let disputeBadge = `<span class="dispute-badge undisputed">Undisputed / Valid</span>`;
    if (r.disputed) {
      if (r.disputeStatus === 'dispute_resolved' || r.disputeStatus === 'verified_valid') {
        disputeBadge = `<span class="dispute-badge resolved">Resolved (${r.disputeCaseId || 'Case Closed'})</span>`;
      } else {
        disputeBadge = `<span class="dispute-badge under_investigation">Under Investigation (${r.disputeCaseId || 'Case Open'})</span>`;
      }
    }

    return `
      <div class="trust-review-card">
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; flex-wrap: wrap; gap: 8px;">
            <div>
              <strong style="color: var(--primary-navy); font-size: 0.95rem;">${escapeHtml(r.proName)}</strong>
              <span style="font-size: 0.8rem; color: var(--text-secondary); margin-left: 6px;">(${escapeHtml(r.roleTitle)})</span>
            </div>
            <div>${disputeBadge}</div>
          </div>

          <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 8px;">
            <span style="color: #F59E0B; font-size: 1.05rem; font-weight: 700;">${starsStr}</span>
            <span style="font-size: 0.78rem; color: var(--text-muted);">${r.date || '—'}</span>
            <span style="font-size: 0.78rem; color: var(--text-secondary);">Customer: <strong>${escapeHtml(r.customerName)}</strong></span>
            <span style="font-size: 0.78rem; color: var(--text-muted);">Booking: <code>${r.bookingId}</code></span>
          </div>

          <div style="font-style: italic; font-size: 0.83rem; color: var(--text-primary); line-height: 1.4; background: #F8FAFC; padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-light);">
            "${escapeHtml(r.comment || 'No comment provided.')}"
          </div>
        </div>

        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
          <button class="btn btn-primary btn-open-trust-detail" data-booking-id="${r.bookingId}" data-slot-id="${r.slotId}" style="padding: 6px 14px; font-size: 0.8rem; background: var(--primary-teal); color: white; border: none; border-radius: var(--radius-sm); cursor: pointer; white-space: nowrap;">
            ${r.disputed ? 'Inspect Investigation →' : 'Inspect / Dispute →'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-open-trust-detail').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bId = e.currentTarget.getAttribute('data-booking-id');
      const sId = e.currentTarget.getAttribute('data-slot-id');
      if (bId && sId) openTrustDetailModal(bId, sId);
    });
  });
}

function openTrustDetailModal(bookingId, slotId) {
  const state = loadState();
  const booking = (state.bookings || []).find(b => b.id === bookingId);
  if (!booking) return;

  const review = (booking.workerReviews || []).find(r => r.slotId === slotId);
  if (!review) return;

  currentActiveTrustReview = { bookingId, slotId, review };
  const modal = document.getElementById('modal-admin-trust-detail');
  if (!modal) return;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('trust-modal-pro-name', review.proName);
  setEl('trust-modal-role-title', review.roleTitle);
  setEl('trust-modal-stars', '★'.repeat(review.stars) + '☆'.repeat(5 - review.stars));
  setEl('trust-modal-original-stars', review.stars);
  setEl('trust-modal-comment', `"${review.comment}"`);
  setEl('trust-modal-date', review.date || '—');
  setEl('trust-modal-customer', booking.customerName || 'Customer');
  setEl('trust-modal-booking', booking.id);

  const actionContainer = document.getElementById('trust-dispute-action-container');
  if (!actionContainer) return;

  if (!review.disputed) {
    actionContainer.innerHTML = `
      <div style="background: white; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 14px 16px;">
        <h4 style="margin: 0 0 6px 0; font-size: 0.88rem; color: var(--primary-navy);">Flag Review for Trust & Safety Investigation</h4>
        <p style="margin: 0 0 10px 0; font-size: 0.78rem; color: var(--text-secondary);">
          If this review violates platform standards, is suspected of fraud, or is disputed by the worker, flag it for evidence-based review. Original stars remain intact.
        </p>
        <div class="form-group">
          <label class="form-label">Dispute Reason / Worker Statement (Required):</label>
          <textarea id="input-trust-dispute-reason" class="form-textarea" rows="2" placeholder="e.g. Worker contends customer requested out-of-scope tasks; requesting dispatch review."></textarea>
        </div>
        <button id="btn-submit-flag-dispute" class="btn btn-primary" style="padding: 8px 18px; font-size: 0.82rem; background: #D97706; color: white; border: none; border-radius: var(--radius-sm); cursor: pointer;">
          Flag Review as Disputed
        </button>
      </div>
    `;

    document.getElementById('btn-submit-flag-dispute')?.addEventListener('click', () => {
      const reasonInput = document.getElementById('input-trust-dispute-reason');
      const reason = (reasonInput ? reasonInput.value : '').trim();
      if (!reason) {
        showToast('Dispute reason is required.', '⚠️');
        return;
      }
      const res = flagReviewDispute(bookingId, slotId, reason);
      if (res.success) {
        showToast(`Review flagged as disputed. Case ${res.case.caseId} opened.`);
        openTrustDetailModal(bookingId, slotId);
        renderAdminTrustSafety();
        renderAdminSupport();
        renderAdminAuditTable();
      } else {
        showToast(res.error || 'Failed to flag dispute.', '⚠️');
      }
    });
  } else {
    const associatedCase = (state.supportCases || []).find(c => c.caseId === review.disputeCaseId);
    actionContainer.innerHTML = `
      <div style="background: white; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 14px 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h4 style="margin: 0; font-size: 0.88rem; color: var(--primary-navy);">
            Active Investigation: <code style="color: #4338CA;">${review.disputeCaseId || 'CASE-TS'}</code>
          </h4>
          <span class="dispute-badge ${review.disputeStatus === 'dispute_resolved' || review.disputeStatus === 'verified_valid' ? 'resolved' : 'under_investigation'}">
            ${(review.disputeStatus || 'under_investigation').replace('_', ' ').toUpperCase()}
          </span>
        </div>

        <div style="margin-bottom: 12px; font-size: 0.8rem;">
          <label class="form-label">Update Investigation Finding / Resolution:</label>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <select id="select-trust-resolution" class="form-select" style="font-size: 0.82rem; padding: 6px 10px;">
              <option value="under_investigation" ${review.disputeStatus === 'under_investigation' ? 'selected' : ''}>Under Investigation</option>
              <option value="verified_valid" ${review.disputeStatus === 'verified_valid' ? 'selected' : ''}>Verified Valid (Original Review Upheld)</option>
              <option value="dispute_resolved" ${review.disputeStatus === 'dispute_resolved' ? 'selected' : ''}>Dispute Resolved (Mutually Concluded)</option>
            </select>
          </div>
          <textarea id="input-trust-resolution-notes" class="form-textarea" rows="2" placeholder="Record investigation findings, evidence reviewed, and resolution rationale..."></textarea>
          <button id="btn-submit-trust-resolution" class="btn btn-primary" style="margin-top: 8px; padding: 6px 14px; font-size: 0.8rem; background: var(--primary-teal); color: white; border: none; border-radius: var(--radius-sm); cursor: pointer;">
            Save Investigation Finding
          </button>
        </div>

        ${associatedCase && associatedCase.notes && associatedCase.notes.length > 0 ? `
          <div style="border-top: 1px solid var(--border-light); padding-top: 10px;">
            <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px;">Investigation Notes History:</div>
            ${associatedCase.notes.map(n => `
              <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: 4px; padding: 6px 10px; margin-bottom: 4px; font-size: 0.75rem;">
                <div style="display: flex; justify-content: space-between; color: var(--text-muted); font-size: 0.68rem; margin-bottom: 2px;">
                  <span>${escapeHtml(n.author)}</span>
                  <span>${n.timestamp ? new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
                <div>${escapeHtml(n.text)}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;

    document.getElementById('btn-submit-trust-resolution')?.addEventListener('click', () => {
      const resolutionSelect = document.getElementById('select-trust-resolution');
      const notesInput = document.getElementById('input-trust-resolution-notes');
      const resVal = resolutionSelect ? resolutionSelect.value : 'under_investigation';
      const notesVal = (notesInput ? notesInput.value : '').trim();

      if (!notesVal) {
        showToast('Investigation findings or resolution notes are required.', '⚠️');
        return;
      }

      if (associatedCase) {
        const res = updateTrustCaseResolution(associatedCase.caseId, resVal, notesVal);
        if (res.success) {
          showToast(`Trust & Safety case updated: ${resVal.replace('_', ' ').toUpperCase()}`);
          openTrustDetailModal(bookingId, slotId);
          renderAdminTrustSafety();
          renderAdminSupport();
          renderAdminAuditTable();
        } else {
          showToast(res.error || 'Failed to update investigation.', '⚠️');
        }
      }
    });
  }

  modal.classList.add('open');
}

// ---------------------------------------------------------------------------
// Simulated Cash-Out Modal Handlers (Stage 2 Section 5 & 6)
// ---------------------------------------------------------------------------
function openCashoutModal() {
  const state = loadState();
  const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
  const modal = document.getElementById('cashout-modal');
  if (!modal) return;

  const subtitle = document.getElementById('cashout-modal-pro-subtitle');
  if (subtitle) {
    subtitle.textContent = `Dallas Pro Wallet Withdrawal Simulation (${activePro.name})`;
  }

  const available = activePro.earnings?.availableBalance || 0;
  const amountDisplay = document.getElementById('cashout-modal-amount');
  if (amountDisplay) {
    amountDisplay.textContent = `$${available.toFixed(2)}`;
  }

  const amountInput = document.getElementById('input-cashout-amount');
  if (amountInput) {
    amountInput.value = available > 0 ? available.toFixed(2) : '0.00';
    amountInput.max = available;
  }

  // Reset instant method as checked by default
  const instantRadio = document.querySelector('input[name="cashoutMethod"][value="instant"]');
  if (instantRadio) instantRadio.checked = true;

  updateCashoutCalculationPreview();
  modal.classList.add('open');
}

function updateCashoutCalculationPreview() {
  const state = loadState();
  const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
  const available = activePro.earnings?.availableBalance || 0;

  const amountInput = document.getElementById('input-cashout-amount');
  const rawVal = parseFloat(amountInput ? amountInput.value : 0);
  const requestedGross = isNaN(rawVal) ? 0 : rawVal;

  const method = document.querySelector('input[name="cashoutMethod"]:checked')?.value || 'instant';
  const fee = method === 'instant'
    ? (WALLET_CONFIG.INSTANT_CASHOUT_FEE_CENTS / 100)
    : (WALLET_CONFIG.STANDARD_CASHOUT_FEE_CENTS / 100);

  const net = Math.max(0, requestedGross - fee);
  const remaining = Math.max(0, available - requestedGross);

  const elGross = document.getElementById('cashout-summary-gross');
  const elFee = document.getElementById('cashout-summary-fee');
  const elNet = document.getElementById('cashout-summary-net');
  const elRemaining = document.getElementById('cashout-summary-remaining');
  const valMsg = document.getElementById('cashout-validation-msg');
  const confirmBtn = document.getElementById('btn-confirm-cashout');

  if (elGross) elGross.textContent = `$${requestedGross.toFixed(2)}`;
  if (elFee) elFee.textContent = fee > 0 ? `-$${fee.toFixed(2)}` : '$0.00 (Free)';
  if (elNet) elNet.textContent = `$${net.toFixed(2)}`;
  if (elRemaining) elRemaining.textContent = `$${remaining.toFixed(2)}`;

  // Validation
  let errorMsg = null;
  if (available <= 0) {
    errorMsg = 'No available balance to withdraw. Complete assignments to earn payouts.';
  } else if (requestedGross <= 0) {
    errorMsg = 'Withdrawal amount must be greater than zero.';
  } else if (requestedGross > available) {
    errorMsg = `Requested withdrawal ($${requestedGross.toFixed(2)}) exceeds available balance ($${available.toFixed(2)}).`;
  } else if (method === 'instant' && requestedGross <= fee) {
    errorMsg = `Instant Cash-Out requires a withdrawal amount greater than the $${fee.toFixed(2)} simulated fee.`;
  }

  if (valMsg && confirmBtn) {
    if (errorMsg) {
      valMsg.textContent = errorMsg;
      valMsg.style.display = 'block';
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.5';
      confirmBtn.style.cursor = 'not-allowed';
    } else {
      valMsg.style.display = 'none';
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
      confirmBtn.style.cursor = 'pointer';
    }
  }
}

function handleConfirmCashout() {
  if (isCashoutSubmitting) return;

  const state = loadState();
  const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
  const method = document.querySelector('input[name="cashoutMethod"]:checked')?.value || 'instant';
  const amountInput = document.getElementById('input-cashout-amount');
  const requestedGross = parseFloat(amountInput ? amountInput.value : 0);

  // Generate stable requestId for idempotency
  const requestId = `req_${activePro.id}_${Date.now()}`;

  const confirmBtn = document.getElementById('btn-confirm-cashout');
  isCashoutSubmitting = true;
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Processing...';
  }

  const res = simulateProCashOut(activePro.id, {
    method,
    requestedAmountDollars: requestedGross,
    requestId
  });

  isCashoutSubmitting = false;
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm Simulated Transfer';
  }

  document.getElementById('cashout-modal')?.classList.remove('open');

  if (res.success) {
    showToast(`Transferred $${res.netAmountDollars.toFixed(2)} via ${res.method}! (${res.notice})`, '💵');
    renderAll();
    if (res.transaction) {
      openReceiptModal(res.transaction, activePro.name);
    }
  } else {
    showToast(res.error || 'Withdrawal failed.', '⚠️');
  }
}

// ---------------------------------------------------------------------------
// Simulated Receipt Modal Handlers (Stage 2 Section 8)
// ---------------------------------------------------------------------------
function openReceiptModal(tx, proName) {
  const modal = document.getElementById('receipt-modal');
  if (!modal || !tx) return;

  const txIdEl = document.getElementById('receipt-tx-id');
  const proNameEl = document.getElementById('receipt-pro-name');
  const timestampEl = document.getElementById('receipt-timestamp');
  const methodEl = document.getElementById('receipt-method');
  const grossEl = document.getElementById('receipt-gross-amount');
  const feeEl = document.getElementById('receipt-fee');
  const netEl = document.getElementById('receipt-net-amount');
  const finalNetEl = document.getElementById('receipt-final-net');
  const statusPill = document.getElementById('receipt-status-text');

  if (txIdEl) txIdEl.textContent = tx.txId;
  if (proNameEl) proNameEl.textContent = proName || 'Dallas Pro';
  if (timestampEl) timestampEl.textContent = `${tx.displayDate || ''} ${tx.isoTimestamp ? tx.isoTimestamp.substring(11, 16) : ''} CST`;
  if (methodEl) methodEl.textContent = tx.methodLabel || tx.description;
  if (grossEl) grossEl.textContent = `$${(tx.amountCents / 100).toFixed(2)}`;
  if (feeEl) feeEl.textContent = tx.feeCents > 0 ? `-$${(tx.feeCents / 100).toFixed(2)}` : '$0.00 (Free)';
  if (netEl) netEl.textContent = `$${(tx.netCents / 100).toFixed(2)}`;
  if (finalNetEl) finalNetEl.textContent = `$${(tx.netCents / 100).toFixed(2)}`;
  if (statusPill) statusPill.textContent = tx.statusLabel || '✓ Simulated Transfer Confirmed';

  modal.classList.add('open');
}

// ---------------------------------------------------------------------------
// Review Submission Handler
// ---------------------------------------------------------------------------
function setupReviewModal() {
  const starsContainer = document.getElementById('star-rating-selector');
  const starText = document.getElementById('star-rating-text');
  const reviewModal = document.getElementById('review-modal');

  const starLabels = {
    1: '1 Star (Poor Experience)',
    2: '2 Stars (Below Average)',
    3: '3 Stars (Average Service)',
    4: '4 Stars (Good Job)',
    5: '5 Stars (Excellent Service)'
  };

  starsContainer.querySelectorAll('span').forEach(star => {
    star.addEventListener('click', (e) => {
      currentRatingSelection = parseInt(e.target.getAttribute('data-star'), 10);
      starText.textContent = starLabels[currentRatingSelection];
      starsContainer.querySelectorAll('span').forEach((s, idx) => {
        s.style.opacity = idx < currentRatingSelection ? '1' : '0.3';
      });
    });
  });

  document.getElementById('btn-submit-review').addEventListener('click', () => {
    if (!pendingReviewBookingId || !pendingReviewSlotId) return;
    const text = document.getElementById('input-review-text').value.trim();

    const result = submitWorkerReview(pendingReviewBookingId, pendingReviewSlotId, {
      rating: currentRatingSelection,
      comment: text || 'Great service, highly recommended!'
    });

    if (result.success) {
      reviewModal.classList.remove('open');
      showToast(
        `Thank you! Your ${currentRatingSelection}-star review for ${pendingReviewWorkerName || 'your Pro'} has been submitted.`,
        '⭐'
      );
      pendingReviewSlotId = null;
      renderAll();
    } else {
      showToast(result.error || 'Could not submit review. Please try again.', '⚠️');
    }
  });

  document.getElementById('btn-close-review').addEventListener('click', () => reviewModal.classList.remove('open'));
  document.getElementById('btn-cancel-review').addEventListener('click', () => reviewModal.classList.remove('open'));
}

// ---------------------------------------------------------------------------
// Customer & Pro Selector Controls
// ---------------------------------------------------------------------------
function initUserSelectors() {
  const customerSelector = document.getElementById('customer-selector');
  const proSelector = document.getElementById('pro-selector');

  customerSelector.addEventListener('change', (e) => {
    const state = loadState();
    state.activeCustomerId = e.target.value;
    saveState(state);
    renderAll();
  });

  proSelector.addEventListener('change', (e) => {
    const state = loadState();
    state.activeProId = e.target.value;
    saveState(state);
    renderProDashboard();
  });

  // Autobook toggle
  const autobookToggle = document.getElementById('pro-autobook-toggle');
  autobookToggle.addEventListener('change', (e) => {
    const state = loadState();
    const activePro = state.pros.find(p => p.id === state.activeProId);
    if (activePro) {
      activePro.autoBookEnabled = e.target.checked;
      saveState(state);
      showToast(`Auto-Book ${e.target.checked ? 'Enabled' : 'Disabled'} for ${activePro.name}.`);
    }
  });
}

// ---------------------------------------------------------------------------
// Render All Views
// ---------------------------------------------------------------------------
function renderAll() {
  const state = loadState();

  // Populate customer selector
  const customerSelector = document.getElementById('customer-selector');
  if (customerSelector) {
    customerSelector.innerHTML = state.customers.map(c =>
      `<option value="${c.id}" ${c.id === state.activeCustomerId ? 'selected' : ''}>${c.name} (${c.neighborhood})</option>`
    ).join('');
  }

  const activeCustomer = state.customers.find(c => c.id === state.activeCustomerId) || state.customers[0];
  const activeNeighborhoodEl = document.getElementById('customer-active-neighborhood');
  if (activeNeighborhoodEl && activeCustomer) {
    activeNeighborhoodEl.textContent = activeCustomer.neighborhood;
  }

  renderServiceCards();
  renderCustomerActiveBookings();
  renderCustomerPastBookings();
  renderProDashboard();
  renderAdminDashboard();
}

// ---------------------------------------------------------------------------
// Main Initialization
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // 1. Role switcher
  initRoleSwitcher();

  // 1b. Admin Sub-navigation
  initAdminSubnav();

  // 2. Selectors
  initUserSelectors();

  // 3. Modals
  document.getElementById('btn-close-intake').addEventListener('click', () => {
    document.getElementById('intake-modal').classList.remove('open');
  });
  document.getElementById('btn-cancel-intake').addEventListener('click', () => {
    document.getElementById('intake-modal').classList.remove('open');
  });
  document.getElementById('btn-submit-booking').addEventListener('click', handleBookingSubmit);

  // Admin Modal
  document.getElementById('btn-admin-metrics').addEventListener('click', openAdminMetricsModal);
  document.getElementById('btn-close-admin').addEventListener('click', () => {
    document.getElementById('admin-modal').classList.remove('open');
  });
  document.getElementById('btn-close-admin-btn').addEventListener('click', () => {
    document.getElementById('admin-modal').classList.remove('open');
  });

  // Cashout Modal
  document.getElementById('btn-cashout-trigger').addEventListener('click', openCashoutModal);
  document.getElementById('btn-close-cashout').addEventListener('click', () => {
    document.getElementById('cashout-modal').classList.remove('open');
  });
  document.getElementById('btn-cancel-cashout').addEventListener('click', () => {
    document.getElementById('cashout-modal').classList.remove('open');
  });
  document.getElementById('btn-confirm-cashout').addEventListener('click', handleConfirmCashout);

  // Cashout Modal input calculations & quick Max (Stage 2)
  document.getElementById('input-cashout-amount')?.addEventListener('input', updateCashoutCalculationPreview);
  document.getElementById('input-cashout-amount')?.addEventListener('change', updateCashoutCalculationPreview);
  document.querySelectorAll('input[name="cashoutMethod"]').forEach(r => {
    r.addEventListener('change', updateCashoutCalculationPreview);
  });
  document.getElementById('btn-cashout-max')?.addEventListener('click', () => {
    const state = loadState();
    const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
    const available = activePro.earnings?.availableBalance || 0;
    const amountInput = document.getElementById('input-cashout-amount');
    if (amountInput) {
      amountInput.value = available.toFixed(2);
      updateCashoutCalculationPreview();
    }
  });

  // Receipt Modal Handlers (Stage 2)
  document.getElementById('btn-close-receipt')?.addEventListener('click', () => {
    document.getElementById('receipt-modal')?.classList.remove('open');
  });
  document.getElementById('btn-done-receipt')?.addEventListener('click', () => {
    document.getElementById('receipt-modal')?.classList.remove('open');
  });
  document.getElementById('btn-print-receipt')?.addEventListener('click', () => {
    window.print();
  });

  // Wallet Transaction Filter Handlers (Stage 2)
  document.getElementById('wallet-filter-all')?.addEventListener('click', () => {
    currentWalletFilter = 'all';
    const state = loadState();
    const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
    renderProWalletTransactions(activePro);
  });
  document.getElementById('wallet-filter-earnings')?.addEventListener('click', () => {
    currentWalletFilter = 'earnings';
    const state = loadState();
    const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
    renderProWalletTransactions(activePro);
  });
  document.getElementById('wallet-filter-cashouts')?.addEventListener('click', () => {
    currentWalletFilter = 'cashouts';
    const state = loadState();
    const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
    renderProWalletTransactions(activePro);
  });

  // Review modal
  setupReviewModal();

  // Reschedule modal handlers (Stage 1.2 Adjustment 3)
  const rescheduleModal = document.getElementById('reschedule-modal');
  const btnCloseReschedule = document.getElementById('btn-close-reschedule');
  const btnCancelReschedule = document.getElementById('btn-cancel-reschedule');
  const btnConfirmReschedule = document.getElementById('btn-confirm-reschedule');

  const closeRescheduleModal = () => {
    if (rescheduleModal) rescheduleModal.classList.remove('open');
    pendingRescheduleBookingId = null;
  };

  if (btnCloseReschedule) btnCloseReschedule.addEventListener('click', closeRescheduleModal);
  if (btnCancelReschedule) btnCancelReschedule.addEventListener('click', closeRescheduleModal);

  if (btnConfirmReschedule) {
    btnConfirmReschedule.addEventListener('click', () => {
      if (!pendingRescheduleBookingId) return;
      const dateInput = document.getElementById('input-reschedule-date');
      const timeInput = document.getElementById('input-reschedule-time');
      const newDate = dateInput ? dateInput.value : '';
      const newTime = timeInput ? timeInput.value : '';

      if (!newDate || !newTime) {
        showToast('Please select both a date and time to reschedule.', '⚠️');
        return;
      }

      const res = rescheduleBooking(pendingRescheduleBookingId, { newDate, newTime });
      if (res.success) {
        let msg = `Booking rescheduled to ${newDate} at ${newTime}.`;
        if (res.unassignedPros && res.unassignedPros.length > 0) {
          msg += ` (${res.unassignedPros.length} Pro assignment(s) unassigned due to schedule conflict)`;
        }
        showToast(msg, '📅');
        closeRescheduleModal();
        renderAll();
      } else {
        showToast(res.error || 'Failed to reschedule booking.', '⚠️');
      }
    });
  }

  // Job Board Category Filter Tab Handlers (Priority 5)
  document.getElementById('job-filter-available')?.addEventListener('click', () => {
    currentJobBoardFilter = 'available';
    const state = loadState();
    const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
    renderProJobBoard(activePro);
  });
  document.getElementById('job-filter-upcoming')?.addEventListener('click', () => {
    currentJobBoardFilter = 'upcoming';
    const state = loadState();
    const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
    renderProJobBoard(activePro);
  });
  document.getElementById('job-filter-ineligible')?.addEventListener('click', () => {
    currentJobBoardFilter = 'ineligible';
    const state = loadState();
    const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
    renderProJobBoard(activePro);
  });

  // Stage 3 Phase 2: Dispatch Search & Status Filter Handlers
  document.getElementById('admin-dispatch-search')?.addEventListener('input', renderAdminDispatchList);
  document.getElementById('admin-dispatch-filter-status')?.addEventListener('change', renderAdminDispatchList);
  document.getElementById('admin-dispatch-refresh-btn')?.addEventListener('click', renderAdminDashboard);
  document.getElementById('admin-audit-filter-action')?.addEventListener('change', renderAdminAuditTable);

  // Stage 3 Phase 2: Manual Assignment Modal Handlers
  const assignModal = document.getElementById('admin-assign-modal');
  const closeAssignModal = () => {
    if (assignModal) assignModal.classList.remove('open');
    pendingAdminAssignBookingId = null;
    pendingAdminAssignSlotId = null;
    selectedAdminCandidateProId = null;
  };

  document.getElementById('btn-close-admin-assign')?.addEventListener('click', closeAssignModal);
  document.getElementById('btn-cancel-admin-assign')?.addEventListener('click', closeAssignModal);
  document.getElementById('check-admin-assign-confirm')?.addEventListener('change', updateAdminAssignConfirmButtonState);
  document.getElementById('btn-confirm-admin-assign')?.addEventListener('click', handleConfirmAdminAssign);

  // Stage 3 Phase 2: Worker Unassignment Modal Handlers
  const unassignModal = document.getElementById('admin-unassign-modal');
  const closeUnassignModal = () => {
    if (unassignModal) unassignModal.classList.remove('open');
    pendingAdminUnassignBookingId = null;
    pendingAdminUnassignSlotId = null;
    pendingAdminUnassignProId = null;
    pendingAdminUnassignProName = null;
  };

  document.getElementById('btn-close-admin-unassign')?.addEventListener('click', closeUnassignModal);
  document.getElementById('btn-cancel-admin-unassign')?.addEventListener('click', closeUnassignModal);
  document.getElementById('check-admin-unassign-confirm')?.addEventListener('change', (e) => {
    const confirmBtn = document.getElementById('btn-confirm-admin-unassign');
    if (confirmBtn) confirmBtn.disabled = !e.target.checked;
  });
  document.getElementById('btn-confirm-admin-unassign')?.addEventListener('click', handleConfirmAdminUnassign);

  // Stage 3.5: Admin Booking Cancellation Modal Handlers
  document.getElementById('btn-close-admin-cancel')?.addEventListener('click', closeAdminCancelModal);
  document.getElementById('btn-cancel-admin-cancel-action')?.addEventListener('click', closeAdminCancelModal);
  document.getElementById('check-admin-cancel-confirm')?.addEventListener('change', (e) => {
    const confirmBtn = document.getElementById('btn-confirm-admin-cancel');
    if (confirmBtn) confirmBtn.disabled = !e.target.checked;
  });
  document.getElementById('btn-confirm-admin-cancel')?.addEventListener('click', handleConfirmAdminCancel);

  // Stage 3.5: Admin-Verified Completion Modal Handlers
  document.getElementById('btn-close-admin-verify')?.addEventListener('click', closeAdminVerifyCompleteModal);
  document.getElementById('btn-cancel-admin-verify-action')?.addEventListener('click', closeAdminVerifyCompleteModal);
  document.getElementById('check-admin-verify-confirm')?.addEventListener('change', (e) => {
    const confirmBtn = document.getElementById('btn-confirm-admin-verify');
    if (confirmBtn) confirmBtn.disabled = !e.target.checked;
  });
  document.getElementById('btn-confirm-admin-verify')?.addEventListener('click', handleConfirmAdminVerify);

  // Stage 3 Phase 3: Worker Directory & Filter Handlers
  document.getElementById('admin-inspector-booking-select')?.addEventListener('change', renderAdminWorkers);
  document.getElementById('admin-support-search')?.addEventListener('input', renderAdminSupport);
  document.getElementById('admin-support-filter-status')?.addEventListener('change', renderAdminSupport);
  document.getElementById('admin-support-filter-priority')?.addEventListener('change', renderAdminSupport);
  document.getElementById('admin-finance-ledger-filter-type')?.addEventListener('change', renderAdminFinance);
  document.getElementById('admin-trust-filter-status')?.addEventListener('change', renderAdminTrustSafety);

  // Stage 3 Phase 3: Create Support Case Modal Handlers
  const createCaseModal = document.getElementById('modal-admin-create-case');
  const closeCreateCaseModal = () => {
    if (createCaseModal) createCaseModal.classList.remove('open');
  };

  document.getElementById('btn-admin-create-case-open')?.addEventListener('click', () => {
    const state = loadState();
    const bookingSelect = document.getElementById('select-case-booking');
    if (bookingSelect) {
      const activeBookings = (state.bookings || []).filter(b => b.overallStatus !== 'cancelled');
      bookingSelect.innerHTML = `<option value="">None / General Marketplace</option>` +
        activeBookings.map(b => `<option value="${b.id}">${b.id} — ${b.serviceTitle} (${b.customerName})</option>`).join('');
    }

    const titleInput = document.getElementById('input-case-title');
    if (titleInput) titleInput.value = '';
    const noteInput = document.getElementById('input-case-initial-note');
    if (noteInput) noteInput.value = '';
    const confirmCheck = document.getElementById('check-create-case-confirm');
    if (confirmCheck) confirmCheck.checked = false;
    const submitBtn = document.getElementById('btn-submit-create-case');
    if (submitBtn) submitBtn.disabled = true;

    if (createCaseModal) createCaseModal.classList.add('open');
  });

  document.getElementById('btn-close-modal-create-case')?.addEventListener('click', closeCreateCaseModal);
  document.getElementById('btn-cancel-create-case')?.addEventListener('click', closeCreateCaseModal);

  const updateConfirmCaseSubmitBtn = () => {
    const titleVal = (document.getElementById('input-case-title')?.value || '').trim();
    const noteVal = (document.getElementById('input-case-initial-note')?.value || '').trim();
    const isChecked = !!document.getElementById('check-create-case-confirm')?.checked;
    const submitBtn = document.getElementById('btn-submit-create-case');
    if (submitBtn) {
      submitBtn.disabled = !(titleVal.length > 0 && noteVal.length > 0 && isChecked);
    }
  };

  document.getElementById('input-case-title')?.addEventListener('input', updateConfirmCaseSubmitBtn);
  document.getElementById('input-case-initial-note')?.addEventListener('input', updateConfirmCaseSubmitBtn);
  document.getElementById('check-create-case-confirm')?.addEventListener('change', updateConfirmCaseSubmitBtn);

  let isSubmittingCase = false;
  document.getElementById('btn-submit-create-case')?.addEventListener('click', () => {
    if (isSubmittingCase) return;
    const title = (document.getElementById('input-case-title')?.value || '').trim();
    const category = document.getElementById('select-case-category')?.value || 'support';
    const issueType = document.getElementById('select-case-issuetype')?.value || 'general';
    const bookingId = document.getElementById('select-case-booking')?.value || null;
    const priority = document.getElementById('select-case-priority')?.value || 'medium';
    const initialNote = (document.getElementById('input-case-initial-note')?.value || '').trim();

    if (!title || !initialNote) {
      showToast('Title and initial dispatcher note are required.', '⚠️');
      return;
    }

    isSubmittingCase = true;
    const state = loadState();
    let customerId = null;
    if (bookingId) {
      const b = (state.bookings || []).find(x => x.id === bookingId);
      if (b) customerId = b.customerId;
    }

    const res = createSupportCase({
      title,
      category,
      issueType,
      bookingId,
      customerId,
      priority,
      initialNote
    });

    isSubmittingCase = false;
    if (res.success) {
      showToast(`Support case ${res.case.caseId} created successfully.`);
      closeCreateCaseModal();
      renderAll();
    } else {
      showToast(res.error || 'Failed to create support case.', '⚠️');
    }
  });

  // Stage 3 Phase 3: Case Detail Modal Handlers
  const caseDetailModal = document.getElementById('modal-admin-case-detail');
  const closeCaseDetailModal = () => {
    if (caseDetailModal) caseDetailModal.classList.remove('open');
    currentActiveCaseId = null;
  };

  document.getElementById('btn-close-case-detail')?.addEventListener('click', closeCaseDetailModal);
  document.getElementById('btn-close-case-detail-footer')?.addEventListener('click', closeCaseDetailModal);

  document.getElementById('btn-case-detail-update-status')?.addEventListener('click', () => {
    if (!currentActiveCaseId) return;
    const statusSelect = document.getElementById('case-detail-select-status');
    const reasonInput = document.getElementById('case-detail-status-reason');
    const newStatus = statusSelect ? statusSelect.value : 'open';
    const reason = (reasonInput ? reasonInput.value : '').trim();

    if (!reason) {
      showToast('Administrative reason is required for status change.', '⚠️');
      return;
    }

    const res = updateSupportCaseStatus(currentActiveCaseId, newStatus, reason);
    if (res.success) {
      showToast(`Case ${currentActiveCaseId} updated to ${newStatus.toUpperCase().replace('_', ' ')}.`);
      openCaseDetailModal(currentActiveCaseId);
      renderAll();
    } else {
      showToast(res.error || 'Failed to update case status.', '⚠️');
    }
  });

  document.getElementById('btn-case-detail-add-note')?.addEventListener('click', () => {
    if (!currentActiveCaseId) return;
    const noteInput = document.getElementById('input-case-detail-new-note');
    const noteText = (noteInput ? noteInput.value : '').trim();

    if (!noteText) {
      showToast('Note text cannot be empty.', '⚠️');
      return;
    }

    const res = addSupportCaseNote(currentActiveCaseId, noteText);
    if (res.success) {
      showToast('Internal dispatcher note added.');
      if (noteInput) noteInput.value = '';
      openCaseDetailModal(currentActiveCaseId);
      renderAll();
    } else {
      showToast(res.error || 'Failed to add note.', '⚠️');
    }
  });

  // Stage 3 Phase 3: Trust & Safety Modal Close Handlers
  const trustModal = document.getElementById('modal-admin-trust-detail');
  const closeTrustModal = () => {
    if (trustModal) trustModal.classList.remove('open');
    currentActiveTrustReview = null;
  };

  document.getElementById('btn-close-trust-detail')?.addEventListener('click', closeTrustModal);
  document.getElementById('btn-close-trust-footer')?.addEventListener('click', closeTrustModal);

  // Reset Demo Data
  document.getElementById('btn-reset-demo').addEventListener('click', () => {
    if (confirm('Reset Crewly state back to Dallas pilot demo seed data?')) {
      resetStateToSeed();
      showToast('Marketplace demo data reset to initial baseline state.');
      renderAll();
    }
  });

  // Listen to Storage events (Syncs across tabs in real-time without overriding active tab's role)
  window.addEventListener('storage', (e) => {
    if (e.key === 'crewly_marketplace_state_v1') {
      renderAll();
    }
  });

  // Listen to local custom event for state updates in same tab
  window.addEventListener('crewly-state-updated', () => {
    renderAll();
  });

  // Initial render
  renderAll();
});
