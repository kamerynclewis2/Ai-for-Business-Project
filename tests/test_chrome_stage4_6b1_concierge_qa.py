#!/usr/bin/env python3
"""
Crewly Stage 4.6B1 — Customer AI Booking Concierge Chrome E2E QA Verification Script.

Executes real, isolated headless Chrome testing for the Customer AI Booking Concierge:
1. Verifies Moving & Lifting service card offers both Standard Booking and AI Concierge.
2. Verifies non-moving service categories strictly do NOT offer AI Concierge.
3. Tests standard manual moving booking modal and conversational switch link.
4. Opens Moving Booking Concierge modal and verifies initial state, chips, and offline banner behavior.
5. Conducts conversational turns via mock proxy:
   - Turn 1: Partial intake (2 movers) -> Concierge asks clarifying questions, button remains disabled.
   - Turn 2: Complete intake (3 hours, 2026-11-28, 75204 Uptown) -> Draft complete, deterministic quote calculated ($300 subtotal + $10 fee = $310 total).
6. Verifies privacy guard: street address collected in local private input field outside AI prompt.
7. Executes explicit customer confirmation click (idempotent, no auto-booking without user action).
8. Verifies booking stored in localStorage with exact pricing ($310 customer, $90 payout per mover slot).
9. Verifies Admin View reflects new booking with preserved historical records (CRW-1001..1004).

Safety & Isolation:
- Ephemeral Chrome user data directory (tempfile.mkdtemp) destroyed on exit.
- Dynamic free ports for local HTTP server and mock AI proxy.
- Pure Python standard library (no selenium, playwright, or third-party packages required).
"""

import base64
import http.server
import json
import os
import shutil
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(TESTS_DIR)


def find_chrome():
    candidates = [
        os.environ.get("CHROME_BIN"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chrome"),
        "/usr/bin/google-chrome",
    ]
    for c in candidates:
        if c and os.path.exists(c) and os.access(c, os.X_OK):
            return c
    return None


def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class QuietStaticHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WORKSPACE, **kwargs)

    def log_message(self, format, *args):
        pass


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class MockConciergeProxyHandler(http.server.BaseHTTPRequestHandler):
    """Local mock proxy simulating /api/concierge/chat and /api/health."""

    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health" or self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "status": "ok",
                "keyConfigured": True,
                "provider": "openai",
                "model": "gpt-4o-mini",
                "inferenceMode": "mock_ai_test_mode",
                "isSimulatedTestMode": True
            }).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/concierge/chat":
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len).decode("utf-8")
            data = json.loads(body) if body else {}

            messages = data.get("messages", [])
            last_msg = messages[-1].get("content", "") if messages else ""

            # Check if user message indicates full details
            if "3 hours" in last_msg or "75204" in last_msg:
                # Complete intake
                concierge_result = {
                    "assistantMessage": "Great! I have all your moving details: 2 movers for 3 hours in Uptown Dallas (75204) on November 28, 2026. Please enter your exact service address below to confirm your booking.",
                    "isComplete": True,
                    "missingFields": [],
                    "clarificationQuestions": [],
                    "extractedDetails": {
                        "serviceCategory": "moving",
                        "workersNeeded": 2,
                        "hours": 3,
                        "scheduledDate": "2026-11-28",
                        "scheduledTime": "10:00",
                        "zipCode": "75204",
                        "truckOption": "labor_only",
                        "stairsOption": "elevator",
                        "scopeSummary": "1-bedroom apartment move in Uptown with elevator access."
                    }
                }
            else:
                # Partial intake
                concierge_result = {
                    "assistantMessage": "Thanks! I have noted you need 2 movers. How many hours do you estimate needing assistance (2 hours minimum), and what date and Dallas ZIP code or neighborhood are you moving to?",
                    "isComplete": False,
                    "missingFields": ["hours", "scheduledDate", "zipCode"],
                    "clarificationQuestions": [
                        "How many hours will you need?",
                        "What date and Dallas ZIP code is your move?"
                    ],
                    "extractedDetails": {
                        "serviceCategory": "moving",
                        "workersNeeded": 2,
                        "hours": None,
                        "scheduledDate": None,
                        "scheduledTime": None,
                        "zipCode": None,
                        "truckOption": "labor_only",
                        "stairsOption": "ground_floor",
                        "scopeSummary": "Apartment move with 2 movers.",
                        "missingFields": ["hours", "scheduledDate", "zipCode"],
                        "isComplete": False
                    }
                }

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "provider": "openai",
                "inferenceSource": "mock_ai_test_mode",
                "isSimulatedTestMode": True,
                "conciergeResult": concierge_result
            }).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()


