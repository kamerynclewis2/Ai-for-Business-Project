/**
 * Crewly Stage 4 Phase 4.4: Admin AI Dispatch UI, Proxy Integration,
 * Offline Fallback, Human Approval & Stale Invalidation Verification Suite.
 *
 * Uses dynamic future dates rather than fixed dates and runs completely offline
 * (mocked fetch transport + lightweight DOM harness) with zero live Gemini calls.
 */

if (typeof console === 'undefined') {
  globalThis.console = { log: print, warn: print, error: print };
} else {
  if (!console.log) console.log = print;
  if (!console.warn) console.warn = print;
  if (!console.error) console.error = print;
}

var mockStorage = {};
var mockSession = { 'crewly_active_role': 'admin' };
var elements = {};
var docListeners = {};
var winListeners = {};

function createElementMock(id, tag = 'div') {
  var el = {
    id: id,
    tagName: tag.toUpperCase(),
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    disabled: false,
    checked: false,
    classList: {
      _classes: new Set(),
      add: function(c) { this._classes.add(c); },
      remove: function(c) { this._classes.delete(c); },
      contains: function(c) { return this._classes.has(c); }
    },
    style: {},
    _listeners: {},
    _cachedHtmlSnapshot: null,
    _parsedCacheByKey: {},
    addEventListener: function(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    },
    dispatchEvent: function(event) {
      var ev = typeof event === 'string' ? { type: event, target: this, currentTarget: this } : event;
      if (!ev.target) ev.target = this;
      if (!ev.currentTarget) ev.currentTarget = this;
      var fns = this._listeners[ev.type] || [];
      for (var i = 0; i < fns.length; i++) fns[i](ev);
    },
    click: function() {
      if (!this.disabled) this.dispatchEvent({ type: 'click', target: this, currentTarget: this });
    },
    getAttribute: function(name) {
      return this._attrs ? (this._attrs[name] || null) : null;
    },
    appendChild: function() {},
    remove: function() {},
    querySelector: function(sel) {
      var list = this.querySelectorAll(sel);
      return list.length > 0 ? list[0] : null;
    },
    querySelectorAll: function(sel) {
      if (this === globalThis.document) {
        if (sel === '.admin-tab-panel') {
          return ['overview', 'alerts', 'dispatch', 'workers', 'support', 'finance', 'trust', 'audit']
            .map(function(t) { return globalThis.document.getElementById('admin-panel-' + t); });
        }
        if (sel === '.admin-subnav-btn') {
          return ['overview', 'alerts', 'dispatch', 'workers', 'support', 'finance', 'trust', 'audit'].map(function(t) {
            var btn = createElementMock('subnav_' + t, 'button');
            btn._attrs = { 'data-tab': t };
            return btn;
          });
        }
        return [];
      }

      // Parse HTML attributes for button/input selectors inside dynamically rendered containers.
      var html = String(this.innerHTML || '');
      if (!html) return [];

      var key = sel + '::' + html.length;
      if (this._cachedHtmlSnapshot !== html) {
        this._cachedHtmlSnapshot = html;
        this._parsedCacheByKey = {};
      }
      if (this._parsedCacheByKey[key]) {
        return this._parsedCacheByKey[key];
      }

      var results = [];
      if (sel.indexOf('input[name="adminCandidatePro"]') === 0) {
        var reInput = /<input\b([^>]*\bname=["']adminCandidatePro["'][^>]*)>/gi;
        var m;
        while ((m = reInput.exec(html)) !== null) {
          var attrsStr = m[1];
          var radio = createElementMock('radio_cand', 'input');
          radio._attrs = parseTagAttrs(attrsStr);
          radio.value = radio._attrs.value || '';
          radio.disabled = /\bdisabled\b/i.test(attrsStr);
          radio.checked = /\bchecked\b/i.test(attrsStr);
          results.push(radio);
        }
      } else if (sel.startsWith('.')) {
        var cleanClass = sel.replace(':not([disabled])', '').substring(1);
        var requireEnabled = sel.includes(':not([disabled])');
        var reTag = /<([a-z0-9]+)\b([^>]*\bclass=["'][^"']*["'][^>]*)>/gi;
        var m2;
        while ((m2 = reTag.exec(html)) !== null) {
          var attrs2 = parseTagAttrs(m2[2]);
          var classes = String(attrs2.class || '').split(/\s+/);
          var isDis = /\bdisabled\b/i.test(m2[2]);
          if (classes.indexOf(cleanClass) !== -1 && (!requireEnabled || !isDis)) {
            var elem = createElementMock(attrs2.id || cleanClass, m2[1]);
            elem._attrs = attrs2;
            elem.disabled = isDis;
            results.push(elem);
          }
        }
      }

      this._parsedCacheByKey[key] = results;
      return results;
    }
  };
  return el;
}

function parseTagAttrs(attrText) {
  var out = {};
  var re = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"|([a-zA-Z0-9_-]+)\s*=\s*'([^']*)'/g;
  var m;
  while ((m = re.exec(attrText)) !== null) {
    if (m[1]) out[m[1]] = m[2];
    else if (m[3]) out[m[3]] = m[4];
  }
  return out;
}

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

globalThis.document = {
  createElement: function(tag) {
    return createElementMock('created_' + (tag || 'div'), tag || 'div');
  },
  getElementById: function(id) {
    if (!elements[id]) {
      var tag = 'div';
      if (id && id.indexOf('btn-') === 0) tag = 'button';
      if (id && id.indexOf('check-') === 0) tag = 'input';
      if (id && id.indexOf('input-') === 0) tag = 'textarea';
      if (id && id.indexOf('admin-dispatch-filter') === 0) tag = 'select';
      elements[id] = createElementMock(id, tag);
    }
    return elements[id];
  },
  querySelector: function(sel) {
    if (sel.startsWith('#')) return this.getElementById(sel.substring(1));
    return createElementMock('mock_query', 'div');
  },
  querySelectorAll: function(sel) {
    return createElementMock('__doc__', 'document').querySelectorAll.call(this, sel);
  },
  addEventListener: function(event, fn) {
    if (!docListeners[event]) docListeners[event] = [];
    docListeners[event].push(fn);
  }
};

globalThis.window = {
  location: { search: '?role=admin', pathname: '/index.html', origin: 'http://localhost:8000', href: 'http://localhost:8000/index.html?role=admin' },
  history: {
    replaceState: function(s, t, url) {
      window.location.href = url;
      window.location.search = url.indexOf('?') !== -1 ? url.substring(url.indexOf('?')) : '';
    }
  },
  addEventListener: function(event, fn) {
    if (!winListeners[event]) winListeners[event] = [];
    winListeners[event].push(fn);
  },
  dispatchEvent: function(e) {
    var ev = typeof e === 'string' ? { type: e } : e;
    var fns = winListeners[ev.type] || [];
    for (var i = 0; i < fns.length; i++) fns[i](ev);
  }
};

globalThis.CustomEvent = function(type, opts) {
  this.type = type;
  this.detail = opts ? opts.detail : null;
};

globalThis.alert = function() {};
globalThis.confirm = function() { return true; };
if (typeof globalThis.setTimeout !== 'function') {
  globalThis.setTimeout = function() { return 0; };
  globalThis.clearTimeout = function() {};
}

import {
  loadState,
  saveState,
  resetStateToSeed,
  createBooking,
  canProAcceptSlot,
  assignProToSlot,
  adminAssignPro,
  getAdminFinancialSummary,
  getDallasLocalNow,
  resolveAiDispatchProxyConfig,
  requestAiDispatchAdvice,
  validateAndNormalizeAiRecommendation,
  getBookingAiDispatchEligibility
} from '../matching.js';

var passed = 0;
var failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    print("  PASS: " + message);
  } else {
    failed++;
    print("  FAIL: " + message);
  }
}

