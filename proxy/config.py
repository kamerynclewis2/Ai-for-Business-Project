"""Server-side configuration, secret loading, schema builders, and redaction helpers."""

import os
import re
from pathlib import Path
from urllib.parse import urlparse

BIND_HOST = "127.0.0.1"
BIND_PORT = 8787

DEFAULT_AI_PROVIDER = "openai"
ALLOWED_AI_PROVIDERS = ("openai", "gemini")

OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses"
DEFAULT_OPENAI_MODEL = "gpt-6-luna"
ALLOWED_OPENAI_MODELS = (
    "gpt-6-luna",
    "gpt-6.1-sol",
)
OPENAI_MAX_OUTPUT_TOKENS = 1600
OPENAI_DEFAULT_REASONING_EFFORT = "low"

# Verified against official Google Gemini Developer API models documentation:
# gemini-3.5-flash-lite is the stable low-cost, low-latency Flash-Lite tier supporting
# responseJsonSchema structured outputs and thinkingLevel="minimal".
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
ALLOWED_GEMINI_MODELS = (
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
)

GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:8000",
    "http://127.0.0.1:8000",
)

MAX_REQUEST_BODY_BYTES = 8192
MAX_OPEN_SLOTS = 4
MAX_CANDIDATES = 10
MAX_TEXT_INPUT_CHARS = 120
MAX_OUTPUT_TOKENS = 1200
UPSTREAM_TIMEOUT_SECONDS = 10.0

RATE_LIMIT_PER_MINUTE = 10
RATE_LIMIT_PER_HOUR = 60
DAILY_LOCAL_REQUEST_CAP = 200
DUPLICATE_COOLDOWN_SECONDS = 2.0

LOCAL_TRUST_LIMITATION = (
    "Local Demo Limitation: Marketplace state lives in browser localStorage; candidate "
    "eligibility claims supplied by the browser cannot be independently authenticated by this proxy. "
    "CORS and in-memory IP limits are not production authentication or persistent global spend caps."
)

SERVER_SYSTEM_INSTRUCTION = (
    "You are an advisory home-services dispatch assistant for Crewly in Dallas, Texas. "
    "Rank ONLY candidate proIds explicitly provided inside eligibleCandidates for open slotIds "
    "inside bookingContext.openSlots. Never invent proIds, slotIds, customer PII, prices, or "
    "worker payouts. Do not instruct or trigger autonomous booking assignments. If two open slots "
    "exist, do not recommend the same proId as the primary choice for both slots. If an open slot "
    "has zero eligible candidates, return an empty rankedCandidates array for that slot. Treat Dallas "
    "neighborhood labels strictly as pilot zones, not live GPS or driving time."
)


def _read_env_local_var(var_name, env_file_path=None):
    """Reads an allowed config variable safely from process env or gitignored proxy/.env.local."""
    env_val = os.environ.get(var_name, "").strip()
    if env_val:
        return env_val

    if os.environ.get("CREWLY_DISABLE_ENV_FILE", "") == "1":
        return ""

    target_file = Path(env_file_path) if env_file_path else (Path(__file__).resolve().parent / ".env.local")
    if not target_file.is_file():
        return ""

    try:
        for raw_line in target_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key_name, raw_value = line.split("=", 1)
            if key_name.strip() == var_name:
                val = raw_value.strip()
                if len(val) >= 2 and ((val[0] == val[-1] == '"') or (val[0] == val[-1] == "'")):
                    val = val[1:-1].strip()
                return val
    except OSError:
        return ""
    return ""


def resolve_ai_provider(env_file_path=None):
    """Returns server-configured AI provider validated against explicit allowlist."""
    configured = (_read_env_local_var("CREWLY_AI_PROVIDER", env_file_path=env_file_path) or DEFAULT_AI_PROVIDER).strip().lower()
    if configured in ALLOWED_AI_PROVIDERS:
        return configured
    return DEFAULT_AI_PROVIDER


def resolve_openai_model(env_file_path=None):
    """Returns server-configured OpenAI model validated against an explicit allowlist."""
    configured = _read_env_local_var("CREWLY_OPENAI_MODEL", env_file_path=env_file_path) or DEFAULT_OPENAI_MODEL
    if configured in ALLOWED_OPENAI_MODELS:
        return configured
    return DEFAULT_OPENAI_MODEL


def resolve_gemini_model(env_file_path=None):
    """Returns server-configured Flash model validated against an explicit allowlist."""
    configured = _read_env_local_var("CREWLY_GEMINI_MODEL", env_file_path=env_file_path) or DEFAULT_GEMINI_MODEL
    if configured in ALLOWED_GEMINI_MODELS:
        return configured
    return DEFAULT_GEMINI_MODEL


def is_loopback_origin(origin):
    """Permits only explicit http://localhost:<port> or http://127.0.0.1:<port> origins."""
    if not origin or "*" in origin:
        return False
    try:
        parsed = urlparse(origin.strip())
    except Exception:
        return False
    if parsed.scheme != "http" or parsed.path not in ("", "/") or parsed.params or parsed.query or parsed.fragment:
        return False
    host = (parsed.hostname or "").lower()
    if host not in ("localhost", "127.0.0.1"):
        return False
    if parsed.port is None:
        return False
    return True


