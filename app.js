/**
 * Crewly Application Controller & UI Renderer
 * Course: INSY 3331: Artificial Intelligence for Business
 * Pilot Market: Dallas, Texas
 */

import {
  PRICING_RATES,
  FURNITURE_ASSEMBLY_TIERS,
  FURNITURE_DISASSEMBLY_TIERS,
  UNSUPPORTED_FURNITURE_ITEMS,
  FURNITURE_ASSEMBLY_CATALOG,
  FURNITURE_DISASSEMBLY_CATALOG,
  DALLAS_NEIGHBORHOODS,
  DALLAS_SERVICE_ZIPS,
  lookupDallasZip,
  WALLET_CONFIG,
  INITIAL_PROS,
  INITIAL_CUSTOMERS,
  AI_DISPATCH_CONFIG
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
  recalculateBookingStatus,
  sanitizeAiText,
  computeBookingDispatchFingerprint,
  verifyRecommendationFreshness,
  logAiDispatchAuditEvent,
  getBookingAiDispatchEligibility,
  requestAiDispatchAdvice,
  resolveAiDispatchProxyConfig,
  groundAndVerifyCandidateClaims,
  CONCIERGE_CONFIG,
  sanitizeCustomerInputPii,
  calculateConciergeDeterministicPricing,
  validateConciergeMovingDraft,
  requestAiConciergeMovingChat,
  createBookingFromConciergeDraft
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

// Stage 4 Phase 4.4: AI-Assisted Dispatch UI State
const aiDispatchUiMap = {};
let aiDispatchRequestCounter = 0;
let pendingAdminAssignAiContext = null;

// Stage 4.6B1: Customer AI Booking Concierge State (Moving Only)
let conciergeConversationMessages = [];
let conciergeCurrentDraft = null;
let isConciergeSubmitting = false;
let isConciergeBookingSubmitting = false;

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
// Standardized Inline Lucide SVG Icons (Option C Bold Professional)
// ---------------------------------------------------------------------------
const LUCIDE_ICONS = {
  check: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  alertTriangle: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  alertCircle: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  clock: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  calendar: '<svg class="lucide-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  dollarSign: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  mapPin: '<svg class="lucide-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  user: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  users: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  hardHat: '<svg class="lucide-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z"/><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M4 15v-3a8 8 0 0 1 16 0v3"/></svg>',
  truck: '<svg class="lucide-icon" viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="13" x="1" y="6" rx="2"/><polygon points="17 8 20 8 23 11 23 16 17 16 17 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
  tv: '<svg class="lucide-icon" viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="15" x="2" y="7" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>',
  hammer: '<svg class="lucide-icon" viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9"/><path d="M17.64 15 22 10.64"/><path d="m20.91 3.26-6.36 6.36"/><path d="m21.67 7.5-6.36-6.36"/></svg>',
  box: '<svg class="lucide-icon" viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  wrench: '<svg class="lucide-icon" viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  sprout: '<svg class="lucide-icon" viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/></svg>',
  bot: '<svg class="lucide-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="12" x="3" y="6" rx="2"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M12 2v4"/><path d="M2 10h1"/><path d="M21 10h1"/></svg>',
  zap: '<svg class="lucide-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  arrowRight: '<svg class="lucide-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  send: '<svg class="lucide-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  shield: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  star: '<svg class="lucide-icon" viewBox="0 0 24 24" width="14" height="14" stroke="#F59E0B" fill="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  starEmpty: '<svg class="lucide-icon" viewBox="0 0 24 24" width="14" height="14" stroke="#CBD5E1" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  car: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>',
  fileText: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  lock: '<svg class="lucide-icon" viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  search: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  ban: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  sparkles: '<svg class="lucide-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>'
};

function renderStarRatingHtml(stars) {
  const full = Math.round(Number(stars) || 0);
  let html = '<span class="star-rating-icons" style="display:inline-flex;align-items:center;gap:2px;">';
  for (let i = 1; i <= 5; i++) {
    html += i <= full ? LUCIDE_ICONS.star : LUCIDE_ICONS.starEmpty;
  }
  html += '</span>';
  return html;
}

// ---------------------------------------------------------------------------
// Toast Notification Utility
// ---------------------------------------------------------------------------
function showToast(message, icon = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  let iconHtml = icon;
  if (!icon || icon === 'success' || icon === '\u2713') {
    iconHtml = LUCIDE_ICONS.check;
  } else if (icon === 'warning' || icon === 'error' || icon === '\u26A0' || icon === '\u26A0\uFE0F') {
    iconHtml = LUCIDE_ICONS.alertTriangle;
  } else if (icon === 'clock' || icon === '\u23F3' || icon === '\u231B') {
    iconHtml = LUCIDE_ICONS.clock;
  } else if (icon === 'calendar' || icon === '\uD83D\uDCC5') {
    iconHtml = LUCIDE_ICONS.calendar;
  } else if (icon === 'dollar' || icon === '\uD83D\uDCB5') {
    iconHtml = LUCIDE_ICONS.dollarSign;
  } else if (icon === 'star' || icon === '\u2B50') {
    iconHtml = LUCIDE_ICONS.star;
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span style="display:inline-flex;align-items:center;flex-shrink:0;">${iconHtml}</span> <span>${message}</span>`;
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
    { key: 'moving', icon: LUCIDE_ICONS.truck, badge: 'Popular • Multi-Worker Teams' },
    { key: 'tv_mounting', icon: LUCIDE_ICONS.tv, badge: 'Guaranteed Flat Rate' },
    { key: 'wall_mounting', icon: LUCIDE_ICONS.hammer, badge: 'Precision Anchoring' },
    { key: 'furniture_assembly', icon: LUCIDE_ICONS.box, badge: 'IKEA & Wayfair Ready' },
    { key: 'furniture_disassembly', icon: LUCIDE_ICONS.wrench, badge: 'Moving Preparation' },
    { key: 'lawn_mowing', icon: LUCIDE_ICONS.sprout, badge: 'Verified Mower Required' }
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
          ${s.key === 'moving' ? `
            <div style="display: flex; gap: 8px;">
              <button class="btn-book-service btn-open-booking" data-service="${s.key}" style="flex: 1;">
                <span>Book Service</span> ${LUCIDE_ICONS.arrowRight}
              </button>
              <button class="btn-book-service btn-open-moving-concierge" style="background: linear-gradient(135deg, #1E40AF, #2563EB); border: none; padding: 0 12px; font-size: 0.82rem;" title="AI-Assisted Moving Intake">
                ${LUCIDE_ICONS.bot} <span>AI Concierge</span>
              </button>
            </div>
          ` : `
            <button class="btn-book-service btn-open-booking" data-service="${s.key}">
              <span>Book Service</span> ${LUCIDE_ICONS.arrowRight}
            </button>
          `}
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

  // Attach moving concierge click handlers
  container.querySelectorAll('.btn-open-moving-concierge').forEach(btn => {
    btn.addEventListener('click', () => {
      openMovingConciergeModal();
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
      <div style="display: flex; justify-content: space-between; align-items: center; background: #F0FDF4; border: 1px solid #BBF7D0; padding: 8px 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 0.82rem; color: #166534;">
        <span>Prefer conversational booking?</span>
        <button type="button" id="link-switch-to-moving-concierge" style="background: none; border: none; color: var(--accent-blue); font-weight: 700; cursor: pointer; text-decoration: underline; font-size: 0.82rem;">
          Try AI Moving Concierge ${LUCIDE_ICONS.arrowRight}
        </button>
      </div>
      <div style="background: #EFF6FF; border-left: 4px solid var(--accent-blue); padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem; color: #1E40AF;">
        <strong>Moving & Lifting Pricing:</strong> $50/hour per mover with a mandatory 2-hour minimum duration, plus a transparent $10 booking fee. You can select 1 to 4 movers.
      </div>
      <div class="form-group">
        <label class="form-label">Number of Movers Needed (1 to 4 Movers):</label>
        <select id="intake-moving-workers" class="form-select">
          <option value="1">1 Worker (Light lifting assistance)</option>
          <option value="2" selected>2 Workers (Recommended for apartments / bulky furniture)</option>
          <option value="3">3 Workers (Multi-bedroom home / heavy pieces)</option>
          <option value="4">4 Workers (Full residential move)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Estimated Duration — 2-Hour Minimum ($50/mover-hour):</label>
        <select id="intake-moving-hours" class="form-select">
          <option value="2">2 Hours (2-Hour Minimum — $50/mover-hr)</option>
          <option value="3" selected>3 Hours (Standard 1-2 bedroom move)</option>
          <option value="4">4 Hours (Half-day move)</option>
          <option value="5">5 Hours</option>
          <option value="6">6 Hours</option>
          <option value="7">7 Hours</option>
          <option value="8">8 Hours (Full-day maximum)</option>
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
  } else if (serviceKey === 'furniture_assembly') {
    questionsContainer.innerHTML = `
      <div style="background: #EFF6FF; border-left: 4px solid var(--accent-blue); padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem; color: #1E40AF;">
        <strong>Tiered Upfront Pricing:</strong> Tier 1 Simple ($60), Tier 2 Standard ($90), Tier 3 Complex ($160). Plus, enjoy a <strong>20% bundle discount</strong> on every secondary item, with only one $10 platform fee!
      </div>
      <div id="intake-assembly-decline-banner" style="display: none; background: #FEF3C7; border-left: 4px solid #D97706; padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem; color: #92400E;">
      </div>
      <div class="form-group">
        <label class="form-label">Primary Item (Type & Complexity Tier):</label>
        <select id="intake-assembly-primary-item" class="form-select">
          <optgroup label="Tier 2: Standard Assembly ($90)">
            <option value="bed_frame_standard" selected>Bed Frame / Platform Bed ($90)</option>
            <option value="standard_desk">Writing Desk or Computer Desk ($90)</option>
            <option value="dresser_3_to_5_drawers">3 to 5-Drawer Dresser / Chest ($90)</option>
            <option value="media_console">TV Media Console / Entertainment Stand ($90)</option>
            <option value="dining_table">Standard Dining Table ($90)</option>
            <option value="tall_bookcase">Tall Bookcase (4+ shelves with wall anchor) ($90)</option>
          </optgroup>
          <optgroup label="Tier 1: Simple Assembly ($60)">
            <option value="chair_stools_pair">Dining Chairs or Bar Stools (Pair) ($60)</option>
            <option value="nightstand_end_table">Nightstand, End Table, or Side Table ($60)</option>
            <option value="office_chair">Ergonomic Office Chair ($60)</option>
            <option value="coffee_table_simple">Coffee Table or Simple Console ($60)</option>
            <option value="small_bookshelf">Small Bookshelf (≤3 shelves) ($60)</option>
          </optgroup>
          <optgroup label="Tier 3: Complex Multi-Component ($160)">
            <option value="dresser_6_to_8_drawers">Large Dresser (6 to 8 Drawers with anti-tip anchor) ($160)</option>
            <option value="wardrobe_single_frame">Wardrobe / Armoire / IKEA PAX (Single frame, up to 4 inserts) ($160)</option>
            <option value="bunk_bed_loft_bed">Residential Bunk Bed or Loft Bed ($160)</option>
            <option value="standing_desk_motorized">Motorized Standing Desk or L-Shaped Desk ($160)</option>
            <option value="treadmill_exercise">Motorized Treadmill, Stationary Bike, or Rowing Machine ($160)</option>
            <option value="bed_frame_with_storage">Platform Bed with Under-Bed Storage Drawers ($160)</option>
          </optgroup>
          <optgroup label="Unsupported Items (Requires Specialized Contractor)">
            <option value="murphy_bed">[Decline] Murphy Bed (Wall-Mounted Pull-Down Bed) [Decline]</option>
            <option value="builtin_cabinetry">[Decline] Custom Built-in Cabinetry / Kitchen Cabinets [Decline]</option>
            <option value="gas_appliance">[Decline] Gas Grill or Gas Appliance [Decline]</option>
            <option value="commercial_gym_multi_stack">[Decline] Commercial Multi-Station Gym Rig [Decline]</option>
          </optgroup>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Total Number of Items to Assemble (Up to 4 Items):</label>
        <select id="intake-assembly-count" class="form-select">
          <option value="1" selected>1 Item (No secondary items)</option>
          <option value="2">2 Items (2nd item receives 20% bundle discount!)</option>
          <option value="3">3 Items (Items 2 & 3 receive 20% bundle discount!)</option>
          <option value="4">4 Items (Items 2, 3, & 4 receive 20% bundle discount!)</option>
        </select>
      </div>

      <!-- Secondary item selectors (revealed dynamically if count > 1) -->
      <div id="intake-assembly-secondary-container" style="display: none; border-top: 1px dashed var(--border-dark); padding-top: 12px; margin-top: 12px;">
        <div class="form-group" id="intake-assembly-sec-item-2-group" style="display: none;">
          <label class="form-label" style="color: var(--brand-emerald);">Second Item (20% Bundle Discount Applied):</label>
          <select id="intake-assembly-sec-2" class="form-select">
            <option value="nightstand_end_table" selected>Tier 1: Nightstand / End Table ($48 — Save $12)</option>
            <option value="chair_stools_pair">Tier 1: Dining Chairs / Stools Pair ($48 — Save $12)</option>
            <option value="office_chair">Tier 1: Office Chair ($48 — Save $12)</option>
            <option value="coffee_table_simple">Tier 1: Coffee Table ($48 — Save $12)</option>
            <option value="small_bookshelf">Tier 1: Small Bookshelf ($48 — Save $12)</option>
            <option value="standard_desk">Tier 2: Standard Desk ($72 — Save $18)</option>
            <option value="bed_frame_standard">Tier 2: Platform Bed Frame ($72 — Save $18)</option>
            <option value="dresser_3_to_5_drawers">Tier 2: 3-5 Drawer Dresser ($72 — Save $18)</option>
            <option value="media_console">Tier 2: Media Console ($72 — Save $18)</option>
            <option value="dresser_6_to_8_drawers">Tier 3: 6-8 Drawer Dresser ($128 — Save $32)</option>
            <option value="wardrobe_single_frame">Tier 3: Wardrobe / PAX Unit ($128 — Save $32)</option>
            <option value="standing_desk_motorized">Tier 3: Motorized Standing Desk ($128 — Save $32)</option>
          </select>
        </div>

        <div class="form-group" id="intake-assembly-sec-item-3-group" style="display: none;">
          <label class="form-label" style="color: var(--brand-emerald);">Third Item (20% Bundle Discount Applied):</label>
          <select id="intake-assembly-sec-3" class="form-select">
            <option value="nightstand_end_table" selected>Tier 1: Nightstand / End Table ($48 — Save $12)</option>
            <option value="office_chair">Tier 1: Office Chair ($48 — Save $12)</option>
            <option value="chair_stools_pair">Tier 1: Dining Chairs / Stools Pair ($48 — Save $12)</option>
            <option value="standard_desk">Tier 2: Standard Desk ($72 — Save $18)</option>
            <option value="dresser_3_to_5_drawers">Tier 2: 3-5 Drawer Dresser ($72 — Save $18)</option>
          </select>
        </div>

        <div class="form-group" id="intake-assembly-sec-item-4-group" style="display: none;">
          <label class="form-label" style="color: var(--brand-emerald);">Fourth Item (20% Bundle Discount Applied):</label>
          <select id="intake-assembly-sec-4" class="form-select">
            <option value="chair_stools_pair" selected>Tier 1: Dining Chairs / Stools Pair ($48 — Save $12)</option>
            <option value="nightstand_end_table">Tier 1: Nightstand / End Table ($48 — Save $12)</option>
            <option value="office_chair">Tier 1: Office Chair ($48 — Save $12)</option>
          </select>
        </div>
      </div>
    `;
  } else if (serviceKey === 'furniture_disassembly') {
    questionsContainer.innerHTML = `
      <div style="background: #EFF6FF; border-left: 4px solid var(--accent-blue); padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem; color: #1E40AF;">
        <strong>Tiered Disassembly Pricing:</strong> Tier 1 Simple ($50), Tier 2 Standard ($80), Tier 3 Complex ($120). Additional items: Tier 1 (+$35), Tier 2 (+$55), Tier 3 (+$85) with no duplicate booking fee!
      </div>
      <div id="intake-disassembly-decline-banner" style="display: none; background: #FEF3C7; border-left: 4px solid #D97706; padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem; color: #92400E;">
      </div>
      <div class="form-group">
        <label class="form-label">Primary Item to Disassemble:</label>
        <select id="intake-disassembly-primary-item" class="form-select">
          <optgroup label="Tier 2: Standard Disassembly ($80)">
            <option value="bed_frame_with_headboard_slats" selected>Platform Bed with Headboard & Slats ($80)</option>
            <option value="sectional_sofa">Modular Sectional Sofa (Uncoupling & Brackets) ($80)</option>
            <option value="executive_desk">Executive Desk / L-Shaped Desk ($80)</option>
            <option value="treadmill_disassembly">Standard Treadmill Folding & Breakdown ($80)</option>
            <option value="standard_dresser_dis">Standard Dresser / Chest Breakdown ($80)</option>
          </optgroup>
          <optgroup label="Tier 1: Simple Disassembly ($50)">
            <option value="bed_frame_simple">Simple Bed Frame (Unbolting) ($50)</option>
            <option value="dining_table_legs">Dining Table (Legs Removal) ($50)</option>
            <option value="simple_desk">Simple Computer Desk Breakdown ($50)</option>
            <option value="small_bookshelf_dis">Small Bookshelf Breakdown ($50)</option>
          </optgroup>
          <optgroup label="Tier 3: Complex Disassembly ($120)">
            <option value="wardrobe_armoire_complex">Multi-Door Wardrobe / Armoire System ($120)</option>
            <option value="bunk_bed_complex">Wooden Bunk Bed or Loft Bed Breakdown ($120)</option>
            <option value="home_gym_exercise_complex">Complex Motorized Gym / Elliptical Breakdown ($120)</option>
          </optgroup>
          <optgroup label="Unsupported Items (Requires Specialized Contractor)">
            <option value="antique_heirloom_glue">[Decline] Antique Heirloom (Hide-Glued Joinery) [Decline]</option>
            <option value="slate_pool_table">[Decline] Slate Pool Table [Decline]</option>
            <option value="piano">[Decline] Upright or Grand Piano [Decline]</option>
          </optgroup>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Total Items to Disassemble (Up to 3 Items):</label>
        <select id="intake-disassembly-count" class="form-select">
          <option value="1" selected>1 Item (No additional items)</option>
          <option value="2">2 Items (Discounted additional item rate!)</option>
          <option value="3">3 Items (Discounted additional item rates!)</option>
        </select>
      </div>

      <!-- Secondary item selectors for disassembly -->
      <div id="intake-disassembly-secondary-container" style="display: none; border-top: 1px dashed var(--border-dark); padding-top: 12px; margin-top: 12px;">
        <div class="form-group" id="intake-disassembly-sec-item-2-group" style="display: none;">
          <label class="form-label" style="color: var(--brand-emerald);">Second Item:</label>
          <select id="intake-disassembly-sec-2" class="form-select">
            <option value="dining_table_legs" selected>Tier 1: Dining Table Legs (+ $35)</option>
            <option value="bed_frame_simple">Tier 1: Simple Bed Frame (+ $35)</option>
            <option value="simple_desk">Tier 1: Simple Desk (+ $35)</option>
            <option value="bed_frame_with_headboard_slats">Tier 2: Platform Bed with Slats (+ $55)</option>
            <option value="sectional_sofa">Tier 2: Modular Sectional (+ $55)</option>
            <option value="executive_desk">Tier 2: Executive Desk (+ $55)</option>
            <option value="wardrobe_armoire_complex">Tier 3: Wardrobe / Armoire (+ $85)</option>
          </select>
        </div>

        <div class="form-group" id="intake-disassembly-sec-item-3-group" style="display: none;">
          <label class="form-label" style="color: var(--brand-emerald);">Third Item:</label>
          <select id="intake-disassembly-sec-3" class="form-select">
            <option value="bed_frame_simple" selected>Tier 1: Simple Bed Frame (+ $35)</option>
            <option value="dining_table_legs">Tier 1: Dining Table Legs (+ $35)</option>
            <option value="simple_desk">Tier 1: Simple Desk (+ $35)</option>
            <option value="bed_frame_with_headboard_slats">Tier 2: Platform Bed with Slats (+ $55)</option>
          </select>
        </div>
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

  // Switch to moving concierge if link clicked
  const switchConciergeBtn = document.getElementById('link-switch-to-moving-concierge');
  if (switchConciergeBtn) {
    switchConciergeBtn.onclick = () => {
      modal.classList.remove('open');
      openMovingConciergeModal();
    };
  }

  modal.classList.add('open');
}

function updateZipIndicator(zip) {
  const indicator = document.getElementById('zip-area-indicator');
  if (!indicator) return;
  const res = lookupDallasZip(zip);
  if (res.valid) {
    indicator.innerHTML = `<span style="color: var(--brand-emerald); display:inline-flex; align-items:center; gap:4px;">${LUCIDE_ICONS.check} ${res.areaName}</span>`;
  } else if (zip && zip.length >= 5) {
    indicator.innerHTML = `<span style="color: var(--accent-red); display:inline-flex; align-items:center; gap:4px;">${LUCIDE_ICONS.alertTriangle} Unsupported ZIP</span>`;
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
  const submitBtn = document.getElementById('btn-submit-booking');
  const rawSubtotalRow = document.getElementById('quote-raw-subtotal-row');
  const rawSubtotalEl = document.getElementById('quote-raw-subtotal');
  const discountRow = document.getElementById('quote-discount-row');
  const discountEl = document.getElementById('quote-discount');
  const discountLabel = document.getElementById('quote-discount-label');

  if (currentSelectedService === 'furniture_assembly') {
    const primarySelect = document.getElementById('intake-assembly-primary-item');
    const countSelect = document.getElementById('intake-assembly-count');
    const declineBanner = document.getElementById('intake-assembly-decline-banner');
    const secContainer = document.getElementById('intake-assembly-secondary-container');
    const sec2Group = document.getElementById('intake-assembly-sec-item-2-group');
    const sec3Group = document.getElementById('intake-assembly-sec-item-3-group');
    const sec4Group = document.getElementById('intake-assembly-sec-item-4-group');

    const primaryType = primarySelect ? primarySelect.value : 'bed_frame_standard';
    const count = countSelect ? parseInt(countSelect.value, 10) : 1;

    // Toggle secondary selectors visibility
    if (secContainer) {
      secContainer.style.display = count > 1 ? 'block' : 'none';
      if (sec2Group) sec2Group.style.display = count >= 2 ? 'block' : 'none';
      if (sec3Group) sec3Group.style.display = count >= 3 ? 'block' : 'none';
      if (sec4Group) sec4Group.style.display = count >= 4 ? 'block' : 'none';
    }

    // Check for unsupported items
    if (UNSUPPORTED_FURNITURE_ITEMS[primaryType]) {
      const u = UNSUPPORTED_FURNITURE_ITEMS[primaryType];
      if (declineBanner) {
        declineBanner.innerHTML = `<strong>${LUCIDE_ICONS.alertTriangle} Unsupported Item:</strong> ${u.name}. ${u.reason}`;
        declineBanner.style.display = 'block';
      }
      if (submitBtn) submitBtn.disabled = true;
      document.getElementById('quote-service-desc').textContent = 'Unsupported Service Request:';
      document.getElementById('quote-subtotal').textContent = '—';
      if (rawSubtotalRow) rawSubtotalRow.style.display = 'none';
      if (discountRow) discountRow.style.display = 'none';
      document.getElementById('quote-customer-total').textContent = '—';
      return;
    } else {
      if (declineBanner) declineBanner.style.display = 'none';
      if (submitBtn) submitBtn.disabled = false;
    }

    const items = [primaryType];
    if (count >= 2) items.push(document.getElementById('intake-assembly-sec-2')?.value || 'nightstand_end_table');
    if (count >= 3) items.push(document.getElementById('intake-assembly-sec-3')?.value || 'nightstand_end_table');
    if (count >= 4) items.push(document.getElementById('intake-assembly-sec-4')?.value || 'chair_stools_pair');

    const quote = calculatePricing('furniture_assembly', { items });

    if (rawSubtotalRow && rawSubtotalEl) {
      if (quote.bundleDiscount > 0) {
        rawSubtotalRow.style.display = 'flex';
        rawSubtotalEl.textContent = `$${quote.rawCustomerSubtotal.toFixed(2)}`;
      } else {
        rawSubtotalRow.style.display = 'none';
      }
    }

    if (discountRow && discountEl) {
      if (quote.bundleDiscount > 0) {
        discountRow.style.display = 'flex';
        discountEl.textContent = `-$${quote.bundleDiscount.toFixed(2)}`;
        if (discountLabel) discountLabel.textContent = 'Secondary-Item Discount (20% off):';
      } else {
        discountRow.style.display = 'none';
      }
    }

    document.getElementById('quote-service-desc').textContent = count > 1
      ? (quote.bundleDiscount > 0 ? `Discounted Service Subtotal (${count} Items):` : `Service Subtotal (${count} Items):`)
      : `Service Subtotal (${quote.primaryItem.name}):`;

    document.getElementById('quote-subtotal').textContent = `$${quote.customerSubtotal.toFixed(2)}`;
    document.getElementById('quote-booking-fee').textContent = `$${quote.bookingFee.toFixed(2)}`;
    document.getElementById('quote-customer-total').textContent = `$${quote.customerTotal.toFixed(2)}`;
    return;
  }

  if (currentSelectedService === 'furniture_disassembly') {
    const primarySelect = document.getElementById('intake-disassembly-primary-item');
    const countSelect = document.getElementById('intake-disassembly-count');
    const declineBanner = document.getElementById('intake-disassembly-decline-banner');
    const secContainer = document.getElementById('intake-disassembly-secondary-container');
    const sec2Group = document.getElementById('intake-disassembly-sec-item-2-group');
    const sec3Group = document.getElementById('intake-disassembly-sec-item-3-group');

    const primaryType = primarySelect ? primarySelect.value : 'bed_frame_with_headboard_slats';
    const count = countSelect ? parseInt(countSelect.value, 10) : 1;

    // Toggle secondary selectors visibility
    if (secContainer) {
      secContainer.style.display = count > 1 ? 'block' : 'none';
      if (sec2Group) sec2Group.style.display = count >= 2 ? 'block' : 'none';
      if (sec3Group) sec3Group.style.display = count >= 3 ? 'block' : 'none';
    }

    // Check for unsupported items
    if (UNSUPPORTED_FURNITURE_ITEMS[primaryType]) {
      const u = UNSUPPORTED_FURNITURE_ITEMS[primaryType];
      if (declineBanner) {
        declineBanner.innerHTML = `<strong>${LUCIDE_ICONS.alertTriangle} Unsupported Item:</strong> ${u.name}. ${u.reason}`;
        declineBanner.style.display = 'block';
      }
      if (submitBtn) submitBtn.disabled = true;
      document.getElementById('quote-service-desc').textContent = 'Unsupported Service Request:';
      document.getElementById('quote-subtotal').textContent = '—';
      if (rawSubtotalRow) rawSubtotalRow.style.display = 'none';
      if (discountRow) discountRow.style.display = 'none';
      document.getElementById('quote-customer-total').textContent = '—';
      return;
    } else {
      if (declineBanner) declineBanner.style.display = 'none';
      if (submitBtn) submitBtn.disabled = false;
    }

    const items = [primaryType];
    if (count >= 2) items.push(document.getElementById('intake-disassembly-sec-2')?.value || 'dining_table_legs');
    if (count >= 3) items.push(document.getElementById('intake-disassembly-sec-3')?.value || 'bed_frame_simple');

    const quote = calculatePricing('furniture_disassembly', { items });

    if (rawSubtotalRow && rawSubtotalEl) {
      if (quote.bundleDiscount > 0) {
        rawSubtotalRow.style.display = 'flex';
        rawSubtotalEl.textContent = `$${quote.rawCustomerSubtotal.toFixed(2)}`;
      } else {
        rawSubtotalRow.style.display = 'none';
      }
    }

    if (discountRow && discountEl) {
      if (quote.bundleDiscount > 0) {
        discountRow.style.display = 'flex';
        discountEl.textContent = `-$${quote.bundleDiscount.toFixed(2)}`;
        if (discountLabel) discountLabel.textContent = 'Secondary-Item Discount:';
      } else {
        discountRow.style.display = 'none';
      }
    }

    document.getElementById('quote-service-desc').textContent = count > 1
      ? (quote.bundleDiscount > 0 ? `Discounted Service Subtotal (${count} Items):` : `Service Subtotal (${count} Items):`)
      : `Service Subtotal (${quote.primaryItem.name}):`;

    document.getElementById('quote-subtotal').textContent = `$${quote.customerSubtotal.toFixed(2)}`;
    document.getElementById('quote-booking-fee').textContent = `$${quote.bookingFee.toFixed(2)}`;
    document.getElementById('quote-customer-total').textContent = `$${quote.customerTotal.toFixed(2)}`;
    return;
  }

  // Ensure discount rows are hidden for other services
  if (rawSubtotalRow) rawSubtotalRow.style.display = 'none';
  if (discountRow) discountRow.style.display = 'none';
  if (submitBtn) submitBtn.disabled = false;

  const workersInput = document.getElementById('intake-moving-workers');
  const hoursInput = document.getElementById('intake-moving-hours');
  const countInput = document.getElementById('intake-mount-count');

  const workersNeeded = workersInput ? parseInt(workersInput.value, 10) : 1;
  const hours = hoursInput ? parseFloat(hoursInput.value) : 1;
  const itemCount = countInput ? parseInt(countInput.value, 10) : 1;

  const quote = calculatePricing(currentSelectedService, {
    workersNeeded,
    hours,
    itemCount
  });

  const ratePerHour = quote.customerRatePerHour || (PRICING_RATES[currentSelectedService] ? PRICING_RATES[currentSelectedService].customerRate : 50);
  document.getElementById('quote-service-desc').textContent = currentSelectedService === 'moving'
    ? `Service Subtotal (${workersNeeded} Movers × ${hours} hrs @ $${ratePerHour}/hr):`
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
    showToast('Please enter a service street address.', 'warning');
    return;
  }

  // Validate ZIP (Priority 4)
  const zipCheck = lookupDallasZip(zipCode);
  if (!zipCheck.valid) {
    showToast(zipCheck.message, 'warning');
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
      showToast(`Scheduled date (${scheduledDate || 'empty'}) cannot be in the past.`, 'warning');
      return;
    }
    if (scheduledDate === dallasNow.dateStr && scheduledTime && scheduledTime < dallasNow.timeStr) {
      showToast(`Scheduled time (${scheduledTime}) has already passed today. Please choose an upcoming time slot.`, 'warning');
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
  } else if (currentSelectedService === 'furniture_assembly') {
    const primary = document.getElementById('intake-assembly-primary-item')?.value || 'bed_frame_standard';
    const count = parseInt(document.getElementById('intake-assembly-count')?.value || '1', 10);
    const items = [primary];
    if (count >= 2) items.push(document.getElementById('intake-assembly-sec-2')?.value || 'nightstand_end_table');
    if (count >= 3) items.push(document.getElementById('intake-assembly-sec-3')?.value || 'nightstand_end_table');
    if (count >= 4) items.push(document.getElementById('intake-assembly-sec-4')?.value || 'chair_stools_pair');
    intakeDetails.items = items;
    intakeDetails.itemCount = items.length;
    intakeDetails.primaryItem = items[0];
    intakeDetails.secondaryItems = items.slice(1);
  } else if (currentSelectedService === 'furniture_disassembly') {
    const primary = document.getElementById('intake-disassembly-primary-item')?.value || 'bed_frame_with_headboard_slats';
    const count = parseInt(document.getElementById('intake-disassembly-count')?.value || '1', 10);
    const items = [primary];
    if (count >= 2) items.push(document.getElementById('intake-disassembly-sec-2')?.value || 'dining_table_legs');
    if (count >= 3) items.push(document.getElementById('intake-disassembly-sec-3')?.value || 'bed_frame_simple');
    intakeDetails.items = items;
    intakeDetails.itemCount = items.length;
    intakeDetails.primaryItem = items[0];
    intakeDetails.secondaryItems = items.slice(1);
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
    showToast(err.message || 'Error creating booking.', 'warning');
  }
}

// ---------------------------------------------------------------------------
// Stage 4.6B1: Customer AI Booking Concierge UI (Moving & Lifting ONLY)
// ---------------------------------------------------------------------------

function openMovingConciergeModal() {
  const modal = document.getElementById('ai-concierge-modal');
  if (!modal) return;

  const state = loadState();
  const activeCustomer = state.customers.find(c => c.id === state.activeCustomerId) || state.customers[0];
  const defaultAddress = activeCustomer ? (activeCustomer.address || '') : '';

  const addressInput = document.getElementById('concierge-input-address');
  if (addressInput && !addressInput.value) {
    addressInput.value = defaultAddress;
  }

  // Address input listener enables/disables the confirmation button in real time
  if (addressInput && !addressInput._hasConciergeListener) {
    addressInput._hasConciergeListener = true;
    addressInput.addEventListener('input', () => {
      const validation = validateConciergeMovingDraft(conciergeCurrentDraft);
      conciergeCurrentDraft = validation.normalizedDraft;
      const pricing = calculateConciergeDeterministicPricing(conciergeCurrentDraft);
      updateConciergeDraftUi(conciergeCurrentDraft, validation.isComplete, pricing);
    });
  }

  conciergeConversationMessages = [];
  const initialValidation = validateConciergeMovingDraft(null);
  conciergeCurrentDraft = initialValidation.normalizedDraft;

  const chatContainer = document.getElementById('concierge-chat-messages');
  if (chatContainer) {
    chatContainer.innerHTML = `
      <div class="concierge-msg concierge-msg-assistant" style="display: flex; gap: 10px; max-width: 90%;">
        <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--accent-blue-light);color:var(--accent-blue);flex-shrink:0;">${LUCIDE_ICONS.bot}</div>
        <div style="background: white; border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 12px 14px; font-size: 0.88rem; color: var(--primary-navy); box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
          <div style="font-weight: 700; font-size: 0.75rem; color: var(--accent-blue); margin-bottom: 4px;">CREWLY MOVING CONCIERGE</div>
          Hello! I'm Crewly's Moving Concierge for the Dallas pilot area. Tell me about your upcoming move — what are you moving, where in Dallas (ZIP or neighborhood), and what date or preferred time do you have in mind?
        </div>
      </div>
    `;
  }

  const initialPricing = calculateConciergeDeterministicPricing(conciergeCurrentDraft);
  updateConciergeDraftUi(conciergeCurrentDraft, false, initialPricing);

  checkConciergeProxyHealth();

  modal.classList.add('open');
  const inputEl = document.getElementById('concierge-user-input');
  if (inputEl) inputEl.focus();
}

function closeMovingConciergeModal() {
  const modal = document.getElementById('ai-concierge-modal');
  if (modal) modal.classList.remove('open');
}

async function checkConciergeProxyHealth() {
  const statusPill = document.getElementById('concierge-proxy-status-pill');
  const offlineBanner = document.getElementById('concierge-offline-banner');

  if (typeof window !== 'undefined' && window.location && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    if (statusPill) {
      statusPill.textContent = 'Standard Only';
      statusPill.style.background = '#F3F4F6';
      statusPill.style.color = '#6B7280';
    }
    if (offlineBanner) offlineBanner.style.display = 'block';
    return false;
  }

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 1200) : null;
    const healthUrl = (typeof CONCIERGE_CONFIG !== 'undefined' && CONCIERGE_CONFIG.HEALTH_ENDPOINT)
      ? CONCIERGE_CONFIG.HEALTH_ENDPOINT
      : 'http://127.0.0.1:8787/health';
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: controller ? controller.signal : undefined
    });
    if (timeoutId) clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.ok === true) {
        if (data.keyConfigured === true) {
          // Proxy online and AI API key is configured — fully ready
          if (statusPill) {
            statusPill.textContent = 'AI Ready';
            statusPill.style.background = '#ECFDF5';
            statusPill.style.color = '#059669';
          }
          if (offlineBanner) offlineBanner.style.display = 'none';
          return 'ready';
        } else {
          // Proxy online but no API key — will reject chat requests with 503
          if (statusPill) {
            statusPill.textContent = 'No API Key';
            statusPill.style.background = '#FEF3C7';
            statusPill.style.color = '#92400E';
          }
          if (offlineBanner) offlineBanner.style.display = 'block';
          return 'no_key';
        }
      }
    }
  } catch (_) {
    // Proxy unreachable
  }

  if (statusPill) {
    statusPill.textContent = 'Offline';
    statusPill.style.background = '#FEF3C7';
    statusPill.style.color = '#92400E';
  }
  if (offlineBanner) offlineBanner.style.display = 'block';
  return false;
}

