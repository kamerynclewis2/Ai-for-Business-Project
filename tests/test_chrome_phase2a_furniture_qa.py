#!/usr/bin/env python3
"""
Crewly DFW Pricing Phase 2A — Headless Chrome QA Verification Script.

Executes targeted real Chrome QA in an isolated temporary profile:
1. Single-Item Assembly Booking (Tier 2 Bed Frame): $90 subtotal, $10 fee, $100 total, $55 Pro payout.
2. Multi-Item Assembly Booking (Tier 2 Bed Frame + Tier 1 Nightstand):
   - Original Items Subtotal: $150.00 ($90 + $60)
   - Secondary-Item Discount: -$12.00 (20% off Tier 1)
   - Discounted Service Subtotal: $138.00
   - Platform Booking Fee: $10.00
   - Total Customer Price: $148.00
   - Worker Slot Payout: $90.00 ($55 + $35)
   - Gross Platform Contribution: $58.00
3. Disassembly Booking (Tier 2 Bed Frame + Tier 1 Table Legs):
   - Original Items Subtotal: $130.00 ($80 + $50)
   - Secondary-Item Discount: -$15.00
   - Discounted Service Subtotal: $115.00
   - Booking Fee: $10.00
   - Total Customer Price: $125.00
   - Worker Slot Payout: $75.00 ($50 + $25)
   - Gross Platform Contribution: $50.00
4. Unsupported Item Guard (Murphy Bed): decline banner shown, submit button disabled, quote suppressed.
5. Historical Bookings Invariance & Admin Finance Rollup: CRW-1001 through CRW-1004 preserved, $70 total fees.

Safety & Isolation:
- Uses a temporary, ephemeral user data directory (tempfile.mkdtemp) destroyed on exit.
- Never reads or resets user's personal browser profiles or actual localStorage.
- Uses dynamic free ports to avoid port binding conflicts.
- Pure Python standard library (no third-party dependencies required).

Usage:
    python3 tests/test_chrome_phase2a_furniture_qa.py
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
from datetime import datetime, timedelta

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


class SimpleCdpClient:
    """Pure-stdlib Chrome DevTools Protocol WebSocket client."""

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
        frame.append(0x81)  # FIN + text
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
        if opcode == 0x8:  # Close
            raise RuntimeError("WebSocket closed by remote peer")
        if opcode == 0x9:  # Ping
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
    assert chrome_bin, "Chrome binary not found on this system. Set CHROME_BIN environment variable."

    cdp_port = get_free_port()
    web_port = get_free_port()

    # Isolated temporary profile for zero-leakage, ephemeral test
    temp_profile_dir = tempfile.mkdtemp(prefix="crewly_chrome_qa_furniture_")

    web_server = None
    try:
        web_server = ThreadedTCPServer(("127.0.0.1", web_port), QuietStaticHandler)
        t = threading.Thread(target=web_server.serve_forever, daemon=True)
        t.start()
        time.sleep(0.5)
        print(f"Started quiet local HTTP server on port {web_port}...")
    except OSError as e:
        print(f"Error starting local HTTP server on port {web_port}: {e}")
        sys.exit(1)

    chrome_cmd = [
        chrome_bin,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        f"--user-data-dir={temp_profile_dir}",
        f"--remote-debugging-port={cdp_port}",
        "about:blank",
    ]

    print(f"Launching headless Chrome on port {cdp_port} with isolated temp profile...")
    chrome_proc = subprocess.Popen(
        chrome_cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )

    passed_checks = 0
    total_checks = 0

    def check(condition, desc):
        nonlocal passed_checks, total_checks
        total_checks += 1
        if condition:
            passed_checks += 1
            print(f"  PASS [{total_checks}]: {desc}")
        else:
            print(f"  FAIL [{total_checks}]: {desc}")
            raise AssertionError(f"Check failed: {desc}")

    try:
        ws_url = wait_for_cdp_ws(cdp_port)
        cdp = SimpleCdpClient(ws_url)
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")

        print(f"\nNavigating to Customer View at http://127.0.0.1:{web_port}/?role=customer...")
        cdp.call("Page.navigate", {"url": f"http://127.0.0.1:{web_port}/?role=customer"})
        time.sleep(1.5)
        cdp.drain_events(0.3)

        # Confirm customer page loaded
        title = cdp.eval_js("document.title")
        check("Crewly" in title, f"Page title contains Crewly ({title})")

        # ---------------------------------------------------------------------
        # TEST 1: Single-Item Assembly Booking (Tier 2 Bed Frame)
        # ---------------------------------------------------------------------
        print("\n=== TEST 1: Single-Item Assembly Booking (Tier 2 Bed Frame) ===")
        # Launch Furniture Assembly modal
        cdp.eval_js("""{
            const card = Array.from(document.querySelectorAll('.service-card')).find(c => c.textContent.includes('Furniture Assembly'));
            if (card) {
                const btn = card.querySelector('.btn-book-service');
                if (btn) btn.click();
            }
        }""")
        time.sleep(0.5)

        modal_open = cdp.eval_js("document.getElementById('intake-modal').classList.contains('open')")
        check(modal_open, "Intake modal opened for Furniture Assembly")

        modal_title = cdp.eval_js("document.getElementById('intake-modal-title').textContent")
        check("Furniture Assembly" in modal_title, f"Modal title is '{modal_title}'")

        # Verify default single item quote: Tier 2 Standard ($90) + $10 fee = $100
        raw_disp1 = cdp.eval_js("document.getElementById('quote-raw-subtotal-row').style.display")
        check(raw_disp1 == "none", "Original items subtotal row is hidden for single item")

        discount_disp = cdp.eval_js("document.getElementById('quote-discount-row').style.display")
        check(discount_disp == "none", "Bundle discount row is hidden for single item")

        desc_text1 = cdp.eval_js("document.getElementById('quote-service-desc').textContent")
        check("Platform Bed" in desc_text1, f"Service description indicates primary item ({desc_text1})")

        subtotal_text = cdp.eval_js("document.getElementById('quote-subtotal').textContent")
        check(subtotal_text == "$90.00", f"Default assembly subtotal is $90.00 (got {subtotal_text})")

        fee_text = cdp.eval_js("document.getElementById('quote-booking-fee').textContent")
        check(fee_text == "$10.00", f"Platform booking fee is $10.00 (got {fee_text})")

        total_text = cdp.eval_js("document.getElementById('quote-customer-total').textContent")
        check(total_text == "$100.00", f"Customer total is $100.00 (got {total_text})")

        # Set future date and submit booking
        fut_date = (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")
        cdp.eval_js(f"""{{
            const radio = document.querySelector('input[name="timingType"][value="scheduled"]');
            radio.checked = true;
            radio.dispatchEvent(new Event('change', {{ bubbles: true }}));

            const dateInput = document.getElementById('input-scheduled-date');
            dateInput.value = '{fut_date}';
            dateInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            const timeInput = document.getElementById('input-scheduled-time');
            timeInput.value = '11:00';
            timeInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            const addrInput = document.getElementById('input-address');
            addrInput.value = '2800 McKinney Ave, Apt 402, Dallas, TX 75204';
            addrInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            const zipInput = document.getElementById('input-zip');
            zipInput.value = '75204';
            zipInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            document.getElementById('btn-submit-booking').click();
        }}""")
        time.sleep(0.8)

        # Verify state in localStorage (new booking prepended at index 0 via state.bookings.unshift)
        state_json = cdp.eval_js("localStorage.getItem('crewly_marketplace_state_v1')")
        state = json.loads(state_json)
        new_b1 = state["bookings"][0]

        check(new_b1["serviceCategory"] == "furniture_assembly", "New booking category is furniture_assembly")
        check(new_b1["pricing"]["customerSubtotal"] == 90, "Stored subtotal is $90.00")
        check(new_b1["pricing"]["customerTotal"] == 100, "Stored total is $100.00")
        check(new_b1["workerAssignments"][0]["payout"] == 55, "Assigned worker slot offers $55.00 payout")
        check(new_b1["workerAssignments"][0]["payoutReleased"] is False, "Payout released is false")

        # ---------------------------------------------------------------------
        # TEST 2: Multi-Item Assembly Booking (Tier 2 Bed + Tier 1 Nightstand)
        # ---------------------------------------------------------------------
        print("\n=== TEST 2: Multi-Item Assembly Booking with Transparent Discount Breakdown ===")
        # Launch Furniture Assembly modal again
        cdp.eval_js("""{
            const card = Array.from(document.querySelectorAll('.service-card')).find(c => c.textContent.includes('Furniture Assembly'));
            if (card) {
                const btn = card.querySelector('.btn-book-service');
                if (btn) btn.click();
            }
        }""")
        time.sleep(0.5)

        # Select 2 items: primary Tier 2 Bed ($90), secondary Tier 1 Nightstand ($48)
        cdp.eval_js("""
            document.getElementById('intake-assembly-primary-item').value = 'bed_frame_standard';
            document.getElementById('intake-assembly-count').value = '2';
            document.getElementById('intake-assembly-count').dispatchEvent(new Event('change'));
            document.getElementById('intake-assembly-sec-2').value = 'nightstand_end_table';
            document.getElementById('intake-assembly-sec-2').dispatchEvent(new Event('change'));
        """)
        time.sleep(0.5)

        # 1. Original items subtotal row ($150)
        raw_disp2 = cdp.eval_js("document.getElementById('quote-raw-subtotal-row').style.display")
        check(raw_disp2 == "flex", "Original items subtotal row is visible for multi-item bundle")

        raw_val2 = cdp.eval_js("document.getElementById('quote-raw-subtotal').textContent")
        check(raw_val2 == "$150.00", f"Original items subtotal is $150.00 ($90 + $60) (got {raw_val2})")

        # 2. Secondary-item discount row (-$12)
        discount_disp2 = cdp.eval_js("document.getElementById('quote-discount-row').style.display")
        check(discount_disp2 == "flex", "Bundle discount row is visible for multi-item booking")

        discount_val = cdp.eval_js("document.getElementById('quote-discount').textContent")
        check(discount_val == "-$12.00", f"Secondary-item discount shows -$12.00 (got {discount_val})")

        # 3. Discounted service subtotal ($138)
        desc_text2 = cdp.eval_js("document.getElementById('quote-service-desc').textContent")
        check("Discounted Service Subtotal" in desc_text2, f"Description indicates Discounted Service Subtotal ({desc_text2})")

        subtotal_b2 = cdp.eval_js("document.getElementById('quote-subtotal').textContent")
        check(subtotal_b2 == "$138.00", f"Discounted service subtotal is $138.00 ($150 - $12) (got {subtotal_b2})")

        # 4. Platform booking fee ($10)
        fee_b2 = cdp.eval_js("document.getElementById('quote-booking-fee').textContent")
        check(fee_b2 == "$10.00", f"Platform booking fee is $10.00 (got {fee_b2})")

        # 5. Final customer total ($148)
        total_b2 = cdp.eval_js("document.getElementById('quote-customer-total').textContent")
        check(total_b2 == "$148.00", f"Final customer total is $148.00 ($138 + $10) (got {total_b2})")

        # Submit 2-item booking
        cdp.eval_js(f"""{{
            const radio = document.querySelector('input[name="timingType"][value="scheduled"]');
            radio.checked = true;
            radio.dispatchEvent(new Event('change', {{ bubbles: true }}));

            const dateInput = document.getElementById('input-scheduled-date');
            dateInput.value = '{fut_date}';
            dateInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            const timeInput = document.getElementById('input-scheduled-time');
            timeInput.value = '14:00';
            timeInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            const addrInput = document.getElementById('input-address');
            addrInput.value = '2800 McKinney Ave, Apt 402, Dallas, TX 75204';
            addrInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            const zipInput = document.getElementById('input-zip');
            zipInput.value = '75204';
            zipInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            document.getElementById('btn-submit-booking').click();
        }}""")
        time.sleep(0.8)

        state = json.loads(cdp.eval_js("localStorage.getItem('crewly_marketplace_state_v1')"))
        new_b2 = state["bookings"][0]

        check(new_b2["serviceCategory"] == "furniture_assembly", "New booking category is furniture_assembly")
        check(new_b2["pricing"]["rawCustomerSubtotal"] == 150, "Stored raw subtotal is $150.00")
        check(new_b2["pricing"]["bundleDiscount"] == 12, "Stored bundle discount is $12.00")
        check(new_b2["pricing"]["customerSubtotal"] == 138, "Stored discounted subtotal is $138.00")
        check(new_b2["pricing"]["bookingFee"] == 10, "Stored booking fee is $10.00")
        check(new_b2["pricing"]["customerTotal"] == 148, "Stored total is $148.00")
        check(new_b2["workerAssignments"][0]["payout"] == 90, "Worker slot payout is $90.00 ($55 + $35)")
        check(new_b2["pricing"]["grossPlatformRevenue"] == 58, "Gross platform revenue is $58.00 ($148 - $90)")

        # ---------------------------------------------------------------------
        # TEST 3: Disassembly Booking (Tier 2 Bed Frame + Tier 1 Table Legs)
        # ---------------------------------------------------------------------
        print("\n=== TEST 3: Disassembly Booking (Tier 2 Bed + Tier 1 Table Legs) ===")
        # Launch Furniture Disassembly modal
        cdp.eval_js("""{
            const card = Array.from(document.querySelectorAll('.service-card')).find(c => c.textContent.includes('Furniture Disassembly'));
            if (card) {
                const btn = card.querySelector('.btn-book-service');
                if (btn) btn.click();
            }
        }""")
        time.sleep(0.5)

        modal_title_dis = cdp.eval_js("document.getElementById('intake-modal-title').textContent")
        check("Furniture Disassembly" in modal_title_dis, f"Modal title is '{modal_title_dis}'")

        # Select 2 items: primary Tier 2 Bed ($80), secondary Tier 1 Table Legs (+$35)
        cdp.eval_js("""
            document.getElementById('intake-disassembly-primary-item').value = 'bed_frame_with_headboard_slats';
            document.getElementById('intake-disassembly-count').value = '2';
            document.getElementById('intake-disassembly-count').dispatchEvent(new Event('change'));
            document.getElementById('intake-disassembly-sec-2').value = 'dining_table_legs';
            document.getElementById('intake-disassembly-sec-2').dispatchEvent(new Event('change'));
        """)
        time.sleep(0.5)

        raw_disp3 = cdp.eval_js("document.getElementById('quote-raw-subtotal-row').style.display")
        check(raw_disp3 == "flex", "Original items subtotal row is visible for disassembly bundle")

        raw_val3 = cdp.eval_js("document.getElementById('quote-raw-subtotal').textContent")
        check(raw_val3 == "$130.00", f"Disassembly original items subtotal is $130.00 ($80 + $50) (got {raw_val3})")

        discount_disp3 = cdp.eval_js("document.getElementById('quote-discount-row').style.display")
        check(discount_disp3 == "flex", "Disassembly discount row is visible")

        discount_val3 = cdp.eval_js("document.getElementById('quote-discount').textContent")
        check(discount_val3 == "-$15.00", f"Disassembly secondary item discount is -$15.00 (got {discount_val3})")

        subtotal_dis = cdp.eval_js("document.getElementById('quote-subtotal').textContent")
        check(subtotal_dis == "$115.00", f"Disassembly subtotal is $115.00 ($80 + $35) (got {subtotal_dis})")

        fee_dis = cdp.eval_js("document.getElementById('quote-booking-fee').textContent")
        check(fee_dis == "$10.00", f"Disassembly booking fee is $10.00 (got {fee_dis})")

        total_dis = cdp.eval_js("document.getElementById('quote-customer-total').textContent")
        check(total_dis == "$125.00", f"Disassembly total is $125.00 ($115 + $10) (got {total_dis})")

        # Submit disassembly booking
        cdp.eval_js(f"""{{
            const radio = document.querySelector('input[name="timingType"][value="scheduled"]');
            radio.checked = true;
            radio.dispatchEvent(new Event('change', {{ bubbles: true }}));

            const dateInput = document.getElementById('input-scheduled-date');
            dateInput.value = '{fut_date}';
            dateInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            const timeInput = document.getElementById('input-scheduled-time');
            timeInput.value = '16:00';
            timeInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            const addrInput = document.getElementById('input-address');
            addrInput.value = '2800 McKinney Ave, Apt 402, Dallas, TX 75204';
            addrInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            const zipInput = document.getElementById('input-zip');
            zipInput.value = '75204';
            zipInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

            document.getElementById('btn-submit-booking').click();
        }}""")
        time.sleep(0.8)

        state = json.loads(cdp.eval_js("localStorage.getItem('crewly_marketplace_state_v1')"))
        new_b3 = state["bookings"][0]

        check(new_b3["serviceCategory"] == "furniture_disassembly", "New booking category is furniture_disassembly")
        check(new_b3["pricing"]["customerSubtotal"] == 115, "Stored disassembly subtotal is $115.00")
        check(new_b3["pricing"]["customerTotal"] == 125, "Stored disassembly total is $125.00")
        check(new_b3["workerAssignments"][0]["payout"] == 75, "Worker slot payout is $75.00 ($50 + $25)")
        check(new_b3["pricing"]["grossPlatformRevenue"] == 50, "Disassembly platform gross contribution is $50.00 ($125 - $75)")

        # ---------------------------------------------------------------------
        # TEST 4: Unsupported Item Guard (Murphy Bed)
        # ---------------------------------------------------------------------
        print("\n=== TEST 4: Unsupported Item Guard (Murphy Bed) ===")
        # Launch Furniture Assembly modal
        cdp.eval_js("""{
            const card = Array.from(document.querySelectorAll('.service-card')).find(c => c.textContent.includes('Furniture Assembly'));
            if (card) {
                const btn = card.querySelector('.btn-book-service');
                if (btn) btn.click();
            }
        }""")
        time.sleep(0.5)

        # Select murphy_bed
        cdp.eval_js("""
            document.getElementById('intake-assembly-primary-item').value = 'murphy_bed';
            document.getElementById('intake-assembly-primary-item').dispatchEvent(new Event('change'));
        """)
        time.sleep(0.5)

        banner_disp = cdp.eval_js("document.getElementById('intake-assembly-decline-banner').style.display")
        check(banner_disp == "block", "Decline banner is displayed for Murphy Bed")

        banner_text = cdp.eval_js("document.getElementById('intake-assembly-decline-banner').textContent")
        check("Unsupported Item" in banner_text and "Murphy Bed" in banner_text, f"Decline banner message explains Murphy Bed ({banner_text[:80]}...)")

        submit_disabled = cdp.eval_js("document.getElementById('btn-submit-booking').disabled")
        check(submit_disabled is True, "Submit button is disabled for unsupported item")

        subtotal_unsupp = cdp.eval_js("document.getElementById('quote-subtotal').textContent")
        check(subtotal_unsupp == "—", f"Subtotal is suppressed to '—' (got {subtotal_unsupp})")

        total_unsupp = cdp.eval_js("document.getElementById('quote-customer-total').textContent")
        check(total_unsupp == "—", f"Customer total is suppressed to '—' (got {total_unsupp})")

        raw_unsupp = cdp.eval_js("document.getElementById('quote-raw-subtotal-row').style.display")
        check(raw_unsupp == "none", "Original subtotal row is hidden for unsupported item")

        # Close modal
        cdp.eval_js("document.getElementById('btn-close-intake').click();")
        time.sleep(0.3)

        # ---------------------------------------------------------------------
        # TEST 5: Historical Invariants & Admin Finance Rollup
        # ---------------------------------------------------------------------
        print("\n=== TEST 5: Historical Invariants & Admin Finance Rollup ===")
        state = json.loads(cdp.eval_js("localStorage.getItem('crewly_marketplace_state_v1')"))

        crw1001 = next(b for b in state["bookings"] if b["id"] == "CRW-1001")
        check(crw1001["pricing"]["customerTotal"] == 250, "CRW-1001 total is preserved at $250.00")
        check(crw1001["pricing"]["workerPayoutPerPerson"] == 75, "CRW-1001 payout is preserved at $75.00")

        crw1002 = next(b for b in state["bookings"] if b["id"] == "CRW-1002")
        check(crw1002["pricing"]["customerTotal"] == 119, "CRW-1002 total is preserved at $119.00")
        check(crw1002["pricing"]["workerPayoutPerPerson"] == 75, "CRW-1002 payout is preserved at $75.00")

        crw1003 = next(b for b in state["bookings"] if b["id"] == "CRW-1003")
        check(crw1003["pricing"]["customerTotal"] == 65, "CRW-1003 total is preserved at $65.00")
        check(crw1003["pricing"]["workerPayoutPerPerson"] == 35, "CRW-1003 payout is preserved at $35.00")

        crw1004 = next(b for b in state["bookings"] if b["id"] == "CRW-1004")
        check(crw1004["pricing"]["customerTotal"] == 250, "CRW-1004 total is preserved at $250.00")
        check(crw1004["pricing"]["workerPayoutPerPerson"] == 75, "CRW-1004 payout is preserved at $75.00")

        # Navigate to Admin Finance and verify rollup
        cdp.call("Page.navigate", {"url": f"http://127.0.0.1:{web_port}/?role=admin"})
        time.sleep(1.5)
        cdp.drain_events(0.3)

        # Switch to finance tab
        cdp.eval_js("""{
            const finTab = document.querySelector('[data-admin-tab="finance"]');
            if (finTab) finTab.click();
        }""")
        time.sleep(0.5)

        # Total GBV includes 4 historical ($684) + new b1 ($100) + new b2 ($148) + new b3 ($125) = $1,057.00
        # Total fees = 7 * $10 = $70.00
        fin_gbv = cdp.eval_js("document.getElementById('admin-fin-panel-projected-gbv')?.textContent")
        print(f"  Admin Finance Projected GBV: {fin_gbv}")

        fin_fees = cdp.eval_js("document.getElementById('admin-fin-panel-fees')?.textContent")
        check(fin_fees == "$70.00", f"Admin Finance reflects exactly $70.00 total booking fees (7 bookings * $10) (got {fin_fees})")

        print("\n" + "=" * 66)
        print(f"HEADLESS CHROME QA VERIFICATION: {passed_checks} of {total_checks} CHECKS PASSED (100%)")
        print("=" * 66)

    finally:
        try:
            cdp.close()
        except Exception:
            pass
        chrome_proc.terminate()
        try:
            chrome_proc.wait(timeout=3)
        except Exception:
            chrome_proc.kill()
        shutil.rmtree(temp_profile_dir, ignore_errors=True)
        if web_server:
            web_server.shutdown()


if __name__ == "__main__":
    main()