function getDynamicFutureBusinessDateStr(minDaysAhead = 2) {
  var dallasNow = getDallasLocalNow();
  var dayOffset = minDaysAhead;
  var candidate = null;
  while (true) {
    candidate = new Date(dallasNow.fullDate.getTime() + dayOffset * 86400000);
    if (candidate.getDay() !== 0) break; // Mon-Sat guarantees all 4 Dallas Pros available
    dayOffset++;
  }
  var yyyy = candidate.getFullYear();
  var mm = String(candidate.getMonth() + 1).padStart(2, '0');
  var dd = String(candidate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

resetStateToSeed();
// Disable autoBook in test setup so created test bookings retain predictable open slots
var setupState = loadState();
setupState.pros.forEach(function(p) { p.autoBookEnabled = false; });
saveState(setupState);
const {
  triggerAdminAiDispatchAdvice,
  getAdminAiDispatchUiStateForTest
} = await import('../app.js');
var dclList = docListeners['DOMContentLoaded'] || [];
for (var d = 0; d < dclList.length; d++) dclList[d]();

// Set filter to 'all' so created open, partially_filled, cancelled, completed bookings remain inspectable
var filterEl = document.getElementById('admin-dispatch-filter-status');
filterEl.value = 'all';

print("\n==================================================================");
print("STAGE 4 PHASE 4.4: ADMIN AI DISPATCH UI & INTEGRATION TEST SUITE");
print("==================================================================");

// ------------------------------------------------------------------
// Group 1: Dynamic Booking Setup & UI Button / Banner Rendering
// ------------------------------------------------------------------
print("\n[Group 1: UI Button Behavior, Local Proxy Gating & Dynamic Bookings]");

var dynamicDate1 = getDynamicFutureBusinessDateStr(1);
var dynamicDate2 = getDynamicFutureBusinessDateStr(3);
var dynamicDate3 = getDynamicFutureBusinessDateStr(5);
var dynamicDate4 = getDynamicFutureBusinessDateStr(7);
var dynamicDate5 = getDynamicFutureBusinessDateStr(9);

// Create a fresh open 2-mover scheduled booking (dynamic future date, zero expiration brittleness)
var resTwoOpen = createBooking({
  customerId: 'cust_sarah',
  address: '2910 Cedar Springs Rd, Dallas, TX 75201',
  zipCode: '75201',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: dynamicDate1,
  scheduledTime: '11:00',
  intakeDetails: { workersNeeded: 2, hours: 2, truckNeeded: false, notes: 'Secret gate 7788' }
});
assert(!!(resTwoOpen && resTwoOpen.id), "Created dynamic future 2-worker moving booking cleanly (" + resTwoOpen.id + " on " + dynamicDate1 + ")");
var openTwoId = resTwoOpen.id;

// Create a partially-filled multi-worker moving booking (Marcus assigned slot_1, slot_2 open)
var resPartial = createBooking({
  customerId: 'cust_david',
  address: '6411 Mockingbird Ln, Dallas, TX 75214',
  zipCode: '75214',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: dynamicDate2,
  scheduledTime: '11:00',
  intakeDetails: { workersNeeded: 2, hours: 2, truckNeeded: false, notes: 'Call phone 214-555-9900 at gate' }
});
assert(!!(resPartial && resPartial.id), "Created dynamic future 2-worker moving booking cleanly (" + resPartial.id + ")");
var partialId = resPartial.id;
assignProToSlot(partialId, 'slot_1', 'pro_marcus');

document.getElementById('admin-dispatch-search').dispatchEvent('input');
var dispatchListEl = document.getElementById('admin-dispatch-bookings-list');
var aiBtns = dispatchListEl.querySelectorAll('.btn-ai-dispatch');
var renderedBtnBookingIds = aiBtns.map(function(b) { return b.getAttribute('data-booking-id'); });

assert(renderedBtnBookingIds.includes(openTwoId), "Get AI Dispatch Advice button renders on dynamic open booking " + openTwoId);
assert(renderedBtnBookingIds.includes(partialId), "Get AI Dispatch Advice button renders on partially filled booking " + partialId);
assert(!renderedBtnBookingIds.includes('CRW-1002'), "Completed/confirmed booking CRW-1002 omits Get AI Dispatch Advice button");
assert(!renderedBtnBookingIds.includes('CRW-1003'), "Completed booking CRW-1003 omits Get AI Dispatch Advice button");

// Check GitHub Pages / file:// origin gating
var pagesCfg = resolveAiDispatchProxyConfig({ locationOrigin: 'https://crewly-demo.github.io' });
var fileCfg = resolveAiDispatchProxyConfig({ locationOrigin: 'null' });
var localCfg = resolveAiDispatchProxyConfig({ locationOrigin: 'http://localhost:8000' });
assert(pagesCfg.enabled === false && pagesCfg.endpoint === null, "GitHub Pages HTTPS origin cleanly disables localhost proxy calls");
assert(fileCfg.enabled === false && fileCfg.endpoint === null, "file:// origin cleanly disables localhost proxy calls");
assert(localCfg.enabled === true && localCfg.endpoint === 'http://127.0.0.1:8787/api/dispatch/recommend', "Local dev origin enables exact 127.0.0.1:8787 dispatch endpoint");

// Invalid booking (completed/cancelled) test
var resInvalidCall = await triggerAdminAiDispatchAdvice('CRW-1003');
assert(resInvalidCall.ok === false, "Triggering AI advice on completed booking CRW-1003 fails cleanly without proxy call");
var invalidPanelHtml = document.getElementById('admin-dispatch-bookings-list').innerHTML;
assert(invalidPanelHtml.includes('Completed bookings are already finalized') || invalidPanelHtml.includes('Dispatch Advice Unavailable'), "Displays clear message when requesting advice for invalid booking");

// ------------------------------------------------------------------
// Group 2: Offline Fallback (Proxy Stopped / Unconfigured / GitHub Pages)
// ------------------------------------------------------------------
print("\n[Group 2: Offline Fallback & Clear Fallback Provenance]");

var offlineFetchCount = 0;
var resOfflineUnreachable = await triggerAdminAiDispatchAdvice(partialId, {
  fetchFn: async function() {
    offlineFetchCount++;
    throw new Error('Failed to fetch: ECONNREFUSED 127.0.0.1:8787');
  }
});
assert(offlineFetchCount === 1, "Attempted local proxy once on localhost origin before falling back");
assert(resOfflineUnreachable.ok === true && resOfflineUnreachable.recommendation.provenance.isLiveAi === false, "Proxy unreachable cleanly falls back to deterministic rules ranking (never pretends Gemini called)");

var dispatchHtmlFallback = document.getElementById('admin-dispatch-bookings-list').innerHTML;
assert(dispatchHtmlFallback.includes('data-provenance="rules_fallback"') && dispatchHtmlFallback.includes('Rules-Based Fallback'), "Fallback UI badge explicitly labels Rules-Based Fallback (No Gemini Call)");
assert(dispatchHtmlFallback.includes('Review &amp; Apply in Assign Modal') || dispatchHtmlFallback.includes('Review & Apply in Assign Modal'), "Fallback renders actionable Review & Apply button");
assert(dispatchHtmlFallback.includes('Manual Assign Alternative'), "Renders manual assignment alternative button");

// GitHub Pages origin skips network fetch completely
var pagesFetchCount = 0;
var resPagesOffline = await triggerAdminAiDispatchAdvice(partialId, {
  locationOrigin: 'https://teamcrewly.github.io',
  fetchFn: async function() {
    pagesFetchCount++;
    throw new Error('Should not be called');
  }
});
assert(pagesFetchCount === 0 && resPagesOffline.recommendation.provenance.isLiveAi === false, "Non-local origin skips network fetch completely and runs offline fallback");

// Proxy HTTP 503 proxy_not_configured -> clean fallback with zero secret leak
var res503 = await triggerAdminAiDispatchAdvice(partialId, {
  fetchFn: async function() {
    return {
      ok: false,
      status: 503,
      json: async function() {
        return {
          ok: false,
          code: 'proxy_not_configured',
          error: 'Local proxy disabled: GEMINI_API_KEY is not configured.',
          fallbackRecommended: true
        };
      }
    };
  }
});
assert(res503.ok === true && res503.recommendation.provenance.isLiveAi === false, "HTTP 503 unconfigured proxy falls back gracefully to Crewly rules");

// Timeout fallback
var resTimeout = await triggerAdminAiDispatchAdvice(partialId, {
  fetchFn: async function() {
    var e = new Error('The operation timed out.');
    e.name = 'AbortError';
    throw e;
  }
});
assert(resTimeout.ok === true && resTimeout.recommendation.provenance.fallbackReason === 'proxy_timeout', "Aborted/timeout proxy request triggers deterministic proxy_timeout fallback");

// ------------------------------------------------------------------
// Group 3: Mocked Proxy Test Mode, Provenance Integrity, Privacy & XSS
// ------------------------------------------------------------------
print("\n[Group 3: Mock AI Test Mode, Provenance Integrity, Multi-Worker Distinctness, Privacy & XSS]");

var capturedProxyRequests = [];
// Even if a test mock stub includes liveAiAttempted/inferenceSource claiming live,
// injected fetchFn test mode must prevent claiming Live Gemini AI!
var mockedGeminiRespTwoOpen = {
  ok: true,
  inferenceSource: 'live_gemini_ai',
  isSimulatedTestMode: false,
  liveAiAttempted: true,
  shortCircuitedZeroEligible: false,
  model: 'gemini-3.5-flash-lite',
  bookingId: openTwoId,
  recommendation: {
    bookingId: openTwoId,
    slotRecommendations: [
      {
        slotId: 'slot_1',
        draftAdminReason: 'Gemini Draft <script>window.__xss=1;</script> Assign Marcus to slot_1.',
        rankedCandidates: [
          {
            proId: 'pro_carlos', // INELIGIBLE: Carlos is lawn_mowing only, NOT moving!
            fitSummary: 'Hallucinated wrong-trade match for moving',
            rationaleBullets: ['Should be rejected by live canProAcceptSlot'],
            cautionNote: ''
          },
          {
            proId: 'pro_ghost_999', // UNKNOWN hallucinated Pro ID
            fitSummary: 'Fake ghost worker',
            rationaleBullets: ['Should be stripped'],
            cautionNote: ''
          },
          {
            proId: 'pro_marcus',
            fitSummary: '<img src=x onerror=window.__xss=2>Top verified mover in Uptown Dallas pilot zone.',
            rationaleBullets: ['Verified moving & heavy dolly equipment', '98% reliability score'],
            cautionNote: 'Monitor active weekend schedule'
          },
          {
            proId: 'pro_jamar',
            fitSummary: 'Backup verified moving Pro.',
            rationaleBullets: ['Available within window'],
            cautionNote: ''
          }
        ]
      },
      {
        slotId: 'slot_2',
        draftAdminReason: 'Assign Jamar to slot_2 to keep primary movers distinct.',
        rankedCandidates: [
          {
            proId: 'pro_marcus',
            fitSummary: 'Strong mover, already primary on slot_1.',
            rationaleBullets: ['High rating'],
            cautionNote: ''
          },
          {
            proId: 'pro_jamar',
            fitSummary: 'Verified moving partner for 2-person crew.',
            rationaleBullets: ['Verified moving skill & dolly equipment'],
            cautionNote: ''
          }
        ]
      }
    ],
    operationalRisks: [
      { severity: 'low', code: 'multi_worker_coordination', message: 'Two movers required before confirmation. <b>Bold</b>' }
    ],
    shortageAssessment: 'sufficient_supply',
    recommendedNextAction: 'approve_top_candidate'
  }
};

var resLive = await triggerAdminAiDispatchAdvice(openTwoId, {
  fetchFn: async function(url, init) {
    capturedProxyRequests.push({
      url: url,
      headers: init.headers || {},
      body: JSON.parse(init.body)
    });
    return {
      ok: true,
      status: 200,
      json: async function() { return mockedGeminiRespTwoOpen; }
    };
  }
});

assert(capturedProxyRequests.length === 1, "Mocked local proxy fetch invoked once for open booking " + openTwoId);
var sentReq = capturedProxyRequests[0];
assert(sentReq.url === 'http://127.0.0.1:8787/api/dispatch/recommend', "Frontend targets exact local loopback proxy URL");
assert(!('x-goog-api-key' in sentReq.headers) && !('authorization' in sentReq.headers), "Browser request contains ZERO API keys or Authorization headers");
var sentJson = JSON.stringify(sentReq.body);
assert(!sentJson.includes('Secret gate 7788') && !sentJson.includes('Cedar Springs') && !sentJson.includes('Sarah Jenkins'), "Browser request payload strips customer names, street addresses, and private gate notes");

assert(
  resLive.ok === true &&
  resLive.recommendation.provenance.source === 'mock_ai_test_mode' &&
  resLive.recommendation.provenance.isMockTestMode === true &&
  resLive.recommendation.provenance.isLiveAi === false,
  "Injected fetchFn test harness forces Mock AI Response — Test Mode provenance (never pretends Live Gemini AI)"
);
var genuineProvTest = validateAndNormalizeAiRecommendation(mockedGeminiRespTwoOpen.recommendation, openTwoId, {
  inferenceSource: 'live_gemini_ai',
  isSimulatedTestMode: false,
  model: 'gemini-3.5-flash-lite'
});
assert(
  genuineProvTest.provenance.source === 'live_gemini_ai' &&
  genuineProvTest.provenance.isLiveAi === true &&
  genuineProvTest.provenance.isMockTestMode === false,
  "Controlled live_gemini_ai backend source produces genuine Live Gemini AI provenance"
);
assert(resLive.recommendation.validationReport.rejectedCandidateCount === 2, "Trust Boundary stripped both ineligible pro_carlos and hallucinated pro_ghost_999");

var slot1Rec = resLive.recommendation.slotRecommendations.find(function(s) { return s.slotId === 'slot_1'; });
var slot2Rec = resLive.recommendation.slotRecommendations.find(function(s) { return s.slotId === 'slot_2'; });
assert(slot1Rec.recommendedPrimaryProId !== slot2Rec.recommendedPrimaryProId, "Multi-worker recommendation guarantees distinct primary Pros across slot_1 and slot_2 (" + slot1Rec.recommendedPrimaryProId + " vs " + slot2Rec.recommendedPrimaryProId + ")");
assert(slot1Rec.recommendedPrimaryProId === 'pro_marcus' && slot2Rec.recommendedPrimaryProId === 'pro_jamar', "Selects valid verified crew combination Marcus + Jamar");

var renderedLiveHtml = document.getElementById('admin-dispatch-bookings-list').innerHTML;
var panelStartIdx = renderedLiveHtml.indexOf('id="ai-panel-' + openTwoId + '"');
var panelFooterIdx = panelStartIdx !== -1 ? renderedLiveHtml.indexOf('class="ai-panel-footer"', panelStartIdx) : -1;
var panelEndClose = panelFooterIdx !== -1 ? renderedLiveHtml.indexOf('</div>', panelFooterIdx) + 6 : renderedLiveHtml.length;
var aiPanelLiveHtml = panelStartIdx !== -1 ? renderedLiveHtml.slice(panelStartIdx, panelEndClose) : '';
assert(
  aiPanelLiveHtml.includes('data-provenance="mock_test_mode"') &&
  aiPanelLiveHtml.includes('Mock AI Response — Test Mode') &&
  !aiPanelLiveHtml.includes('Live Gemini AI'),
  "UI renders clear Mock AI Response — Test Mode badge and NEVER displays Live Gemini AI in mock mode"
);
var mockAuditEntry = loadState().adminAuditLog.find(function(a) { return a.actionType === 'ai_dispatch_recommended' && a.bookingId === openTwoId; });
assert(
  mockAuditEntry && String(mockAuditEntry.verificationSource || '').includes('Mock AI Response — Test Mode') && !String(mockAuditEntry.verificationSource || '').includes('Live Gemini AI'),
  "Audit log records Mock AI Response — Test Mode rather than Live Gemini AI"
);
assert(!aiPanelLiveHtml.includes('pro_carlos') && !aiPanelLiveHtml.includes('pro_ghost_999') && !aiPanelLiveHtml.includes('Carlos Mendez'), "Ineligible Carlos and hallucinated ghost worker never appear in UI candidate cards");
assert(!aiPanelLiveHtml.includes('<script') && !aiPanelLiveHtml.includes('onerror='), "Sanitizes & escapes all XSS markup from mocked Gemini output");

// Recommendations remain visible after unrelated state updates (appropriate updates)
await triggerAdminAiDispatchAdvice(partialId, { forceOffline: true });
assert(getAdminAiDispatchUiStateForTest()[openTwoId].status === 'ready', "Live recommendation on " + openTwoId + " remains intact after unrelated action on " + partialId);
assert(document.getElementById('admin-dispatch-bookings-list').innerHTML.includes('ai-panel-' + openTwoId), "Recommendation panel stays rendered across unrelated updates");

// Insufficient workers scenario (3 open moving slots with only 2 eligible Pros -> max 2 unique workers)
var resInsuff = createBooking({
  customerId: 'cust_sarah',
  address: '100 Uptown Plaza, Dallas, TX 75201',
  zipCode: '75201',
  serviceCategory: 'moving',
  timingType: 'scheduled',
  scheduledDate: dynamicDate3,
  scheduledTime: '11:00',
  intakeDetails: { workersNeeded: 3, hours: 2 }
});
// Only Marcus and Jamar have moving -> max 2 fillable out of 3 open slots!
var insufFetchCalls = 0;
var resInsufAdvice = await triggerAdminAiDispatchAdvice(resInsuff.id, {
  fetchFn: async function() {
    insufFetchCalls++;
    return {
      ok: true,
      status: 200,
      json: async function() {
        return {
          ok: true,
          model: 'gemini-3.5-flash-lite',
          recommendation: {
            bookingId: resInsuff.id,
            slotRecommendations: [
              { slotId: 'slot_1', draftAdminReason: 'Assign Marcus', rankedCandidates: [{ proId: 'pro_marcus', fitSummary: 'Lead mover', rationaleBullets: ['Verified'], cautionNote: '' }] },
              { slotId: 'slot_2', draftAdminReason: 'Assign Jamar', rankedCandidates: [{ proId: 'pro_jamar', fitSummary: 'Second mover', rationaleBullets: ['Verified'], cautionNote: '' }] },
              { slotId: 'slot_3', draftAdminReason: 'Cannot fill', rankedCandidates: [{ proId: 'pro_marcus', fitSummary: 'Duplicate!', rationaleBullets: ['Same pro'], cautionNote: '' }] }
            ],
            operationalRisks: [],
            shortageAssessment: 'tight_supply',
            recommendedNextAction: 'escalate_support_case'
          }
        };
      }
    };
  }
});
assert(resInsufAdvice.recommendation.staffingFeasibility.fullCrewFeasible === false, "Detects insufficient unique workers across 3-mover booking");
assert(document.getElementById('admin-dispatch-bookings-list').innerHTML.includes('Multi-Worker Supply Alert'), "UI communicates multi-worker supply shortage banner clearly");

// ------------------------------------------------------------------
// Group 4: Duplicate Request Guard, Human Approval & Invariant Checks
// ------------------------------------------------------------------
print("\n[Group 4: Duplicate Protection, Admin Approval Modal & Financial Invariants]");

// Snapshot state before clicking Apply — verify zero automatic assignment!
var stateBeforeModal = loadState();
var finBeforeModal = getAdminFinancialSummary(stateBeforeModal);
var marcusBeforePending = stateBeforeModal.pros.find(function(p) { return p.id === 'pro_marcus'; }).earnings.pendingBalance;

// Simulate clicking Apply Suggestion for openTwoId / slot_1 / pro_marcus
var applyBtns = document.getElementById('admin-dispatch-bookings-list').querySelectorAll('.btn-ai-apply-suggestion');
var targetApplyBtn = applyBtns.find(function(b) {
  return b.getAttribute('data-booking-id') === openTwoId &&
    b.getAttribute('data-slot-id') === 'slot_1' &&
    b.getAttribute('data-pro-id') === 'pro_marcus';
});
assert(!!targetApplyBtn, "Apply Suggestion button rendered for slot_1 / pro_marcus on " + openTwoId);
targetApplyBtn.click();

var assignModalEl = document.getElementById('admin-assign-modal');
var confirmCheckEl = document.getElementById('check-admin-assign-confirm');
var confirmAssignBtn = document.getElementById('btn-confirm-admin-assign');
var reasonTextarea = document.getElementById('input-admin-assign-reason');
var radioEls = document.getElementById('admin-assign-candidates-list').querySelectorAll('input[name="adminCandidatePro"]');
var marcusRadio = radioEls.find(function(r) { return r.value === 'pro_marcus'; });

assert(assignModalEl.classList.contains('open'), "Clicking Apply Suggestion opens existing Admin assignment modal");
assert(marcusRadio && marcusRadio.checked === true, "Eligible Pro Marcus preselected in assignment modal");
assert(reasonTextarea.value.length > 0 && !reasonTextarea.value.includes('<script'), "Editable administrative reason drafted without executable HTML");
assert(confirmCheckEl.checked === false && confirmAssignBtn.disabled === true, "Admin confirmation checkbox remains UNCHECKED and Confirm button disabled");

// Verify clicking Apply did NOT mutate bookings or balances yet
var stateAfterModalOpen = loadState();
var openTwoBookingMid = stateAfterModalOpen.bookings.find(function(b) { return b.id === openTwoId; });
assert(openTwoBookingMid.workerAssignments[0].status === 'unassigned', "Applying AI suggestion NEVER auto-assigns a worker before explicit confirmation");
assert(stateAfterModalOpen.pros.find(function(p) { return p.id === 'pro_marcus'; }).earnings.pendingBalance === marcusBeforePending, "Applying AI suggestion NEVER modifies worker balances");

// Attempt confirm while checkbox UNCHECKED -> blocked!
document.getElementById('btn-confirm-admin-assign').dispatchEvent('click');
assert(loadState().bookings.find(function(b) { return b.id === openTwoId; }).workerAssignments[0].status === 'unassigned', "Confirm handler refuses assignment when confirmation checkbox is unchecked");

// Now check confirmation checkbox, customize reason, confirm via adminAssignPro path
confirmCheckEl.checked = true;
confirmCheckEl.dispatchEvent('change');
assert(confirmAssignBtn.disabled === false, "Checking confirmation checkbox enables Confirm Assignment button");
reasonTextarea.value = 'Admin verified Marcus qualifications for dynamic moving request.';
confirmAssignBtn.dispatchEvent('click');

var stateAfterAssign = loadState();
var assignedBooking = stateAfterAssign.bookings.find(function(b) { return b.id === openTwoId; });
var assignedSlot1 = assignedBooking.workerAssignments.find(function(s) { return s.slotId === 'slot_1'; });
var expectedPayout = assignedSlot1.payout;
assert(assignedSlot1.status === 'assigned' && assignedSlot1.assignedProId === 'pro_marcus', "Checked Admin confirmation completes assignment cleanly via adminAssignPro()");
assert(assignedBooking.overallStatus === 'partially_filled', "Multi-worker booking remains partially_filled after 1 of 2 slots assigned");
assert(stateAfterAssign.pros.find(function(p) { return p.id === 'pro_marcus'; }).earnings.pendingBalance === marcusBeforePending + expectedPayout, "Worker pending balance credited accurately once (+$" + expectedPayout + ")");
assert(stateAfterAssign.adminAuditLog.some(function(a) { return a.actionType === 'worker_assigned' && a.bookingId === openTwoId && a.proId === 'pro_marcus'; }), "Assignment audit log recorded via adminAssignPro()");

// Duplicate assign prevention: trying to assign pro_marcus to slot_2 must be blocked!
var dupAttempt = adminAssignPro(openTwoId, 'slot_2', 'pro_marcus', 'Attempting duplicate assignment');
assert(dupAttempt.success === false, "Prevents assigning the same Pro twice onto slot_2 of the same booking");

// Duplicate loading-click protection (in-flight debounce)
var resolveDeferred;
var deferredPromise = new Promise(function(resolve) { resolveDeferred = resolve; });
var dupFetchCalls = 0;
var p1 = triggerAdminAiDispatchAdvice(openTwoId, {
  fetchFn: function() {
    dupFetchCalls++;
    return deferredPromise;
  }
});
var p2 = await triggerAdminAiDispatchAdvice(openTwoId, {
  fetchFn: function() {
    dupFetchCalls++;
    return deferredPromise;
  }
});
assert(p2.duplicateBlocked === true && dupFetchCalls === 1, "Duplicate button click while loading is blocked with single proxy request");

// Mid-flight stale test: while p1 waits on deferredPromise, cross-tab/local action assigns Jamar to slot_2!
assignProToSlot(openTwoId, 'slot_2', 'pro_jamar');
resolveDeferred({
  ok: true,
  status: 200,
  json: async function() {
    return { ok: true, model: 'gemini-3.5-flash-lite', recommendation: mockedGeminiRespTwoOpen.recommendation };
  }
});
var resStaleInFlight = await p1;
assert(resStaleInFlight.ok === false && resStaleInFlight.staleDetected === true, "Mid-flight booking completion causes in-flight AI response to be discarded cleanly");

// ------------------------------------------------------------------
// Group 5: Cross-Tab Storage Invalidation & Stale Modal Guard
// ------------------------------------------------------------------
print("\n[Group 5: Cross-Tab Storage Invalidation & Stale Modal Protection]");

// Fresh 1-worker booking on dynamic future date for cross-tab stale test
var resCross = createBooking({
  customerId: 'cust_david',
  address: '6200 Abrams Rd, Dallas, TX 75214',
  zipCode: '75214',
  serviceCategory: 'tv_mounting',
  timingType: 'scheduled',
  scheduledDate: dynamicDate4,
  scheduledTime: '13:00',
  intakeDetails: { tvSize: '55 inch' }
});
var crossId = resCross.id;
await triggerAdminAiDispatchAdvice(crossId, { forceOffline: true });
assert(getAdminAiDispatchUiStateForTest()[crossId].status === 'ready', "Cached fallback advice ready for " + crossId);

// Simulate cross-tab change updating booking duration in localStorage
var crossState = JSON.parse(mockStorage['crewly_marketplace_state_v1']);
crossState.bookings.find(function(b) { return b.id === crossId; }).estimatedDurationHours = 2.5;
mockStorage['crewly_marketplace_state_v1'] = JSON.stringify(crossState);
window.dispatchEvent({ type: 'storage', key: 'crewly_marketplace_state_v1' });

assert(getAdminAiDispatchUiStateForTest()[crossId].status === 'stale_discarded', "Cross-tab storage event discards stale recommendation immediately");
assert(document.getElementById('admin-dispatch-bookings-list').innerHTML.includes('Stale Advice Discarded'), "Cross-tab stale invalidation displays clear warning banner");

// Open modal guard: prefill on dynamic booking, then invalidate slot behind the scenes before Confirm click!
var resModalStale = createBooking({
  customerId: 'cust_sarah',
  address: '101 Turtle Creek Blvd, Dallas, TX 75201',
  zipCode: '75201',
  serviceCategory: 'tv_mounting',
  timingType: 'scheduled',
  scheduledDate: dynamicDate5,
  scheduledTime: '12:00',
  intakeDetails: { tvSize: '65 inch' }
});
var modalStaleId = resModalStale.id;
await triggerAdminAiDispatchAdvice(modalStaleId, { forceOffline: true });
var applyBtns2 = document.getElementById('admin-dispatch-bookings-list').querySelectorAll('.btn-ai-apply-suggestion');
var elenaBtn = applyBtns2.find(function(b) {
  return b.getAttribute('data-booking-id') === modalStaleId && b.getAttribute('data-slot-id') === 'slot_1';
});
assert(!!elenaBtn, "Apply suggestion rendered for " + modalStaleId);
elenaBtn.click();

// Simulate someone accepting slot_1 right before Admin clicks Confirm Assignment
assignProToSlot(modalStaleId, 'slot_1', 'pro_marcus');
document.getElementById('check-admin-assign-confirm').checked = true;
document.getElementById('check-admin-assign-confirm').dispatchEvent('change');
document.getElementById('btn-confirm-admin-assign').dispatchEvent('click');

var finalCrossBooking = loadState().bookings.find(function(b) { return b.id === modalStaleId; });
assert(finalCrossBooking.workerAssignments[0].assignedProId === 'pro_marcus', "Stale modal guard prevents double-assigning over slot already accepted elsewhere");
assert(loadState().adminAuditLog.some(function(a) { return a.actionType === 'ai_dispatch_recommendation_rejected' && a.bookingId === modalStaleId; }), "Logs ai_dispatch_recommendation_rejected when stale modal approval is blocked");

// ---------------------------------------------------------------------------
// 7. Stage 4.5 OpenAI (gpt-6-luna) Provenance, Mock Separation & Live Label UI
// ---------------------------------------------------------------------------
print("\n[Stage 4.5: OpenAI gpt-6-luna UI Provenance & Mock Test Separation]");
var resOpenAiBooking = createBooking({
  customerId: 'cust_sarah',
  address: '4400 Lomo Alto Dr, Dallas, TX 75219',
  zipCode: '75219',
  serviceCategory: 'tv_mounting',
  timingType: 'scheduled',
  scheduledDate: getDynamicFutureBusinessDateStr(8),
  scheduledTime: '14:00',
  intakeDetails: { tvSize: '55 inch' }
});
var openAiBookingId = resOpenAiBooking.id;

var openAiSamplePayload = {
  ok: true,
  provider: 'openai',
  inferenceSource: 'live_openai_ai',
  isSimulatedTestMode: false,
  liveAiAttempted: true,
  model: 'gpt-6-luna',
  recommendation: {
    bookingId: openAiBookingId,
    slotRecommendations: [
      {
        slotId: 'slot_1',
        draftAdminReason: 'Elena is verified for TV mounting and clear at 14:00.',
        rankedCandidates: [
          {
            proId: 'pro_elena',
            fitSummary: 'Platinum specialist verified for TV mounting.',
            rationaleBullets: ['Platinum reliability tier', 'Available at 14:00'],
            cautionNote: ''
          }
        ]
      }
    ],
    operationalRisks: [
      { severity: 'low', code: 'pilot_zone_check', message: 'Pilot zone label check only; no GPS routing.' }
    ],
    shortageAssessment: 'sufficient_supply',
    recommendedNextAction: 'approve_top_candidate'
  }
};

// Case A: Injected fetchFn must STILL stay Mock Test Mode even if payload says live_openai_ai
var resOpenAiMocked = await triggerAdminAiDispatchAdvice(openAiBookingId, {
  fetchFn: async function() {
    return {
      ok: true,
      status: 200,
      json: async function() { return openAiSamplePayload; }
    };
  }
});
assert(
  resOpenAiMocked.ok === true &&
  resOpenAiMocked.recommendation.provenance.source === 'mock_ai_test_mode' &&
  resOpenAiMocked.recommendation.provenance.model === 'gpt-6-luna' &&
  document.getElementById('admin-dispatch-bookings-list').innerHTML.includes('Mock AI Response — Test Mode (gpt-6-luna)') &&
  !document.getElementById('admin-dispatch-bookings-list').innerHTML.includes('Live OpenAI AI — gpt-6-luna'),
  "Injected fetchFn keeps OpenAI test response in Mock AI Response — Test Mode (gpt-6-luna)"
);

// Case B: Non-injected real transport response verified by backend renders exact 'Live OpenAI AI — gpt-6-luna'
var origGlobalFetch = globalThis.fetch;
globalThis.fetch = async function() {
  return {
    ok: true,
    status: 200,
    json: async function() { return openAiSamplePayload; }
  };
};
try {
  var resOpenAiLive = await triggerAdminAiDispatchAdvice(openAiBookingId, { skipLoadingRender: true });
  assert(
    resOpenAiLive.ok === true &&
    resOpenAiLive.recommendation.provenance.source === 'live_openai_ai' &&
    resOpenAiLive.recommendation.provenance.provider === 'openai' &&
    resOpenAiLive.recommendation.provenance.model === 'gpt-6-luna' &&
    resOpenAiLive.recommendation.provenance.isLiveAi === true &&
    resOpenAiLive.recommendation.provenance.isMockTestMode === false,
    "Backend-verified OpenAI response resolves genuine live_openai_ai provenance with gpt-6-luna"
  );
} finally {
  globalThis.fetch = origGlobalFetch;
}

var liveOpenAiListHtml = document.getElementById('admin-dispatch-bookings-list').innerHTML;
assert(
  liveOpenAiListHtml.includes('Live OpenAI AI — gpt-6-luna') &&
  liveOpenAiListHtml.includes('data-provenance="live_ai"'),
  "Admin UI badge displays exact 'Live OpenAI AI — gpt-6-luna' label for genuine OpenAI inference"
);
var liveOpenAiAudit = loadState().adminAuditLog.find(function(a) {
  return a.actionType === 'ai_dispatch_recommended' && a.bookingId === openAiBookingId && String(a.verificationSource || '').includes('Live OpenAI AI');
});
assert(
  liveOpenAiAudit && liveOpenAiAudit.verificationSource === 'Live OpenAI AI — gpt-6-luna',
  "Audit log records exact verificationSource 'Live OpenAI AI — gpt-6-luna'"
);

// Apply button opens modal cleanly without auto-assigning
var openAiApplyBtn = document.getElementById('admin-dispatch-bookings-list').querySelectorAll('.btn-ai-apply-suggestion').find(function(b) {
  return b.getAttribute('data-booking-id') === openAiBookingId && b.getAttribute('data-slot-id') === 'slot_1';
});
assert(!!openAiApplyBtn, "Apply Suggestion button rendered on Live OpenAI AI card");
openAiApplyBtn.click();
assert(
  document.getElementById('admin-assign-ai-banner').innerHTML.includes('Live OpenAI Suggestion Loaded') &&
  document.getElementById('check-admin-assign-confirm').checked === false,
  "Modal banner reflects Live OpenAI suggestion while keeping confirmation checkbox unchecked"
);
document.getElementById('btn-cancel-admin-assign').dispatchEvent('click');

print("\n==================================================================");
print("FINAL RESULTS: " + passed + " of " + (passed + failed) + " assertions passed (" + Math.round((passed / (passed + failed)) * 100) + "%).");
print("==================================================================");
if (failed > 0) {
  throw new Error("Stage 4 Phase 4.4 UI Dispatch verification failed (" + failed + " failures).");
}
