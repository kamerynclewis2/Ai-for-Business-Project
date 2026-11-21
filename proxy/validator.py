"""Strict request allowlist validation, PII rejection, and Gemini output verification."""

import json
import re

from proxy.config import (
    DALLAS_PILOT_ZIP_CODES,
    MAX_CANDIDATES,
    MAX_OPEN_SLOTS,
    MAX_TEXT_INPUT_CHARS,
    redact_secrets,
)

BOOKING_ID_RE = re.compile(r"^CRW-\d{3,6}$")
SLOT_ID_RE = re.compile(r"^slot_\d{1,3}$")
PRO_ID_RE = re.compile(r"^pro_[a-zA-Z0-9_]{1,40}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")


def normalize_time_str(time_str):
    """Normalizes 12h/24h time strings (e.g. '10:00 AM', '10:00am', '14:30') to standard HH:MM (24h)."""
    if not time_str or not isinstance(time_str, str):
        return ""
    t = str(time_str).strip().upper()
    m = re.match(r"^(\d{1,2}):(\d{2})\s*(AM|PM)?$", t)
    if m:
        h, mn, meridiem = int(m.group(1)), m.group(2), m.group(3)
        if meridiem == "PM" and h < 12:
            h += 12
        elif meridiem == "AM" and h == 12:
            h = 0
        return f"{h:02d}:{mn}"
    return ""

ALLOWED_ROOT_KEYS = {
    "schemaVersion",
    "bookingContext",
    "eligibleCandidates",
    "slotSupply",
    "disqualifiedSummary",
    "constraints",
    "requestFingerprint",
}

ALLOWED_BOOKING_CONTEXT_KEYS = {
    "bookingId",
    "serviceCategory",
    "serviceTitle",
    "neighborhoodName",
    "timingType",
    "scheduledDate",
    "scheduledTime",
    "targetWeekday",
    "estimatedDurationHours",
    "asapRemainingMinutes",
    "scopeSummary",
    "alreadyAssignedCount",
    "totalSlotsCount",
    "openSlots",
}

ALLOWED_CANDIDATE_KEYS = {
    "proId",
    "displayName",
    "tier",
    "rating",
    "reviewCount",
    "historicalReviewCount",
    "reliabilityScore",
    "homeNeighborhood",
    "sameNeighborhoodAsBooking",
    "verifiedSkills",
    "verifiedEquipment",
    "dayAvailabilityWindow",
    "activeAssignmentsCount",
    "recentSessionCompletedJobsCount",
    "completedJobsCount",
    "historicalCompletedJobsKnown",
    "eligibleForSlotIds",
}

ALLOWED_SERVICE_CATEGORIES = {
    "moving",
    "tv_mounting",
    "wall_mounting",
    "furniture_assembly",
    "furniture_disassembly",
    "lawn_mowing",
}

ALLOWED_RISK_SEVERITIES = {"low", "medium", "high"}
ALLOWED_RISK_CODES = {
    "thin_candidate_pool",
    "asap_urgency",
    "multi_worker_coordination",
    "neighborhood_travel",
    "reliability_watch",
    "zero_eligible_slot",
    "insufficient_multiworker_supply",
    "availability_boundary",
}
ALLOWED_SHORTAGE_ASSESSMENTS = {"sufficient_supply", "tight_supply", "critical_shortage"}
ALLOWED_NEXT_ACTIONS = {
    "approve_top_candidate",
    "review_risks_before_assign",
    "extend_asap_window",
    "escalate_support_case",
}

# Explicit privacy & security deny-list checked recursively across every incoming object key.
FORBIDDEN_PII_OR_SECRET_KEYS = {
    "customerid",
    "customername",
    "address",
    "streetaddress",
    "zipcode",
    "postalcode",
    "phone",
    "phonenumber",
    "email",
    "notes",
    "selfreportednotes",
    "bio",
    "earnings",
    "availablebalance",
    "pendingbalance",
    "lifetimeearned",
    "wallettransactions",
    "payout",
    "pricing",
    "customersubtotal",
    "customertotal",
    "bookingfee",
    "totalworkerpayouts",
    "grossplatformrevenue",
    "supportcases",
    "adminauditlog",
    "messages",
    "workerreviews",
    "cancellationsnapshot",
    "apikey",
    "gemini_api_key",
    "openai_api_key",
    "provider",
    "aiprovider",
    "reasoning",
    "instructions",
    "secret",
    "password",
    "token",
    "systeminstruction",
    "model",
    "temperature",
}