function appendConciergeChatMessage(role, text) {
  const container = document.getElementById('concierge-chat-messages');
  if (!container) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `concierge-msg concierge-msg-${role}`;
  msgDiv.style.display = 'flex';
  msgDiv.style.gap = '10px';
  msgDiv.style.maxWidth = '90%';

  if (role === 'user') {
    msgDiv.style.alignSelf = 'flex-end';
    msgDiv.style.flexDirection = 'row-reverse';
    msgDiv.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--bg-card-alt);color:var(--primary-navy);flex-shrink:0;">${LUCIDE_ICONS.user}</div>
      <div style="background: var(--primary-navy); color: white; border-radius: var(--radius-md); padding: 10px 14px; font-size: 0.88rem; box-shadow: 0 1px 2px rgba(0,0,0,0.06);">
        ${escapeHtml(text)}
      </div>
    `;
  } else {
    msgDiv.style.alignSelf = 'flex-start';
    msgDiv.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--accent-blue-light);color:var(--accent-blue);flex-shrink:0;">${LUCIDE_ICONS.bot}</div>
      <div style="background: white; border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 12px 14px; font-size: 0.88rem; color: var(--primary-navy); box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
        <div style="font-weight: 700; font-size: 0.75rem; color: var(--accent-blue); margin-bottom: 4px;">CREWLY MOVING CONCIERGE</div>
        ${escapeHtml(text)}
      </div>
    `;
  }

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function appendConciergeTypingIndicator(id) {
  const container = document.getElementById('concierge-chat-messages');
  if (!container) return;
  const typingDiv = document.createElement('div');
  typingDiv.id = id;
  typingDiv.className = 'concierge-msg concierge-msg-assistant';
  typingDiv.style.display = 'flex';
  typingDiv.style.gap = '10px';
  typingDiv.style.maxWidth = '90%';
  typingDiv.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--accent-blue-light);color:var(--accent-blue);flex-shrink:0;">${LUCIDE_ICONS.bot}</div>
    <div style="background: white; border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 10px 14px; font-size: 0.85rem; color: var(--text-muted); font-style: italic;">
      Concierge is reviewing your moving details...
    </div>
  `;
  container.appendChild(typingDiv);
  container.scrollTop = container.scrollHeight;
}

function removeConciergeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function updateConciergeDraftUi(draft, isComplete, pricing) {
  const complete = (draft && typeof draft.isComplete === 'boolean') ? draft.isComplete : !!isComplete;
  const statusEl = document.getElementById('concierge-draft-status');
  const moversEl = document.getElementById('concierge-draft-movers');
  const hoursEl = document.getElementById('concierge-draft-hours');
  const datetimeEl = document.getElementById('concierge-draft-datetime');
  const zipEl = document.getElementById('concierge-draft-zip');
  const truckEl = document.getElementById('concierge-draft-truck');
  const stairsEl = document.getElementById('concierge-draft-stairs');

  const descEl = document.getElementById('concierge-quote-service-desc');
  const subtotalEl = document.getElementById('concierge-quote-subtotal');
  const feeEl = document.getElementById('concierge-quote-fee');
  const totalEl = document.getElementById('concierge-quote-total');
  const confirmBtn = document.getElementById('btn-concierge-confirm-booking');

  if (statusEl) {
    statusEl.innerHTML = complete
      ? `<span style="background: #ECFDF5; color: #059669; padding: 2px 8px; border-radius: 10px; font-weight: 700;">Ready to Book</span>`
      : `<span style="background: #EFF6FF; color: var(--accent-blue); padding: 2px 8px; border-radius: 10px; font-weight: 700;">In Progress</span>`;
  }

  if (moversEl) {
    if (draft && draft.workersNeeded) {
      moversEl.innerHTML = `<span style="color: var(--brand-emerald); font-weight: 700;">${draft.workersNeeded} Mover${draft.workersNeeded > 1 ? 's' : ''}</span>`;
    } else {
      moversEl.innerHTML = `<span style="color: #D97706; font-weight: 700;">Needs clarification</span>`;
    }
  }

  if (hoursEl) {
    if (draft && draft.hours) {
      hoursEl.innerHTML = `<span style="color: var(--brand-emerald); font-weight: 700;">${draft.hours} Hours (2-hr min)</span>`;
    } else {
      hoursEl.innerHTML = `<span style="color: #D97706; font-weight: 700;">Needs clarification</span>`;
    }
  }

  if (datetimeEl) {
    if (draft && draft.scheduledDate) {
      const timePart = draft.scheduledTime ? ` at ${draft.scheduledTime}` : '';
      datetimeEl.innerHTML = `<span style="color: var(--brand-emerald); font-weight: 700;">${draft.scheduledDate}${timePart}</span>`;
    } else {
      datetimeEl.innerHTML = `<span style="color: #D97706; font-weight: 700;">Needs clarification</span>`;
    }
  }

  if (zipEl) {
    if (draft && draft.zipCode) {
      const area = lookupDallasZip(draft.zipCode);
      const areaName = area.valid ? ` (${area.areaName})` : '';
      zipEl.innerHTML = `<span style="color: var(--brand-emerald); font-weight: 700;">${draft.zipCode}${areaName}</span>`;
    } else {
      zipEl.innerHTML = `<span style="color: #D97706; font-weight: 700;">Needs clarification</span>`;
    }
  }

  if (truckEl) {
    if (draft && draft.truckOption === 'truck_required') {
      truckEl.innerHTML = `<span style="color: var(--brand-emerald); font-weight: 700;">Pickup Truck Needed</span>`;
    } else if (draft && draft.truckOption === 'labor_only') {
      truckEl.innerHTML = `<span style="color: var(--brand-emerald); font-weight: 700;">Labor Only</span>`;
    } else {
      truckEl.innerHTML = `<span style="color: var(--text-muted); font-weight: 700;">Labor Only (Default)</span>`;
    }
  }

  if (stairsEl) {
    if (draft && draft.stairsOption) {
      const label = draft.stairsOption.replace(/_/g, ' ');
      stairsEl.innerHTML = `<span style="color: var(--brand-emerald); font-weight: 700;">${label}</span>`;
    } else {
      stairsEl.innerHTML = `<span style="color: var(--text-muted); font-weight: 700;">Ground floor (Default)</span>`;
    }
  }

  if (pricing && pricing.isReady) {
    if (descEl) descEl.textContent = `${pricing.workersNeeded} Movers × ${pricing.hours} hrs ($50/hr):`;
    if (subtotalEl) subtotalEl.textContent = `$${pricing.customerSubtotal.toFixed(2)}`;
    if (feeEl) feeEl.textContent = `$${pricing.bookingFee.toFixed(2)}`;
    if (totalEl) totalEl.textContent = `$${pricing.customerTotal.toFixed(2)}`;
  } else {
    if (descEl) descEl.textContent = `Service Subtotal:`;
    if (subtotalEl) subtotalEl.textContent = `—`;
    if (feeEl) feeEl.textContent = `$10.00`;
    if (totalEl) totalEl.textContent = `—`;
  }

  const addressVal = (document.getElementById('concierge-input-address')?.value || '').trim();
  if (confirmBtn) {
    if (complete && pricing && pricing.isReady && addressVal) {
      confirmBtn.disabled = false;
      confirmBtn.style.background = 'var(--brand-emerald)';
      confirmBtn.style.color = 'white';
      confirmBtn.textContent = `Confirm & Book Dallas Moving — $${pricing.customerTotal.toFixed(2)}`;
    } else {
      confirmBtn.disabled = true;
      confirmBtn.style.background = '';
      confirmBtn.style.color = '';
      if (!complete) {
        confirmBtn.textContent = 'Complete Details with Concierge to Book';
      } else if (!addressVal) {
        confirmBtn.textContent = 'Enter Street Address Below to Confirm';
      } else {
        confirmBtn.textContent = 'Complete Details Above to Book';
      }
    }
  }
}

async function handleConciergeSendMessage(e) {
  if (e && e.preventDefault) e.preventDefault();
  const inputEl = document.getElementById('concierge-user-input');
  if (!inputEl) return;
  const userText = inputEl.value.trim();
  if (!userText || isConciergeSubmitting) return;

  isConciergeSubmitting = true;
  inputEl.value = '';

  const sendBtn = document.getElementById('btn-concierge-send');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span>...</span>';
  }

  appendConciergeChatMessage('user', userText);

  const typingId = 'concierge-typing-indicator';
  appendConciergeTypingIndicator(typingId);

  conciergeConversationMessages.push({ role: 'user', content: userText });

  try {
    const res = await requestAiConciergeMovingChat({
      messages: conciergeConversationMessages,
      currentDraft: conciergeCurrentDraft
    });

    removeConciergeTypingIndicator(typingId);

    if (res.ok) {
      appendConciergeChatMessage('assistant', res.reply);
      conciergeConversationMessages.push({ role: 'assistant', content: res.reply });
      if (res.draft) {
        conciergeCurrentDraft = res.draft;
      }
      updateConciergeDraftUi(conciergeCurrentDraft, res.isComplete, res.pricing);
    } else {
      const errorMsg = res.error || (res.offline
        ? "I'm currently unable to reach the local AI engine. You can switch to our standard guided moving form anytime using the button above to book with guaranteed pricing."
        : "I encountered an error processing that message. Please try again or switch to our standard booking form.");
      appendConciergeChatMessage('assistant', errorMsg);
      // Only show the offline banner for genuine proxy connectivity failures, not validation rejections
      if (res.offline && !res.validationError) {
        const offlineBanner = document.getElementById('concierge-offline-banner');
        if (offlineBanner) offlineBanner.style.display = 'block';
      }
    }
  } catch (err) {
    removeConciergeTypingIndicator(typingId);
    appendConciergeChatMessage('assistant', "Network connection error. You can switch to our standard booking form anytime.");
  } finally {
    isConciergeSubmitting = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span>Send</span> ' + LUCIDE_ICONS.send;
    }
    inputEl.focus();
  }
}

async function handleConciergeConfirmBooking() {
  if (isConciergeBookingSubmitting) return;
  const addressInput = document.getElementById('concierge-input-address');
  const notesInput = document.getElementById('concierge-input-notes');
  const address = (addressInput ? addressInput.value : '').trim();
  const notes = (notesInput ? notesInput.value : '').trim();

  if (!address) {
    showToast('Please enter your service street address to confirm.', 'warning');
    if (addressInput) addressInput.focus();
    return;
  }

  const validation = validateConciergeMovingDraft(conciergeCurrentDraft);
  if (!validation.isComplete) {
    showToast('Please provide all moving details (movers, hours, date, ZIP) before confirming.', 'warning');
    return;
  }

  const confirmBtn = document.getElementById('btn-concierge-confirm-booking');
  isConciergeBookingSubmitting = true;
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Creating Booking...';
  }

  try {
    const state = loadState();
    const customerId = state.activeCustomerId;
    const booking = createBookingFromConciergeDraft({
      customerId,
      address,
      zipCode: validation.normalizedDraft.zipCode,
      draft: validation.normalizedDraft,
      notes
    });

    closeMovingConciergeModal();
    showToast(`Booking ${booking.id} confirmed! Dispatched to Dallas Job Board for ${booking.neighborhoodName}.`);
    renderAll();
  } catch (err) {
    showToast(err.message || 'Error creating booking.', 'warning');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      const pricing = calculateConciergeDeterministicPricing(conciergeCurrentDraft);
      confirmBtn.textContent = `Confirm & Book Dallas Moving — $${pricing.customerTotal.toFixed(2)}`;
    }
  } finally {
    isConciergeBookingSubmitting = false;
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
        <div style="display:flex;justify-content:center;color:var(--text-muted);margin-bottom:8px;">${LUCIDE_ICONS.fileText}</div>
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
      statusBadgeHtml = `<span class="status-badge waiting" style="background: #FEF3C7; color: #92400E; border: 1px solid #F59E0B;">${LUCIDE_ICONS.clock} Window Expired</span>`;
    } else if (b.overallStatus === 'partially_filled') {
      statusBadgeHtml = `<span class="status-badge partially_filled">${LUCIDE_ICONS.alertTriangle} Partially Filled (${b.workerAssignments.filter(s => s.status !== 'unassigned').length}/${b.workerAssignments.length} Assigned)</span>`;
    } else if (b.overallStatus === 'waiting_for_pros') {
      statusBadgeHtml = `<span class="status-badge waiting">${LUCIDE_ICONS.clock} Waiting for Pros</span>`;
    } else if (b.overallStatus === 'fully_confirmed') {
      statusBadgeHtml = `<span class="status-badge confirmed">${LUCIDE_ICONS.check} Fully Confirmed</span>`;
    } else if (b.overallStatus === 'in_progress' || b.overallStatus === 'arrived' || b.overallStatus === 'traveling') {
      statusBadgeHtml = `<span class="status-badge in_progress">${LUCIDE_ICONS.zap} Active (${b.overallStatus})</span>`;
    }

    // Partial fulfillment alert banner (Mandatory for multi-worker jobs) & ASAP Expired recovery banner
    let alertBannerHtml = '';
    if (isExpired && hasUnassigned) {
      alertBannerHtml = `
        <div class="asap-expired-banner" style="background: #FFFBEB; border: 1px solid #F59E0B; border-radius: var(--radius-md); padding: 14px 16px; margin: 12px 0 16px 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 240px;">
              <strong style="color: #92400E; display: flex; align-items: center; gap: 6px;">
                <span>${LUCIDE_ICONS.clock}</span> ASAP Matching Window Expired
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
                ${LUCIDE_ICONS.calendar} Reschedule
              </button>
            </div>
          </div>
        </div>
      `;
    } else if (b.overallStatus === 'partially_filled' || b.overallStatus === 'waiting_for_pros') {
      alertBannerHtml = `
        <div class="partial-fulfillment-alert">
          <span style="display:inline-flex;align-items:center;">${LUCIDE_ICONS.alertTriangle}</span>
          <div style="flex: 1;">
            <strong>Booking Not Fully Confirmed Yet:</strong>
            ${b.partialFulfillmentNotice}
          </div>
          <div>
            <button class="btn-open-reschedule" data-booking-id="${b.id}" style="padding: 4px 10px; background: white; border: 1px solid var(--border-dark); border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; cursor: pointer; color: var(--text-secondary);">
              ${LUCIDE_ICONS.calendar} Reschedule
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
            <span class="worker-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--primary-navy);">${isAssigned ? LUCIDE_ICONS.hardHat : LUCIDE_ICONS.clock}</span>
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
              ${LUCIDE_ICONS.mapPin} ${b.neighborhoodName} • <strong>${formatBookingTiming(b)}</strong>
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
            <div class="step-circle">${currentStep > 1 ? LUCIDE_ICONS.check : '1'}</div>
            <div class="step-label">Requested</div>
          </div>
          <div class="step-node ${currentStep >= 2 ? (currentStep === 2 ? 'active' : 'completed') : ''}">
            <div class="step-circle">${currentStep > 2 ? LUCIDE_ICONS.check : '2'}</div>
            <div class="step-label">Matching</div>
          </div>
          <div class="step-node ${currentStep >= 3 ? (currentStep === 3 ? 'active' : 'completed') : ''}">
            <div class="step-circle">${currentStep > 3 ? LUCIDE_ICONS.check : '3'}</div>
            <div class="step-label">Confirmed</div>
          </div>
          <div class="step-node ${currentStep >= 4 ? (currentStep === 4 ? 'active' : 'completed') : ''}">
            <div class="step-circle">${currentStep > 4 ? LUCIDE_ICONS.check : '4'}</div>
            <div class="step-label">En Route</div>
          </div>
          <div class="step-node ${currentStep >= 5 ? (currentStep === 5 ? 'active' : 'completed') : ''}">
            <div class="step-circle">${currentStep > 5 ? LUCIDE_ICONS.check : '5'}</div>
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
            ${b.pricing && b.pricing.bundleDiscount > 0
              ? `Original Items: <span style="text-decoration: line-through;">$${(b.pricing.rawCustomerSubtotal || (b.pricing.customerSubtotal + b.pricing.bundleDiscount)).toFixed(2)}</span> · Discount: <strong style="color: var(--brand-emerald);">-$${b.pricing.bundleDiscount.toFixed(2)}</strong> · Service Subtotal: <strong>$${b.pricing.customerSubtotal.toFixed(2)}</strong> + Platform Booking Fee: <strong>$${b.pricing.bookingFee.toFixed(2)}</strong>`
              : `Service Subtotal: <strong>$${b.pricing.customerSubtotal.toFixed(2)}</strong> + Platform Booking Fee: <strong>$${b.pricing.bookingFee.toFixed(2)}</strong>`
            }
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
        showToast(`Extended search for ${bookingId} by 30 minutes! Looking for pros.`, 'clock');
        renderAll();
      } else {
        showToast(res.error || 'Failed to extend search.', 'warning');
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
                    ${LUCIDE_ICONS.hardHat} ${existingReview.proName}
                    <span style="font-weight: 400; color: var(--text-muted);">— ${existingReview.roleTitle}</span>
                  </span>
                  <span style="font-size: 0.72rem; color: var(--text-muted);">${existingReview.date}</span>
                </div>
                <div style="font-size: 0.88rem; color: var(--brand-emerald); font-weight: 700; margin-bottom: 4px;">
                  ${renderStarRatingHtml(existingReview.stars)} ${existingReview.stars} Star${existingReview.stars !== 1 ? 's' : ''}
                </div>
                ${existingReview.comment
                  ? `<p style="font-size: 0.82rem; color: var(--text-secondary); font-style: italic; margin: 0;">"${existingReview.comment}"</p>`
                  : ''}
                ${existingReview.disputed
                  ? '<div style="font-size: 0.72rem; color: var(--accent-red); font-weight: 600; margin-top: 4px;">Disputed by Pro (Investigation Pending)</div>'
                  : ''}
              </div>
            `;
          } else {
            return `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: #F8FAFC; border: 1px dashed var(--border-dark); border-radius: var(--radius-md); margin-bottom: 10px;">
                <span style="font-size: 0.85rem; color: var(--text-secondary);">
                  ${LUCIDE_ICONS.hardHat} <strong>${slot.assignedProName}</strong>
                  <span style="color: var(--text-muted);">— ${slot.roleTitle}</span>
                </span>
                <button class="btn-open-review"
                  data-booking-id="${b.id}"
                  data-slot-id="${slot.slotId}"
                  data-pro-name="${slot.assignedProName}"
                  data-role-title="${slot.roleTitle}"
                  style="padding: 6px 14px; font-size: 0.82rem; font-weight: 600; background: var(--primary-navy); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; white-space: nowrap;">
                  ${LUCIDE_ICONS.star} Review
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
          <span class="status-badge completed">${LUCIDE_ICONS.check} Completed</span>
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
  document.getElementById('pro-avatar-display').innerHTML = LUCIDE_ICONS.hardHat;
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
    let iconSymbol = isEarnings ? LUCIDE_ICONS.dollarSign : (isCashout ? (tx.type === 'cashout_instant' ? LUCIDE_ICONS.zap : LUCIDE_ICONS.dollarSign) : LUCIDE_ICONS.fileText);

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
      statusBadge = `<span class="slot-status-pill completed">${LUCIDE_ICONS.check} CREDITED</span>`;
    } else if (tx.status === 'simulated_instant_confirmed') {
      statusBadge = `<span class="slot-status-pill in_progress" style="background:#ECFDF5; color:var(--brand-emerald); border-color:#A7F3D0;">${LUCIDE_ICONS.check} CONFIRMED (SIMULATED)</span>`;
    } else if (tx.status === 'simulated_processing') {
      statusBadge = `<span class="slot-status-pill assigned" style="background:#EFF6FF; color:#1E40AF;">${LUCIDE_ICONS.clock} PROCESSING (1-2 DAYS)</span>`;
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
              <span>${LUCIDE_ICONS.calendar} ${tx.displayDate || (tx.isoTimestamp ? tx.isoTimestamp.split('T')[0] : '')}</span>
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
                  ${LUCIDE_ICONS.fileText} Receipt
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
                <span style="display:inline-flex;align-items:center;">${LUCIDE_ICONS.clock}</span>
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
            ${LUCIDE_ICONS.car} Mark En Route
          </button>
          <button class="btn-open-tab btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="arrived" ${isCrewIncomplete || slot.status === 'arrived' ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
            ${LUCIDE_ICONS.mapPin} Mark Arrived
          </button>
          <button class="btn-open-tab btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="in_progress" ${isCrewIncomplete || slot.status === 'in_progress' ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
            ${LUCIDE_ICONS.hammer} Start Work
          </button>
          <button class="btn-book-service btn-pro-action" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-status="completed" ${isCrewIncomplete ? 'disabled style="opacity:0.5; cursor:not-allowed; width: auto; padding: 6px 16px; background: var(--text-muted);"' : 'style="width: auto; padding: 6px 16px; background: var(--brand-emerald);"'}>
            ${LUCIDE_ICONS.check} Complete & Finalize Payout
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
        showToast(result.error || 'Status update could not be completed.', 'warning');
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
      ? `<span style="color: var(--brand-emerald); font-weight: 700; display:inline-flex; align-items:center; gap:4px;">${renderStarRatingHtml(item.review.stars)} ${item.review.stars} Star Rating</span>`
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
          <div class="job-meta-item">${LUCIDE_ICONS.mapPin} Area: <strong>${b.neighborhoodName}</strong></div>
          <div class="job-meta-item">${LUCIDE_ICONS.calendar} Date: <strong>${b.scheduledDate}</strong></div>
          <div class="job-meta-item">${LUCIDE_ICONS.clock} Schedule: <strong>${b.timingType === 'asap' ? (isAsapExpired(b) ? 'ASAP (Window Expired)' : `ASAP — Seeking Pros (${b.scheduledTime})`) : b.scheduledTime}</strong></div>
          <div class="job-meta-item">${LUCIDE_ICONS.clock} Duration: <strong>${b.estimatedDurationHours} hrs</strong></div>
        </div>

        <!-- Eligibility Evaluation Output -->
        ${
          eligibility.allowed
            ? `
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; border-top: 1px solid var(--border-light); padding-top: 12px;">
                <span style="font-size: 0.82rem; color: var(--brand-emerald); font-weight: 700;">
                  ${LUCIDE_ICONS.check} You are eligible & verified for this task
                </span>
                <button class="btn-book-service btn-accept-job" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" style="width: auto; padding: 8px 20px;">
                  Accept Job ($${slot.payout.toFixed(2)})
                </button>
              </div>
            `
            : `
              <div style="margin-top: 12px; border-top: 1px solid var(--border-light); padding-top: 10px;">
                <div class="ineligible-reason-badge">
                  <span style="display:inline-flex;align-items:center;">${LUCIDE_ICONS.alertTriangle}</span>
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
        showToast(res.error || 'Could not accept job.', 'warning');
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
          <div style="display:flex;justify-content:center;color:var(--brand-emerald);margin-bottom:8px;">${LUCIDE_ICONS.check}</div>
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
// Stage 4 Phase 4.4: AI-Assisted Dispatch UI Helpers & Controllers
// ---------------------------------------------------------------------------
function renderAdminAiConnectionBanner() {
  const banner = document.getElementById('admin-ai-connection-status');
  if (!banner) return;

  const cfg = resolveAiDispatchProxyConfig();
  if (cfg.enabled) {
    banner.className = 'ai-connection-banner local-ready';
    banner.innerHTML = `
      <span>
        <strong>${LUCIDE_ICONS.bot} Local AI Proxy Ready (<code>127.0.0.1:8787</code>):</strong>
        Advisory dispatch assistant available from <code>${escapeHtml(cfg.origin)}</code>. Human Admin confirmation remains strictly required.
      </span>
      <span style="font-weight: 700; font-size: 0.74rem;">Auto-fallback enabled if proxy offline</span>
    `;
  } else {
    banner.className = 'ai-connection-banner';
    banner.innerHTML = `
      <span>
        <strong>${LUCIDE_ICONS.shield} Offline Rules-Based Fallback Mode:</strong>
        Running on <code>${escapeHtml(cfg.origin || 'file://')}</code> (local proxy disabled outside local dev origin). Zero credentials or external AI calls made.
      </span>
      <span style="font-weight: 700; font-size: 0.74rem;">Crewly Deterministic Rules Active</span>
    `;
  }
}

function syncAiDispatchCacheWithState(bookingId) {
  const entry = aiDispatchUiMap[bookingId];
  if (!entry || entry.status !== 'ready' || !entry.recommendation) return entry;

  const fresh = verifyRecommendationFreshness(entry.recommendation, bookingId);
  if (!fresh.fresh) {
    aiDispatchUiMap[bookingId] = {
      status: 'stale_discarded',
      inFlightSeq: entry.inFlightSeq || 0,
      startFingerprint: entry.startFingerprint || null,
      recommendation: null,
      notice: fresh.reason || 'Booking or worker availability changed; previous AI advice was discarded.'
    };
  }
  return aiDispatchUiMap[bookingId];
}

function formatAiNextActionLabel(actionCode) {
  const map = {
    approve_top_candidate: 'Review & approve top eligible candidate',
    review_risks_before_assign: 'Review flagged operational risks before assigning',
    extend_asap_window: 'Extend ASAP dispatch window before assigning',
    escalate_support_case: 'Escalate staffing shortage to Support Queue'
  };
  return map[actionCode] || 'Review Crewly eligibility & assign manually';
}

function renderAiCandidateRowHtml(booking, slotRec, cand, idx, isPrimary, state) {
  const pro = (state.pros || []).find(p => p.id === cand.proId);
  const liveEligibility = canProAcceptSlot(cand.proId, booking.id, slotRec.slotId);

  // Never display an AI-recommended candidate as eligible without live deterministic proof.
  if (!pro || !liveEligibility.allowed) {
    return `
      <div class="ai-candidate-card">
        <div style="font-size: 0.8rem; color: #DC2626; font-weight: 700;">
          ${LUCIDE_ICONS.alertTriangle} Suggestion rejected by live Crewly rules: ${escapeHtml(sanitizeAiText(cand.displayName || cand.proId, 64))} (${escapeHtml(liveEligibility.reason || 'Not eligible')})
        </div>
      </div>
    `;
  }

  // Phase 4.6A: Application-level factual verification safeguard in UI render
  const bookingContext = {
    bookingId: booking.id,
    serviceCategory: booking.serviceCategory,
    serviceTitle: booking.serviceTitle
  };
  const grounded = groundAndVerifyCandidateClaims(cand, pro, bookingContext, state, slotRec.roleTitle);

  const safeName = escapeHtml(pro.name);
  const safeTier = escapeHtml(pro.tier || 'Bronze');
  const safeZone = escapeHtml(pro.homeNeighborhood || 'Dallas Pilot');
  const safeSkills = (pro.verifiedSkills || []).slice(0, 4).map(s => escapeHtml(s)).join(', ') || 'None';
  const safeSummary = escapeHtml(sanitizeAiText(grounded.fitSummary, 160));
  const safeCaution = grounded.cautionNote ? escapeHtml(sanitizeAiText(grounded.cautionNote, 140)) : '';
  const bullets = Array.isArray(grounded.rationaleBullets) ? grounded.rationaleBullets.slice(0, 3) : [];
  const bulletsHtml = bullets.map(b => `<li>${escapeHtml(sanitizeAiText(b, 140))}</li>`).join('');

  return `
    <div class="ai-candidate-card ${isPrimary ? 'primary' : ''}">
      <div class="ai-candidate-header">
        <div>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <strong style="color: var(--primary-navy); font-size: 0.88rem;">#${idx + 1} ${safeName}</strong>
            <span class="tier-badge ${String(pro.tier || 'bronze').toLowerCase()}">${safeTier}</span>
            ${isPrimary ? `<span style="font-size: 0.7rem; background: #059669; color: white; padding: 2px 7px; border-radius: 999px; font-weight: 800; display:inline-flex; align-items:center; gap:3px;">${LUCIDE_ICONS.star} Primary Suggestion</span>` : ''}
            <span style="font-size: 0.7rem; background: #ECFDF5; color: #047857; padding: 2px 7px; border-radius: 999px; font-weight: 700; display:inline-flex; align-items:center; gap:3px;">${LUCIDE_ICONS.check} Verified by Crewly Rules</span>
          </div>
          <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 4px;">
            ${LUCIDE_ICONS.star} ${Number(pro.rating || 0)} (${Number(pro.reviewCount || 0)} reviews) •
            Reliability: <strong>${Number(pro.reliabilityScore || 0)}%</strong> •
            ${LUCIDE_ICONS.mapPin} ${safeZone} (Pilot Zone) •
            Skills: ${safeSkills}
          </div>
        </div>
        <button type="button"
          class="btn-ai-apply-suggestion"
          data-booking-id="${escapeHtml(booking.id)}"
          data-slot-id="${escapeHtml(slotRec.slotId)}"
          data-pro-id="${escapeHtml(pro.id)}">
          Review & Apply in Assign Modal
        </button>
      </div>
      ${safeSummary ? `<div style="font-size: 0.8rem; color: var(--text-primary); margin-top: 6px; font-weight: 600;">${safeSummary}</div>` : ''}
      ${bulletsHtml ? `<ul class="ai-candidate-bullets">${bulletsHtml}</ul>` : ''}
      ${safeCaution ? `<div style="font-size: 0.75rem; color: #B45309; background: #FFFBEB; padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid #FDE68A; display:inline-flex; align-items:center; gap:4px;">${LUCIDE_ICONS.alertTriangle} ${safeCaution}</div>` : ''}
    </div>
  `;
}

function renderAiSlotSectionHtml(booking, slotRec, state) {
  const candidates = Array.isArray(slotRec.rankedCandidates) ? slotRec.rankedCandidates.slice(0, 3) : [];
  const supplyLabel = slotRec.eligibleCount === 0
    ? '<span style="color: #DC2626; font-weight: 800;">0 Eligible Pros</span>'
    : `<span style="color: #059669; font-weight: 700;">${Number(slotRec.eligibleCount)} Verified Eligible</span>`;

  const bodyHtml = candidates.length > 0
    ? candidates.map((cand, idx) => renderAiCandidateRowHtml(
        booking,
        slotRec,
        cand,
        idx,
        cand.proId === slotRec.recommendedPrimaryProId,
        state
      )).join('')
    : `
      <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: var(--radius-sm); padding: 10px 12px; font-size: 0.8rem; color: #991B1B;">
        <strong>Insufficient Available Workers:</strong> Zero Dallas Pros currently satisfy verified skill, equipment, availability, and conflict checks for <strong>${escapeHtml(slotRec.roleTitle)}</strong>.
        Use <strong>Manual Assign</strong> to inspect disqualification details, check Worker Directory, or escalate to Support.
      </div>
    `;

  return `
    <div class="ai-slot-section">
      <div class="ai-slot-header">
        <div>
          <strong style="font-size: 0.85rem; color: var(--primary-navy);">${escapeHtml(slotRec.roleTitle || slotRec.slotId)}</strong>
          <span style="font-size: 0.76rem; color: var(--text-muted); margin-left: 6px;">(${escapeHtml(slotRec.slotId)} • ${supplyLabel})</span>
        </div>
        <button type="button"
          class="btn-ai-secondary btn-ai-manual-assign"
          data-booking-id="${escapeHtml(booking.id)}"
          data-slot-id="${escapeHtml(slotRec.slotId)}">
          ${LUCIDE_ICONS.search} Manual Assign Alternative
        </button>
      </div>
      ${bodyHtml}
    </div>
  `;
}

function renderAiDispatchPanelHtml(booking, aiEntry, state) {
  if (!aiEntry || aiEntry.status === 'idle') return '';

  if (aiEntry.status === 'loading') {
    return `
      <div class="ai-recommendation-panel" id="ai-panel-${escapeHtml(booking.id)}" data-ai-status="loading">
        <div class="ai-panel-header">
          <span class="ai-provenance-badge fallback">${LUCIDE_ICONS.clock} Generating Dispatch Advice...</span>
        </div>
        <div style="font-size: 0.82rem; color: var(--text-secondary);">
          Evaluating live Crewly eligibility rules, checking schedule overlaps, and querying local assistant (no autonomous worker assignment will occur).
        </div>
      </div>
    `;
  }

  if (aiEntry.status === 'stale_discarded') {
    return `
      <div class="ai-recommendation-panel stale" id="ai-panel-${escapeHtml(booking.id)}" data-ai-status="stale_discarded">
        <div class="ai-panel-header">
          <span class="ai-provenance-badge zero">${LUCIDE_ICONS.alertTriangle} Stale Advice Discarded</span>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn-ai-secondary btn-ai-refresh" data-booking-id="${escapeHtml(booking.id)}">↻ Get Fresh Advice</button>
            <button type="button" class="btn-ai-secondary btn-ai-dismiss" data-booking-id="${escapeHtml(booking.id)}">Dismiss</button>
          </div>
        </div>
        <div style="font-size: 0.8rem; color: #92400E;">
          ${escapeHtml(sanitizeAiText(aiEntry.notice || 'Booking or worker availability changed; previous recommendation was discarded.', 240))}
        </div>
      </div>
    `;
  }

  if (aiEntry.status === 'error') {
    return `
      <div class="ai-recommendation-panel error" id="ai-panel-${escapeHtml(booking.id)}" data-ai-status="error">
        <div class="ai-panel-header">
          <span class="ai-provenance-badge zero">ℹ️ Dispatch Advice Unavailable</span>
          <button type="button" class="btn-ai-secondary btn-ai-dismiss" data-booking-id="${escapeHtml(booking.id)}">Dismiss</button>
        </div>
        <div style="font-size: 0.8rem; color: #92400E;">
          ${escapeHtml(sanitizeAiText(aiEntry.errorMessage || 'This booking is not currently eligible for dispatch advice.', 240))}
        </div>
      </div>
    `;
  }

  const rec = aiEntry.recommendation;
  if (!rec) return '';

  const isLiveAi = !!(
    rec.provenance &&
    rec.provenance.isLiveAi === true &&
    (rec.provenance.source === 'live_openai_ai' || rec.provenance.source === 'live_gemini_ai') &&
    !rec.provenance.isMockTestMode
  );
  const isMockAi = !!(
    rec.provenance &&
    !isLiveAi &&
    (rec.provenance.isMockTestMode === true || rec.provenance.source === 'mock_ai_test_mode')
  );
  const isZero = rec.provenance && rec.provenance.source === 'zero_eligible_short_circuit';
  const panelClass = isLiveAi ? 'live' : (isMockAi ? 'mock' : 'fallback');
  const provenanceAttr = isLiveAi ? 'live_ai' : (isMockAi ? 'mock_test_mode' : 'rules_fallback');
  const isOpenAiLive = isLiveAi && (rec.provenance.source === 'live_openai_ai' || rec.provenance.provider === 'openai');
  const liveBadgeText = isOpenAiLive
    ? `${LUCIDE_ICONS.bot} Live OpenAI AI — ${escapeHtml(sanitizeAiText(rec.provenance.model || 'gpt-6-luna', 48))}`
    : `${LUCIDE_ICONS.bot} Live Gemini AI (${escapeHtml(sanitizeAiText(rec.provenance.model || 'gemini', 48))})`;
  const badgeHtml = isLiveAi
    ? `<span class="ai-provenance-badge live">${liveBadgeText}</span>`
    : (isMockAi
      ? `<span class="ai-provenance-badge mock">${LUCIDE_ICONS.sparkles} Mock AI Response — Test Mode (${escapeHtml(sanitizeAiText(rec.provenance.model || 'mock', 48))})</span>`
      : (isZero
        ? `<span class="ai-provenance-badge zero">${LUCIDE_ICONS.alertTriangle} Rules Engine: 0 Eligible Pros (No External AI Call)</span>`
        : `<span class="ai-provenance-badge fallback">${LUCIDE_ICONS.shield} Rules-Based Fallback (Offline — No External AI Call)</span>`));

  const noticeText = aiEntry.notice || (rec.provenance ? rec.provenance.disclaimer : '');
  const shortageWarningHtml = (rec.staffingFeasibility && !rec.staffingFeasibility.fullCrewFeasible)
    ? `<div class="ai-notice-banner shortage"><strong>${LUCIDE_ICONS.alertTriangle} Multi-Worker Supply Alert:</strong> ${escapeHtml(sanitizeAiText(rec.staffingFeasibility.cannotCompletelyStaffReason || 'Insufficient unique workers to fill all open slots simultaneously.', 220))}</div>`
    : '';

  const slotsSectionHtml = (rec.slotRecommendations || []).map(slotRec =>
    renderAiSlotSectionHtml(booking, slotRec, state)
  ).join('');

  const risks = Array.isArray(rec.operationalRisks) ? rec.operationalRisks : [];
  const risksHtml = risks.length > 0
    ? `
      <div class="ai-risks-list">
        <div style="font-size: 0.76rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.3px;">Operational Risks & Coordination Notes</div>
        ${risks.map(r => `
          <div class="ai-risk-item">
            <span class="ai-risk-sev ${escapeHtml(r.severity || 'medium')}">${escapeHtml(r.severity || 'medium')}</span>
            <span>${escapeHtml(sanitizeAiText(r.message, 180))}</span>
          </div>
        `).join('')}
      </div>
    `
    : '';

  return `
    <div class="ai-recommendation-panel ${panelClass}" id="ai-panel-${escapeHtml(booking.id)}" data-ai-status="ready" data-provenance="${provenanceAttr}">
      <div class="ai-panel-header">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          ${badgeHtml}
          <span style="font-size: 0.74rem; color: var(--text-secondary); font-weight: 700;">Advisory Only • Admin Approval Required</span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button type="button" class="btn-ai-secondary btn-ai-refresh" data-booking-id="${escapeHtml(booking.id)}">↻ Refresh</button>
          <button type="button" class="btn-ai-secondary btn-ai-dismiss" data-booking-id="${escapeHtml(booking.id)}">Dismiss</button>
        </div>
      </div>
      ${noticeText ? `<div class="ai-notice-banner">${escapeHtml(sanitizeAiText(noticeText, 240))}</div>` : ''}
      ${shortageWarningHtml}
      ${slotsSectionHtml}
      ${risksHtml}
      <div class="ai-panel-footer">
        <span><strong>Suggested Next Step:</strong> ${escapeHtml(formatAiNextActionLabel(rec.recommendedNextAction))}</span>
        <span>${LUCIDE_ICONS.mapPin} ${escapeHtml(AI_DISPATCH_CONFIG.NEIGHBORHOOD_LIMITATION_NOTE)}</span>
      </div>
    </div>
  `;
}

export async function triggerAdminAiDispatchAdvice(bookingId, options = {}) {
  const existing = aiDispatchUiMap[bookingId];
  if (existing && existing.status === 'loading') {
    return { ok: false, duplicateBlocked: true, bookingId };
  }

  const eligCheck = getBookingAiDispatchEligibility(bookingId, options);
  const startFp = computeBookingDispatchFingerprint(bookingId, options);
  if (!eligCheck.dispatchable || !startFp.valid || !startFp.dispatchable) {
    aiDispatchUiMap[bookingId] = {
      status: 'error',
      inFlightSeq: aiDispatchRequestCounter,
      startFingerprint: startFp.fingerprint || null,
      recommendation: null,
      errorMessage: eligCheck.reason || startFp.reason || 'Booking is not currently eligible for AI dispatch advice.'
    };
    renderAdminDispatchList();
    return {
      ok: false,
      dispatchable: false,
      bookingId,
      error: aiDispatchUiMap[bookingId].errorMessage
    };
  }

  const mySeq = ++aiDispatchRequestCounter;
  aiDispatchUiMap[bookingId] = {
    status: 'loading',
    inFlightSeq: mySeq,
    startFingerprint: startFp.fingerprint,
    recommendation: null,
    notice: null
  };
  renderAdminDispatchList();

  const result = await requestAiDispatchAdvice(bookingId, options);
  const currentEntry = aiDispatchUiMap[bookingId];
  if (!currentEntry || currentEntry.inFlightSeq !== mySeq) {
    return { ok: false, superseded: true, bookingId };
  }

  if (result.staleDetected || !result.ok || !result.recommendation) {
    aiDispatchUiMap[bookingId] = {
      status: result.staleDetected ? 'stale_discarded' : 'error',
      inFlightSeq: mySeq,
      startFingerprint: startFp.fingerprint,
      recommendation: null,
      notice: result.staleDetected ? (result.error || 'Marketplace state changed; stale advice discarded.') : null,
      errorMessage: result.error || 'Unable to generate dispatch advice for this booking.'
    };
    renderAdminDispatchList();
    return result;
  }

  const finalFresh = verifyRecommendationFreshness(result.recommendation, bookingId, options);
  if (!finalFresh.fresh) {
    aiDispatchUiMap[bookingId] = {
      status: 'stale_discarded',
      inFlightSeq: mySeq,
      startFingerprint: startFp.fingerprint,
      recommendation: null,
      notice: finalFresh.reason || 'Marketplace state changed before recommendation could be shown.'
    };
    renderAdminDispatchList();
    return {
      ok: false,
      staleDetected: true,
      bookingId,
      error: aiDispatchUiMap[bookingId].notice
    };
  }

  aiDispatchUiMap[bookingId] = {
    status: 'ready',
    inFlightSeq: mySeq,
    startFingerprint: result.recommendation.fingerprint,
    recommendation: result.recommendation,
    notice: result.fallbackNotice || (result.recommendation.provenance ? result.recommendation.provenance.disclaimer : null)
  };
  renderAdminDispatchList();
  return result;
}

export function getAdminAiDispatchUiStateForTest() {
  return aiDispatchUiMap;
}

function handleApplyAiSuggestionToModal(bookingId, slotId, proId) {
  syncAiDispatchCacheWithState(bookingId);
  const entry = aiDispatchUiMap[bookingId];
  if (!entry || entry.status !== 'ready' || !entry.recommendation) {
    renderAdminDispatchList();
    showToast('AI dispatch advice expired or unavailable. Refresh advice or assign manually.', 'warning');
    return false;
  }

  const fresh = verifyRecommendationFreshness(entry.recommendation, bookingId, { slotId, proId });
  if (!fresh.allowedForApproval) {
    aiDispatchUiMap[bookingId] = {
      status: 'stale_discarded',
      inFlightSeq: entry.inFlightSeq || 0,
      startFingerprint: entry.startFingerprint || null,
      recommendation: null,
      notice: fresh.reason || 'Marketplace state changed; previous recommendation was discarded.'
    };
    renderAdminDispatchList();
    showToast(fresh.reason || 'Recommendation became stale because booking or worker state changed.', 'warning');
    return false;
  }

  const slotRec = (entry.recommendation.slotRecommendations || []).find(s => s.slotId === slotId);
  const candObj = slotRec ? (slotRec.rankedCandidates || []).find(c => c.proId === proId) : null;
  const state = loadState();
  const pro = (state.pros || []).find(p => p.id === proId);
  const prov = entry.recommendation.provenance || {};
  const isLiveDraft = !!(
    prov.isLiveAi === true &&
    (prov.source === 'live_openai_ai' || prov.source === 'live_gemini_ai') &&
    !prov.isMockTestMode
  );
  const isMockDraft = !!(prov.isMockTestMode === true || prov.source === 'mock_ai_test_mode');
  const sourceTag = isLiveDraft
    ? '[AI Advisory Draft]'
    : (isMockDraft ? '[Mock AI Test Draft]' : '[Rules Fallback Draft]');

  let draftReason = '';
  if (slotRec && slotRec.draftAdminReason && slotRec.recommendedPrimaryProId === proId) {
    draftReason = sanitizeAiText(slotRec.draftAdminReason, AI_DISPATCH_CONFIG.REASON_MAX_CHARS);
  } else {
    const proName = pro ? pro.name : proId;
    const roleTitle = slotRec ? slotRec.roleTitle : slotId;
    const summaryHint = candObj ? candObj.fitSummary : 'Verified eligible via Crewly rules.';
    draftReason = sanitizeAiText(
      `${sourceTag} Selected ${proName} for ${roleTitle} (${bookingId}). ${summaryHint}`,
      AI_DISPATCH_CONFIG.REASON_MAX_CHARS
    );
  }

  openAdminAssignModal(bookingId, slotId, {
    preselectProId: proId,
    draftReason,
    recommendation: entry.recommendation
  });
  return true;
}

// ---------------------------------------------------------------------------
// Stage 3 Phase 2: Dispatch Management Console
// ---------------------------------------------------------------------------
function renderAdminDispatchList() {
  renderAdminAiConnectionBanner();
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
        <div style="display:flex;justify-content:center;color:var(--text-muted);margin-bottom:8px;">${LUCIDE_ICONS.search}</div>
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
      statusBadgeHtml = `<span class="badge" style="background: #FEE2E2; color: #DC2626; font-weight: 800;">${LUCIDE_ICONS.ban} Cancelled Record</span>`;
    } else if (isPast) {
      statusBadgeHtml = `<span class="badge" style="background: #FEE2E2; color: #DC2626; font-weight: 800;">${LUCIDE_ICONS.calendar} Historical Date Passed (${b.scheduledDate})</span>`;
    } else if (b.overallStatus === 'partially_filled') {
      statusBadgeHtml = `<span class="badge badge-pending" style="background: #FEF3C7; color: #92400E; font-weight: 800;">${LUCIDE_ICONS.alertTriangle} Partially Filled (${assignedSlots}/${totalSlots})</span>`;
    } else if (b.overallStatus === 'waiting_for_pros') {
      statusBadgeHtml = `<span class="badge badge-open">${LUCIDE_ICONS.clock} Open / Seeking Pros</span>`;
    } else if (b.overallStatus === 'fully_confirmed') {
      statusBadgeHtml = `<span class="badge badge-confirmed">${LUCIDE_ICONS.check} Fully Confirmed</span>`;
    } else if (b.overallStatus === 'in_progress') {
      statusBadgeHtml = `<span class="badge" style="background: #DBEAFE; color: #1D4ED8; font-weight: 800; border: 1px solid #93C5FD;">${LUCIDE_ICONS.zap} In Progress</span>`;
    } else if (b.overallStatus === 'arrived') {
      statusBadgeHtml = `<span class="badge" style="background: #FEF3C7; color: #92400E; font-weight: 800; border: 1px solid #FCD34D;">${LUCIDE_ICONS.mapPin} Arrived On Site</span>`;
    } else if (b.overallStatus === 'traveling') {
      statusBadgeHtml = `<span class="badge" style="background: #E0E7FF; color: #3730A3; font-weight: 800; border: 1px solid #C7D2FE;">${LUCIDE_ICONS.car} En Route / Traveling</span>`;
    } else if (b.overallStatus === 'completed') {
      statusBadgeHtml = `<span class="badge" style="background: #E2E8F0; color: #475569;">${LUCIDE_ICONS.check} Completed</span>`;
    } else {
      statusBadgeHtml = `<span class="badge">${b.overallStatus}</span>`;
    }

    const timingLabel = b.timingType === 'asap'
      ? `<span style="color: #2563EB; font-weight: 700; display:inline-flex; align-items:center; gap:4px;">${LUCIDE_ICONS.zap} ASAP On-Demand</span>`
      : `${LUCIDE_ICONS.calendar} ${b.scheduledDate} at ${b.scheduledTime || 'TBD'}`;

    // Stage 3.5 Cancellation Evaluation
    const cancelCheck = canBookingBeCancelled(b);
    let cancelActionHtml = '';
    if (b.overallStatus === 'cancelled') {
      const byWhom = (b.cancellationSnapshot && b.cancellationSnapshot.cancelledBy) ? b.cancellationSnapshot.cancelledBy : (b.cancelledBy || 'Dispatch');
      cancelActionHtml = `<span style="font-size: 0.75rem; color: #DC2626; background: #FEF2F2; padding: 3px 8px; border-radius: var(--radius-sm); font-weight: 700;">${LUCIDE_ICONS.ban} Cancelled (${escapeHtml(byWhom)})</span>`;
    } else if (cancelCheck.allowed) {
      cancelActionHtml = `<button class="btn-cancel-booking" data-booking-id="${b.id}" title="Cancel booking and safely reverse pending worker earnings">${LUCIDE_ICONS.ban} Cancel Booking</button>`;
    } else if (cancelCheck.escalationToSupport) {
      cancelActionHtml = `
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <span style="font-size: 0.72rem; color: #991B1B; background: #FEF2F2; padding: 3px 8px; border-radius: var(--radius-sm); font-weight: 700; display:inline-flex; align-items:center; gap:4px;">${LUCIDE_ICONS.lock} Cancel Restricted</span>
          <button class="btn-support-escalate" data-booking-id="${b.id}" data-customer-id="${b.customerId}" title="${escapeHtml(cancelCheck.reason)}">${LUCIDE_ICONS.headphones} Support Escalation</button>
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
          actionHtml = `<button class="btn-assign-slot" style="background: #94A3B8; cursor: not-allowed;" title="Appointment date in past; customer must reschedule" disabled>Historical (Reschedule Req.)</button>`;
        } else if (b.overallStatus === 'cancelled') {
          actionHtml = `<span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">Booking Cancelled</span>`;
        } else {
          actionHtml = `<button class="btn-assign-slot" data-booking-id="${b.id}" data-slot-id="${slot.slotId}">${LUCIDE_ICONS.user} Assign / Replace Pro</button>`;
        }
      } else if (slot.status === 'in_progress') {
        actionHtml = `
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <span style="font-size: 0.75rem; color: #2563EB; font-weight: 700; background: #DBEAFE; padding: 4px 10px; border-radius: var(--radius-sm); display:inline-flex; align-items:center; gap:4px;">${LUCIDE_ICONS.lock} In Progress</span>
            <button class="btn-verify-complete" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-pro-id="${slot.assignedProId}" data-pro-name="${escapeHtml(slot.assignedProName)}">${LUCIDE_ICONS.check} Verify & Complete</button>
          </div>
        `;
      } else if (isCompleted) {
        actionHtml = `<span style="font-size: 0.75rem; color: #059669; font-weight: 700; background: #ECFDF5; padding: 4px 10px; border-radius: var(--radius-sm);">${LUCIDE_ICONS.check} Payout Released (Protected)</span>`;
      } else if (slot.status === 'traveling' || slot.status === 'arrived') {
        actionHtml = `<span style="font-size: 0.75rem; color: #2563EB; font-weight: 700; background: #DBEAFE; padding: 4px 10px; border-radius: var(--radius-sm);">${slot.status === 'traveling' ? (LUCIDE_ICONS.car + ' En Route') : (LUCIDE_ICONS.mapPin + ' Arrived On Site')}</span>`;
      } else {
        // Assigned pre-work: eligible for administrative unassignment
        actionHtml = `<button class="btn-unassign-slot" data-booking-id="${b.id}" data-slot-id="${slot.slotId}" data-pro-id="${slot.assignedProId}" data-pro-name="${slot.assignedProName}">${LUCIDE_ICONS.ban} Unassign Worker</button>`;
      }

      return `
        <div class="dispatch-slot-card ${isAssigned ? 'assigned' : 'unassigned'}">
          <div>
            <div class="dispatch-slot-role">${slot.roleTitle || 'Worker Slot'}</div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
              ${isAssigned ? `Assigned to: <strong style="color: var(--primary-navy);">${slot.assignedProName}</strong>` : `<span style="color: #D97706; font-weight: 700; display:inline-flex; align-items:center; gap:4px;">${LUCIDE_ICONS.clock} Position Open — Seeking Pro</span>`}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <div class="dispatch-slot-payout">Worker Pay: $${slot.payout.toFixed(2)}</div>
            ${actionHtml}
          </div>
        </div>
      `;
    }).join('');

    const aiEntry = syncAiDispatchCacheWithState(b.id);
    const aiElig = getBookingAiDispatchEligibility(b.id);
    const hasUnassignedSlot = (b.workerAssignments || []).some(s => s.status === 'unassigned');
    const isAiLoading = !!(aiEntry && aiEntry.status === 'loading');
    let aiActionBtnHtml = '';
    if (aiElig.dispatchable) {
      aiActionBtnHtml = `<button type="button" class="btn-ai-dispatch" data-booking-id="${escapeHtml(b.id)}" ${isAiLoading ? 'disabled' : ''}>${isAiLoading ? (LUCIDE_ICONS.clock + ' Analyzing Crew...') : (LUCIDE_ICONS.bot + ' Get AI Dispatch Advice')}</button>`;
    } else if (hasUnassignedSlot && b.overallStatus !== 'cancelled' && b.overallStatus !== 'completed') {
      aiActionBtnHtml = `<button type="button" class="btn-ai-dispatch" data-booking-id="${escapeHtml(b.id)}" title="${escapeHtml(aiElig.reason || '')}">${LUCIDE_ICONS.bot} AI Advice Status</button>`;
    }
    const aiPanelHtml = renderAiDispatchPanelHtml(b, aiEntry, state);

    return `
      <div class="dispatch-booking-card" id="dispatch-card-${b.id}">
        <div class="dispatch-card-header">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <h3 class="dispatch-card-title">${b.serviceTitle}</h3>
              ${statusBadgeHtml}
            </div>
            <div class="dispatch-card-meta" style="margin-top: 6px;">
              <span><strong>${b.id}</strong></span>
              <span>${LUCIDE_ICONS.user} Customer: <strong>${b.customerName}</strong></span>
              <span>${LUCIDE_ICONS.mapPin} ${b.neighborhoodName} (${b.address || ''})</span>
              <span>${timingLabel}</span>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
            <div>
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; text-align: right;">Customer Total</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: var(--primary-navy); text-align: right;">$${(b.pricing?.customerTotal || 0).toFixed(2)}</div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end;">
              ${aiActionBtnHtml}
              ${cancelActionHtml}
            </div>
          </div>
        </div>

        <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px;">
          Crew Staffing Requirement (${assignedSlots} of ${totalSlots} positions filled):
        </div>
        <div class="dispatch-slots-container">
          ${slotsHtml}
        </div>
        ${aiPanelHtml}
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

  // Wire AI Dispatch clicks
  container.querySelectorAll('.btn-ai-dispatch:not([disabled])').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      triggerAdminAiDispatchAdvice(bookingId);
    });
  });

  container.querySelectorAll('.btn-ai-refresh').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      triggerAdminAiDispatchAdvice(bookingId, { isRefresh: true });
    });
  });

  container.querySelectorAll('.btn-ai-dismiss').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      delete aiDispatchUiMap[bookingId];
      renderAdminDispatchList();
    });
  });

  container.querySelectorAll('.btn-ai-apply-suggestion').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      const slotId = e.currentTarget.getAttribute('data-slot-id');
      const proId = e.currentTarget.getAttribute('data-pro-id');
      handleApplyAiSuggestionToModal(bookingId, slotId, proId);
    });
  });

  container.querySelectorAll('.btn-ai-manual-assign').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const bookingId = e.currentTarget.getAttribute('data-booking-id');
      const slotId = e.currentTarget.getAttribute('data-slot-id');
      openAdminAssignModal(bookingId, slotId, null);
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
                  ${isFailed ? 'REJECTED' : log.actionType.replace(/_/g, ' ')}
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
function openAdminAssignModal(bookingId, slotId, aiPrefill = null) {
  const state = loadState();
  const booking = state.bookings.find(b => b.id === bookingId);
  const slot = booking ? booking.workerAssignments.find(s => s.slotId === slotId) : null;
  if (!booking || !slot) return;

  pendingAdminAssignBookingId = bookingId;
  pendingAdminAssignSlotId = slotId;
  selectedAdminCandidateProId = null;
  pendingAdminAssignAiContext = null;

  // Booking Summary
  const summaryEl = document.getElementById('admin-assign-booking-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div><strong>Booking:</strong> ${escapeHtml(booking.id)} — ${escapeHtml(booking.serviceTitle)}</div>
      <div><strong>Customer:</strong> ${escapeHtml(booking.customerName)} (${escapeHtml(booking.neighborhoodName)})</div>
      <div><strong>Timing:</strong> ${booking.timingType === 'asap' ? 'ASAP (On-Demand)' : `${escapeHtml(booking.scheduledDate)} at ${escapeHtml(booking.scheduledTime || 'TBD')}`}</div>
      <div><strong>Position:</strong> ${escapeHtml(slot.roleTitle)} (Worker Payout: $${Number(slot.payout || 0).toFixed(2)})</div>
    `;
  }

  // Candidates List (Always grounded in deterministic getProCandidatesForSlot)
  const candidatesContainer = document.getElementById('admin-assign-candidates-list');
  const candidates = getProCandidatesForSlot(bookingId, slotId);
  const preselectId = (aiPrefill && aiPrefill.preselectProId) ? aiPrefill.preselectProId : null;
  let preselectedApplied = false;

  if (candidatesContainer) {
    candidatesContainer.innerHTML = candidates.map(c => {
      const pro = c.pro;
      const isEligible = c.eligible;
      const isPreselected = !!(isEligible && preselectId && pro.id === preselectId);
      if (isPreselected) preselectedApplied = true;
      return `
        <label class="candidate-pro-card ${isEligible ? 'eligible' : 'ineligible'}" style="display: flex; gap: 12px; align-items: center;">
          <input type="radio" name="adminCandidatePro" value="${escapeHtml(pro.id)}" ${isEligible ? (isPreselected ? 'checked' : '') : 'disabled'}>
          <div style="display:flex;align-items:center;justify-content:center;color:var(--primary-navy);">${LUCIDE_ICONS.hardHat}</div>
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="color: var(--primary-navy);">${escapeHtml(pro.name)}</strong>
              <span class="tier-badge ${String(pro.tier || 'bronze').toLowerCase()}">${escapeHtml(pro.tier)}</span>
              <span style="font-size: 0.78rem; color: var(--text-muted);">${LUCIDE_ICONS.star} ${Number(pro.rating || 0)} (${Number(pro.reviewCount || 0)} reviews)</span>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">
              ${LUCIDE_ICONS.mapPin} ${escapeHtml(pro.homeNeighborhood)} • Reliability: ${Number(pro.reliabilityScore || 0)}%
            </div>
            <div style="font-size: 0.75rem; margin-top: 4px;">
              ${isEligible
                ? `<span style="color: #059669; font-weight: 700;">${LUCIDE_ICONS.check} Eligible and verified for this slot</span>`
                : `<span style="color: #DC2626; font-weight: 600;">Disqualified: ${escapeHtml(c.reason)}</span>`
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

  if (preselectedApplied) {
    selectedAdminCandidateProId = preselectId;
    pendingAdminAssignAiContext = {
      bookingId,
      slotId,
      preselectProId: preselectId,
      recommendation: aiPrefill.recommendation || null
    };
  }

  const aiBanner = document.getElementById('admin-assign-ai-banner');
  if (aiBanner) {
    if (preselectedApplied && aiPrefill) {
      const prov = (aiPrefill.recommendation && aiPrefill.recommendation.provenance) || {};
      const isLive = !!(
        prov.isLiveAi === true &&
        (prov.source === 'live_openai_ai' || prov.source === 'live_gemini_ai') &&
        !prov.isMockTestMode
      );
      const isOpenAi = isLive && (prov.source === 'live_openai_ai' || prov.provider === 'openai');
      const isMock = !!(prov.isMockTestMode === true || prov.source === 'mock_ai_test_mode');
      aiBanner.style.display = 'block';
      aiBanner.innerHTML = isLive
        ? `<strong>${LUCIDE_ICONS.bot} Live ${isOpenAi ? 'OpenAI' : 'Gemini'} Suggestion Loaded (Advisory Only):</strong> Eligible Pro preselected and reason drafted below. Edit reason if needed and check the confirmation box before approving.`
        : (isMock
          ? `<strong>${LUCIDE_ICONS.sparkles} Mock AI Response — Test Mode Loaded (Advisory Only):</strong> Simulated suggestion preselected (no live AI API call). Edit reason if needed and check the confirmation box before approving.`
          : `<strong>${LUCIDE_ICONS.shield} Rules Fallback Suggestion Loaded (Advisory Only):</strong> Eligible Pro preselected from deterministic ranking. Review details and check the confirmation box before approving.`);
    } else {
      aiBanner.style.display = 'none';
      aiBanner.innerHTML = '';
    }
  }

  // Populate editable draft reason ONLY when preselected cleanly; keep confirmation checkbox UNCHECKED.
  const reasonInput = document.getElementById('input-admin-assign-reason');
  if (reasonInput) {
    reasonInput.value = (preselectedApplied && aiPrefill && aiPrefill.draftReason)
      ? sanitizeAiText(aiPrefill.draftReason, AI_DISPATCH_CONFIG.REASON_MAX_CHARS)
      : '';
  }

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
  const confirmCheck = document.getElementById('check-admin-assign-confirm');

  if (!selectedAdminCandidateProId) {
    showToast('Please select an eligible Pro to assign.', 'warning');
    return;
  }
  if (!confirmCheck || !confirmCheck.checked) {
    showToast('Administrative confirmation checkbox is required before assigning a worker.', 'warning');
    return;
  }
  if (!reason) {
    showToast('Administrative reason is required for dispatch record.', 'warning');
    return;
  }

  // Revalidate recommendation freshness & live worker eligibility right before confirming.
  if (pendingAdminAssignAiContext && pendingAdminAssignAiContext.recommendation) {
    const freshCheck = verifyRecommendationFreshness(
      pendingAdminAssignAiContext.recommendation,
      pendingAdminAssignBookingId,
      { slotId: pendingAdminAssignSlotId, proId: selectedAdminCandidateProId }
    );
    if (!freshCheck.allowedForApproval) {
      delete aiDispatchUiMap[pendingAdminAssignBookingId];
      logAiDispatchAuditEvent({
        actionType: 'ai_dispatch_recommendation_rejected',
        bookingId: pendingAdminAssignBookingId,
        slotId: pendingAdminAssignSlotId,
        proId: selectedAdminCandidateProId,
        reason: 'Blocked stale AI-prefilled assignment; booking or worker state changed before confirmation.'
      });
      showToast(freshCheck.reason || 'Booking or worker state changed while modal was open. Candidates refreshed.', 'warning');
      openAdminAssignModal(pendingAdminAssignBookingId, pendingAdminAssignSlotId, null);
      renderAll();
      return;
    }
  }

  const liveEligibility = canProAcceptSlot(
    selectedAdminCandidateProId,
    pendingAdminAssignBookingId,
    pendingAdminAssignSlotId
  );
  if (!liveEligibility.allowed) {
    showToast(liveEligibility.reason || 'Selected worker is no longer eligible for this position.', 'warning');
    openAdminAssignModal(pendingAdminAssignBookingId, pendingAdminAssignSlotId, null);
    return;
  }

  const res = adminAssignPro(pendingAdminAssignBookingId, pendingAdminAssignSlotId, selectedAdminCandidateProId, reason);
  if (res.success) {
    showToast(`Successfully assigned worker to ${pendingAdminAssignSlotId}. Booking updated.`);
    pendingAdminAssignAiContext = null;
    pendingAdminAssignBookingId = null;
    pendingAdminAssignSlotId = null;
    selectedAdminCandidateProId = null;
    const modal = document.getElementById('admin-assign-modal');
    if (modal) modal.classList.remove('open');
    renderAll();
  } else {
    showToast(res.error || 'Failed to assign Pro.', 'warning');
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
    showToast('Administrative reason is required for worker unassignment.', 'warning');
    return;
  }

  const res = adminUnassignPro(pendingAdminUnassignBookingId, pendingAdminUnassignSlotId, pendingAdminUnassignProId, reason);
  if (res.success) {
    showToast(`Worker unassigned. Pending earnings reversed and position reopened.`);
    const modal = document.getElementById('admin-unassign-modal');
    if (modal) modal.classList.remove('open');
    renderAll();
  } else {
    showToast(res.error || 'Failed to unassign worker.', 'warning');
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
    showToast(check.reason, 'warning');
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
    showToast('Administrative reason is required for booking cancellation.', 'warning');
    return;
  }

  const confirmCheck = document.getElementById('check-admin-cancel-confirm');
  if (!confirmCheck || !confirmCheck.checked) {
    showToast('Please confirm the cancellation authorization checkbox.', 'warning');
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
    showToast(res.error || 'Failed to cancel booking.', 'warning');
  }
}

function openAdminVerifyCompleteModal(bookingId, slotId, proId, proName) {
  const state = loadState();
  const booking = (state.bookings || []).find(b => b.id === bookingId);
  const slot = booking ? (booking.workerAssignments || []).find(s => s.slotId === slotId) : null;
  if (!booking || !slot) return;

  const check = canSlotBeAdminCompleted(booking, slot);
  if (!check.allowed) {
    showToast(check.reason, 'warning');
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
    showToast('Documented verification notes and explanation are required.', 'warning');
    return;
  }

  const confirmCheck = document.getElementById('check-admin-verify-confirm');
  const isConfirmed = !!(confirmCheck && confirmCheck.checked);
  if (!isConfirmed) {
    showToast('Affirmative confirmation checkbox is required to verify completion.', 'warning');
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
    showToast(res.error || 'Failed to verify assignment completion.', 'warning');
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
              ${LUCIDE_ICONS.mapPin} ${escapeHtml(booking.address || 'Dallas, TX')} | ${LUCIDE_ICONS.calendar} ${booking.timingType === 'asap' ? 'ASAP Request' : (booking.scheduledDate + ' at ' + booking.scheduledTime)}
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
              let statusText = 'Ineligible';

              if (isAssigned) {
                badgeColor = '#4338CA';
                badgeBg = '#EEF2FF';
                statusText = 'Assigned to Job';
              } else if (evalRes.eligible) {
                badgeColor = '#059669';
                badgeBg = '#ECFDF5';
                statusText = 'Eligible for Slot';
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
        `<span class="worker-badge-pill verified">${LUCIDE_ICONS.check} ${escapeHtml(s)}</span>`
      ).join('');
      const equipPills = (pro.verifiedEquipment || []).map(eq =>
        `<span class="worker-badge-pill equipment">${LUCIDE_ICONS.wrench} ${escapeHtml(eq)}</span>`
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
              <div class="worker-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--primary-navy);">${LUCIDE_ICONS.hardHat}</div>
              <div>
                <h3 style="margin: 0 0 2px 0; font-size: 1.05rem; color: var(--primary-navy);">${escapeHtml(pro.name)}</h3>
                <span class="worker-tier-badge ${tierClass}">${escapeHtml(pro.tier)} Tier</span>
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700; color: #F59E0B; font-size: 0.95rem;">
                ${LUCIDE_ICONS.star} ${pro.rating ? pro.rating.toFixed(1) : '5.0'}
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
              <span class="worker-badge-pill" style="background: #F0FDF4; color: #166534; border-color: #86EFAC; display:inline-flex; align-items:center; gap:4px;">${LUCIDE_ICONS.shield} TX DPS Check Passed</span>
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
            ${LUCIDE_ICONS.alertTriangle} Demonstration Profile — Credentials & equipment simulated for INSY 3331.
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
                <span style="display:inline-flex;align-items:center;gap:4px;">${LUCIDE_ICONS.lock} <strong>${escapeHtml(latestNote.author)}</strong></span>
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
          <strong style="display:inline-flex;align-items:center;gap:4px;">${LUCIDE_ICONS.lock} ${escapeHtml(n.author)}</strong>
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
    const starsStr = renderStarRatingHtml(r.stars);
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
  const elStars = document.getElementById('trust-modal-stars'); if (elStars) elStars.innerHTML = renderStarRatingHtml(review.stars);
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
        showToast('Dispute reason is required.', 'warning');
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
        showToast(res.error || 'Failed to flag dispute.', 'warning');
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
        showToast('Investigation findings or resolution notes are required.', 'warning');
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
          showToast(res.error || 'Failed to update investigation.', 'warning');
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
    showToast(`Transferred $${res.netAmountDollars.toFixed(2)} via ${res.method}! (${res.notice})`, 'dollar');
    renderAll();
    if (res.transaction) {
      openReceiptModal(res.transaction, activePro.name);
    }
  } else {
    showToast(res.error || 'Withdrawal failed.', 'warning');
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
  if (statusPill) statusPill.innerHTML = tx.statusLabel || (LUCIDE_ICONS.check + ' Simulated Transfer Confirmed');

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
      const targetSpan = e.currentTarget; currentRatingSelection = parseInt(targetSpan.getAttribute('data-star') || e.target.getAttribute('data-star'), 10);
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
      showToast(result.error || 'Could not submit review. Please try again.', 'warning');
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

  // Stage 4.6B1: Customer AI Booking Concierge Handlers
  document.getElementById('btn-close-concierge')?.addEventListener('click', closeMovingConciergeModal);
  document.getElementById('btn-concierge-switch-standard')?.addEventListener('click', () => {
    closeMovingConciergeModal();
    openIntakeModal('moving');
  });
  document.getElementById('concierge-chat-form')?.addEventListener('submit', handleConciergeSendMessage);
  document.querySelectorAll('.concierge-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      const text = e.currentTarget.getAttribute('data-text');
      const inputEl = document.getElementById('concierge-user-input');
      if (inputEl && text) {
        inputEl.value = text;
        handleConciergeSendMessage();
      }
    });
  });
  document.getElementById('btn-concierge-confirm-booking')?.addEventListener('click', handleConciergeConfirmBooking);

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
        showToast('Please select both a date and time to reschedule.', 'warning');
        return;
      }

      const res = rescheduleBooking(pendingRescheduleBookingId, { newDate, newTime });
      if (res.success) {
        let msg = `Booking rescheduled to ${newDate} at ${newTime}.`;
        if (res.unassignedPros && res.unassignedPros.length > 0) {
          msg += ` (${res.unassignedPros.length} Pro assignment(s) unassigned due to schedule conflict)`;
        }
        showToast(msg, 'calendar');
        closeRescheduleModal();
        renderAll();
      } else {
        showToast(res.error || 'Failed to reschedule booking.', 'warning');
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
    pendingAdminAssignAiContext = null;
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
      showToast('Title and initial dispatcher note are required.', 'warning');
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
      showToast(res.error || 'Failed to create support case.', 'warning');
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
      showToast('Administrative reason is required for status change.', 'warning');
      return;
    }

    const res = updateSupportCaseStatus(currentActiveCaseId, newStatus, reason);
    if (res.success) {
      showToast(`Case ${currentActiveCaseId} updated to ${newStatus.toUpperCase().replace('_', ' ')}.`);
      openCaseDetailModal(currentActiveCaseId);
      renderAll();
    } else {
      showToast(res.error || 'Failed to update case status.', 'warning');
    }
  });

  document.getElementById('btn-case-detail-add-note')?.addEventListener('click', () => {
    if (!currentActiveCaseId) return;
    const noteInput = document.getElementById('input-case-detail-new-note');
    const noteText = (noteInput ? noteInput.value : '').trim();

    if (!noteText) {
      showToast('Note text cannot be empty.', 'warning');
      return;
    }

    const res = addSupportCaseNote(currentActiveCaseId, noteText);
    if (res.success) {
      showToast('Internal dispatcher note added.');
      if (noteInput) noteInput.value = '';
      openCaseDetailModal(currentActiveCaseId);
      renderAll();
    } else {
      showToast(res.error || 'Failed to add note.', 'warning');
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
      if (
        assignModal &&
        assignModal.classList.contains('open') &&
        pendingAdminAssignBookingId &&
        pendingAdminAssignSlotId
      ) {
        if (pendingAdminAssignAiContext && pendingAdminAssignAiContext.recommendation) {
          const crossTabFresh = verifyRecommendationFreshness(
            pendingAdminAssignAiContext.recommendation,
            pendingAdminAssignBookingId,
            { slotId: pendingAdminAssignSlotId, proId: selectedAdminCandidateProId }
          );
          if (!crossTabFresh.allowedForApproval) {
            delete aiDispatchUiMap[pendingAdminAssignBookingId];
            showToast('Cross-tab update detected; assignment candidates refreshed.', 'warning');
            openAdminAssignModal(pendingAdminAssignBookingId, pendingAdminAssignSlotId, null);
          }
        }
      }
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
