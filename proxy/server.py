"""Crewly Stage 4 Local-Only Python 3 HTTP Proxy for AI Dispatch Advice (OpenAI default, Gemini optional)."""

import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from proxy.config import (
    ALLOWED_AI_PROVIDERS,
    BIND_HOST,
    BIND_PORT,
    DEFAULT_AI_PROVIDER,
    LOCAL_TRUST_LIMITATION,
    MAX_REQUEST_BODY_BYTES,
    UPSTREAM_TIMEOUT_SECONDS,
    get_allowed_origins,
    is_api_key_configured,
    redact_secrets,
    resolve_ai_provider,
    resolve_provider_api_key,
    resolve_provider_model,
)
from proxy.gemini_client import GeminiClientError, request_gemini_recommendation
from proxy.openai_client import OpenAIClientError, request_openai_recommendation
from proxy.rate_limit import LocalDispatchRateLimiter
from proxy.validator import (
    build_prompt_payload_for_gemini,
    validate_and_normalize_gemini_output,
    validate_dispatch_request_payload,
)


def _header_get(headers, target_name):
    """Case-insensitive HTTP header lookup across email.message.Message or dicts."""
    if not headers:
        return None
    if hasattr(headers, "get") and not isinstance(headers, dict):
        return headers.get(target_name)
    target_lower = target_name.lower()
    for k, v in headers.items():
        if str(k).lower() == target_lower:
            return v
    return None


def _extract_origin_from_referer(referer_header):
    if not referer_header:
        return None
    try:
        parsed = urlparse(referer_header.strip())
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return None
    return None


def _default_log(line):
    sys.stderr.write(line + "\n")
    sys.stderr.flush()


def _check_origin_allowed(headers, allowed_origins):
    """
    Validates strict local CORS origin and browser fetch metadata.
    Explicit Origin headers must match local loopback allowlist strictly.
    """
    origin = _header_get(headers, "Origin")
    if origin is not None:
        clean = str(origin).strip()
        if clean in allowed_origins:
            return True, clean
        return False, None

    sec_fetch_site = str(_header_get(headers, "Sec-Fetch-Site") or "").strip().lower()
    if sec_fetch_site == "cross-site":
        return False, None

    referer_origin = _extract_origin_from_referer(_header_get(headers, "Referer"))
    if referer_origin and referer_origin not in allowed_origins:
        return False, None

    return True, None


def _build_json_response(context, method, path, status_code, body_dict, cors_origin=None, extra_headers=None, log_code="ok"):
    api_key = context["api_key_loader"]()
    payload_str = json.dumps(body_dict, ensure_ascii=True)
    safe_json_str = redact_secrets(payload_str, api_key=api_key)
    body_bytes = safe_json_str.encode("utf-8")

    resp_headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Vary": "Origin",
        "Content-Length": str(len(body_bytes)),
    }
    if cors_origin:
        resp_headers["Access-Control-Allow-Origin"] = cors_origin
    if extra_headers:
        for hk, hv in extra_headers.items():
            resp_headers[hk] = str(hv)

    context["log_fn"](
        f"[proxy] {method} {path} status={status_code} code={redact_secrets(log_code, api_key)}"
    )
    return status_code, resp_headers, body_bytes


