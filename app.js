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
  rescheduleBooking
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
  const openTabBtn = document.getElementById('btn-open-dual-tab');

  const updateRoleUI = (role) => {
    const customerSection = document.getElementById('customer-view-section');
    const proSection = document.getElementById('pro-view-section');

    if (role === 'pro') {
      customerBtn.classList.remove('active');
      proBtn.classList.add('active', 'pro-mode');
      customerSection.style.display = 'none';
      proSection.style.display = 'block';
    } else {
      proBtn.classList.remove('active', 'pro-mode');
      customerBtn.classList.add('active');
      customerSection.style.display = 'block';
      proSection.style.display = 'none';
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

  openTabBtn.addEventListener('click', () => {
    const currentRole = getActiveRole();
    const targetRole = currentRole === 'customer' ? 'pro' : 'customer';
    const targetUrl = `${window.location.origin}${window.location.pathname}?role=${targetRole}`;
    window.open(targetUrl, '_blank');
    showToast(`Opened ${targetRole === 'pro' ? 'Crewly Pro' : 'Customer'} view in a new browser tab for dual demonstration.`);
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
  document.getElementById('pro-stat-available').textContent = `$${(activePro.earnings?.availableBalance || 0).toFixed(2)}`;
  document.getElementById('pro-stat-pending').textContent = `$${(activePro.earnings?.pendingBalance || 0).toFixed(2)}`;
  document.getElementById('pro-stat-lifetime').textContent = `$${(activePro.earnings?.lifetimeEarned || 0).toFixed(2)}`;

  // Populate Pro selector dropdown
  const proSelector = document.getElementById('pro-selector');
  proSelector.innerHTML = state.pros.map(p =>
    `<option value="${p.id}" ${p.id === activePro.id ? 'selected' : ''}>${p.name} (${p.tier} • ${p.verifiedSkills.join(', ')})</option>`
  ).join('');

  renderProActiveAssignments(activePro);
  renderProCompletedJobs(activePro);
  renderProJobBoard(activePro);
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
// Simulated Cash-Out Modal Handlers
// ---------------------------------------------------------------------------
function openCashoutModal() {
  const state = loadState();
  const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
  const modal = document.getElementById('cashout-modal');

  const available = activePro.earnings?.availableBalance || 0;
  document.getElementById('cashout-modal-amount').textContent = `$${available.toFixed(2)}`;
  modal.classList.add('open');
}

function handleConfirmCashout() {
  const state = loadState();
  const activePro = state.pros.find(p => p.id === state.activeProId) || state.pros[0];
  const method = document.querySelector('input[name="cashoutMethod"]:checked')?.value || 'instant';

  const res = simulateProCashOut(activePro.id, method);
  document.getElementById('cashout-modal').classList.remove('open');

  if (res.success) {
    showToast(`Transferred $${res.netAmount.toFixed(2)} via ${res.method}! (${res.notice})`, '💵');
    renderAll();
  } else {
    alert(res.error);
  }
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
}

// ---------------------------------------------------------------------------
// Main Initialization
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // 1. Role switcher
  initRoleSwitcher();

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
