/**
 * Crewly Application Controller & UI Renderer
 * Course: INSY 3331: Artificial Intelligence for Business
 * Pilot Market: Dallas, Texas
 */

import {
  PRICING_RATES,
  DALLAS_NEIGHBORHOODS,
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
  submitCustomerReview,
  flagReviewDispute
} from './matching.js';

// Global UI State
let currentSelectedService = 'moving';
let pendingReviewBookingId = null;
let currentRatingSelection = 5;

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

  // Populate neighborhoods
  const neighborhoodSelect = document.getElementById('input-neighborhood');
  neighborhoodSelect.innerHTML = DALLAS_NEIGHBORHOODS.map(n =>
    `<option value="${n.id}">${n.name} (ZIP ${n.zip})</option>`
  ).join('');

  // Default address
  const state = loadState();
  const activeCustomer = state.customers.find(c => c.id === state.activeCustomerId) || state.customers[0];
  document.getElementById('input-address').value = activeCustomer.address;

  // Set default scheduled date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById('input-scheduled-date').value = tomorrow.toISOString().split('T')[0];

  // Attach live calculation listeners
  setupIntakeCalculationListeners();
  recalculateIntakePrice();

  modal.classList.add('open');
}

function setupIntakeCalculationListeners() {
  const form = document.getElementById('intake-form');
  form.querySelectorAll('select, input').forEach(input => {
    input.addEventListener('change', recalculateIntakePrice);
    input.addEventListener('input', recalculateIntakePrice);
  });

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

  const neighborhoodId = document.getElementById('input-neighborhood').value;
  const address = document.getElementById('input-address').value;
  const notes = document.getElementById('input-notes').value;

  const timingTypeRadio = document.querySelector('input[name="timingType"]:checked');
  const timingType = timingTypeRadio ? timingTypeRadio.value : 'asap';
  const scheduledDate = timingType === 'scheduled'
    ? document.getElementById('input-scheduled-date').value
    : new Date().toISOString().split('T')[0];
  const scheduledTime = timingType === 'scheduled'
    ? document.getElementById('input-scheduled-time').value
    : 'Immediate';

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

  const booking = createBooking({
    customerId: state.activeCustomerId,
    neighborhoodId,
    address,
    serviceCategory: currentSelectedService,
    timingType,
    scheduledDate,
    scheduledTime,
    intakeDetails
  });

  document.getElementById('intake-modal').classList.remove('open');
  showToast(`Booking ${booking.id} created! Dispatched to Dallas Job Board.`);
  renderAll();
}

// ---------------------------------------------------------------------------
// Render Customer Active Bookings & Tracking
// ---------------------------------------------------------------------------
function renderCustomerActiveBookings() {
  const container = document.getElementById('customer-active-bookings-container');
  if (!container) return;

  const state = loadState();
  const activeBookings = state.bookings.filter(b => b.overallStatus !== 'completed' && b.overallStatus !== 'cancelled');

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

    // Status Badge
    let statusBadgeHtml = '';
    if (b.overallStatus === 'partially_filled') {
      statusBadgeHtml = `<span class="status-badge partially_filled">⚠️ Partially Filled (${b.workerAssignments.filter(s => s.status !== 'unassigned').length}/${b.workerAssignments.length} Assigned)</span>`;
    } else if (b.overallStatus === 'waiting_for_pros') {
      statusBadgeHtml = `<span class="status-badge waiting">⏳ Waiting for Pros</span>`;
    } else if (b.overallStatus === 'fully_confirmed') {
      statusBadgeHtml = `<span class="status-badge confirmed">✓ Fully Confirmed</span>`;
    } else if (b.overallStatus === 'in_progress' || b.overallStatus === 'arrived' || b.overallStatus === 'traveling') {
      statusBadgeHtml = `<span class="status-badge in_progress">⚡ Active (${b.overallStatus})</span>`;
    }

    // Partial fulfillment alert banner (Mandatory for multi-worker jobs)
    let alertBannerHtml = '';
    if (b.overallStatus === 'partially_filled' || b.overallStatus === 'waiting_for_pros') {
      alertBannerHtml = `
        <div class="partial-fulfillment-alert">
          <span style="font-size: 1.2rem;">⚠️</span>
          <div>
            <strong>Booking Not Fully Confirmed Yet:</strong>
            ${b.partialFulfillmentNotice}
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
              📍 ${b.neighborhoodName} • Scheduled: <strong>${b.scheduledDate} at ${b.scheduledTime}</strong>
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
}

// ---------------------------------------------------------------------------
// Render Customer Past Bookings & Review Modal
// ---------------------------------------------------------------------------
function renderCustomerPastBookings() {
  const container = document.getElementById('customer-past-bookings-container');
  if (!container) return;

  const state = loadState();
  const completed = state.bookings.filter(b => b.overallStatus === 'completed');

  if (completed.length === 0) {
    container.innerHTML = `
      <div style="background: white; border: 1px dashed var(--border-dark); border-radius: var(--radius-lg); padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No completed bookings yet.
      </div>
    `;
    return;
  }

  container.innerHTML = completed.map(b => {
    const reviewBlock = b.review
      ? `
        <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 12px; margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-weight: 700; color: var(--primary-navy);">⭐ ${b.review.stars} Star Rating</span>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${b.review.date}</span>
          </div>
          <p style="font-size: 0.85rem; color: var(--text-secondary); font-style: italic;">"${b.review.comment}"</p>
          ${b.review.disputed ? '<span style="font-size: 0.72rem; color: var(--accent-red); font-weight: 600;">⚠️ Disputed by Pro (Investigation Pending)</span>' : ''}
        </div>
      `
      : `
        <button class="btn-book-service btn-open-review" data-booking-id="${b.id}" style="width: auto; padding: 6px 14px; font-size: 0.82rem; margin-top: 10px;">
          ⭐ Leave Star Rating & Review
        </button>
      `;

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
        ${reviewBlock}
      </div>
    `;
  }).join('');

  // Attach review triggers
  container.querySelectorAll('.btn-open-review').forEach(btn => {
    btn.addEventListener('click', (e) => {
      pendingReviewBookingId = e.currentTarget.getAttribute('data-booking-id');
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
          Scheduled: <strong>${b.scheduledDate} at ${b.scheduledTime}</strong> • Customer: <strong>${b.customerName}</strong>
        </div>

        <!-- Pro Action Lifecycle Stepper Buttons -->
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; border-top: 1px solid var(--border-light); padding-top: 14px;">
          <button class="btn-open-tab btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="traveling" ${slot.status === 'traveling' ? 'disabled style="opacity:0.5;"' : ''}>
            🚗 Mark En Route
          </button>
          <button class="btn-open-tab btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="arrived" ${slot.status === 'arrived' ? 'disabled style="opacity:0.5;"' : ''}>
            📍 Mark Arrived
          </button>
          <button class="btn-open-tab btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="in_progress" ${slot.status === 'in_progress' ? 'disabled style="opacity:0.5;"' : ''}>
            🔨 Start Work
          </button>
          <button class="btn-book-service btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="completed" style="width: auto; padding: 6px 16px; background: var(--brand-emerald);">
            ✓ Complete & Finalize Payout
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach status transition handlers
  container.querySelectorAll('.btn-pro-action').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      const slotId = e.currentTarget.getAttribute('data-slot-id');
      const newStatus = e.currentTarget.getAttribute('data-status');

      const result = updateProAssignmentStatus(bookingId, slotId, newStatus);
      if (result.success) {
        showToast(`Job status updated: ${newStatus.toUpperCase()}`);
        renderAll();
      }
    });
  });
}

