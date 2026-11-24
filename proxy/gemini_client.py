"""Standard-library Google Gemini Developer API REST client with clean error mapping & redaction."""

import json
import socket
import ssl
import urllib.error
import urllib.request

from proxy.config import (
    CONCIERGE_SYSTEM_INSTRUCTION,
    GEMINI_API_BASE_URL,
    MAX_OUTPUT_TOKENS,
    SERVER_SYSTEM_INSTRUCTION,
    UPSTREAM_TIMEOUT_SECONDS,
    build_concierge_response_json_schema,
    build_gemini_response_json_schema,
    redact_secrets,
)


class GeminiClientError(Exception):
    """Structured non-secret upstream client exception."""

    def __init__(self, http_status, code, message):
        super().__init__(message)
        self.http_status = http_status
        self.code = code
        self.message = message


def build_generate_content_body(prompt_payload):
    """Builds official Gemini v1beta generateContent body with server-owned prompt & schema."""
    return {
        "systemInstruction": {
            "parts": [{"text": SERVER_SYSTEM_INSTRUCTION}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "Evaluate the following Crewly dispatch context and return ONLY JSON "
                            "matching the schema:\n"
                            + json.dumps(prompt_payload, ensure_ascii=True)
                        )
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
            "responseMimeType": "application/json",
            "responseJsonSchema": build_gemini_response_json_schema(),
            "thinkingConfig": {"thinkingLevel": "minimal"},
        },
    }


def default_https_transport(url, headers, body_bytes, timeout_seconds):
    """Executes HTTPS POST using Python stdlib urllib without placing credentials in the URL."""
    req = urllib.request.Request(url=url, data=body_bytes, headers=headers, method="POST")
    context = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout_seconds, context=context) as resp:
        return resp.status, resp.read().decode("utf-8", errors="replace")


def extract_json_from_gemini_envelope(envelope_dict, api_key=None):
    """Extracts and parses the candidate text JSON from a Gemini generateContent response."""
    if not isinstance(envelope_dict, dict):
        raise GeminiClientError(502, "invalid_gemini_response", "Upstream Gemini response was not a JSON object.")

    prompt_feedback = envelope_dict.get("promptFeedback")
    if isinstance(prompt_feedback, dict) and prompt_feedback.get("blockReason"):
        raise GeminiClientError(
            502,
            "gemini_prompt_blocked",
            "Gemini did not return recommendations due to safety filtering.",
        )

    candidates = envelope_dict.get("candidates")
    if not isinstance(candidates, list) or len(candidates) == 0:
        raise GeminiClientError(502, "empty_gemini_candidates", "Gemini response contained zero completion candidates.")

    first = candidates[0] if isinstance(candidates[0], dict) else {}
    content = first.get("content") if isinstance(first.get("content"), dict) else {}
    parts = content.get("parts") if isinstance(content.get("parts"), list) else []

    text_chunks = [
        p.get("text", "")
        for p in parts
        if isinstance(p, dict) and isinstance(p.get("text"), str) and not p.get("thought")
    ]
    combined = "".join(text_chunks).strip()
    if not combined:
        raise GeminiClientError(502, "empty_gemini_text", "Gemini candidate contained no JSON text payload.")

    # Defensive markdown fence stripping if a fallback model emits ```json blocks.
    if combined.startswith("```"):
        lines = combined.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        combined = "\n".join(lines).strip()

    try:
        parsed = json.loads(combined)
    except json.JSONDecodeError:
        raise GeminiClientError(
            502,
            "malformed_gemini_json",
            "Gemini returned non-JSON or truncated structured text; use rules-based fallback.",
        )

    if not isinstance(parsed, dict):
        raise GeminiClientError(
            502,
            "invalid_gemini_output",
            "Gemini JSON root must be an object; use rules-based fallback.",
        )
    return parsed