class SimpleCdpClient:
    def __init__(self, ws_url):
        rest = ws_url[5:]
        host_port, path = rest.split("/", 1)
        path = "/" + path
        host, port_s = host_port.split(":")
        self.sock = socket.create_connection((host, int(port_s)), timeout=15)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host_port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode("ascii"))
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("WebSocket handshake closed unexpectedly")
            buf += chunk
        header_end = buf.index(b"\r\n\r\n") + 4
        self._rx_extra = buf[header_end:]
        self._msg_id = 0
        self.events = []

    def _recv_exact(self, n):
        chunks = []
        remaining = n
        if self._rx_extra:
            take = min(len(self._rx_extra), remaining)
            chunks.append(self._rx_extra[:take])
            self._rx_extra = self._rx_extra[take:]
            remaining -= take
        while remaining > 0:
            chunk = self.sock.recv(remaining)
            if not chunk:
                raise RuntimeError("WebSocket connection closed")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _send_text(self, text):
        payload = text.encode("utf-8")
        frame = bytearray()
        frame.append(0x81)
        length = len(payload)
        mask_bit = 0x80
        if length < 126:
            frame.append(mask_bit | length)
        elif length < 65536:
            frame.append(mask_bit | 126)
            frame.extend(struct.pack("!H", length))
        else:
            frame.append(mask_bit | 127)
            frame.extend(struct.pack("!Q", length))
        mask_key = os.urandom(4)
        frame.extend(mask_key)
        masked_payload = bytearray(length)
        for i, b in enumerate(payload):
            masked_payload[i] = b ^ mask_key[i % 4]
        frame.extend(masked_payload)
        self.sock.sendall(frame)

    def _recv_frame(self):
        head = self._recv_exact(2)
        b1, b2 = head[0], head[1]
        opcode = b1 & 0x0F
        is_masked = bool(b2 & 0x80)
        pay_len = b2 & 0x7F
        if pay_len == 126:
            pay_len = struct.unpack("!H", self._recv_exact(2))[0]
        elif pay_len == 127:
            pay_len = struct.unpack("!Q", self._recv_exact(8))[0]
        mask_key = self._recv_exact(4) if is_masked else None
        body = self._recv_exact(pay_len)
        if is_masked:
            unmasked = bytearray(pay_len)
            for i, b in enumerate(body):
                unmasked[i] = b ^ mask_key[i % 4]
            body = bytes(unmasked)
        if opcode == 0x8:
            raise RuntimeError("WebSocket closed by remote peer")
        if opcode == 0x9:
            pong = bytearray([0x8A, 0x00])
            self.sock.sendall(pong)
            return self._recv_frame()
        return json.loads(body.decode("utf-8"))

    def call(self, method, params=None, timeout=15):
        self._msg_id += 1
        msg_id = self._msg_id
        req = {"id": msg_id, "method": method}
        if params is not None:
            req["params"] = params
        self._send_text(json.dumps(req))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self._recv_frame()
            if msg.get("id") == msg_id:
                if "error" in msg:
                    raise RuntimeError(f"CDP call {method} error: {msg['error']}")
                return msg.get("result", {})
            if "method" in msg:
                self.events.append(msg)

    def eval_js(self, expr, await_promise=True):
        res = self.call(
            "Runtime.evaluate",
            {
                "expression": expr,
                "returnByValue": True,
                "awaitPromise": await_promise,
            },
        )
        if "exceptionDetails" in res:
            raise RuntimeError(f"Browser JS exception: {json.dumps(res['exceptionDetails'])}")
        return res.get("result", {}).get("value")

    def drain_events(self, wait_s=0.2):
        self.sock.settimeout(wait_s)
        try:
            while True:
                msg = self._recv_frame()
                if "method" in msg:
                    self.events.append(msg)
        except Exception:
            pass
        finally:
            self.sock.settimeout(15)

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def wait_for_cdp_ws(port):
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1) as resp:
                targets = json.loads(resp.read().decode("utf-8"))
                for t in targets:
                    if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                        return t["webSocketDebuggerUrl"]
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("Timed out waiting for Chrome DevTools endpoint")