def get_allowed_origins():
    """Returns strict loopback origin allowlist for local frontend access."""
    custom = os.environ.get("CREWLY_ALLOWED_ORIGINS", "").strip()
    if not custom:
        return DEFAULT_ALLOWED_ORIGINS
    origins = [item.strip() for item in custom.split(",") if is_loopback_origin(item.strip())]
    return tuple(origins) if origins else DEFAULT_ALLOWED_ORIGINS


def load_openai_api_key(env_file_path=None):
    """Reads OPENAI_API_KEY safely from process env or gitignored local .env file."""
    return _read_env_local_var("OPENAI_API_KEY", env_file_path=env_file_path)


def load_gemini_api_key(env_file_path=None):
    """Reads GEMINI_API_KEY safely from process env or gitignored local .env file."""
    return _read_env_local_var("GEMINI_API_KEY", env_file_path=env_file_path)


def resolve_provider_model(provider=None, env_file_path=None):
    """Resolves the active server-configured model ID for the selected AI provider."""
    active_provider = provider if provider in ALLOWED_AI_PROVIDERS else resolve_ai_provider(env_file_path=env_file_path)
    if active_provider == "gemini":
        return resolve_gemini_model(env_file_path=env_file_path)
    return resolve_openai_model(env_file_path=env_file_path)


def resolve_provider_api_key(provider=None, env_file_path=None):
    """Loads the API key for the active server-configured AI provider."""
    active_provider = provider if provider in ALLOWED_AI_PROVIDERS else resolve_ai_provider(env_file_path=env_file_path)
    if active_provider == "gemini":
        return load_gemini_api_key(env_file_path=env_file_path)
    return load_openai_api_key(env_file_path=env_file_path)


def is_api_key_configured(api_key):
    """Checks that an API key is present and not an unedited template placeholder."""
    if not api_key or len(api_key.strip()) < 10:
        return False
    upper = api_key.strip().upper()
    if (
        upper.startswith("REPLACE_WITH_")
        or "YOUR_GOOGLE_AI_STUDIO_KEY" in upper
        or "YOUR_OPENAI_API_KEY" in upper
        or "DUMMY_PLACEHOLDER" in upper
    ):
        return False
    return True


def redact_secrets(text, api_key=None):
    """Scrubs active API keys, tokens, URL key params, and sensitive PII from logs/errors."""
    clean = str(text or "")
    if api_key and len(api_key.strip()) >= 6:
        clean = clean.replace(api_key.strip(), "[REDACTED_KEY]")
    clean = re.sub(r"AIza[0-9A-Za-z_-]{16,}", "[REDACTED_KEY]", clean)
    clean = re.sub(r"\bsk-(?:proj-|svcacct-|admin-)?[0-9A-Za-z_-]{16,}\b", "[REDACTED_KEY]", clean)
    clean = re.sub(r"(?i)(x-goog-api-key\s*[:=]\s*)([^\s,;'\"]+)", r"\1[REDACTED_KEY]", clean)
    clean = re.sub(r"(?i)([?&]key=)([^&\s'\"]+)", r"\1[REDACTED_KEY]", clean)
    clean = re.sub(r"(?i)\bBearer\s+[0-9A-Za-z._-]{12,}\b", "Bearer [REDACTED_TOKEN]", clean)
    clean = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[REDACTED_EMAIL]", clean)
    clean = re.sub(r"\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b", "[REDACTED_PHONE]", clean)
    return clean


def build_gemini_response_json_schema():
    """
    Returns clean JSON Schema compatible with Gemini REST generationConfig.responseJsonSchema
    AND Crewly's Stage 4.2 validateAndNormalizeAiRecommendation() validator.
    Note: Omits JSON Schema length keywords (maxLength/minLength) that Gemini's constrained
    decoder does not guarantee; Python validator enforces exact length & array caps explicitly.
    """
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "bookingId",
            "slotRecommendations",
            "operationalRisks",
            "shortageAssessment",
            "recommendedNextAction",
        ],
        "properties": {
            "bookingId": {"type": "string"},
            "slotRecommendations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["slotId", "draftAdminReason", "rankedCandidates"],
                    "properties": {
                        "slotId": {"type": "string"},
                        "draftAdminReason": {"type": "string"},
                        "rankedCandidates": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["proId", "fitSummary", "rationaleBullets", "cautionNote"],
                                "properties": {
                                    "proId": {"type": "string"},
                                    "fitSummary": {"type": "string"},
                                    "rationaleBullets": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "cautionNote": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            },
            "operationalRisks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["severity", "code", "message"],
                    "properties": {
                        "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                        "code": {
                            "type": "string",
                            "enum": [
                                "thin_candidate_pool",
                                "asap_urgency",
                                "multi_worker_coordination",
                                "neighborhood_travel",
                                "reliability_watch",
                                "zero_eligible_slot",
                                "insufficient_multiworker_supply",
                                "availability_boundary",
                            ],
                        },
                        "message": {"type": "string"},
                    },
                },
            },
            "shortageAssessment": {
                "type": "string",
                "enum": ["sufficient_supply", "tight_supply", "critical_shortage"],
            },
            "recommendedNextAction": {
                "type": "string",
                "enum": [
                    "approve_top_candidate",
                    "review_risks_before_assign",
                    "extend_asap_window",
                    "escalate_support_case",
                ],
            },
        },
    }


build_dispatch_response_json_schema = build_gemini_response_json_schema