def handle_proxy_http_request(context, method, path, headers, raw_body_bytes=b"", client_ip="127.0.0.1"):
    """
    Single pure HTTP dispatch pipeline shared by live ThreadingHTTPServer requests
    and offline unit tests. Zero booking or financial mutations.
    """
    upper_method = str(method or "").upper()
    allowed_origins = context["allowed_origins"]

    if upper_method == "OPTIONS":
        origin = str(_header_get(headers, "Origin") or "").strip()
        if not origin or origin not in allowed_origins:
            return _build_json_response(
                context, upper_method, path, 403,
                {
                    "ok": False,
                    "code": "cors_origin_denied",
                    "error": "Origin is not in the strict localhost allowlist.",
                    "fallbackRecommended": True,
                },
                log_code="cors_origin_denied",
            )
        preflight_headers = {
            "Access-Control-Allow-Origin": origin,
            "Vary": "Origin",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
            "Content-Length": "0",
        }
        context["log_fn"](f"[proxy] OPTIONS {path} status=204 code=cors_preflight_ok")
        return 204, preflight_headers, b""

    allowed, cors_origin = _check_origin_allowed(headers, allowed_origins)
    if not allowed:
        return _build_json_response(
            context, upper_method, path, 403,
            {
                "ok": False,
                "code": "cors_origin_denied",
                "error": "Origin is not in the strict localhost allowlist.",
                "fallbackRecommended": True,
            },
            log_code="cors_origin_denied",
        )

    if upper_method == "GET":
        if path != "/health":
            return _build_json_response(
                context, upper_method, path, 404,
                {"ok": False, "code": "not_found", "error": "Endpoint not found."},
                cors_origin=cors_origin,
                log_code="not_found",
            )
        provider = context["provider_resolver"]()
        if provider not in ALLOWED_AI_PROVIDERS:
            provider = DEFAULT_AI_PROVIDER
        api_key = context["api_key_loader"]()
        key_ready = is_api_key_configured(api_key)
        is_mock_transport = context["transport_fn"] is not None
        live_mode = "live_gemini_ai" if provider == "gemini" else "live_openai_ai"
        inference_mode = "mock_ai_test_mode" if is_mock_transport else live_mode
        return _build_json_response(
            context, upper_method, path, 200,
            {
                "ok": True,
                "status": "ok" if key_ready else "disabled_no_key",
                "keyConfigured": key_ready,
                "provider": provider,
                "model": context["model_resolver"](),
                "bind": f"{context['host']}:{context['port']}",
                "proxyMode": "local_python_demo_only",
                "inferenceMode": inference_mode,
                "isSimulatedTestMode": is_mock_transport,
                "allowedOrigins": list(allowed_origins),
                "rateLimiter": context["rate_limiter"].snapshot_stats(),
                "limitations": LOCAL_TRUST_LIMITATION,
            },
            cors_origin=cors_origin,
            log_code="health_ok" if key_ready else "health_disabled_no_key",
        )

    if upper_method != "POST":
        return _build_json_response(
            context, upper_method, path, 405,
            {"ok": False, "code": "method_not_allowed", "error": "Method not allowed."},
            cors_origin=cors_origin,
            log_code="method_not_allowed",
        )

    if path != "/api/dispatch/recommend":
        return _build_json_response(
            context, upper_method, path, 404,
            {"ok": False, "code": "not_found", "error": "Endpoint not found."},
            cors_origin=cors_origin,
            log_code="not_found",
        )

    raw_ct = str(_header_get(headers, "Content-Type") or "")
    content_type = raw_ct.split(";")[0].strip().lower()
    if content_type != "application/json":
        return _build_json_response(
            context, upper_method, path, 415,
            {
                "ok": False,
                "code": "unsupported_media_type",
                "error": "Content-Type must be application/json.",
                "fallbackRecommended": True,
            },
            cors_origin=cors_origin,
            log_code="unsupported_media_type",
        )

    max_bytes = context["max_body_bytes"]
    raw_cl = _header_get(headers, "Content-Length")
    if raw_cl is not None:
        try:
            content_length = int(raw_cl)
        except ValueError:
            return _build_json_response(
                context, upper_method, path, 400,
                {"ok": False, "code": "invalid_content_length", "error": "Invalid Content-Length header."},
                cors_origin=cors_origin,
                log_code="invalid_content_length",
            )
        if content_length <= 0:
            return _build_json_response(
                context, upper_method, path, 400,
                {"ok": False, "code": "empty_body", "error": "Request body must not be empty."},
                cors_origin=cors_origin,
                log_code="empty_body",
            )
        if content_length > max_bytes:
            return _build_json_response(
                context, upper_method, path, 413,
                {
                    "ok": False,
                    "code": "payload_too_large",
                    "error": f"Request body exceeds maximum allowed {max_bytes} bytes.",
                    "fallbackRecommended": True,
                },
                cors_origin=cors_origin,
                log_code="payload_too_large",
            )

    if not raw_body_bytes:
        return _build_json_response(
            context, upper_method, path, 400,
            {"ok": False, "code": "empty_body", "error": "Request body must not be empty."},
            cors_origin=cors_origin,
            log_code="empty_body",
        )
    if len(raw_body_bytes) > max_bytes:
        return _build_json_response(
            context, upper_method, path, 413,
            {
                "ok": False,
                "code": "payload_too_large",
                "error": f"Request body exceeds maximum allowed {max_bytes} bytes.",
                "fallbackRecommended": True,
            },
            cors_origin=cors_origin,
            log_code="payload_too_large",
        )

    try:
        parsed_body = json.loads(raw_body_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _build_json_response(
            context, upper_method, path, 400,
            {
                "ok": False,
                "code": "invalid_json",
                "error": "Request body must be valid UTF-8 JSON.",
                "fallbackRecommended": True,
            },
            cors_origin=cors_origin,
            log_code="invalid_json",
        )

    ok_req, validated_req, validation_err = validate_dispatch_request_payload(parsed_body)
    if not ok_req:
        return _build_json_response(
            context, upper_method, path, 400,
            {
                "ok": False,
                "code": "invalid_dispatch_payload",
                "error": validation_err,
                "fallbackRecommended": True,
            },
            cors_origin=cors_origin,
            log_code="invalid_dispatch_payload",
        )

    # Zero eligible candidates -> local short circuit cleanly with zero API usage.
    ctx = validated_req["bookingContext"]
    if len(validated_req["eligibleCandidates"]) == 0:
        short_rec = {
            "bookingId": ctx["bookingId"],
            "slotRecommendations": [
                {
                    "slotId": s["slotId"],
                    "draftAdminReason": "",
                    "rankedCandidates": [],
                }
                for s in ctx["openSlots"]
            ],
            "operationalRisks": [
                {
                    "severity": "high",
                    "code": "zero_eligible_slot",
                    "message": "Zero eligible workers provided; skipped upstream Gemini request.",
                }
            ],
            "shortageAssessment": "critical_shortage",
            "recommendedNextAction": "escalate_support_case",
        }
        return _build_json_response(
            context, upper_method, path, 200,
            {
                "ok": True,
                "liveAiAttempted": False,
                "shortCircuitedZeroEligible": True,
                "provider": None,
                "model": None,
                "bookingId": ctx["bookingId"],
                "recommendation": short_rec,
                "proxyValidation": {"rejectedSlots": [], "rejectedCandidates": []},
                "limitations": LOCAL_TRUST_LIMITATION,
            },
            cors_origin=cors_origin,
            log_code="zero_eligible_short_circuit",
        )

    provider = context["provider_resolver"]()
    if provider not in ALLOWED_AI_PROVIDERS:
        provider = DEFAULT_AI_PROVIDER

    api_key = context["api_key_loader"]()
    if not is_api_key_configured(api_key):
        key_env_name = "GEMINI_API_KEY" if provider == "gemini" else "OPENAI_API_KEY"
        return _build_json_response(
            context, upper_method, path, 503,
            {
                "ok": False,
                "code": "proxy_not_configured",
                "provider": provider,
                "error": (
                    f"Local proxy disabled: {key_env_name} is not configured. "
                    "Continue using Crewly rules-based fallback."
                ),
                "fallbackRecommended": True,
            },
            cors_origin=cors_origin,
            log_code="proxy_not_configured",
        )

    prompt_payload = build_prompt_payload_for_gemini(validated_req)
    allowed_rate, rate_code, rate_msg, retry_after = context["rate_limiter"].check_and_record(
        client_ip,
        prompt_payload,
    )
    if not allowed_rate:
        return _build_json_response(
            context, upper_method, path, 429,
            {
                "ok": False,
                "code": rate_code,
                "error": rate_msg,
                "fallbackRecommended": True,
            },
            cors_origin=cors_origin,
            extra_headers={"Retry-After": retry_after},
            log_code=rate_code,
        )

    model = context["model_resolver"]()
    started = time.monotonic()
    try:
        if provider == "gemini":
            raw_ai_output = request_gemini_recommendation(
                prompt_payload=prompt_payload,
                api_key=api_key,
                model=model,
                timeout_seconds=context["upstream_timeout_seconds"],
                transport_fn=context["transport_fn"],
            )
        else:
            raw_ai_output = request_openai_recommendation(
                prompt_payload=prompt_payload,
                api_key=api_key,
                model=model,
                timeout_seconds=context["upstream_timeout_seconds"],
                transport_fn=context["transport_fn"],
            )
    except (OpenAIClientError, GeminiClientError) as ai_err:
        return _build_json_response(
            context, upper_method, path, ai_err.http_status,
            {
                "ok": False,
                "code": ai_err.code,
                "provider": provider,
                "error": redact_secrets(ai_err.message, api_key=api_key),
                "fallbackRecommended": True,
            },
            cors_origin=cors_origin,
            log_code=ai_err.code,
        )

    ok_out, out_code, normalized_or_err, val_report = validate_and_normalize_gemini_output(
        raw_ai_output,
        validated_req,
        api_key=api_key,
    )
    if not ok_out:
        return _build_json_response(
            context, upper_method, path, 502,
            {
                "ok": False,
                "code": out_code,
                "provider": provider,
                "error": normalized_or_err,
                "proxyValidation": val_report,
                "fallbackRecommended": True,
            },
            cors_origin=cors_origin,
            log_code=out_code,
        )

    elapsed_ms = int((time.monotonic() - started) * 1000)
    is_mock_transport = context["transport_fn"] is not None
    live_source = "live_gemini_ai" if provider == "gemini" else "live_openai_ai"
    inference_source = "mock_ai_test_mode" if is_mock_transport else live_source
    return _build_json_response(
        context, upper_method, path, 200,
        {
            "ok": True,
            "provider": provider,
            "inferenceSource": inference_source,
            "isSimulatedTestMode": is_mock_transport,
            "liveAiAttempted": not is_mock_transport,
            "shortCircuitedZeroEligible": False,
            "model": model,
            "bookingId": ctx["bookingId"],
            "elapsedMs": elapsed_ms,
            "recommendation": normalized_or_err,
            "proxyValidation": val_report,
            "limitations": LOCAL_TRUST_LIMITATION,
        },
        cors_origin=cors_origin,
        log_code=f"{provider}_recommendation_ok" if not is_mock_transport else "mock_ai_test_mode_ok",
    )


def create_proxy_context(
    host=BIND_HOST,
    port=BIND_PORT,
    api_key_loader=None,
    model_resolver=None,
    provider_resolver=None,
    allowed_origins=None,
    rate_limiter=None,
    transport_fn=None,
    upstream_timeout_seconds=UPSTREAM_TIMEOUT_SECONDS,
    max_body_bytes=MAX_REQUEST_BODY_BYTES,
    log_fn=None,
):
    """Builds an isolated proxy configuration context bound strictly to 127.0.0.1."""
    if host != "127.0.0.1":
        raise ValueError("Crewly local proxy must bind strictly to 127.0.0.1.")

    active_provider_resolver = provider_resolver or resolve_ai_provider
    return {
        "host": host,
        "port": port,
        "provider_resolver": active_provider_resolver,
        "api_key_loader": api_key_loader or (lambda: resolve_provider_api_key(active_provider_resolver())),
        "model_resolver": model_resolver or (lambda: resolve_provider_model(active_provider_resolver())),
        "allowed_origins": tuple(allowed_origins) if allowed_origins is not None else get_allowed_origins(),
        "rate_limiter": rate_limiter or LocalDispatchRateLimiter(),
        "transport_fn": transport_fn,
        "upstream_timeout_seconds": upstream_timeout_seconds,
        "max_body_bytes": max_body_bytes,
        "log_fn": log_fn or _default_log,
    }


def create_proxy_handler_class(context):
    """Creates a BaseHTTPRequestHandler bound to a proxy context."""

    class CrewlyDispatchProxyHandler(BaseHTTPRequestHandler):
        server_version = "CrewlyLocalProxy/1.0"
        sys_version = ""

        def log_message(self, format_str, *args):
            api_key = context["api_key_loader"]()
            raw = format_str % args if args else str(format_str)
            safe = redact_secrets(raw, api_key=api_key)
            context["log_fn"](f"[proxy-http] {safe}")

        def _dispatch_to_pipeline(self, method):
            body_bytes = b""
            if method == "POST":
                raw_cl = self.headers.get("Content-Length")
                if raw_cl is None:
                    status, resp_headers, resp_bytes = _build_json_response(
                        context, "POST", self.path, 411,
                        {"ok": False, "code": "length_required", "error": "Content-Length header is required.", "fallbackRecommended": True},
                        log_code="length_required",
                    )
                    self._write_wire_response(status, resp_headers, resp_bytes)
                    return
                try:
                    cl_int = int(raw_cl)
                except ValueError:
                    cl_int = -1
                if cl_int > 0:
                    cap = context["max_body_bytes"] + 1
                    body_bytes = self.rfile.read(min(cl_int, cap))

            client_ip = self.client_address[0] if self.client_address else "127.0.0.1"
            status, resp_headers, resp_bytes = handle_proxy_http_request(
                context=context,
                method=method,
                path=self.path,
                headers=self.headers,
                raw_body_bytes=body_bytes,
                client_ip=client_ip,
            )
            self._write_wire_response(status, resp_headers, resp_bytes)

        def _write_wire_response(self, status_code, resp_headers, body_bytes):
            self.send_response(status_code)
            for hk, hv in resp_headers.items():
                self.send_header(hk, hv)
            self.end_headers()
            if body_bytes:
                self.wfile.write(body_bytes)

        def do_OPTIONS(self):
            self._dispatch_to_pipeline("OPTIONS")

        def do_GET(self):
            self._dispatch_to_pipeline("GET")

        def do_POST(self):
            self._dispatch_to_pipeline("POST")

    return CrewlyDispatchProxyHandler


def create_proxy_server(
    host=BIND_HOST,
    port=BIND_PORT,
    api_key_loader=None,
    model_resolver=None,
    provider_resolver=None,
    allowed_origins=None,
    rate_limiter=None,
    transport_fn=None,
    upstream_timeout_seconds=UPSTREAM_TIMEOUT_SECONDS,
    max_body_bytes=MAX_REQUEST_BODY_BYTES,
    log_fn=None,
):
    """Builds a ThreadingHTTPServer bound strictly to loopback 127.0.0.1."""
    context = create_proxy_context(
        host=host,
        port=port,
        api_key_loader=api_key_loader,
        model_resolver=model_resolver,
        provider_resolver=provider_resolver,
        allowed_origins=allowed_origins,
        rate_limiter=rate_limiter,
        transport_fn=transport_fn,
        upstream_timeout_seconds=upstream_timeout_seconds,
        max_body_bytes=max_body_bytes,
        log_fn=log_fn,
    )
    handler_cls = create_proxy_handler_class(context)
    server = ThreadingHTTPServer((host, port), handler_cls)
    context["port"] = server.server_address[1]
    return server


def main():
    server = create_proxy_server()
    provider = resolve_ai_provider()
    api_key = resolve_provider_api_key(provider)
    key_env_name = "GEMINI_API_KEY" if provider == "gemini" else "OPENAI_API_KEY"
    key_status = "CONFIGURED" if is_api_key_configured(api_key) else "NOT SET (fallback/disabled mode)"
    print(f"Crewly Local Dispatch Proxy listening on http://{BIND_HOST}:{BIND_PORT}")
    print(f"Provider: {provider} | Model: {resolve_provider_model(provider)} | {key_env_name}: {key_status}")
    print("Allowed Origins:", ", ".join(get_allowed_origins()))
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Crewly Local Dispatch Proxy...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
