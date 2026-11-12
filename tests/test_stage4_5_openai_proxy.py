"""
Stage 4.5: Offline Local Python OpenAI Proxy Integration, Security & Responses API Test Suite.
Executes completely offline using handle_proxy_http_request(), temp env files, and mocked transports
(zero live OpenAI or Gemini API calls).
"""

import json
import os
import socket
import sys
import tempfile
import urllib.error
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from proxy.config import (
    ALLOWED_OPENAI_MODELS,
    DEFAULT_AI_PROVIDER,
    DEFAULT_OPENAI_MODEL,
    OPENAI_RESPONSES_API_URL,
    is_api_key_configured,
    load_openai_api_key,
    redact_secrets,
    resolve_ai_provider,
    resolve_openai_model,
    resolve_provider_api_key,
    resolve_provider_model,
)
from proxy.openai_client import (
    OpenAIClientError,
    build_openai_responses_body,
    extract_json_from_openai_envelope,
)
from proxy.rate_limit import LocalDispatchRateLimiter
from proxy.server import create_proxy_context, handle_proxy_http_request

DUMMY_OPENAI_KEY = "sk-proj-DummyTestOpenAIKeyNotReal9876543210987654"
DUMMY_GEMINI_KEY = "AIzaDummyTestKeyNotReal987654321098765432"

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


def sample_sanitized_request(booking_id="CRW-1004"):
    return {
        "schemaVersion": "crewly_ai_dispatch_request_v1",
        "bookingContext": {
            "bookingId": booking_id,
            "serviceCategory": "moving",
            "serviceTitle": "Moving & Lifting Assistance (Upcoming Weekend)",
            "neighborhoodName": "Uptown Dallas",
            "timingType": "scheduled",
            "scheduledDate": "2026-11-15",
            "scheduledTime": "10:00",
            "targetWeekday": "Sunday",
            "estimatedDurationHours": 3,
            "asapRemainingMinutes": None,
            "scopeSummary": {"workersRequired": 2, "estimatedDurationHours": 3, "truckNeeded": False},
            "alreadyAssignedCount": 1,
            "totalSlotsCount": 2,
            "openSlots": [{"slotId": "slot_2", "roleTitle": "Assistant Mover"}],
        },
        "eligibleCandidates": [
            {
                "proId": "pro_jamar",
                "displayName": "Jamar Washington",
                "tier": "Bronze",
                "rating": 4.75,
                "reviewCount": 14,
                "reliabilityScore": 94,
                "homeNeighborhood": "Oak Lawn",
                "sameNeighborhoodAsBooking": False,
                "verifiedSkills": ["moving", "furniture_assembly"],
                "verifiedEquipment": ["hand_truck", "shoulder_dolly"],
                "dayAvailabilityWindow": "09:00-18:00",
                "activeAssignmentsCount": 0,
                "completedJobsCount": 28,
                "eligibleForSlotIds": ["slot_2"],
            }
        ],
        "slotSupply": [
            {
                "slotId": "slot_2",
                "roleTitle": "Assistant Mover",
                "eligibleProIds": ["pro_jamar"],
                "eligibleCount": 1,
            }
        ],
    }


def sample_valid_recommendation(booking_id="CRW-1004"):
    return {
        "bookingId": booking_id,
        "slotRecommendations": [
            {
                "slotId": "slot_2",
                "draftAdminReason": "Jamar is verified for moving equipment and clear on Sunday morning.",
                "rankedCandidates": [
                    {
                        "proId": "pro_jamar",
                        "fitSummary": "Equipment-ready moving Pro with strong Sunday availability.",
                        "rationaleBullets": [
                            "Verified moving skill and hand truck equipment",
                            "Zero conflicting assignments on Sunday morning",
                        ],
                        "cautionNote": "",
                    }
                ],
            }
        ],
        "operationalRisks": [
            {
                "severity": "medium",
                "code": "thin_candidate_pool",
                "message": "Only 1 eligible Pro available for Assistant Mover.",
            }
        ],
        "shortageAssessment": "tight_supply",
        "recommendedNextAction": "approve_top_candidate",
    }