// Render Pro Job Board with Eligibility & Conflict Explanations
function renderProJobBoard(activePro) {
  const container = document.getElementById('pro-job-board-container');
  if (!container) return;

  const state = loadState();
  const openBookings = state.bookings.filter(b =>
    b.overallStatus !== 'completed' &&
    b.overallStatus !== 'cancelled' &&
    b.workerAssignments.some(s => s.status === 'unassigned')
  );

  if (openBookings.length === 0) {
    container.innerHTML = `
      <div style="background: white; border: 1px dashed var(--border-dark); border-radius: var(--radius-lg); padding: 32px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
        No open positions on the Dallas job board right now. Check back soon or toggle Auto-Book.
      </div>
    `;
    return;
  }

  container.innerHTML = openBookings.map(b => {
    // Render an acceptance card for each unassigned slot
    const unassignedSlots = b.workerAssignments.filter(s => s.status === 'unassigned');

    return unassignedSlots.map(slot => {
      const eligibility = canProAcceptSlot(activePro.id, b.id, slot.slotId);

      return `
        <div class="job-board-card ${eligibility.allowed ? '' : 'ineligible'}">
          <div class="job-card-header">
            <div class="job-title-group">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="booking-id-tag">${b.id}</span>
                <h3>${b.serviceTitle} — ${slot.roleTitle}</h3>
              </div>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                Customer: ${b.customerName} (${b.neighborhoodName})
              </div>
            </div>
            
            <!-- Pro Payout Only (Strict separation: customer fees and platform margins are hidden) -->
            <div class="job-payout-badge">
              <div class="job-payout-amount">$${slot.payout.toFixed(2)}</div>
              <div class="job-payout-label">Your Offered Payout</div>
            </div>
          </div>

          <div class="job-meta-row">
            <div class="job-meta-item">📍 Dallas: <strong>${b.neighborhoodName}</strong></div>
            <div class="job-meta-item">📅 Date: <strong>${b.scheduledDate}</strong></div>
            <div class="job-meta-item">⏰ Time: <strong>${b.scheduledTime}</strong></div>
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
        alert(res.error);
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
    if (!pendingReviewBookingId) return;
    const text = document.getElementById('input-review-text').value.trim();

    submitCustomerReview(pendingReviewBookingId, {
      rating: currentRatingSelection,
      comment: text || 'Great service, highly recommended!'
    });

    reviewModal.classList.remove('open');
    showToast('Thank you! Your verified rating and review have been submitted.', '⭐');
    renderAll();
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
    const customer = state.customers.find(c => c.id === state.activeCustomerId);
    if (customer) {
      document.getElementById('customer-active-neighborhood').textContent = customer.neighborhood;
    }
    renderCustomerActiveBookings();
    renderCustomerPastBookings();
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