def sanitize_text(value, max_len=240):
    """Strips script tags, markup delimiters, event attributes, and control chars."""
    if value is None:
        return ""
    clean = str(value)
    clean = re.sub(r"<script\b[^>]*>[\s\S]*?</script\s*>", " ", clean, flags=re.IGNORECASE)
    clean = re.sub(r"<[^>]*>", " ", clean)
    clean = clean.replace("<", "").replace(">", "")
    clean = re.sub(r"javascript\s*:", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\bon[a-z]{2,18}\s*=", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r"[\x00-\x1f\x7f]", " ", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    clean = redact_secrets(clean)
    if len(clean) > max_len:
        clean = clean[: max(0, max_len - 3)].rstrip() + "..."
    return clean


def _find_forbidden_key(obj, path=""):
    """Recursively detects forbidden PII, financial, or server-control keys."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            key_lower = str(k).strip().lower()
            cur_path = f"{path}.{k}" if path else str(k)
            if key_lower in FORBIDDEN_PII_OR_SECRET_KEYS:
                return cur_path
            nested = _find_forbidden_key(v, cur_path)
            if nested:
                return nested
    elif isinstance(obj, list):
        for idx, item in enumerate(obj):
            nested = _find_forbidden_key(item, f"{path}[{idx}]")
            if nested:
                return nested
    return None


def _contains_secret_or_pii_literal(payload):
    """Checks serialized body cleanly for embedded API key/token formats or phone/email literals."""
    try:
        serialized = json.dumps(payload, ensure_ascii=True)
    except Exception:
        return "Unserializable request payload."
    if re.search(r"(?:AIza[0-9A-Za-z_-]{16,}|\bsk-(?:proj-|svcacct-|admin-)?[0-9A-Za-z_-]{16,}\b)", serialized):
        return "Request body must not contain API keys."
    if re.search(r"\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b", serialized):
        return "Request body must not contain phone numbers."
    if re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", serialized, re.IGNORECASE):
        return "Request body must not contain email addresses."
    return None


def _validate_short_string(val, field_name, max_len=MAX_TEXT_INPUT_CHARS, allow_empty=False):
    if not isinstance(val, str):
        return None, f"{field_name} must be a string."
    trimmed = val.strip()
    if not allow_empty and not trimmed:
        return None, f"{field_name} must not be empty."
    if len(trimmed) > max_len:
        return None, f"{field_name} exceeds maximum allowed length ({max_len} chars)."
    return sanitize_text(trimmed, max_len), None


def validate_dispatch_request_payload(payload):
    """
    Validates Crewly Stage 4.2 sanitized request payload strictly before Gemini inference.
    Returns (True, sanitized_request_dict, None) or (False, None, error_message).
    """
    if not isinstance(payload, dict):
        return False, None, "Request body must be a JSON object."

    forbidden_key = _find_forbidden_key(payload)
    if forbidden_key:
        return False, None, f"Forbidden PII or sensitive field rejected: {forbidden_key}."

    unknown_root = set(payload.keys()) - ALLOWED_ROOT_KEYS
    if unknown_root:
        return False, None, f"Unexpected root field(s): {', '.join(sorted(unknown_root))}."

    literal_violation = _contains_secret_or_pii_literal(payload)
    if literal_violation:
        return False, None, literal_violation

    ctx = payload.get("bookingContext")
    if not isinstance(ctx, dict):
        return False, None, "bookingContext object is required."

    unknown_ctx = set(ctx.keys()) - ALLOWED_BOOKING_CONTEXT_KEYS
    if unknown_ctx:
        return False, None, f"Unexpected bookingContext field(s): {', '.join(sorted(unknown_ctx))}."

    booking_id = ctx.get("bookingId")
    if not isinstance(booking_id, str) or not BOOKING_ID_RE.match(booking_id.strip()):
        return False, None, "bookingContext.bookingId must match Crewly format (e.g. CRW-1004)."
    booking_id = booking_id.strip()

    category = ctx.get("serviceCategory")
    if category not in ALLOWED_SERVICE_CATEGORIES:
        return False, None, "bookingContext.serviceCategory is not recognized."

    service_title, err = _validate_short_string(ctx.get("serviceTitle"), "bookingContext.serviceTitle", 80)
    if err:
        return False, None, err

    neighborhood, err = _validate_short_string(ctx.get("neighborhoodName"), "bookingContext.neighborhoodName", 64)
    if err:
        return False, None, err

    timing_type = ctx.get("timingType")
    if timing_type not in ("asap", "scheduled"):
        return False, None, "bookingContext.timingType must be 'asap' or 'scheduled'."

    scheduled_date = ctx.get("scheduledDate")
    if scheduled_date is not None and (not isinstance(scheduled_date, str) or not DATE_RE.match(scheduled_date)):
        return False, None, "bookingContext.scheduledDate must be YYYY-MM-DD or null."

    scheduled_time = ctx.get("scheduledTime")
    if scheduled_time is not None and (not isinstance(scheduled_time, str) or not TIME_RE.match(scheduled_time)):
        return False, None, "bookingContext.scheduledTime must be HH:MM or null."

    open_slots_raw = ctx.get("openSlots")
    if not isinstance(open_slots_raw, list) or len(open_slots_raw) == 0:
        return False, None, "bookingContext.openSlots must be a non-empty array."
    if len(open_slots_raw) > MAX_OPEN_SLOTS:
        return False, None, f"bookingContext.openSlots exceeds maximum allowed ({MAX_OPEN_SLOTS})."

    sanitized_open_slots = []
    seen_slots = set()
    for idx, slot in enumerate(open_slots_raw):
        if not isinstance(slot, dict) or not set(slot.keys()).issubset({"slotId", "roleTitle"}):
            return False, None, f"openSlots[{idx}] contains invalid structure or keys."
        slot_id = slot.get("slotId")
        if not isinstance(slot_id, str) or not SLOT_ID_RE.match(slot_id.strip()):
            return False, None, f"openSlots[{idx}].slotId is invalid."
        slot_id = slot_id.strip()
        if slot_id in seen_slots:
            return False, None, f"Duplicate open slotId: {slot_id}."
        seen_slots.add(slot_id)
        role_title, err = _validate_short_string(slot.get("roleTitle"), f"openSlots[{idx}].roleTitle", 64)
        if err:
            return False, None, err
        sanitized_open_slots.append({"slotId": slot_id, "roleTitle": role_title})

    candidates_raw = payload.get("eligibleCandidates")
    if not isinstance(candidates_raw, list):
        return False, None, "eligibleCandidates must be an array."
    if len(candidates_raw) > MAX_CANDIDATES:
        return False, None, f"eligibleCandidates exceeds maximum allowed ({MAX_CANDIDATES})."

    sanitized_candidates = []
    seen_pros = set()
    for idx, cand in enumerate(candidates_raw):
        if not isinstance(cand, dict):
            return False, None, f"eligibleCandidates[{idx}] must be an object."
        unknown_c = set(cand.keys()) - ALLOWED_CANDIDATE_KEYS
        if unknown_c:
            return False, None, f"Unexpected field(s) in eligibleCandidates[{idx}]: {', '.join(sorted(unknown_c))}."
        pro_id = cand.get("proId")
        if not isinstance(pro_id, str) or not PRO_ID_RE.match(pro_id.strip()):
            return False, None, f"eligibleCandidates[{idx}].proId is invalid."
        pro_id = pro_id.strip()
        if pro_id in seen_pros:
            return False, None, f"Duplicate eligible candidate proId: {pro_id}."
        seen_pros.add(pro_id)

        display_name, err = _validate_short_string(cand.get("displayName"), f"eligibleCandidates[{idx}].displayName", 64)
        if err:
            return False, None, err

        elig_slots = cand.get("eligibleForSlotIds", [])
        if not isinstance(elig_slots, list) or not all(isinstance(s, str) and s in seen_slots for s in elig_slots):
            return False, None, f"eligibleCandidates[{idx}].eligibleForSlotIds must reference declared openSlots."

        home_zone, err = _validate_short_string(
            cand.get("homeNeighborhood", "Dallas Pilot"),
            f"eligibleCandidates[{idx}].homeNeighborhood",
            48,
        )
        if err:
            return False, None, err

        rating = cand.get("rating", 0)
        reliability = cand.get("reliabilityScore", 0)
        if not isinstance(rating, (int, float)) or not (0 <= float(rating) <= 5):
            return False, None, f"eligibleCandidates[{idx}].rating out of range [0, 5]."
        if not isinstance(reliability, (int, float)) or not (0 <= float(reliability) <= 100):
            return False, None, f"eligibleCandidates[{idx}].reliabilityScore out of range [0, 100]."

        recent_session_jobs = cand.get("recentSessionCompletedJobsCount")
        if not isinstance(recent_session_jobs, int):
            recent_session_jobs = cand.get("completedJobsCount", 0) if isinstance(cand.get("completedJobsCount"), int) else 0

        hist_reviews = cand.get("historicalReviewCount")
        if not isinstance(hist_reviews, int):
            hist_reviews = cand.get("reviewCount", 0) if isinstance(cand.get("reviewCount"), int) else 0

        sanitized_candidates.append({
            "proId": pro_id,
            "displayName": display_name,
            "tier": sanitize_text(cand.get("tier", "Bronze"), 24),
            "rating": float(rating),
            "reviewCount": int(cand.get("reviewCount", 0)) if isinstance(cand.get("reviewCount"), int) else 0,
            "historicalReviewCount": int(hist_reviews),
            "reliabilityScore": float(reliability),
            "homeNeighborhood": home_zone,
            "sameNeighborhoodAsBooking": bool(cand.get("sameNeighborhoodAsBooking", False)),
            "verifiedSkills": [sanitize_text(s, 32) for s in (cand.get("verifiedSkills") or [])[:12] if isinstance(s, str)],
            "verifiedEquipment": [sanitize_text(e, 32) for e in (cand.get("verifiedEquipment") or [])[:12] if isinstance(e, str)],
            "dayAvailabilityWindow": sanitize_text(cand.get("dayAvailabilityWindow"), 24) if cand.get("dayAvailabilityWindow") else None,
            "activeAssignmentsCount": int(cand.get("activeAssignmentsCount", 0)) if isinstance(cand.get("activeAssignmentsCount"), int) else 0,
            "recentSessionCompletedJobsCount": int(recent_session_jobs),
            "completedJobsCount": int(cand.get("completedJobsCount", recent_session_jobs)) if isinstance(cand.get("completedJobsCount"), int) else int(recent_session_jobs),
            "historicalCompletedJobsKnown": bool(cand.get("historicalCompletedJobsKnown", False)),
            "eligibleForSlotIds": list(dict.fromkeys(elig_slots)),
        })

    # Reconstruct strictly sanitized request object (drops arbitrary extra nested descriptions).
    sanitized_payload = {
        "schemaVersion": sanitize_text(payload.get("schemaVersion", "crewly_ai_dispatch_request_v1"), 48),
        "bookingContext": {
            "bookingId": booking_id,
            "serviceCategory": category,
            "serviceTitle": service_title,
            "neighborhoodName": neighborhood,
            "timingType": timing_type,
            "scheduledDate": scheduled_date,
            "scheduledTime": scheduled_time,
            "targetWeekday": sanitize_text(ctx.get("targetWeekday", ""), 16) or None,
            "estimatedDurationHours": float(ctx.get("estimatedDurationHours", 1))
            if isinstance(ctx.get("estimatedDurationHours"), (int, float))
            else 1.0,
            "asapRemainingMinutes": int(ctx["asapRemainingMinutes"])
            if isinstance(ctx.get("asapRemainingMinutes"), (int, float))
            else None,
            "scopeSummary": _sanitize_scope_summary(ctx.get("scopeSummary")),
            "alreadyAssignedCount": int(ctx.get("alreadyAssignedCount", 0))
            if isinstance(ctx.get("alreadyAssignedCount"), int)
            else 0,
            "totalSlotsCount": int(ctx.get("totalSlotsCount", len(sanitized_open_slots)))
            if isinstance(ctx.get("totalSlotsCount"), int)
            else len(sanitized_open_slots),
            "openSlots": sanitized_open_slots,
        },
        "eligibleCandidates": sanitized_candidates,
        "slotSupply": _sanitize_slot_supply(payload.get("slotSupply"), sanitized_open_slots, seen_pros),
        "disqualifiedSummary": _sanitize_disqualified_summary(payload.get("disqualifiedSummary")),
        "requestFingerprint": sanitize_text(payload.get("requestFingerprint", ""), 64) or None,
    }
    return True, sanitized_payload, None


def _sanitize_scope_summary(raw_scope):
    if not isinstance(raw_scope, dict):
        return {}
    allowed_scalar = {
        "workersRequired",
        "estimatedDurationHours",
        "truckNeeded",
        "edgeTrimming",
        "truckOption",
        "stairsOption",
        "stairsElevator",
        "tvSize",
        "wallType",
        "bracket",
        "yardSize",
        "gateAccess",
        "lotSize",
    }
    clean = {}
    for key in allowed_scalar:
        if key not in raw_scope:
            continue
        val = raw_scope[key]
        if isinstance(val, (bool, int, float)):
            clean[key] = val
        elif isinstance(val, str) and val.strip():
            clean[key] = sanitize_text(val, 64)
    if isinstance(raw_scope.get("requiredEquipment"), list):
        clean["requiredEquipment"] = [
            sanitize_text(item, 40)
            for item in raw_scope["requiredEquipment"][:6]
            if isinstance(item, str) and item.strip()
        ]
    return clean


def _sanitize_slot_supply(raw_supply, open_slots, valid_pro_ids):
    by_slot = {}
    if isinstance(raw_supply, list):
        for entry in raw_supply:
            if isinstance(entry, dict) and isinstance(entry.get("slotId"), str):
                by_slot[entry["slotId"]] = entry
    clean = []
    for slot in open_slots:
        entry = by_slot.get(slot["slotId"], {})
        raw_ids = entry.get("eligibleProIds") if isinstance(entry.get("eligibleProIds"), list) else []
        filtered_ids = [pid for pid in raw_ids if isinstance(pid, str) and pid in valid_pro_ids]
        clean.append({
            "slotId": slot["slotId"],
            "roleTitle": slot["roleTitle"],
            "eligibleProIds": filtered_ids,
            "eligibleCount": len(filtered_ids),
            "zeroEligible": len(filtered_ids) == 0,
        })
    return clean


def _sanitize_disqualified_summary(raw_summary):
    if not isinstance(raw_summary, dict):
        return {"totalDisqualificationChecksFailed": 0}
    total = raw_summary.get("totalDisqualificationChecksFailed", 0)
    clean_reasons = {}
    if isinstance(raw_summary.get("reasonsCount"), dict):
        for k, v in list(raw_summary["reasonsCount"].items())[:10]:
            if isinstance(v, int) and v >= 0:
                clean_reasons[sanitize_text(k, 40)] = v
    return {
        "totalDisqualificationChecksFailed": int(total) if isinstance(total, int) and total >= 0 else 0,
        "reasonsCount": clean_reasons,
    }


def build_prompt_payload_for_gemini(validated_request):
    """Selects strictly non-sensitive operational data to send inside Gemini user prompt."""
    return {
        "bookingContext": validated_request["bookingContext"],
        "eligibleCandidates": validated_request["eligibleCandidates"],
        "slotSupply": validated_request["slotSupply"],
        "disqualifiedSummary": validated_request["disqualifiedSummary"],
        "advisoryConstraints": {
            "advisoryOnly": True,
            "noAutonomousAssignment": True,
            "distinctProPerSlotRequired": True,
            "neighborhoodLabelNotGpsOrEta": True,
        },
    }


def _ground_candidate_text_server_side(cand_dict, pro_data, booking_context):
    """
    Phase 4.6A: Application-level factual verification on proxy server.
    Ensures model outputs do not assert contradictions regarding completed jobs,
    unverified equipment (e.g. pickup trucks), unverified skills, ratings, or tiers.
    """
    if not pro_data:
        return cand_dict

    fit_summary = cand_dict.get("fitSummary", "")
    caution_note = cand_dict.get("cautionNote", "")
    bullets = list(cand_dict.get("rationaleBullets", []))

    review_count = int(pro_data.get("reviewCount", 0))
    rating = float(pro_data.get("rating", 0.0))
    tier = str(pro_data.get("tier", "Bronze"))
    verified_equipment = set(pro_data.get("verifiedEquipment") or [])

    # 1. Zero jobs contradiction fix for experienced workers
    has_experience = review_count > 0
    zero_jobs_pattern = re.compile(
        r"(?i)\b(?:0|zero|no)\s+(?:completed\s+)?jobs?\b|\bno\s+(?:jobs|history|experience|track\s*record)\s+recorded\b|\b(?:untested|new|no\s+prior\s+jobs?)\s+(?:on\s+(?:the\s+)?platform|worker|pro)\b|\bhasn't\s+completed\s+any\s+jobs\b|\bfirst\s+job\b|\b0\s+reviews?\b"
    )

    if has_experience:
        if zero_jobs_pattern.search(caution_note):
            caution_note = ""
        bullets = [
            f"Verified Dallas Pro with {review_count} customer reviews ({rating}★)."
            if zero_jobs_pattern.search(b)
            else b
            for b in bullets
        ]
        if zero_jobs_pattern.search(fit_summary):
            fit_summary = zero_jobs_pattern.sub(f"{review_count} reviews ({rating}★)", fit_summary)

    # 2. Equipment grounding
    has_truck = any(t in verified_equipment for t in ("pickup_truck", "box_truck", "truck"))
    truck_pattern = re.compile(
        r"(?i)\b(?:brings?|owns?|equipped\s+with|has)\s+(?:a\s+|his\s+|their\s+)?(?:pickup\s+truck|box\s+truck|moving\s+truck|cargo\s+van|trailer|truck)\b|\b(?:pickup\s+truck|box\s+truck|moving\s+truck|truck)\b"
    )
    if not has_truck:
        if booking_context and booking_context.get("serviceCategory") == "moving":
            fit_summary = truck_pattern.sub("hand truck & shoulder dolly (labor-only moving; truck not included)", fit_summary)
            bullets = [
                truck_pattern.sub("hand truck & shoulder dolly (labor-only moving; truck not included)", b)
                for b in bullets
            ]
        else:
            fit_summary = truck_pattern.sub("", fit_summary).strip()
            bullets = [truck_pattern.sub("", b).strip() for b in bullets if truck_pattern.sub("", b).strip()]

    # 3. Skills grounding: unverified outside trades
    outside_trades = re.compile(r"(?i)\b(?:licensed|certified|master)?\s*(?:electrician|electrical|plumber|plumbing|roofer|roofing|hvac)\b")
    fit_summary = outside_trades.sub("", fit_summary).strip()
    bullets = [outside_trades.sub("", b).strip() for b in bullets if outside_trades.sub("", b).strip()]

    # 4. Tier grounding
    tier_pattern = re.compile(r"(?i)\b(Bronze|Silver|Gold|Platinum)\s+(?:tier|pro|specialist|worker)?\b")
    def _tier_sub(m):
        claimed = m.group(1)
        if claimed.lower() != tier.lower():
            return f"{tier} tier"
        return m.group(0)

    fit_summary = tier_pattern.sub(_tier_sub, fit_summary)
    caution_note = tier_pattern.sub(_tier_sub, caution_note)
    bullets = [tier_pattern.sub(_tier_sub, b) for b in bullets]

    # 5. Financial privacy safeguard: strip worker earnings/wallet references from AI text
    financial_pattern = re.compile(
        r"(?i)\b(?:\$?\d+(?:\.\d{2})?\s*(?:lifetime\s*earned|earnings|wallet|take-home|payout\s*balance)|lifetime\s*earnings?(?:\s*of)?\s*\$?\d+(?:\.\d{2})?)\b"
    )
    fit_summary = financial_pattern.sub("", fit_summary).strip()
    caution_note = financial_pattern.sub("", caution_note).strip()
    bullets = [financial_pattern.sub("", b).strip() for b in bullets if financial_pattern.sub("", b).strip()]

    # Clean empty or degenerate bullets
    bullets = [b for b in bullets if len(b) > 4]
    if not bullets:
        bullets = [f"Verified eligible with {tier} tier and {rating}★ rating ({review_count} reviews)."]

    return {
        "fitSummary": fit_summary,
        "rationaleBullets": bullets[:3],
        "cautionNote": caution_note,
    }


def _ground_draft_admin_reason_server_side(draft_text, pro_data, booking_context):
    if not draft_text or not pro_data:
        return draft_text
    grounded = _ground_candidate_text_server_side(
        {"fitSummary": draft_text, "rationaleBullets": [], "cautionNote": ""},
        pro_data,
        booking_context,
    )
    return grounded.get("fitSummary", draft_text)


def validate_and_normalize_gemini_output(raw_output, validated_request, api_key=None):
    """
    Verifies upstream Gemini JSON structure and candidate/slot membership against the
    validated request before returning data compatible with Crewly Stage 4.2 frontend validation.
    Returns (True, None, normalized_recommendation, audit_summary) or (False, error_code, error_msg, audit_summary).
    """
    ctx = validated_request["bookingContext"]
    expected_booking_id = ctx["bookingId"]
    open_slots = ctx["openSlots"]
    open_slot_ids = {s["slotId"] for s in open_slots}

    slot_eligible_map = {}
    cand_lookup = {}
    for cand in validated_request["eligibleCandidates"]:
        cand_lookup[cand["proId"]] = cand
        for sid in cand.get("eligibleForSlotIds", []):
            slot_eligible_map.setdefault(sid, set()).add(cand["proId"])

    if not isinstance(raw_output, dict):
        return False, "invalid_gemini_output", "Model response must be a JSON object.", {
            "rejectedSlots": [],
            "rejectedCandidates": [],
        }

    if raw_output.get("bookingId") != expected_booking_id:
        return False, "ai_booking_id_mismatch", "Model response bookingId did not match request.", {
            "rejectedSlots": [],
            "rejectedCandidates": [],
        }

    raw_slots = raw_output.get("slotRecommendations")
    if not isinstance(raw_slots, list) or len(raw_slots) == 0:
        return False, "invalid_gemini_output", "Model response missing slotRecommendations array.", {
            "rejectedSlots": [],
            "rejectedCandidates": [],
        }

    rejected_slots = []
    rejected_candidates = []
    valid_slot_entries = {}

    for entry in raw_slots[: MAX_OPEN_SLOTS + 2]:
        if not isinstance(entry, dict) or not isinstance(entry.get("slotId"), str):
            rejected_slots.append("malformed_slot_entry")
            continue
        sid = entry["slotId"].strip()
        if sid not in open_slot_ids:
            rejected_slots.append(sanitize_text(sid, 32))
            continue
        if sid in valid_slot_entries:
            continue

        allowed_for_slot = slot_eligible_map.get(sid, set())
        seen_slot_pros = set()
        clean_ranked = []

        raw_ranked = entry.get("rankedCandidates")
        if isinstance(raw_ranked, list):
            for cand in raw_ranked[:8]:
                if not isinstance(cand, dict) or not isinstance(cand.get("proId"), str):
                    rejected_candidates.append(f"{sid}:malformed_candidate")
                    continue
                pid = sanitize_text(cand["proId"], 48)
                if pid not in allowed_for_slot:
                    rejected_candidates.append(f"{sid}:{pid}")
                    continue
                if pid in seen_slot_pros:
                    rejected_candidates.append(f"{sid}:duplicate_{pid}")
                    continue
                seen_slot_pros.add(pid)
                if len(clean_ranked) < 3:
                    bullets_raw = cand.get("rationaleBullets")
                    clean_bullets = [
                        redact_secrets(sanitize_text(b, 140), api_key)
                        for b in (bullets_raw[:3] if isinstance(bullets_raw, list) else [])
                        if isinstance(b, str) and sanitize_text(b, 140)
                    ]
                    if not clean_bullets:
                        clean_bullets = ["Candidate submitted within verified eligibility allowlist."]

                    pro_data = cand_lookup.get(pid)
                    grounded = _ground_candidate_text_server_side(
                        {
                            "fitSummary": redact_secrets(sanitize_text(cand.get("fitSummary"), 140), api_key)
                            or "Eligible candidate evaluated by advisory model.",
                            "rationaleBullets": clean_bullets,
                            "cautionNote": redact_secrets(sanitize_text(cand.get("cautionNote"), 120), api_key),
                        },
                        pro_data,
                        ctx,
                    )

                    clean_ranked.append({
                        "proId": pid,
                        "fitSummary": grounded["fitSummary"],
                        "rationaleBullets": grounded["rationaleBullets"],
                        "cautionNote": grounded["cautionNote"],
                    })

        primary_pro_data = cand_lookup.get(clean_ranked[0]["proId"]) if clean_ranked else None
        raw_draft = redact_secrets(sanitize_text(entry.get("draftAdminReason"), 240), api_key)
        clean_draft = _ground_draft_admin_reason_server_side(raw_draft, primary_pro_data, ctx) if primary_pro_data else raw_draft

        valid_slot_entries[sid] = {
            "slotId": sid,
            "draftAdminReason": clean_draft,
            "rankedCandidates": clean_ranked,
        }

    # If the request included at least one assignable slot with eligible candidates,
    # reject if ZERO valid candidates survived model filtering across every slot.
    any_assignable_input = any(len(slot_eligible_map.get(s["slotId"], set())) > 0 for s in open_slots)
    surviving_total = sum(len(v["rankedCandidates"]) for v in valid_slot_entries.values())

    if len(valid_slot_entries) == 0:
        return False, "invalid_gemini_slot_ids", "No valid open slotIds returned by model.", {
            "rejectedSlots": rejected_slots,
            "rejectedCandidates": rejected_candidates,
        }
    if any_assignable_input and surviving_total == 0:
        return False, "ai_candidates_invalid", "All candidate proIds returned by model were unknown or ineligible.", {
            "rejectedSlots": rejected_slots,
            "rejectedCandidates": rejected_candidates,
        }

    # Build normalized slotRecommendations strictly aligned to requested openSlots.
    normalized_slots = []
    for slot in open_slots:
        sid = slot["slotId"]
        if sid in valid_slot_entries:
            normalized_slots.append(valid_slot_entries[sid])
        else:
            normalized_slots.append({
                "slotId": sid,
                "draftAdminReason": "",
                "rankedCandidates": [],
            })

    clean_risks = []
    if isinstance(raw_output.get("operationalRisks"), list):
        for r in raw_output["operationalRisks"][:4]:
            if not isinstance(r, dict):
                continue
            msg = redact_secrets(sanitize_text(r.get("message"), 160), api_key)
            if not msg:
                continue
            sev = r.get("severity") if r.get("severity") in ALLOWED_RISK_SEVERITIES else "medium"
            code = r.get("code") if r.get("code") in ALLOWED_RISK_CODES else "reliability_watch"
            clean_risks.append({"severity": sev, "code": code, "message": msg})

    shortage = raw_output.get("shortageAssessment")
    if shortage not in ALLOWED_SHORTAGE_ASSESSMENTS:
        shortage = "tight_supply"

    next_action = raw_output.get("recommendedNextAction")
    if next_action not in ALLOWED_NEXT_ACTIONS:
        next_action = "review_risks_before_assign"

    normalized = {
        "bookingId": expected_booking_id,
        "slotRecommendations": normalized_slots,
        "operationalRisks": clean_risks,
        "shortageAssessment": shortage,
        "recommendedNextAction": next_action,
    }
    return True, None, normalized, {
        "rejectedSlots": rejected_slots,
        "rejectedCandidates": rejected_candidates,
    }


# =============================================================================
# Stage 4.6B1: Customer AI Booking Concierge Validators & PII Filters
# =============================================================================

CONCIERGE_ALLOWED_ROOT_KEYS = {"serviceCategory", "messages", "currentDraft"}
CONCIERGE_ALLOWED_ROLES = {"user", "assistant"}
CONCIERGE_ALLOWED_DRAFT_KEYS = {
    "serviceCategory",
    "workersNeeded",
    "hours",
    "scheduledDate",
    "scheduledTime",
    "zipCode",
    "truckOption",
    "stairsOption",
    "scopeSummary",
    "isComplete",
    "missingFields",
    "unsupportedReason",
}

PII_ADDRESS_RE = re.compile(
    r"\b\d{1,5}\s+[A-Za-z0-9\.\s]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Ln|Lane|Dr|Drive|Ct|Court|Way|Pkwy|Parkway|Apt|Apartment|Suite|Unit)\b",
    re.IGNORECASE,
)
PII_PHONE_RE = re.compile(r"(?:(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\b\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b)")
PII_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PII_GATE_CODE_RE = re.compile(r"(?i)(?:gate|door|entry|buzzer|access|callbox)\s*(?:code|#)?\s*(?:is|[:=])?\s*#?\d{3,6}\b")
PII_CARD_RE = re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b")
PII_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")


def sanitize_concierge_input_text(text, api_key=None):
    """
    Scrubs sensitive PII (street addresses, phone numbers, emails, gate codes, credit cards)
    from customer conversation text before dispatching to an AI model.
    """
    clean = str(text or "")
    clean = redact_secrets(clean, api_key=api_key)
    clean = PII_ADDRESS_RE.sub("[REDACTED_STREET_ADDRESS]", clean)
    clean = PII_PHONE_RE.sub("[REDACTED_PHONE]", clean)
    clean = PII_EMAIL_RE.sub("[REDACTED_EMAIL]", clean)
    clean = PII_GATE_CODE_RE.sub("[REDACTED_ACCESS_CODE]", clean)
    clean = PII_CARD_RE.sub("[REDACTED_PAYMENT_INFO]", clean)
    clean = PII_SSN_RE.sub("[REDACTED_SSN]", clean)
    return clean.strip()


def validate_concierge_request_payload(parsed_body, api_key=None):
    """
    Validates incoming POST /api/concierge/chat request body.
    Enforces serviceCategory == 'moving' ONLY, message count/length limits, and PII scrubbing.
    """
    if not isinstance(parsed_body, dict):
        return False, None, "Request body must be a JSON object."

    extra_keys = set(parsed_body.keys()) - CONCIERGE_ALLOWED_ROOT_KEYS
    if extra_keys:
        return False, None, f"Disallowed root keys in concierge payload: {sorted(list(extra_keys))}."

    service_cat = parsed_body.get("serviceCategory")
    if service_cat != "moving":
        return False, None, (
            "Customer AI Concierge currently coordinates Moving & Lifting assistance only. "
            f"Requested service '{service_cat}' is not supported in Stage 4.6B1."
        )

    raw_messages = parsed_body.get("messages")
    if not isinstance(raw_messages, list) or len(raw_messages) == 0:
        return False, None, "Concierge 'messages' must be a non-empty list of conversation turns."
    if len(raw_messages) > 10:
        return False, None, "Concierge conversation exceeds maximum limit of 10 message turns."

    clean_messages = []
    pii_redacted_count = 0
    for idx, msg in enumerate(raw_messages):
        if not isinstance(msg, dict):
            return False, None, f"Message at index {idx} must be a JSON object with 'role' and 'content'."
        role = str(msg.get("role") or "").strip().lower()
        if role not in CONCIERGE_ALLOWED_ROLES:
            return False, None, f"Message at index {idx} has invalid role '{role}'; must be 'user' or 'assistant'."
        raw_content = str(msg.get("content") or "").strip()
        if not raw_content:
            return False, None, f"Message at index {idx} contains empty content."
        if len(raw_content) > 500:
            return False, None, f"Message at index {idx} exceeds maximum allowed length of 500 characters."

        # Apply strict PII sanitization to user messages
        if role == "user":
            sanitized = sanitize_concierge_input_text(raw_content, api_key=api_key)
            if sanitized != raw_content:
                pii_redacted_count += 1
            clean_messages.append({"role": role, "content": sanitized})
        else:
            clean_messages.append({"role": role, "content": redact_secrets(raw_content, api_key=api_key)})

    clean_draft = None
    if "currentDraft" in parsed_body and parsed_body["currentDraft"] is not None:
        raw_draft = parsed_body["currentDraft"]
        if not isinstance(raw_draft, dict):
            return False, None, "'currentDraft' must be a JSON object if provided."
        draft_extra = set(raw_draft.keys()) - CONCIERGE_ALLOWED_DRAFT_KEYS
        if draft_extra:
            return False, None, f"Disallowed keys in currentDraft: {sorted(list(draft_extra))}."
        clean_draft = {
            k: raw_draft[k] for k in CONCIERGE_ALLOWED_DRAFT_KEYS if k in raw_draft
        }

    validated_payload = {
        "serviceCategory": "moving",
        "messages": clean_messages,
        "currentDraft": clean_draft,
        "piiRedactedTurnsCount": pii_redacted_count,
    }
    return True, validated_payload, None


def validate_and_normalize_concierge_output(raw_output, request_payload, api_key=None):
    """
    Validates and normalizes upstream model response for Customer Moving Concierge.
    Enforces deterministic pricing separation (strips made-up prices), field bounds,
    and returns a clean, safe output.
    """
    if isinstance(raw_output, str):
        try:
            raw_output = json.loads(raw_output)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return False, "invalid_json_envelope", "AI output was not valid JSON.", {}

    if not isinstance(raw_output, dict):
        return False, "invalid_ai_response", "AI output was not a JSON object.", {}

    raw_msg = str(raw_output.get("assistantMessage") or "").strip()
    if not raw_msg:
        return False, "empty_assistant_message", "AI output contained an empty assistantMessage.", {}

    # Strict Price Neutralization: AI must NEVER invent or state dollar prices or rates
    # If the model emits dollar signs or rate figures, neutralize them
    neutralized_msg = re.sub(
        r"\$\s*\d+(?:\.\d{2})?(?:\s*/\s*(?:hr|hour|mover-hour))?",
        "[exact upfront quote calculated by Crewly]",
        raw_msg,
        flags=re.IGNORECASE,
    )
    clean_msg = redact_secrets(neutralized_msg, api_key=api_key)

    raw_details = raw_output.get("extractedDetails")
    if not isinstance(raw_details, dict):
        raw_details = {}

    service_cat = str(raw_details.get("serviceCategory") or "moving").strip().lower()
    if service_cat not in ("moving", "unsupported"):
        service_cat = "moving"

    # Normalize workersNeeded (0 if unset, 1 to 4)
    raw_workers = raw_details.get("workersNeeded")
    try:
        workers = int(raw_workers) if raw_workers is not None else 0
    except (ValueError, TypeError):
        workers = 0
    if workers < 0:
        workers = 0
    elif workers > 4:
        workers = 4

    # Normalize hours (0.0 if unset, 2.0 to 8.0)
    raw_hours = raw_details.get("hours")
    try:
        hours = float(raw_hours) if raw_hours is not None else 0.0
    except (ValueError, TypeError):
        hours = 0.0
    if hours < 0:
        hours = 0.0
    elif 0.0 < hours < 2.0:
        # Enforce 2-hour minimum if duration was requested below minimum
        hours = 2.0
    elif hours > 8.0:
        hours = 8.0

    # Scheduled Date & Time
    raw_date = str(raw_details.get("scheduledDate") or "").strip()
    clean_date = raw_date if DATE_RE.match(raw_date) else ""

    raw_time = str(raw_details.get("scheduledTime") or "").strip()
    norm_time = normalize_time_str(raw_time)
    clean_time = norm_time if norm_time and TIME_RE.match(norm_time) else (raw_time if TIME_RE.match(raw_time) else "")

    # ZIP code verification against Dallas pilot zones
    raw_zip = str(raw_details.get("zipCode") or "").strip()
    clean_zip = raw_zip if raw_zip in DALLAS_PILOT_ZIP_CODES else ""

    # Truck option
    raw_truck = str(raw_details.get("truckOption") or "undetermined").strip().lower()
    if raw_truck not in ("labor_only", "truck_required", "undetermined"):
        raw_truck = "undetermined"

    # Stairs option
    raw_stairs = str(raw_details.get("stairsOption") or "undetermined").strip().lower()
    if raw_stairs not in ("ground_floor", "stairs_1_flight", "stairs_multi", "elevator", "undetermined"):
        raw_stairs = "undetermined"

    raw_scope = str(raw_details.get("scopeSummary") or "").strip()
    clean_scope = sanitize_concierge_input_text(raw_scope[:200], api_key=api_key)

    unsupported_reason = str(raw_details.get("unsupportedReason") or "").strip()
    if service_cat == "unsupported" and not unsupported_reason:
        unsupported_reason = "Requested service is outside Moving & Lifting scope."

    # Determine completion status deterministically
    is_complete_deterministic = (
        service_cat == "moving"
        and workers >= 1
        and hours >= 2.0
        and bool(clean_date)
        and bool(clean_time)
        and bool(clean_zip)
        and raw_truck in ("labor_only", "truck_required")
    )

    missing = []
    if workers == 0:
        missing.append("workersNeeded")
    if hours == 0.0:
        missing.append("hours")
    if not clean_date:
        missing.append("scheduledDate")
    if not clean_time:
        missing.append("scheduledTime")
    if not clean_zip:
        missing.append("zipCode")
    if raw_truck == "undetermined":
        missing.append("truckOption")
    if raw_stairs == "undetermined":
        missing.append("stairsOption")

    raw_questions = raw_output.get("clarificationQuestions")
    clean_questions = []
    if isinstance(raw_questions, list):
        for q in raw_questions[:3]:
            q_str = str(q or "").strip()
            if q_str:
                clean_questions.append(redact_secrets(q_str, api_key=api_key))

    normalized_output = {
        "assistantMessage": clean_msg,
        "isComplete": is_complete_deterministic,
        "missingFields": missing,
        "clarificationQuestions": clean_questions,
        "extractedDetails": {
            "serviceCategory": service_cat,
            "workersNeeded": workers if workers > 0 else None,
            "hours": hours if hours > 0 else None,
            "scheduledDate": clean_date or None,
            "scheduledTime": clean_time or None,
            "zipCode": clean_zip or None,
            "truckOption": raw_truck if raw_truck != "undetermined" else None,
            "stairsOption": raw_stairs if raw_stairs != "undetermined" else None,
            "scopeSummary": clean_scope or None,
            "unsupportedReason": unsupported_reason or None,
            "isComplete": is_complete_deterministic,
            "missingFields": missing,
        },
    }

    validation_meta = {
        "serviceCategory": service_cat,
        "isComplete": is_complete_deterministic,
        "missingCount": len(missing),
    }

    return True, None, normalized_output, validation_meta