def make_openai_responses_envelope(rec_obj, with_reasoning_item=True):
    output = []
    if with_reasoning_item:
        output.append({"id": "rs_mock_1", "type": "reasoning", "summary": []})
    output.append(
        {
            "id": "msg_mock_1",
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [
                {
                    "type": "output_text",
                    "text": json.dumps(rec_obj, ensure_ascii=True),
                    "annotations": [],
                }
            ],
        }
    )
    return {
        "id": "resp_mock_123",
        "object": "response",
        "status": "completed",
        "model": DEFAULT_OPENAI_MODEL,
        "error": None,
        "output": output,
    }


def send_http(ctx, method, path, body=None, headers=None):
    hdrs = dict(headers or {})
    raw_bytes = b""
    if body is not None:
        raw_bytes = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        if "Content-Type" not in hdrs:
            hdrs["Content-Type"] = "application/json"
    status, resp_hdrs, resp_bytes = handle_proxy_http_request(
        context=ctx,
        method=method,
        path=path,
        headers=hdrs,
        raw_body_bytes=raw_bytes,
        client_ip="127.0.0.1",
    )
    text = resp_bytes.decode("utf-8", errors="replace") if resp_bytes else ""
    parsed = json.loads(text) if text.strip().startswith("{") else None
    return status, {k.lower(): v for k, v in resp_hdrs.items()}, text, parsed


