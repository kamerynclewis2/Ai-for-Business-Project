"""Standard-library OpenAI Responses API REST client with clean error mapping & redaction."""

import json
import socket
import urllib.error

from proxy.config import (
    ALLOWED_OPENAI_MODELS,
    DEFAULT_OPENAI_MODEL,
    OPENAI_DEFAULT_REASONING_EFFORT,
    OPENAI_MAX_OUTPUT_TOKENS,
    OPENAI_RESPONSES_API_URL,
    SERVER_SYSTEM_INSTRUCTION,
    UPSTREAM_TIMEOUT_SECONDS,
    build_dispatch_response_json_schema,
    redact_secrets,
)
from proxy.gemini_client import default_https_transport


class OpenAIClientError(Exception):
    """Structured non-secret upstream OpenAI client exception."""

    def __init__(self, http_status, code, message):
        super().__init__(message)
        self.http_status = http_status
        self.code = code
        self.message = message


def _raise_for_upstream_http_status(status_code):
    """Maps upstream OpenAI HTTP error codes to safe non-secret proxy errors."""
    if status_code == 429:
        raise OpenAIClientError(
            429,
            "upstream_rate_limited",
            "OpenAI API rate limit or quota exceeded (HTTP 429); switch to Crewly rules fallback.",
        )
    if status_code in (401, 403):
        raise OpenAIClientError(
            502,
            "upstream_auth_error",
            "OpenAI API rejected credentials or project access. Verify local OPENAI_API_KEY; never expose keys.",
        )
    if status_code == 400:
        raise OpenAIClientError(
            502,
            "upstream_bad_request",
            "OpenAI API rejected upstream request parameters (HTTP 400). Use Crewly rules fallback.",
        )
    if status_code >= 500:
        raise OpenAIClientError(
            502,
            "upstream_unavailable",
            f"OpenAI API temporary service error (HTTP {status_code}). Use Crewly rules fallback.",
        )
    raise OpenAIClientError(
        502,
        "upstream_error",
        f"OpenAI API error (HTTP {status_code}). Use Crewly rules fallback.",
    )


def build_openai_responses_body(prompt_payload, model=DEFAULT_OPENAI_MODEL):
    """Builds official OpenAI POST /v1/responses body with server prompt, reasoning & strict JSON schema."""
    selected_model = model if model in ALLOWED_OPENAI_MODELS else DEFAULT_OPENAI_MODEL
    return {
        "model": selected_model,
        "instructions": SERVER_SYSTEM_INSTRUCTION,
        "input": (
            "Evaluate the following Crewly dispatch context and return ONLY JSON "
            "matching the schema:\n"
            + json.dumps(prompt_payload, ensure_ascii=True)
        ),
        "reasoning": {"effort": OPENAI_DEFAULT_REASONING_EFFORT},
        "max_output_tokens": OPENAI_MAX_OUTPUT_TOKENS,
        "store": False,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "crewly_dispatch_recommendation",
                "strict": True,
                "schema": build_dispatch_response_json_schema(),
            }
        },
    }