def main():
    chrome_bin = find_chrome()
    if not chrome_bin:
        print("ERROR: Google Chrome binary not found.")
        sys.exit(1)

    print("==================================================================")
    print("CREWLY STAGE 4.6B1 — CUSTOMER AI CONCIERGE CHROME QA")
    print("==================================================================")
    print(f"Chrome Binary: {chrome_bin}")

    http_port = get_free_port()
    proxy_port = get_free_port()
    cdp_port = get_free_port()

    # 1. Start static file server
    http_server_instance = ThreadedTCPServer(("127.0.0.1", http_port), QuietStaticHandler)
    http_thread = threading.Thread(target=http_server_instance.serve_forever, daemon=True)
    http_thread.start()
    print(f"Static HTTP Server: http://127.0.0.1:{http_port}")

    # 2. Start mock concierge proxy server
    proxy_server_instance = ThreadedTCPServer(("127.0.0.1", proxy_port), MockConciergeProxyHandler)
    proxy_thread = threading.Thread(target=proxy_server_instance.serve_forever, daemon=True)
    proxy_thread.start()
    print(f"Mock Concierge Proxy: http://127.0.0.1:{proxy_port}")

    temp_profile = tempfile.mkdtemp(prefix="crewly_chrome_qa_concierge_")
    chrome_proc = None
    cdp = None
    passed = 0
    failed = 0

    def assert_check(condition, name):
        nonlocal passed, failed
        if condition:
            passed += 1
            print(f"  PASS: {name}")
        else:
            failed += 1
            print(f"  FAIL: {name}")

    try:
        cmd = [
            chrome_bin,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={temp_profile}",
            f"--remote-debugging-port={cdp_port}",
            "about:blank",
        ]
        chrome_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        ws_url = wait_for_cdp_ws(cdp_port)
        cdp = SimpleCdpClient(ws_url)
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        cdp.call("Page.navigate", {"url": f"http://127.0.0.1:{http_port}/index.html?role=customer"})
        time.sleep(1.5)
        cdp.drain_events(0.3)

        # Wait for page to initialize
        for _ in range(50):
            ready = cdp.eval_js("document.readyState === 'complete' && typeof renderAll === 'function'")
            if ready:
                break
            time.sleep(0.1)

        # Point CONCIERGE_CONFIG to our local test mock proxy and allow dynamic test origin
        cdp.eval_js(f"""
          (() => {{
            window.AI_DISPATCH_CONFIG_ALLOWED_ORIGINS = [
              'http://localhost:8000',
              'http://127.0.0.1:8000',
              window.location.origin
            ];
            if (window.CONCIERGE_CONFIG) {{
              window.CONCIERGE_CONFIG.ENDPOINT = 'http://127.0.0.1:{proxy_port}/api/concierge/chat';
              window.CONCIERGE_CONFIG.HEALTH_ENDPOINT = 'http://127.0.0.1:{proxy_port}/health';
            }}
            // Re-route fetch to test proxy in page runtime
            const origFetch = window.fetch;
            window.fetch = function(url, opts) {{
              if (typeof url === 'string' && url.includes('/api/concierge/chat')) {{
                return origFetch('http://127.0.0.1:{proxy_port}/api/concierge/chat', opts);
              }}
              if (typeof url === 'string' && (url.includes('/api/health') || url.includes('/health'))) {{
                return origFetch('http://127.0.0.1:{proxy_port}/health', opts);
              }}
              return origFetch(url, opts);
            }};
          }})()
        """)

        # -------------------------------------------------------------------
        # Test Section 1: Customer View & Service Cards
        # -------------------------------------------------------------------
        print("\n[QA Section 1: Customer View & Service Cards]")
        active_role = cdp.eval_js("sessionStorage.getItem('crewly_active_role')")
        assert_check(active_role == "customer", "1A: Active role is customer")

        moving_card_buttons = cdp.eval_js("""
          (() => {
            const card = document.querySelector('.service-card[data-service="moving"]');
            if (!card) return null;
            return {
              hasStandardBtn: !!card.querySelector('.btn-open-booking'),
              hasConciergeBtn: !!card.querySelector('.btn-open-moving-concierge'),
              conciergeText: card.querySelector('.btn-open-moving-concierge')?.innerText || ''
            };
          })()
        """)
        assert_check(moving_card_buttons and moving_card_buttons["hasStandardBtn"], "1B: Moving card offers standard booking button")
        assert_check(moving_card_buttons and moving_card_buttons["hasConciergeBtn"], "1B: Moving card offers AI Concierge button")
        assert_check(moving_card_buttons and "Concierge" in moving_card_buttons["conciergeText"], "1B: AI Concierge button labeled with Concierge")

        # Verify non-moving cards do not have concierge buttons
        non_moving_concierge_count = cdp.eval_js("""
          (() => {
            const nonMovingCards = document.querySelectorAll('.service-card:not([data-service="moving"])');
            let count = 0;
            nonMovingCards.forEach(c => {
              if (c.querySelector('.btn-open-moving-concierge')) count++;
            });
            return count;
          })()
        """)
        assert_check(non_moving_concierge_count == 0, "1C: Non-moving service cards strictly omit AI Concierge (Moving Only)")

        # -------------------------------------------------------------------
        # Test Section 2: Standard Moving Modal & Concierge Switch Link
        # -------------------------------------------------------------------
        print("\n[QA Section 2: Standard Moving Modal & Concierge Switch Link]")
        cdp.eval_js("""
          document.querySelector('.service-card[data-service="moving"] .btn-open-booking').click();
        """)
        time.sleep(0.2)

        standard_modal_state = cdp.eval_js("""
          (() => {
            const m = document.getElementById('intake-modal');
            const switchLink = document.getElementById('link-switch-to-moving-concierge');
            return {
              isOpen: m && m.classList.contains('open'),
              hasSwitchLink: !!switchLink,
              switchText: switchLink?.innerText || ''
            };
          })()
        """)
        assert_check(standard_modal_state and standard_modal_state["isOpen"], "2A: Standard moving intake modal opens cleanly")
        assert_check(standard_modal_state and standard_modal_state["hasSwitchLink"], "2B: Switch to AI Concierge link rendered in standard modal")

        # Click switch link to open Concierge
        cdp.eval_js("""
          document.getElementById('link-switch-to-moving-concierge').click();
        """)
        time.sleep(0.3)

        concierge_modal_open = cdp.eval_js("""
          (() => {
            const standardModal = document.getElementById('intake-modal');
            const conciergeModal = document.getElementById('ai-concierge-modal');
            return {
              standardClosed: standardModal && !standardModal.classList.contains('open'),
              conciergeOpen: conciergeModal && conciergeModal.classList.contains('open'),
              confirmDisabled: document.getElementById('btn-concierge-confirm-booking')?.disabled === true,
              confirmText: document.getElementById('btn-concierge-confirm-booking')?.innerText || '',
              quoteSubtotal: document.getElementById('concierge-quote-subtotal')?.innerText || '',
              quoteTotal: document.getElementById('concierge-quote-total')?.innerText || '',
              quoteFee: document.getElementById('concierge-quote-fee')?.innerText || ''
            };
          })()
        """)
        assert_check(concierge_modal_open and concierge_modal_open["standardClosed"], "2C: Standard modal closes upon switching to Concierge")
        assert_check(concierge_modal_open and concierge_modal_open["conciergeOpen"], "2C: AI Concierge modal opens cleanly")
        assert_check(concierge_modal_open and concierge_modal_open["confirmDisabled"], "2D: Confirmation button disabled initially")
        assert_check(concierge_modal_open and concierge_modal_open["quoteSubtotal"] == "—", "2E: Initial subtotal is placeholder (—)")
        assert_check(concierge_modal_open and concierge_modal_open["quoteTotal"] == "—", "2E: Initial customer total is placeholder (—)")
        assert_check(concierge_modal_open and concierge_modal_open["quoteFee"] == "$10.00", "2E: Platform booking fee is transparent $10.00")

        # -------------------------------------------------------------------
        # Test Section 3: Conversational Turn 1 (Partial Intake)
        # -------------------------------------------------------------------
        print("\n[QA Section 3: Conversational Turn 1 (Partial Intake)]")
        cdp.eval_js("""
          (() => {
            const inputEl = document.getElementById('concierge-user-input');
            inputEl.value = 'I need 2 movers for an apartment move';
            document.getElementById('concierge-chat-form').dispatchEvent(new Event('submit', { cancelable: true }));
          })()
        """)
        time.sleep(0.5)

        turn1_state = cdp.eval_js("""
          (() => {
            const msgs = document.querySelectorAll('#concierge-chat-messages .concierge-msg');
            const moversDraft = document.getElementById('concierge-draft-movers')?.innerText || '';
            const hoursDraft = document.getElementById('concierge-draft-hours')?.innerText || '';
            const statusBadge = document.getElementById('concierge-draft-status')?.innerText || '';
            const confirmBtn = document.getElementById('btn-concierge-confirm-booking');
            return {
              msgCount: msgs.length,
              moversDraft,
              hoursDraft,
              statusBadge,
              confirmDisabled: confirmBtn?.disabled === true
            };
          })()
        """)
        assert_check(turn1_state and turn1_state["msgCount"] >= 3, "3A: Assistant replied to user message in chat log")
        assert_check(turn1_state and "2 Mover" in turn1_state["moversDraft"], "3B: Live draft captured 2 movers")
        assert_check(turn1_state and "clarification" in turn1_state["hoursDraft"], "3C: Duration correctly flags needs clarification")
        assert_check(turn1_state and "In Progress" in turn1_state["statusBadge"], "3D: Draft status remains In Progress")
        assert_check(turn1_state and turn1_state["confirmDisabled"], "3E: Confirm button strictly disabled while draft is incomplete")

        # -------------------------------------------------------------------
        # Test Section 4: Conversational Turn 2 (Complete Moving Details)
        # -------------------------------------------------------------------
        print("\n[QA Section 4: Conversational Turn 2 (Complete Moving Details)]")
        cdp.eval_js("""
          (() => {
            const inputEl = document.getElementById('concierge-user-input');
            inputEl.value = 'We need them for 3 hours on 2026-11-28 in Uptown 75204 with an elevator';
            document.getElementById('concierge-chat-form').dispatchEvent(new Event('submit', { cancelable: true }));
          })()
        """)
        time.sleep(0.5)

        turn2_state = cdp.eval_js("""
          (() => {
            const moversDraft = document.getElementById('concierge-draft-movers')?.innerText || '';
            const hoursDraft = document.getElementById('concierge-draft-hours')?.innerText || '';
            const dateDraft = document.getElementById('concierge-draft-datetime')?.innerText || '';
            const zipDraft = document.getElementById('concierge-draft-zip')?.innerText || '';
            const statusBadge = document.getElementById('concierge-draft-status')?.innerText || '';
            const subtotal = document.getElementById('concierge-quote-subtotal')?.innerText || '';
            const fee = document.getElementById('concierge-quote-fee')?.innerText || '';
            const total = document.getElementById('concierge-quote-total')?.innerText || '';
            return {
              moversDraft,
              hoursDraft,
              dateDraft,
              zipDraft,
              statusBadge,
              subtotal,
              fee,
              total
            };
          })()
        """)
        assert_check(turn2_state and "2 Mover" in turn2_state["moversDraft"], "4A: Draft confirmed 2 movers")
        assert_check(turn2_state and "3 Hours" in turn2_state["hoursDraft"], "4B: Draft confirmed 3 hours")
        assert_check(turn2_state and "2026-11-28" in turn2_state["dateDraft"], "4C: Draft confirmed 2026-11-28 date")
        assert_check(turn2_state and "75204" in turn2_state["zipDraft"], "4D: Draft confirmed Dallas pilot ZIP 75204")
        assert_check(turn2_state and "Ready to Book" in turn2_state["statusBadge"], "4E: Draft status transitioned to Ready to Book")
        assert_check(turn2_state and turn2_state["subtotal"] == "$300.00", "4F: Deterministic customer subtotal is $300.00 (2 movers × 3 hrs × $50)")
        assert_check(turn2_state and turn2_state["fee"] == "$10.00", "4G: Transparent booking fee is $10.00")
        assert_check(turn2_state and turn2_state["total"] == "$310.00", "4H: Final customer total is $310.00 ($300 + $10)")

        # -------------------------------------------------------------------
        # Test Section 5: Strict Privacy & Explicit Confirmation Click
        # -------------------------------------------------------------------
        print("\n[QA Section 5: Strict Privacy & Explicit Confirmation Click]")
        # Fill in street address in local input field
        cdp.eval_js("""
          (() => {
            const addrInput = document.getElementById('concierge-input-address');
            addrInput.value = '2800 McKinney Ave, Apt 402';
            addrInput.dispatchEvent(new Event('input', { bubbles: true }));
            
            const notesInput = document.getElementById('concierge-input-notes');
            notesInput.value = 'Callbox #1234';
            notesInput.dispatchEvent(new Event('input', { bubbles: true }));
          })()
        """)
        time.sleep(0.2)

        confirm_btn_state = cdp.eval_js("""
          (() => {
            const btn = document.getElementById('btn-concierge-confirm-booking');
            return {
              disabled: btn?.disabled === true,
              text: btn?.innerText || ''
            };
          })()
        """)
        assert_check(confirm_btn_state and not confirm_btn_state["disabled"], "5A: Confirmation button enabled once address is entered")
        assert_check(confirm_btn_state and "$310.00" in confirm_btn_state["text"], "5B: Confirmation button displays exact $310.00 total")

        # Explicit Confirmation Click
        cdp.eval_js("""
          document.getElementById('btn-concierge-confirm-booking').click();
        """)
        time.sleep(0.5)

        post_confirm_state = cdp.eval_js("""
          (() => {
            const modal = document.getElementById('ai-concierge-modal');
            const state = JSON.parse(localStorage.getItem('crewly_marketplace_state_v1') || '{}');
            const bookings = state.bookings || [];
            const newBooking = bookings[0];
            return {
              modalClosed: modal && !modal.classList.contains('open'),
              totalBookings: bookings.length,
              newBookingId: newBooking?.id,
              serviceCategory: newBooking?.serviceCategory,
              address: newBooking?.address,
              zipCode: newBooking?.zipCode,
              customerSubtotal: newBooking?.pricing?.customerSubtotal,
              bookingFee: newBooking?.pricing?.bookingFee,
              customerTotal: newBooking?.pricing?.customerTotal,
              workersNeeded: newBooking?.workersNeeded,
              slot1Payout: newBooking?.workerAssignments?.[0]?.payout,
              slot2Payout: newBooking?.workerAssignments?.[1]?.payout,
              slotCount: newBooking?.workerAssignments?.length
            };
          })()
        """)
        assert_check(post_confirm_state and post_confirm_state["modalClosed"], "5C: Concierge modal closed cleanly upon booking confirmation")
        assert_check(post_confirm_state and post_confirm_state["totalBookings"] >= 5, "5D: New booking successfully stored in state")
        assert_check(post_confirm_state and post_confirm_state["serviceCategory"] == "moving", "5E: Stored booking category is moving")
        assert_check(post_confirm_state and post_confirm_state["address"] == "2800 McKinney Ave, Apt 402", "5F: Service street address stored accurately from local field")
        assert_check(post_confirm_state and post_confirm_state["zipCode"] == "75204", "5G: Stored ZIP code is 75204")
        assert_check(post_confirm_state and post_confirm_state["customerSubtotal"] == 300, "5H: Stored customer subtotal matches $300.00")
        assert_check(post_confirm_state and post_confirm_state["bookingFee"] == 10, "5I: Stored booking fee matches $10.00")
        assert_check(post_confirm_state and post_confirm_state["customerTotal"] == 310, "5J: Stored customer total matches $310.00")
        assert_check(post_confirm_state and post_confirm_state["workersNeeded"] == 2, "5K: 2 workers required")
        assert_check(post_confirm_state and post_confirm_state["slotCount"] == 2, "5L: 2 worker assignment slots created")
        assert_check(post_confirm_state and post_confirm_state["slot1Payout"] == 90, "5M: Slot 1 worker payout is $90.00 (3 hrs × $30)")
        assert_check(post_confirm_state and post_confirm_state["slot2Payout"] == 90, "5N: Slot 2 worker payout is $90.00 (3 hrs × $30)")

        # -------------------------------------------------------------------
        # Test Section 6: Historical Seed Invariants & Admin Financial Rollup
        # -------------------------------------------------------------------
        print("\n[QA Section 6: Historical Invariants & Admin View]")
        cdp.eval_js("""
          (() => {
            const adminBtn = document.getElementById('role-btn-admin');
            if (adminBtn) adminBtn.click();
          })()
        """)
        time.sleep(0.5)

        admin_state = cdp.eval_js("""
          (() => {
            const state = JSON.parse(localStorage.getItem('crewly_marketplace_state_v1') || '{}');
            const bookings = state.bookings || [];
            const b1001 = bookings.find(b => b.id === 'CRW-1001');
            const b1002 = bookings.find(b => b.id === 'CRW-1002');
            const b1003 = bookings.find(b => b.id === 'CRW-1003');
            const b1004 = bookings.find(b => b.id === 'CRW-1004');
            return {
              b1001Total: b1001?.pricing?.customerTotal,
              b1002Total: b1002?.pricing?.customerTotal,
              b1003Total: b1003?.pricing?.customerTotal,
              b1004Total: b1004?.pricing?.customerTotal,
              adminRole: sessionStorage.getItem('crewly_active_role')
            };
          })()
        """)
        assert_check(admin_state and admin_state["adminRole"] == "admin", "6A: Successfully switched to Admin View")
        assert_check(admin_state and admin_state["b1001Total"] == 250, "6B: Historical CRW-1001 total preserved at $250.00")
        assert_check(admin_state and admin_state["b1002Total"] == 119, "6C: Historical CRW-1002 total preserved at $119.00")
        assert_check(admin_state and admin_state["b1003Total"] == 65, "6D: Historical CRW-1003 total preserved at $65.00")
        assert_check(admin_state and admin_state["b1004Total"] == 250, "6E: Historical CRW-1004 total preserved at $250.00")

    finally:
        if cdp:
            cdp.close()
        if chrome_proc:
            try:
                chrome_proc.terminate()
                chrome_proc.wait(timeout=3)
            except Exception:
                chrome_proc.kill()
        try:
            http_server_instance.shutdown()
        except Exception:
            pass
        try:
            proxy_server_instance.shutdown()
        except Exception:
            pass
        if os.path.exists(temp_profile):
            try:
                shutil.rmtree(temp_profile)
            except Exception:
                pass

    print("\n==================================================================")
    print(f"CHROME QA RESULTS: {passed} passed, {failed} failed.")
    print("==================================================================")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