def request_gemini_recommendation(
    prompt_payload,
    api_key,
    model,
    timeout_seconds=UPSTREAM_TIMEOUT_SECONDS,
    transport_fn=None,
):
    """
    Sends sanitized Crewly prompt payload to official Gemini Developer API.
    Never puts GEMINI_API_KEY in URL or returned error messages.
    """
    if not api_key:
        raise GeminiClientError(
            503,
            "proxy_not_configured",
            "GEMINI_API_KEY is not configured on the local proxy. Run rules-based fallback.",
        )

    transport = transport_fn or default_https_transport
    url = f"{GEMINI_API_BASE_URL}/{model}:generateContent"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }
    request_body = json.dumps(build_generate_content_body(prompt_payload), ensure_ascii=True).encode("utf-8")

    try:
        status_code, raw_body = transport(url, headers, request_body, timeout_seconds)
    except urllib.error.HTTPError as err:
        upstream_status = getattr(err, "code", 502)
        if upstream_status == 429:
            raise GeminiClientError(
                429,
                "upstream_rate_limited",
                "Gemini API rate limit or quota exceeded (HTTP 429); switch to Crewly rules fallback.",
            )
        if upstream_status in (401, 403):
            raise GeminiClientError(
                502,
                "upstream_auth_error",
                "Gemini API rejected credentials or quota access. Verify AI Studio setup; never expose keys.",
            )
        if upstream_status == 400:
            raise GeminiClientError(
                502,
                "upstream_bad_request",
                "Gemini API rejected upstream request format (HTTP 400). Use Crewly rules fallback.",
            )
        raise GeminiClientError(
            502,
            "upstream_unavailable",
            f"Gemini API returned upstream HTTP {upstream_status}. Use Crewly rules fallback.",
        )
    except (socket.timeout, TimeoutError):
        raise GeminiClientError(
            504,
            "upstream_timeout",
            f"Gemini API request timed out after {int(timeout_seconds)}s. Use Crewly rules fallback.",
        )
    except urllib.error.URLError as err:
        reason = getattr(err, "reason", None)
        if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason).lower():
            raise GeminiClientError(
                504,
                "upstream_timeout",
                f"Gemini API request timed out after {int(timeout_seconds)}s. Use Crewly rules fallback.",
            )
        safe_reason = redact_secrets(str(reason), api_key)
        raise GeminiClientError(
            502,
            "upstream_network_error",
            f"Unable to reach Gemini API ({safe_reason or 'network error'}). Use Crewly rules fallback.",
        )
    except Exception as exc:
        safe_msg = redact_secrets(str(exc), api_key)
        raise GeminiClientError(
            502,
            "upstream_client_error",
            f"Upstream proxy call failed ({safe_msg or 'unexpected error'}).",
        )

    if status_code >= 500:
        raise GeminiClientError(
            502,
            "upstream_unavailable",
            f"Gemini API temporary service error (HTTP {status_code}). Use Crewly rules fallback.",
        )
    if status_code == 429:
        raise GeminiClientError(
            429,
            "upstream_rate_limited",
            "Gemini API rate limit exceeded (HTTP 429); switch to Crewly rules fallback.",
        )
    if status_code >= 400:
        raise GeminiClientError(
            502,
            "upstream_error",
            f"Gemini API error (HTTP {status_code}). Use Crewly rules fallback.",
        )

    try:
        envelope = json.loads(raw_body)
    except json.JSONDecodeError:
        raise GeminiClientError(
            502,
            "invalid_gemini_envelope",
            "Upstream Gemini HTTP body was not valid JSON.",
        )

    return extract_json_from_gemini_envelope(envelope, api_key=api_key)


def build_gemini_concierge_body(validated_payload):
    """Builds official Gemini v1beta generateContent body for the Moving Booking Concierge."""
    messages = validated_payload.get("messages", [])
    conv_lines = [f"{m['role'].upper()}: {m['content']}" for m in messages]
    draft_dict = validated_payload.get("currentDraft") or {}
    input_text = (
        "Customer Conversation History:\n" + "\n".join(conv_lines) + "\n\n"
        "Existing Intake Draft:\n" + json.dumps(draft_dict, ensure_ascii=True) + "\n\n"
        "Analyze the moving request and return ONLY valid JSON matching the schema."
    )
    return {
        "systemInstruction": {
            "parts": [{"text": CONCIERGE_SYSTEM_INSTRUCTION}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": input_text}],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
            "responseMimeType": "application/json",
            "responseJsonSchema": build_concierge_response_json_schema(),
            "thinkingConfig": {"thinkingLevel": "minimal"},
        },
    }


def request_gemini_concierge(
    validated_payload,
    api_key,
    model="gemini-3.5-flash-lite",
    timeout_seconds=UPSTREAM_TIMEOUT_SECONDS,
    transport_fn=None,
):
    """Sends sanitized Moving Concierge conversation to Google Gemini Developer API."""
    body_dict = build_gemini_concierge_body(validated_payload)
    body_bytes = json.dumps(body_dict).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key.strip(),
        "User-Agent": "CrewlyLocalProxy/1.0",
    }
    url = f"{GEMINI_API_BASE_URL}/{model}:generateContent"

    transport = transport_fn or default_https_transport
    try:
        status_code, raw_body = transport(url, headers, body_bytes, timeout_seconds)
    except (socket.timeout, TimeoutError):
        raise GeminiClientError(
            504,
            "upstream_timeout",
            f"Gemini API request timed out after {int(timeout_seconds)}s. Use Crewly manual booking.",
        )
    except urllib.error.URLError as err:
        reason = getattr(err, "reason", None)
        if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason).lower():
            raise GeminiClientError(
                504,
                "upstream_timeout",
                f"Gemini API request timed out after {int(timeout_seconds)}s. Use Crewly manual booking.",
            )
        safe_reason = redact_secrets(str(reason), api_key)
        raise GeminiClientError(
            502,
            "upstream_network_error",
            f"Unable to reach Gemini API ({safe_reason or 'network error'}). Use Crewly manual booking.",
        )
    except Exception as exc:
        safe_msg = redact_secrets(str(exc), api_key)
        raise GeminiClientError(
            502,
            "upstream_client_error",
            f"Upstream proxy call failed ({safe_msg or 'unexpected error'}).",
        )

    if status_code >= 500:
        raise GeminiClientError(
            502,
            "upstream_unavailable",
            f"Gemini API temporary service error (HTTP {status_code}). Use Crewly manual booking.",
        )
    if status_code == 429:
        raise GeminiClientError(
            429,
            "upstream_rate_limited",
            "Gemini API rate limit exceeded (HTTP 429); switch to Crewly manual booking.",
        )
    if status_code >= 400:
        raise GeminiClientError(
            502,
            "upstream_error",
            f"Gemini API error (HTTP {status_code}). Use Crewly manual booking.",
        )

    try:
        envelope = json.loads(raw_body)
    except json.JSONDecodeError:
        raise GeminiClientError(
            502,
            "invalid_gemini_envelope",
            "Upstream Gemini HTTP body was not valid JSON.",
        )

    return extract_json_from_gemini_envelope(envelope, api_key=api_key)