def extract_json_from_openai_envelope(envelope_dict, api_key=None):
    """Extracts and parses structured JSON text from an OpenAI Responses API envelope."""
    if not isinstance(envelope_dict, dict):
        raise OpenAIClientError(502, "invalid_openai_response", "Upstream OpenAI response was not a JSON object.")

    top_error = envelope_dict.get("error")
    if top_error:
        raise OpenAIClientError(
            502,
            "openai_api_error",
            "OpenAI returned an upstream response error. Use Crewly rules fallback.",
        )

    top_status = str(envelope_dict.get("status") or "").strip().lower()
    if top_status == "incomplete":
        details = envelope_dict.get("incomplete_details")
        reason = details.get("reason") if isinstance(details, dict) else None
        safe_reason = redact_secrets(str(reason or "incomplete"), api_key)
        raise OpenAIClientError(
            502,
            "openai_response_incomplete",
            f"OpenAI response was incomplete ({safe_reason}). Use Crewly rules fallback.",
        )
    if top_status and top_status != "completed":
        raise OpenAIClientError(
            502,
            "openai_response_failed",
            f"OpenAI response ended with status '{redact_secrets(top_status, api_key)}'. Use Crewly rules fallback.",
        )

    text_chunks = []
    output_items = envelope_dict.get("output")
    if isinstance(output_items, list):
        for item in output_items:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type == "reasoning":
                continue
            item_status = str(item.get("status") or "").strip().lower()
            if item_status == "incomplete":
                raise OpenAIClientError(
                    502,
                    "openai_response_incomplete",
                    "OpenAI output message was incomplete; use Crewly rules fallback.",
                )
            content_parts = item.get("content")
            if not isinstance(content_parts, list):
                continue
            for part in content_parts:
                if not isinstance(part, dict):
                    continue
                part_type = part.get("type")
                if part_type == "refusal":
                    raise OpenAIClientError(
                        502,
                        "openai_refusal",
                        "OpenAI declined to generate dispatch advice (model refusal). Use Crewly rules fallback.",
                    )
                if part_type == "output_text" and isinstance(part.get("text"), str):
                    text_chunks.append(part.get("text", ""))

    combined = "".join(text_chunks).strip()
    if not combined and isinstance(envelope_dict.get("output_text"), str):
        combined = envelope_dict.get("output_text", "").strip()

    if not combined:
        raise OpenAIClientError(502, "empty_openai_text", "OpenAI response contained no JSON text payload.")

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
        raise OpenAIClientError(
            502,
            "malformed_openai_json",
            "OpenAI returned non-JSON or truncated structured text; use rules-based fallback.",
        )

    if not isinstance(parsed, dict):
        raise OpenAIClientError(
            502,
            "invalid_openai_output",
            "OpenAI JSON root must be an object; use rules-based fallback.",
        )
    return parsed


def request_openai_recommendation(
    prompt_payload,
    api_key,
    model=DEFAULT_OPENAI_MODEL,
    timeout_seconds=UPSTREAM_TIMEOUT_SECONDS,
    transport_fn=None,
):
    """
    Sends sanitized Crewly dispatch payload to official OpenAI Responses API.
    Never includes OPENAI_API_KEY in URLs, responses, or redacted error strings.
    """
    if not api_key:
        raise OpenAIClientError(
            503,
            "proxy_not_configured",
            "OPENAI_API_KEY is not configured on the local proxy. Run rules-based fallback.",
        )

    transport = transport_fn or default_https_transport
    selected_model = model if model in ALLOWED_OPENAI_MODELS else DEFAULT_OPENAI_MODEL
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key.strip()}",
    }
    request_body = json.dumps(
        build_openai_responses_body(prompt_payload, model=selected_model),
        ensure_ascii=True,
    ).encode("utf-8")

    try:
        status_code, raw_body = transport(OPENAI_RESPONSES_API_URL, headers, request_body, timeout_seconds)
    except urllib.error.HTTPError as err:
        _raise_for_upstream_http_status(getattr(err, "code", 502))
    except (socket.timeout, TimeoutError):
        raise OpenAIClientError(
            504,
            "upstream_timeout",
            f"OpenAI API request timed out after {int(timeout_seconds)}s. Use Crewly rules fallback.",
        )
    except urllib.error.URLError as err:
        reason = getattr(err, "reason", None)
        if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason).lower():
            raise OpenAIClientError(
                504,
                "upstream_timeout",
                f"OpenAI API request timed out after {int(timeout_seconds)}s. Use Crewly rules fallback.",
            )
        safe_reason = redact_secrets(str(reason), api_key)
        raise OpenAIClientError(
            502,
            "upstream_network_error",
            f"Unable to reach OpenAI API ({safe_reason or 'network error'}). Use Crewly rules fallback.",
        )
    except Exception as exc:
        safe_msg = redact_secrets(str(exc), api_key)
        raise OpenAIClientError(
            502,
            "upstream_client_error",
            f"Upstream proxy call failed ({safe_msg or 'unexpected error'}).",
        )

    if status_code >= 400:
        _raise_for_upstream_http_status(status_code)

    try:
        envelope = json.loads(raw_body)
    except json.JSONDecodeError:
        raise OpenAIClientError(
            502,
            "invalid_openai_envelope",
            "Upstream OpenAI HTTP body was not valid JSON.",
        )

    return extract_json_from_openai_envelope(envelope, api_key=api_key)
