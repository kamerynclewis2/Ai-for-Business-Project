"""Strict request allowlist validation, PII rejection, and Gemini output verification."""

import json
import re

from proxy.config import (
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
    "reliabilityScore",
    "homeNeighborhood",
    "sameNeighborhoodAsBooking",
    "verifiedSkills",
    "verifiedEquipment",
    "dayAvailabilityWindow",
    "activeAssignmentsCount",
    "completedJobsCount",
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
    if re.search(r"AIza[0-9A-Za-z_-]{16,}", serialized):
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

        sanitized_candidates.append({
            "proId": pro_id,
            "displayName": display_name,
            "tier": sanitize_text(cand.get("tier", "Bronze"), 24),
            "rating": float(rating),
            "reviewCount": int(cand.get("reviewCount", 0)) if isinstance(cand.get("reviewCount"), int) else 0,
            "reliabilityScore": float(reliability),
            "homeNeighborhood": home_zone,
            "sameNeighborhoodAsBooking": bool(cand.get("sameNeighborhoodAsBooking", False)),
            "verifiedSkills": [sanitize_text(s, 32) for s in (cand.get("verifiedSkills") or [])[:12] if isinstance(s, str)],
            "verifiedEquipment": [sanitize_text(e, 32) for e in (cand.get("verifiedEquipment") or [])[:12] if isinstance(e, str)],
            "dayAvailabilityWindow": sanitize_text(cand.get("dayAvailabilityWindow"), 24) if cand.get("dayAvailabilityWindow") else None,
            "activeAssignmentsCount": int(cand.get("activeAssignmentsCount", 0)) if isinstance(cand.get("activeAssignmentsCount"), int) else 0,
            "completedJobsCount": int(cand.get("completedJobsCount", 0)) if isinstance(cand.get("completedJobsCount"), int) else 0,
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
    for cand in validated_request["eligibleCandidates"]:
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

                    clean_ranked.append({
                        "proId": pid,
                        "fitSummary": redact_secrets(sanitize_text(cand.get("fitSummary"), 140), api_key)
                        or "Eligible candidate evaluated by advisory model.",
                        "rationaleBullets": clean_bullets,
                        "cautionNote": redact_secrets(sanitize_text(cand.get("cautionNote"), 120), api_key),
                    })

        valid_slot_entries[sid] = {
            "slotId": sid,
            "draftAdminReason": redact_secrets(sanitize_text(entry.get("draftAdminReason"), 240), api_key),
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