def main():
    print("============================================================")
    print("CREWLY STAGE 4.5 — OPENAI PROXY INTEGRATION & SECURITY SUITE")
    print("============================================================")

    # Group 1: Config Defaults, Model Allowlist, Optional Gemini & Secret Scrubbing
    print("\n[Group 1: Provider Config, Models & Secret Protection]")
    with tempfile.TemporaryDirectory() as tmpdir:
        missing_env = Path(tmpdir) / "nonexistent.env.local"
        old_env = {
            k: os.environ.pop(k, None)
            for k in ("CREWLY_AI_PROVIDER", "CREWLY_OPENAI_MODEL", "OPENAI_API_KEY", "CREWLY_GEMINI_MODEL", "GEMINI_API_KEY")
        }
        try:
            check(
                DEFAULT_AI_PROVIDER == "openai" and resolve_ai_provider(missing_env) == "openai",
                "Default AI provider resolves to 'openai'",
            )
            check(
                DEFAULT_OPENAI_MODEL == "gpt-6-luna" and resolve_openai_model(missing_env) == "gpt-6-luna",
                "Default OpenAI model resolves to exact ID 'gpt-6-luna'",
            )
            check(ALLOWED_OPENAI_MODELS == ("gpt-6-luna", "gpt-6.1-sol"), "OpenAI model allowlist includes only gpt-6-luna and gpt-6.1-sol")

            sol_env = Path(tmpdir) / "sol.env.local"
            sol_env.write_text(
                f"CREWLY_AI_PROVIDER=openai\nCREWLY_OPENAI_MODEL=gpt-6.1-sol\nOPENAI_API_KEY={DUMMY_OPENAI_KEY}\n",
                encoding="utf-8",
            )
            check(resolve_openai_model(sol_env) == "gpt-6.1-sol", "Server-side env config opts into 'gpt-6.1-sol'")
            check(load_openai_api_key(sol_env) == DUMMY_OPENAI_KEY, "Loads OPENAI_API_KEY cleanly from isolated local env file")

            bad_env = Path(tmpdir) / "bad_model.env.local"
            bad_env.write_text("CREWLY_AI_PROVIDER=unknown_vendor\nCREWLY_OPENAI_MODEL=gpt-99-untrusted\n", encoding="utf-8")
            check(
                resolve_ai_provider(bad_env) == "openai" and resolve_openai_model(bad_env) == "gpt-6-luna",
                "Unknown provider or model safely falls back to openai + gpt-6-luna",
            )

            gemini_env = Path(tmpdir) / "gemini.env.local"
            gemini_env.write_text(f"CREWLY_AI_PROVIDER=gemini\nGEMINI_API_KEY={DUMMY_GEMINI_KEY}\n", encoding="utf-8")
            check(
                resolve_ai_provider(gemini_env) == "gemini"
                and resolve_provider_model("gemini", gemini_env) == "gemini-3.5-flash-lite"
                and resolve_provider_api_key("gemini", gemini_env) == DUMMY_GEMINI_KEY,
                "Optional CREWLY_AI_PROVIDER=gemini preserves Gemini configuration",
            )
        finally:
            for k, v in old_env.items():
                if v is not None:
                    os.environ[k] = v

    check(not is_api_key_configured("REPLACE_WITH_YOUR_OPENAI_API_KEY"), "Placeholder OPENAI_API_KEY rejected as unconfigured")
    scrubbed = redact_secrets(f"Authorization: Bearer {DUMMY_OPENAI_KEY} leaked", api_key=DUMMY_OPENAI_KEY)
    check(DUMMY_OPENAI_KEY not in scrubbed and "sk-proj-" not in scrubbed, "Secret redactor scrubs OpenAI Bearer tokens & sk- keys")

    # Group 2: End-to-End Proxy Request & Responses API Payload Inspection
    print("\n[Group 2: OpenAI Responses API Wire Contract & Mocked HTTP Proxy]")
    mock_state = {"calls": [], "now": [2000.0], "mode": "ok", "api_key": DUMMY_OPENAI_KEY}
    limiter = LocalDispatchRateLimiter(time_fn=lambda: mock_state["now"][0])

    def mock_openai_transport(url, headers, body_bytes, timeout_seconds):
        mock_state["calls"].append(
            {
                "url": url,
                "headers": dict(headers),
                "body": json.loads(body_bytes.decode("utf-8")),
                "timeout": timeout_seconds,
            }
        )
        mode = mock_state["mode"]
        if mode == "http_401":
            return 401, json.dumps({"error": {"message": f"Invalid API key {DUMMY_OPENAI_KEY}", "type": "invalid_request_error"}})
        if mode == "http_403":
            raise urllib.error.HTTPError(url, 403, "Forbidden", {}, None)
        if mode == "http_429":
            return 429, json.dumps({"error": {"message": "Rate limit reached"}})
        if mode == "http_400":
            return 400, json.dumps({"error": {"message": "Bad parameter"}})
        if mode == "http_500":
            return 500, json.dumps({"error": {"message": "Server error"}})
        if mode == "timeout":
            raise socket.timeout("timed out")
        if mode == "url_err_key":
            raise urllib.error.URLError(f"Failed connecting with {DUMMY_OPENAI_KEY}")
        if mode == "incomplete":
            return 200, json.dumps({"id": "resp_1", "status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}, "output": []})
        if mode == "refusal":
            return 200, json.dumps({
                "id": "resp_2",
                "status": "completed",
                "output": [{"type": "message", "status": "completed", "content": [{"type": "refusal", "refusal": "Cannot comply"}]}],
            })
        if mode == "malformed_json":
            return 200, json.dumps({
                "id": "resp_3",
                "status": "completed",
                "output": [{"type": "message", "status": "completed", "content": [{"type": "output_text", "text": "{truncated json"}]}],
            })
        if mode == "ineligible_pro":
            bad_rec = sample_valid_recommendation()
            bad_rec["slotRecommendations"][0]["rankedCandidates"].append({
                "proId": "pro_ghost_999",
                "fitSummary": "Unknown",
                "rationaleBullets": ["Invented"],
                "cautionNote": "",
            })
            return 200, json.dumps(make_openai_responses_envelope(bad_rec))
        return 200, json.dumps(make_openai_responses_envelope(sample_valid_recommendation()))

    ctx = create_proxy_context(
        provider_resolver=lambda: "openai",
        api_key_loader=lambda: mock_state["api_key"],
        model_resolver=lambda: DEFAULT_OPENAI_MODEL,
        rate_limiter=limiter,
        transport_fn=mock_openai_transport,
        log_fn=lambda _: None,
    )

    # Check live default context reporting without making any live API call
    live_ctx = create_proxy_context(
        provider_resolver=lambda: "openai",
        api_key_loader=lambda: DUMMY_OPENAI_KEY,
        model_resolver=lambda: DEFAULT_OPENAI_MODEL,
        transport_fn=None,
    )
    st_lh, _, raw_lh, js_lh = send_http(live_ctx, "GET", "/health", headers={"Origin": "http://localhost:8000"})
    check(
        st_lh == 200
        and js_lh["provider"] == "openai"
        and js_lh["model"] == "gpt-6-luna"
        and js_lh["inferenceMode"] == "live_openai_ai"
        and js_lh["isSimulatedTestMode"] is False
        and DUMMY_OPENAI_KEY not in raw_lh,
        "Default transport OpenAI /health reports provider='openai', model='gpt-6-luna', inferenceMode='live_openai_ai'",
    )

    st_mh, _, _, js_mh = send_http(ctx, "GET", "/health", headers={"Origin": "http://localhost:8000"})
    check(
        st_mh == 200
        and js_mh["provider"] == "openai"
        and js_mh["model"] == "gpt-6-luna"
        and js_mh["inferenceMode"] == "mock_ai_test_mode"
        and js_mh["isSimulatedTestMode"] is True,
        "Mocked OpenAI /health reports inferenceMode='mock_ai_test_mode'",
    )

    req_ok = sample_sanitized_request()
    st, hdrs, raw, js = send_http(ctx, "POST", "/api/dispatch/recommend", body=req_ok, headers={"Origin": "http://localhost:8000"})
    check(
        st == 200
        and js["ok"] is True
        and js["provider"] == "openai"
        and js["model"] == "gpt-6-luna"
        and js["inferenceSource"] == "mock_ai_test_mode"
        and js["isSimulatedTestMode"] is True
        and js["liveAiAttempted"] is False
        and js["recommendation"]["bookingId"] == "CRW-1004",
        "Mocked POST /api/dispatch/recommend succeeds cleanly with gpt-6-luna & mock_ai_test_mode provenance",
    )
    check(len(mock_state["calls"]) == 1, "Upstream OpenAI mock transport called once")

    call = mock_state["calls"][0]
    check(call["url"] == OPENAI_RESPONSES_API_URL and DUMMY_OPENAI_KEY not in call["url"], "Targets official https://api.openai.com/v1/responses URL without credentials")
    check(call["headers"].get("Authorization") == f"Bearer {DUMMY_OPENAI_KEY}", "Sends Authorization: Bearer <OPENAI_API_KEY> header")
    body = call["body"]
    check(body["model"] == "gpt-6-luna" and body.get("store") is False, "Request sets model='gpt-6-luna' and store=false")
    check(body.get("reasoning") == {"effort": "low"} and "temperature" not in body and "top_p" not in body, "Sets reasoning.effort='low' and omits temperature/top_p")
    fmt = body.get("text", {}).get("format", {})
    check(
        fmt.get("type") == "json_schema"
        and fmt.get("strict") is True
        and fmt.get("schema", {}).get("additionalProperties") is False,
        "Request enforces strict JSON schema via text.format",
    )

    # Direct body builder test for gpt-6.1-sol opt-in
    sol_body = build_openai_responses_body(req_ok, model="gpt-6.1-sol")
    check(sol_body["model"] == "gpt-6.1-sol" and "temperature" not in sol_body, "Server-side gpt-6.1-sol builder preserves model & omits sampling params")

    # Group 3: Browser Payload Trust Boundary & Responses Envelope Edge Cases
    print("\n[Group 3: Security Validation, Incomplete/Refusal & Error Handling]")
    for field_name, field_val in [("provider", "openai"), ("openai_api_key", DUMMY_OPENAI_KEY), ("model", "gpt-6.1-sol"), ("reasoning", {"effort": "high"})]:
        bad_payload = sample_sanitized_request()
        bad_payload[field_name] = field_val
        st_b, _, _, js_b = send_http(ctx, "POST", "/api/dispatch/recommend", body=bad_payload, headers={"Origin": "http://localhost:8000"})
        check(st_b == 400 and js_b["ok"] is False, f"Rejects browser override field '{field_name}' with HTTP 400")

    embedded_sk = sample_sanitized_request()
    embedded_sk["bookingContext"]["serviceTitle"] = f"Moving help {DUMMY_OPENAI_KEY}"
    st_sk, _, _, js_sk = send_http(ctx, "POST", "/api/dispatch/recommend", body=embedded_sk, headers={"Origin": "http://localhost:8000"})
    check(st_sk == 400 and DUMMY_OPENAI_KEY not in json.dumps(js_sk), "Rejects embedded OpenAI sk- key literal in request body cleanly")

    # Missing key -> 503 proxy_not_configured referencing OPENAI_API_KEY
    mock_state["api_key"] = None
    mock_state["now"][0] += 5.0
    st_nk, _, _, js_nk = send_http(ctx, "POST", "/api/dispatch/recommend", body=req_ok, headers={"Origin": "http://localhost:8000"})
    check(
        st_nk == 503 and js_nk["code"] == "proxy_not_configured" and "OPENAI_API_KEY" in js_nk["error"] and js_nk["fallbackRecommended"] is True,
        "Unconfigured OPENAI_API_KEY returns 503 proxy_not_configured with fallbackRecommended=True",
    )
    mock_state["api_key"] = DUMMY_OPENAI_KEY

    # Error status mapping checks
    error_expectations = [
        ("http_401", 502, "upstream_auth_error"),
        ("http_403", 502, "upstream_auth_error"),
        ("http_429", 429, "upstream_rate_limited"),
        ("http_400", 502, "upstream_bad_request"),
        ("http_500", 502, "upstream_unavailable"),
        ("timeout", 504, "upstream_timeout"),
        ("url_err_key", 502, "upstream_network_error"),
        ("incomplete", 502, "openai_response_incomplete"),
        ("refusal", 502, "openai_refusal"),
        ("malformed_json", 502, "malformed_openai_json"),
    ]
    for mode, exp_status, exp_code in error_expectations:
        mock_state["mode"] = mode
        mock_state["now"][0] += 15.0
        st_e, _, raw_e, js_e = send_http(ctx, "POST", "/api/dispatch/recommend", body=req_ok, headers={"Origin": "http://localhost:8000"})
        check(
            st_e == exp_status
            and js_e["ok"] is False
            and js_e["code"] == exp_code
            and js_e["fallbackRecommended"] is True
            and DUMMY_OPENAI_KEY not in raw_e,
            f"Handles OpenAI '{mode}' safely -> HTTP {exp_status} ({exp_code}) without secret leaks",
        )

    # Stripping hallucinated Pro returned by OpenAI
    mock_state["mode"] = "ineligible_pro"
    mock_state["now"][0] += 15.0
    st_ip, _, _, js_ip = send_http(ctx, "POST", "/api/dispatch/recommend", body=req_ok, headers={"Origin": "http://localhost:8000"})
    check(
        st_ip == 200
        and js_ip["ok"] is True
        and [c["proId"] for c in js_ip["recommendation"]["slotRecommendations"][0]["rankedCandidates"]] == ["pro_jamar"]
        and "slot_2:pro_ghost_999" in js_ip["proxyValidation"]["rejectedCandidates"],
        "Strips unknown/hallucinated proId returned by OpenAI before forwarding to frontend",
    )

    # output_text top-level envelope convenience fallback
    extracted_top = extract_json_from_openai_envelope({
        "status": "completed",
        "output": [{"type": "reasoning", "summary": []}],
        "output_text": json.dumps(sample_valid_recommendation()),
    })
    check(extracted_top["bookingId"] == "CRW-1004", "Supports top-level output_text fallback when output contains only reasoning items")

    print("\n============================================================")
    print(f"STAGE 4.5 OPENAI PROXY SUITE SUMMARY: {passed} passed, {failed} failed")
    print("============================================================")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
