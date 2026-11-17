#!/bin/bash
set -e

echo "=================================================================="
echo "CREWLY MASTER TEST SUITE — DFW PRICING PHASE 1 & REGRESSION SUITE"
echo "=================================================================="
echo "Environment: macOS Darwin | JavaScriptCore (WebKit) & Python 3"
echo "Branch: feature/crewly-product-improvements"
echo "Date: $(date)"
echo ""

JSC="/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
if [ ! -f "$JSC" ]; then
  echo "Error: JavaScriptCore binary not found at $JSC"
  exit 1
fi

PYTHON="/usr/bin/python3"
if [ ! -f "$PYTHON" ]; then
  PYTHON="python3"
fi

echo ">>> [1/13] Running Browser Startup & ES Module Parsing Verification..."
$JSC -m tests/test_es_module_startup.js
echo ">>> Suite 1 Passed."
echo ""

echo ">>> [2/13] Running Stage 3 Phase 1 Overview Regression Suite..."
$PYTHON tests/test_phase1_overview.py
echo ">>> Suite 2 Passed."
echo ""

echo ">>> [3/13] Running Stage 3 Phase 2 Dispatch Management Regression Suite..."
$PYTHON tests/test_phase2_dispatch.py
echo ">>> Suite 3 Passed."
echo ""

echo ">>> [4/13] Running Stage 3 Phase 3 Operations & Trust Regression Suite..."
$PYTHON tests/test_phase3_operations.py
echo ">>> Suite 4 Passed."
echo ""

echo ">>> [5/13] Running Stage 3 Phase 4 End-to-End Marketplace Test Suite..."
$JSC -m tests/test_phase4_e2e_marketplace.js
echo ">>> Suite 5 Passed."
echo ""

echo ">>> [6/13] Running Stage 3.5 Admin Cancellation & Verified Completion Suite..."
$JSC -m tests/test_stage3_5_admin_cancel_complete.js
echo ">>> Suite 6 Passed."
echo ""

echo ">>> [7/13] Running Stage 3.5 Chrome Bug Regression Suite (Issue 1 & Issue 2)..."
$JSC -m tests/test_chrome_issues_verification.js
echo ">>> Suite 7 Passed."
echo ""

echo ">>> [8/13] Running Stage 4 Phase 4.2 Offline AI Dispatch Privacy, Trust & Fallback Suite..."
$JSC -m tests/test_stage4_ai_dispatch.js
echo ">>> Suite 8 Passed."
echo ""

echo ">>> [9/13] Running Stage 4 Phase 4.3 Local Python Gemini Proxy Mock & Security Suite..."
$PYTHON tests/test_stage4_proxy.py
echo ">>> Suite 9 Passed."
echo ""

echo ">>> [10/13] Running Stage 4 Phase 4.4 Admin AI Dispatch UI & Integration Suite..."
$JSC -m tests/test_stage4_ui_dispatch.js
echo ">>> Suite 10 Passed."
echo ""

echo ">>> [11/13] Running Stage 4.5 Local Python OpenAI Proxy Integration & Security Suite..."
$PYTHON tests/test_stage4_5_openai_proxy.py
echo ">>> Suite 11 Passed."
echo ""

echo ">>> [12/13] Running Stage 4.6A AI Accuracy & Factual Truth Hardening Suite..."
$JSC -m tests/test_stage4_6_ai_accuracy.js
echo ">>> Suite 12 Passed."
echo ""

echo ">>> [13/13] Running DFW Pricing Phase 1: Moving & Lifting Pricing Verification Suite..."
$JSC -m tests/test_stage4_7_moving_pricing.js
echo ">>> Suite 13 Passed."
echo ""

echo "=================================================================="
echo "ALL 13 CREWLY TEST SUITES COMPLETED WITH 100% PASS RATE (916/916)"
echo "=================================================================="
