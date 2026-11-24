"""Thread-safe in-memory rate limiter & duplicate burst guard for local proxy demonstration."""

import hashlib
import json
import threading
import time
from collections import deque
from datetime import datetime, timezone

from proxy.config import (
    DAILY_LOCAL_REQUEST_CAP,
    DUPLICATE_COOLDOWN_SECONDS,
    RATE_LIMIT_PER_HOUR,
    RATE_LIMIT_PER_MINUTE,
)


class LocalDispatchRateLimiter:
    """
    In-memory per-IP sliding window + duplicate burst guard + daily request cap.
    Explicitly intended ONLY for single-process local demonstration safety — not a distributed
    production quota or billing enforcement mechanism.
    """

    def __init__(
        self,
        per_minute=RATE_LIMIT_PER_MINUTE,
        per_hour=RATE_LIMIT_PER_HOUR,
        daily_cap=DAILY_LOCAL_REQUEST_CAP,
        duplicate_cooldown=DUPLICATE_COOLDOWN_SECONDS,
        time_fn=None,
        day_fn=None,
    ):
        self.per_minute = per_minute
        self.per_hour = per_hour
        self.daily_cap = daily_cap
        self.duplicate_cooldown = duplicate_cooldown
        self._time_fn = time_fn or time.monotonic
        self._day_fn = day_fn or (lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        self._lock = threading.Lock()
        self._ip_windows = {}
        self._recent_digests = {}
        self._daily_date = self._day_fn()
        self._daily_count = 0

    def _roll_day_if_needed(self):
        today = self._day_fn()
        if today != self._daily_date:
            self._daily_date = today
            self._daily_count = 0

    def _request_signature(self, client_ip, canonical_payload):
        body = json.dumps(canonical_payload, sort_keys=True, ensure_ascii=True)
        return hashlib.sha256(f"{client_ip}|{body}".encode("utf-8")).hexdigest()

    def check_and_record(self, client_ip, canonical_payload):
        """
        Atomically verifies cooldown, IP window caps, and daily demo budget before forwarding.
        Returns (allowed: bool, code: str | None, message: str | None, retry_after_sec: int).
        """
        now = self._time_fn()
        sig = self._request_signature(client_ip, canonical_payload)

        with self._lock:
            self._roll_day_if_needed()

            # 1. Duplicate burst protection for identical requests within cooldown window
            last_seen = self._recent_digests.get(sig)
            if last_seen is not None and (now - last_seen) < self.duplicate_cooldown:
                retry_sec = max(1, int(self.duplicate_cooldown - (now - last_seen) + 0.999))
                return (
                    False,
                    "duplicate_request_throttled",
                    "Duplicate dispatch request throttled; wait briefly before retrying.",
                    retry_sec,
                )

            # Prune stale duplicate fingerprints opportunistically
            stale_sigs = [k for k, ts in self._recent_digests.items() if (now - ts) >= max(10.0, self.duplicate_cooldown * 5)]
            for k in stale_sigs:
                del self._recent_digests[k]

            # 2. Global daily local-process budget cap
            if self._daily_count >= self.daily_cap:
                return (
                    False,
                    "daily_demo_cap_reached",
                    "Local proxy daily demonstration cap reached. Restart proxy or adjust configuration if needed.",
                    60,
                )

            # 3. Per-IP sliding window caps (1 minute & 1 hour)
            dq = self._ip_windows.setdefault(client_ip, deque())
            while dq and (now - dq[0]) > 3600.0:
                dq.popleft()

            recent_min = sum(1 for ts in dq if (now - ts) <= 60.0)
            if recent_min >= self.per_minute:
                return (
                    False,
                    "rate_limit_exceeded",
                    f"Per-minute local demonstration rate limit ({self.per_minute}/min) exceeded.",
                    10,
                )

            if len(dq) >= self.per_hour:
                return (
                    False,
                    "rate_limit_exceeded",
                    f"Hourly local demonstration rate limit ({self.per_hour}/hr) exceeded.",
                    60,
                )

            dq.append(now)
            self._recent_digests[sig] = now
            self._daily_count += 1
            return True, None, None, 0

    def snapshot_stats(self):
        with self._lock:
            self._roll_day_if_needed()
            return {
                "dailyDate": self._daily_date,
                "dailyRequestsUsed": self._daily_count,
                "dailyCap": self.daily_cap,
            }
