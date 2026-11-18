"""
Stage 4.6B1: Local Python AI Booking Concierge Proxy Integration & Privacy Test Suite.

Executes completely offline using handle_proxy_http_request(), local mock transports,
and synthetic payloads (zero live OpenAI or Gemini API calls).
"""

import json
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from proxy.config import (
    ALLOWED_OPENAI_MODELS,
    DALLAS_PILOT_ZIP_CODES,
    DEFAULT_OPENAI_MODEL,
    is_api_key_configured,
    redact_secrets,
)
from proxy.openai_client import (
    OpenAIClientError,
    build_openai_concierge_body,
    extract_json_from_openai_envelope,
    request_openai_concierge,
)
from proxy.rate_limit import LocalDispatchRateLimiter
from proxy.server import create_proxy_context, handle_proxy_http_request
from proxy.validator import (
    sanitize_concierge_input_text,
    validate_and_normalize_concierge_output,
    validate_concierge_request_payload,
)

DUMMY_OPENAI_KEY = "sk-proj-DummyConciergeTestKey9876543210987654"

passed = 0
failed = 0


def check(condition, msg):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS: {msg}")
    else:
        failed += 1
        print(f"  FAIL: {msg}")


def run_tests():
    global passed, failed
    print("\n=== STAGE 4.6B1: CUSTOMER AI CONCIERGE PROXY TEST SUITE ===")

    # -------------------------------------------------------------------------
    # Group 1: Request Payload Allowlist & Moving-Only Scope Guard
    # -------------------------------------------------------------------------
    print("\n[Group 1: Concierge Request Allowlist & Scope Guard]")

    # Valid moving request
    valid_payload = {
        "serviceCategory": "moving",
        "messages": [
            {"role": "user", "content": "I need help moving my 1-bedroom apartment in Uptown next Saturday."}
        ],
        "currentDraft": {
            "serviceCategory": "moving",
            "workersNeeded": None,
            "hours": None,
        },
    }
    ok, validated, err = validate_concierge_request_payload(valid_payload)
    check(ok is True and err is None, "Valid moving concierge payload passes validation")
    check(validated["serviceCategory"] == "moving", "Validated payload retains serviceCategory == 'moving'")

    # Scope guard: Non-moving serviceCategory must be rejected
    tv_payload = {
        "serviceCategory": "tv_mounting",
        "messages": [{"role": "user", "content": "Mount my 65-inch TV"}],
    }
    ok_tv, _, err_tv = validate_concierge_request_payload(tv_payload)
    check(ok_tv is False, "Non-moving service category (tv_mounting) is rejected")
    check("Moving & Lifting assistance only" in (err_tv or ""), "Rejection error cites Moving & Lifting restriction")

    lawn_payload = {
        "serviceCategory": "lawn_mowing",
        "messages": [{"role": "user", "content": "Mow my front lawn"}],
    }
    ok_lawn, _, err_lawn = validate_concierge_request_payload(lawn_payload)
    check(ok_lawn is False, "Non-moving service category (lawn_mowing) is rejected")

    # Disallowed root keys rejected
    disallowed_keys_payload = {
        "serviceCategory": "moving",
        "messages": [{"role": "user", "content": "Need movers"}],
        "creditCard": "4111222233334444",
    }
    ok_dis, _, err_dis = validate_concierge_request_payload(disallowed_keys_payload)
    check(ok_dis is False, "Payload with disallowed root key (creditCard) is rejected")
    check("Disallowed root keys" in (err_dis or ""), "Error indicates disallowed root keys")

    # Message bounds: > 10 messages rejected
    too_many_msgs = {
        "serviceCategory": "moving",
        "messages": [{"role": "user", "content": f"msg {i}"} for i in range(12)],
    }
    ok_many, _, err_many = validate_concierge_request_payload(too_many_msgs)
    check(ok_many is False, "More than 10 messages rejected")

    # Message bounds: single message > 500 chars rejected
    too_long_msg = {
        "serviceCategory": "moving",
        "messages": [{"role": "user", "content": "A" * 550}],
    }
    ok_long, _, err_long = validate_concierge_request_payload(too_long_msg)
    check(ok_long is False, "Message exceeding 500 chars rejected")

    # -------------------------------------------------------------------------
    # Group 2: Client/Server Privacy & PII Scrubbing Filters
    # -------------------------------------------------------------------------
    print("\n[Group 2: Privacy Filter & PII Scrubbing]")

    # Street address scrubbing
    raw_addr_text = "I live at 2800 McKinney Ave, Apt 402 in Dallas and need 2 movers."
    sanitized_addr = sanitize_concierge_input_text(raw_addr_text)
    check("2800 McKinney" not in sanitized_addr, "Street address number and name scrubbed from user input")
    check("[REDACTED_STREET_ADDRESS]" in sanitized_addr, "Replaced with [REDACTED_STREET_ADDRESS] token")

    # Phone number scrubbing
    raw_phone_text = "Call me at (214) 555-0199 or 214-555-0188 if needed."
    sanitized_phone = sanitize_concierge_input_text(raw_phone_text)
    check("555-0199" not in sanitized_phone, "Phone number scrubbed from user input")
    check("[REDACTED_PHONE]" in sanitized_phone, "Replaced with [REDACTED_PHONE] token")

    # Email scrubbing
    raw_email_text = "Send confirmation to sarah.jenkins@example.com please."
    sanitized_email = sanitize_concierge_input_text(raw_email_text)
    check("sarah.jenkins@example.com" not in sanitized_email, "Email address scrubbed from user input")
    check("[REDACTED_EMAIL]" in sanitized_email, "Replaced with [REDACTED_EMAIL] token")

    # Gate code scrubbing
    raw_gate_text = "The gate code is #4492 and callbox code: 1234."
    sanitized_gate = sanitize_concierge_input_text(raw_gate_text)
    check("#4492" not in sanitized_gate, "Gate code scrubbed from user input")
    check("[REDACTED_ACCESS_CODE]" in sanitized_gate, "Replaced with [REDACTED_ACCESS_CODE] token")

    # End-to-end payload sanitization during request validation
    leaky_user_payload = {
        "serviceCategory": "moving",
        "messages": [
            {"role": "user", "content": "Moving from 1500 Main St, Suite 200, Dallas TX. Call 214-555-0123."}
        ],
    }
    ok_leak, validated_leak, _ = validate_concierge_request_payload(leaky_user_payload)
    check(ok_leak is True, "Leaky message is safely accepted after sanitization")
    check("1500 Main St" not in validated_leak["messages"][0]["content"], "Validated message body has address scrubbed")
    check("214-555-0123" not in validated_leak["messages"][0]["content"], "Validated message body has phone scrubbed")
    check(validated_leak["piiRedactedTurnsCount"] == 1, "PII redaction counter increments accurately")

    # -------------------------------------------------------------------------
    # Group 3: Model Output Validation & Pricing Integrity
    # -------------------------------------------------------------------------
    print("\n[Group 3: Output Validation & Price Neutralization]")

    # Price neutralization: Ensure model NEVER quotes independent dollar amounts
    raw_ai_with_price = {
        "assistantMessage": "I can arrange 2 movers for 3 hours at $300 ($50/hour) plus a $10 fee totaling $310!",
        "isComplete": True,
        "missingFields": [],
        "clarificationQuestions": [],
        "extractedDetails": {
            "serviceCategory": "moving",
            "workersNeeded": 2,
            "hours": 3,
            "scheduledDate": "2026-11-25",
            "scheduledTime": "10:00",
            "zipCode": "75204",
            "truckOption": "labor_only",
            "stairsOption": "elevator",
            "scopeSummary": "1-bedroom apartment move",
            "unsupportedReason": "",
        },
    }
    ok_out, _, norm_out, _ = validate_and_normalize_concierge_output(raw_ai_with_price, valid_payload)
    check(ok_out is True, "Output validation succeeded")
    check("$300" not in norm_out["assistantMessage"], "Invented price $300 neutralized from assistantMessage")
    check("$50" not in norm_out["assistantMessage"], "Hourly rate $50/hour neutralized from assistantMessage")
    check("$310" not in norm_out["assistantMessage"], "Total price $310 neutralized from assistantMessage")

    # Moving bounds: workers clamped to 1-4
    raw_ai_bad_workers = {
        "assistantMessage": "We need 6 movers.",
        "isComplete": False,
        "missingFields": [],
        "clarificationQuestions": [],
        "extractedDetails": {
            "serviceCategory": "moving",
            "workersNeeded": 6,
            "hours": 3,
            "scheduledDate": "",
            "scheduledTime": "",
            "zipCode": "75204",
            "truckOption": "labor_only",
            "stairsOption": "ground_floor",
            "scopeSummary": "",
            "unsupportedReason": "",
        },
    }
    _, _, norm_workers, _ = validate_and_normalize_concierge_output(raw_ai_bad_workers, valid_payload)
    check(norm_workers["extractedDetails"]["workersNeeded"] == 4, "Movers count > 4 clamped to 4 (max moving capacity)")

    # Moving bounds: hours < 2 clamped to 2-hour minimum
    raw_ai_one_hour = {
        "assistantMessage": "Just need 1 hour of help.",
        "isComplete": False,
        "missingFields": [],
        "clarificationQuestions": [],
        "extractedDetails": {
            "serviceCategory": "moving",
            "workersNeeded": 2,
            "hours": 1.0,
            "scheduledDate": "",
            "scheduledTime": "",
            "zipCode": "75204",
            "truckOption": "labor_only",
            "stairsOption": "ground_floor",
            "scopeSummary": "",
            "unsupportedReason": "",
        },
    }
    _, _, norm_hours, _ = validate_and_normalize_concierge_output(raw_ai_one_hour, valid_payload)
    check(norm_hours["extractedDetails"]["hours"] == 2.0, "Hours < 2 enforced to 2.0 (mandatory 2-hour minimum)")

    # Incomplete status when required fields are missing
    check(norm_hours["isComplete"] is False, "isComplete is False when date, time are missing")
    check("scheduledDate" in norm_hours["missingFields"], "scheduledDate identified in missingFields")
    check("scheduledTime" in norm_hours["missingFields"], "scheduledTime identified in missingFields")

    # Outside Dallas ZIP handling
    raw_ai_outside_zip = {
        "assistantMessage": "Fort Worth move.",
        "isComplete": True,
        "missingFields": [],
        "clarificationQuestions": [],
        "extractedDetails": {
            "serviceCategory": "moving",
            "workersNeeded": 2,
            "hours": 3,
            "scheduledDate": "2026-11-25",
            "scheduledTime": "10:00",
            "zipCode": "76102",  # Fort Worth ZIP, not Dallas pilot
            "truckOption": "labor_only",
            "stairsOption": "ground_floor",
            "scopeSummary": "",
            "unsupportedReason": "",
        },
    }
    _, _, norm_outside_zip, _ = validate_and_normalize_concierge_output(raw_ai_outside_zip, valid_payload)
    check(norm_outside_zip["extractedDetails"]["zipCode"] is None, "Non-pilot ZIP (76102) rejected and set to None")
    check(norm_outside_zip["isComplete"] is False, "isComplete remains False when ZIP is outside Dallas pilot")
    check("zipCode" in norm_outside_zip["missingFields"], "zipCode flagged in missingFields when invalid")

    # -------------------------------------------------------------------------
    # Group 4: End-to-End Proxy Server Integration (/api/concierge/chat)
    # -------------------------------------------------------------------------
    print("\n[Group 4: Proxy Server Route Integration]")

    mock_concierge_ai_response = {
        "assistantMessage": "I'd love to help coordinate your move in Uptown! For a 1-bedroom apartment, 2 movers working 3 hours is our recommended crew. Do you already have a moving truck, or do you need pickup truck assistance?",
        "isComplete": False,
        "missingFields": ["scheduledDate", "scheduledTime", "truckOption", "stairsOption"],
        "clarificationQuestions": [
            "What date and time do you prefer for your move?",
            "Will you have your own moving truck or POD, or do you need pickup truck assistance?",
        ],
        "extractedDetails": {
            "serviceCategory": "moving",
            "workersNeeded": 2,
            "hours": 3.0,
            "scheduledDate": "",
            "scheduledTime": "",
            "zipCode": "75204",
            "truckOption": "undetermined",
            "stairsOption": "undetermined",
            "scopeSummary": "1-bedroom apartment move in Uptown",
            "unsupportedReason": "",
        },
    }

    def mock_transport(url, headers, body_bytes, timeout):
        # Return official OpenAI Responses API envelope wrapping mock JSON
        envelope = {
            "id": "resp_mock_12345",
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "status": "completed",
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps(mock_concierge_ai_response),
                        }
                    ],
                }
            ],
        }
        return 200, json.dumps(envelope)

    ctx = create_proxy_context(
        provider_resolver=lambda: "openai",
        model_resolver=lambda: DEFAULT_OPENAI_MODEL,
        api_key_loader=lambda: DUMMY_OPENAI_KEY,
        transport_fn=mock_transport,
    )

    # Health endpoints: both /health and /api/health supported
    status_health, _, health_bytes = handle_proxy_http_request(
        ctx,
        "GET",
        "/health",
        {"Origin": "http://127.0.0.1:8000"},
    )
    check(status_health == 200, f"GET /health returns HTTP 200 (got {status_health})")
    health_obj = json.loads(health_bytes.decode("utf-8"))
    check(health_obj.get("ok") is True and health_obj.get("keyConfigured") is True, "GET /health returns keyConfigured True")

    status_api_health, _, api_health_bytes = handle_proxy_http_request(
        ctx,
        "GET",
        "/api/health",
        {"Origin": "http://127.0.0.1:8000"},
    )
    check(status_api_health == 200, f"GET /api/health returns HTTP 200 (got {status_api_health})")
    api_health_obj = json.loads(api_health_bytes.decode("utf-8"))
    check(api_health_obj.get("ok") is True, "GET /api/health returns ok True")

    req_body = json.dumps(valid_payload).encode("utf-8")
    status, headers, resp_bytes = handle_proxy_http_request(
        ctx,
        "POST",
        "/api/concierge/chat",
        {"Origin": "http://127.0.0.1:8000", "Content-Type": "application/json"},
        req_body,
        "127.0.0.1",
    )
    check(status == 200, f"POST /api/concierge/chat returns HTTP 200 (got {status})")
    resp_obj = json.loads(resp_bytes.decode("utf-8"))
    check(resp_obj.get("ok") is True, "Response ok is True")
    check(resp_obj.get("inferenceSource") == "mock_ai_test_mode", "Inference source marked as mock_ai_test_mode")
    check(resp_obj.get("isSimulatedTestMode") is True, "isSimulatedTestMode is True")
    check(resp_obj["conciergeResult"]["extractedDetails"]["workersNeeded"] == 2, "Extracted workersNeeded is 2")
    check(resp_obj["conciergeResult"]["extractedDetails"]["hours"] == 3.0, "Extracted hours is 3.0")
    check(resp_obj["conciergeResult"]["extractedDetails"]["zipCode"] == "75204", "Extracted zipCode is 75204")

    # Origin security: Unauthorized origin rejected with 403
    status_bad_origin, _, _ = handle_proxy_http_request(
        ctx,
        "POST",
        "/api/concierge/chat",
        {"Origin": "https://malicious-site.com", "Content-Type": "application/json"},
        req_body,
        "127.0.0.1",
    )
    check(status_bad_origin == 403, f"Unauthorized origin returns HTTP 403 (got {status_bad_origin})")

    # Offline / Disabled Proxy: Key not configured returns 503 with honest offline message
    ctx_no_key = create_proxy_context(
        provider_resolver=lambda: "openai",
        model_resolver=lambda: DEFAULT_OPENAI_MODEL,
        api_key_loader=lambda: "",  # No key
        transport_fn=mock_transport,
    )
    status_no_key, _, no_key_bytes = handle_proxy_http_request(
        ctx_no_key,
        "POST",
        "/api/concierge/chat",
        {"Origin": "http://127.0.0.1:8000", "Content-Type": "application/json"},
        req_body,
        "127.0.0.1",
    )
    check(status_no_key == 503, f"Disabled proxy returns HTTP 503 (got {status_no_key})")
    no_key_obj = json.loads(no_key_bytes.decode("utf-8"))
    check(no_key_obj["code"] == "proxy_not_configured", "Error code is proxy_not_configured")
    check(no_key_obj["fallbackRecommended"] is True, "fallbackRecommended is True")
    check("standard guided moving booking form" in no_key_obj["error"], "Honest fallback instructions returned")

    # Non-moving category rejected via HTTP 400
    status_bad_cat, _, bad_cat_bytes = handle_proxy_http_request(
        ctx,
        "POST",
        "/api/concierge/chat",
        {"Origin": "http://127.0.0.1:8000", "Content-Type": "application/json"},
        json.dumps(tv_payload).encode("utf-8"),
        "127.0.0.1",
    )
    check(status_bad_cat == 400, f"Unsupported category to concierge returns HTTP 400 (got {status_bad_cat})")
    bad_cat_obj = json.loads(bad_cat_bytes.decode("utf-8"))
    check("Moving & Lifting assistance only" in bad_cat_obj["error"], "Error explains Moving & Lifting scope restriction")

    # -------------------------------------------------------------------------
    # Group 5: First-Message Regression — Full Initial Draft with isComplete + missingFields
    # Reproduces the HTTP 400 bug where app.js sent isComplete/missingFields in the
    # first-turn draft and the validator incorrectly rejected the payload.
    # -------------------------------------------------------------------------
    print("\n[Group 5: First-Message Draft Regression (isComplete + missingFields in draft)]")

    first_message_payload = {
        "serviceCategory": "moving",
        "messages": [
            {"role": "user", "content": "I need help moving out of my apartment. I already have a rental truck and need two movers."}
        ],
        "currentDraft": {
            "serviceCategory": "moving",
            "workersNeeded": None,
            "hours": None,
            "scheduledDate": None,
            "scheduledTime": None,
            "zipCode": None,
            "truckOption": None,
            "stairsOption": None,
            "scopeSummary": "",
            "missingFields": ["workersNeeded", "hours", "scheduledDate", "zipCode"],
            "isComplete": False,
        }
    }
    ok_first, validated_first, err_first = validate_concierge_request_payload(first_message_payload)
    check(ok_first is True, "First real user message with isComplete+missingFields in draft passes validation (regression)")
    check(err_first is None, "No validation error on first-turn draft with isComplete+missingFields")

    # Confirm the full proxy round-trip also succeeds for the first real message
    mock_first_response = {
        "assistantMessage": "Got it! You need 2 movers and already have a truck — great. What date, neighborhood or Dallas ZIP code, and estimated duration do you have in mind?",
        "isComplete": False,
        "missingFields": ["workersNeeded", "hours", "scheduledDate", "zipCode"],
        "clarificationQuestions": ["What date is your move?", "How many hours do you estimate needing?", "What Dallas ZIP code or neighborhood?"],
        "extractedDetails": {
            "serviceCategory": "moving",
            "workersNeeded": 2,
            "hours": 0,
            "scheduledDate": "",
            "scheduledTime": "",
            "zipCode": "",
            "truckOption": "labor_only",
            "stairsOption": "undetermined",
            "scopeSummary": "Apartment move, customer has own truck, needs 2 movers.",
            "unsupportedReason": "",
        },
    }

    def mock_first_transport(url, headers, body_bytes, timeout):
        envelope = {
            "id": "resp_first_msg_test",
            "status": "completed",
            "output": [{"type": "message", "status": "completed", "content": [{"type": "output_text", "text": json.dumps(mock_first_response)}]}],
        }
        return 200, json.dumps(envelope)

    ctx_first = create_proxy_context(
        provider_resolver=lambda: "openai",
        model_resolver=lambda: DEFAULT_OPENAI_MODEL,
        api_key_loader=lambda: DUMMY_OPENAI_KEY,
        transport_fn=mock_first_transport,
    )
    first_body = json.dumps(first_message_payload).encode("utf-8")
    status_first, _, first_bytes = handle_proxy_http_request(
        ctx_first,
        "POST",
        "/api/concierge/chat",
        {"Origin": "http://127.0.0.1:8000", "Content-Type": "application/json"},
        first_body,
        "127.0.0.1",
    )
    check(status_first == 200, f"First real message full proxy round-trip returns HTTP 200 (got {status_first}) — regression check")
    first_resp_obj = json.loads(first_bytes.decode("utf-8"))
    check(first_resp_obj.get("ok") is True, "First message response ok is True")
    check(first_resp_obj["conciergeResult"]["extractedDetails"]["workersNeeded"] == 2, "First message correctly extracts 2 movers")
    check(first_resp_obj["conciergeResult"]["isComplete"] is False, "Draft marked incomplete — date, hours, ZIP still missing after first message")

    # Partial draft: second turn (workers known, rest unknown — should still validate)
    partial_draft_payload = {
        "serviceCategory": "moving",
        "messages": [
            {"role": "user", "content": "I need help moving out of my apartment. I already have a rental truck and need two movers."},
            {"role": "assistant", "content": "Got it! 2 movers noted. What date and Dallas ZIP do you have in mind?"},
            {"role": "user", "content": "Next Saturday the 28th, 3 hours, ZIP 75204 in Uptown."}
        ],
        "currentDraft": {
            "serviceCategory": "moving",
            "workersNeeded": 2,
            "hours": None,
            "scheduledDate": None,
            "scheduledTime": None,
            "zipCode": None,
            "truckOption": "labor_only",
            "stairsOption": None,
            "scopeSummary": "Apartment move with 2 movers",
            "isComplete": False,
            "missingFields": ["hours", "scheduledDate", "zipCode"],
            "unsupportedReason": ""
        }
    }
    ok_partial, validated_partial, err_partial = validate_concierge_request_payload(partial_draft_payload)
    check(ok_partial is True, "Second-turn partial draft (workers known, rest unknown) passes validation")
    check(err_partial is None, "No validation error on partial second-turn draft")

    print(f"\n============================================================")
    print(f"CONCIERGE PROXY SUITE SUMMARY: {passed} passed, {failed} failed")
    print(f"============================================================")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
