---
name: crewly-product-rules
description: Product rules, pricing assumptions, verification standards, and quality specifications for Crewly home services marketplace.
---

# Crewly Product Rules & Engineering Standards

## 1. Project Overview & Scope
- **Application Name:** Crewly
- **Academic Context:** INSY 3331: Artificial Intelligence for Business
- **Target Pilot Market:** Dallas, Texas neighborhoods only (e.g., Downtown, Uptown, Deep Ellum, Bishop Arts, Lakewood, Oak Lawn, Lower Greenville, Preston Hollow). Surrounding metroplex cities are marked as future expansion zones.
- **Architecture:** Zero-dependency static web application (HTML5, CSS3, Vanilla ES6 JavaScript) hosted on GitHub Pages.
- **Demo State & Persistence:** Uses browser `localStorage` for cross-tab data synchronization. The selected active view role (Customer vs. Pro vs. Admin) is stored in `sessionStorage` or URL query parameter (`?role=customer`, `?role=pro`, or `?role=admin`) so separate browser tabs can operate simultaneously without overriding each other's view.

---

## 2. Pricing & Financial Terminology Rules
- **Demonstration Labeling:** All prices, fees, and calculations must display: `"Demonstration assumptions — Dallas pilot market"`.
- **Visibility Separation (strictly enforced):**
  1. **Customer View:** Shows service subtotal, platform booking fee (\$10), and customer total. **Customers must never see Pro payouts, individual worker payout amounts, or platform gross revenue — in any area including booking activity logs, dispatch notifications, worker assignment cards, or booking history.** Furthermore, **customer privacy is strictly enforced**: customers see only bookings associated with their own customer ID (`state.activeCustomerId`). Booking details, street addresses, and messages of other customers are never exposed.
  2. **Crewly Pro View:** Shows only the worker's individual offered payout for their own assignment. Pro does not see other workers' payouts or platform fees.
  3. **Admin / Demo Summary View:** Displays total customer billed, worker payouts disbursed, and **Gross Platform Revenue before operating expenses** (do NOT call it "net profit" or "net margin").
- **Platform Pricing Rates:**
  - **Moving & Lifting:** \$40 per worker-hour (Customer) | \$25 per worker-hour (Pro Payout)
  - **TV Mounting:** \$109 per task (Customer) | \$75 per task (Pro Payout)
  - **Wall Mounting:** \$95 per task (Customer) | \$65 per task (Pro Payout)
  - **Furniture Assembly:** \$90 per task (Customer) | \$55 per task (Pro Payout)
  - **Furniture Disassembly:** \$80 per task (Customer) | \$50 per task (Pro Payout)
  - **Lawn Mowing & Care:** \$55 per task (Customer) | \$35 per task (Pro Payout)
  - **Platform Booking Fee:** Standard \$10 per customer booking.

---

## 3. Multi-Worker Moving & Job Decomposition Rules
- **Moving Requests with Multiple Workers:**
  - If a customer requests 2 movers for 3 hours:
    - Customer Subtotal = $2 \times 3 \times \$40 = \$240$
    - Customer Total = $\$240 + \$10\text{ fee} = \$250$
    - Individual Worker Payout = $3 \times \$25 = \$75$ per mover.
  - The booking creates **distinct worker assignment slots** (`Role 1 of 2` and `Role 2 of 2`).
  - **Partial Fulfillment Rule:** The booking status remains `Partially Filled (X of N)` until **all** required worker positions are claimed. It cannot transition to `Fully Confirmed` until every worker position has an assigned Pro.
  - **Crew Size Enforcement (Active Work Guard):** A multi-worker booking cannot enter the active working stage (`traveling`, `arrived`, `in_progress`, or `completed`) until all required positions are staffed. A lone assigned Pro cannot start or complete the job until all required co-workers have joined.
  - A single Pro cannot claim more than one worker position on the same concurrent moving job.
  - **Completion Rule:** Once all positions are staffed and work legitimately begins, each Pro can independently complete their assignment and receive their eligible payout. The overall customer booking completes only when every worker completes their assignment.

---

## 4. Verified Service Eligibility & Rewards
- **Predefined Verification Required:** Self-reported information entered by a worker does **not** grant access to jobs. A Pro must have verified platform credentials:
  - `Verified Mover` badge (physical lift assessment passed)
  - `Verified Lawn Equipment` badge (platform-inspected commercial/residential equipment)
  - `Verified Assembly/Mounting Tools` badge (power tools & stud finder verified)
  - `Background Check Verified`
- **Decoupled Reward Tiers:**
  - Bronze: Entry-level, standard job-board access.
  - Silver: Early access to scheduled jobs (+12h window).
  - Gold: Early access (+24h window) & eligible performance perks.
  - Platinum: Priority access & instant payout simulation.
  - **Crucial Rule:** High tier rank (e.g. Platinum) **never** bypasses service eligibility or equipment requirements.
- **Pro Job Board Filters (Stage 1.1):**
  - **Available to Me:** Open jobs matching verified credentials and availability, excluding past schedules.
  - **Upcoming Jobs:** Open jobs scheduled for future dates.
  - **Conflicts / Ineligible:** Jobs with schedule conflicts, missing badges, or expired times, displaying explicit explanatory badges. Past appointments cannot be claimed.

---

## 5. Individual Worker Reviews (Version 2)
- **Per-Worker Review System:** Customers review each assigned Crewly Pro individually after a completed booking. A single booking with two movers produces two independent review cards.
- **Data Structure:** Reviews are stored in `booking.workerReviews[]` as an array of per-slot objects: `{ slotId, proId, proName, roleTitle, stars, comment, date, disputed }`.
- **Rating Calculation:** A new review updates only the specific Pro's weighted average rating:
  - Formula: `newRating = (oldRating × oldReviewCount + newStars) / (oldReviewCount + 1)`
  - `pro.reviewCount` represents verified review count. It is incremented by exactly 1 per submitted review.
  - One worker's new review must not affect any other worker's rating.
- **Duplicate Prevention & Submission Validation:**
  - The booking must be in `completed` status before any review can be accepted.
  - The specific worker assignment slot must be in `completed` status.
  - The review rating must be an integer between 1 and 5.
  - The system checks `booking.workerReviews.some(r => r.slotId === slotId)` before accepting a submission. A second review for the same slot returns an error.
- **Customer Privacy:** Review forms and display cards show worker name, role, stars, and comment. No payout information is ever included in customer-facing review UI.
- **Planned Features (not yet implemented):** Two-way reviews (Pro reviews customer), reputation protection, appeals process. Do not automatically penalize workers based on unverified complaints.

---

## 6. Earnings Integrity Rules (Version 2)
- **Per-Slot Payout Release:** When a Pro marks their own assignment as completed, their eligible payout immediately moves from `pendingBalance` to `availableBalance` and is credited to `lifetimeEarned`. The overall customer booking remains active until every assigned worker completes their slot.
- **Idempotency & Duplicate Action Guard:** Each assignment slot carries a `payoutReleased: boolean` flag. Payout is credited only if `!slot.payoutReleased`. Once set to `true`, the slot cannot generate additional earnings credits. Furthermore, once an assignment is `completed`, repeated status update requests are rejected with an explicit error, preventing duplicate timeline messages or inconsistent state.
- **Historical Completed Slots:** The state migration in `migrateStateIfNeeded()` automatically sets `payoutReleased = true` on any slot already in `completed` status before the Version 2 schema was introduced. This prevents duplicate credits on existing demo data.
- **Pro Completed-Job History (Stage 1.1):** The Crewly Pro Dashboard includes a "My Completed Jobs" section displaying only jobs completed by the active Pro. Each entry displays customer name, completion date, the worker's individual payout, and individual rating received (or "Not rated"). Customer street addresses, gate codes, and other workers' payouts are strictly excluded.
- **Prohibited Operations:** Negative balances, duplicate cash-outs, transfers exceeding available funds, cash-outs from pending earnings, duplicate earnings from repeated completion.
- **Lifetime Earnings:** Must never decrease after a cash-out.

---

## 7. State Migration & Schema Compatibility
- **Migration Function:** `migrateStateIfNeeded(state)` runs every time `loadState()` retrieves existing `localStorage` data. It performs three upgrades in-place:
  1. Sets `payoutReleased = true` on completed slots lacking the flag.
  2. Converts legacy `booking.review` → `booking.workerReviews[]`.
  3. Strips payout dollar amounts from system dispatch messages (`senderRole === 'system'` only; customer and Pro authored messages are never modified).
  4. Ensures `activeCustomerId` is initialized and every booking has a valid `customerId`.
- **Storage Key:** `crewly_marketplace_state_v1` — preserved across all versions.

---

## 8. Technical Limitations & Required Transparency Disclosures
- **Simulated Payments:** Balances and cash-outs are client-side simulations. No real money or payment gateway is integrated.
- **Simulated GPS & Geolocation:** Dallas neighborhood distances are mock values. No live telematics or background device GPS is active.
- **Service Location & Address Validation (Stage 1.1):** Customer location is established via service street address and a 5-digit Dallas pilot ZIP code (75201, 75202, 75204, 75206, 75208, 75214, 75219, 75225, 75226). Where a ZIP maps reliably to an area, the neighborhood is displayed automatically. Unsupported locations display clear pilot-boundary notices.
- **Past-Date Prevention (Stage 1.1):** Booking creation validates schedule against Dallas local time. Past dates and times are rejected for scheduled jobs; Book Now generates a consistent immediate timestamp.
- **Simulated In-App Messaging:** Communications between Customer and Pro are mock event logs stored in browser storage.
- **Rules-Based Intake:** The intake system is smart and dynamic, driven by declarative decision trees. It must not be marketed as live generative AI.
- **Client-Side Role Separation:** Customer, Pro, and Admin views are separated by `sessionStorage` role flags. This is a demonstration convenience, not production-grade access control. Sensitive data, financial records, and administrative actions would require server-side authentication in a real deployment.

---

## 9. Verification & Test Scenarios
Every build iteration must pass the following test benchmarks:

**Original Five Tests (preserved):**
1. **Test 1 (Two-Worker Moving):** Customer books 2 movers for 3 hours. System creates 2 separate worker slots. Total customer price is \$250. Booking remains partially confirmed until both Pros accept.
2. **Test 2 (TV Mounting Intake):** Smart intake branches on TV size, wall type, bracket ownership. Calculates \$109 + \$10 fee = \$119. Pro sees \$75 payout.
3. **Test 3 (Lawn Care Equipment Enforcement):** Lawn job requires verified equipment. Workers lacking verified mower are blocked with explanatory badge.
4. **Test 4 (Service Bundling):** Moving + TV Mounting + Assembly combined in one checkout. Deconstructed into individual worker roles; partial fulfillment warnings active until completely filled.
5. **Test 5 (Conflict & Unavailability Prevention):** Pro with overlapping active booking cannot accept a conflicting job. Detailed reason displayed.

**Version 2 Stage 1 Tests (added):**
6. **Test 6 (Payout Privacy — New Messages):** When a Pro accepts a job, the customer activity log shows "Pro has accepted the Role assignment." — no dollar amount visible.
7. **Test 7 (Payout Privacy — Stored State):** Migration sanitizes previously saved payout-exposing messages in localStorage on next load. Customer and Pro authored messages are preserved.
8. **Test 8 (Individual Worker Reviews):** Customer completes a two-worker booking. Separate review cards appear for each worker. Submitting 5 stars for Marcus and 3 stars for Jamar updates only each respective Pro's rating. Elena Rodriguez's rating is unchanged.
9. **Test 9 (No Cross-Worker Rating Bleed):** Each worker's `reviewCount` increments by exactly 1 per submitted review. No other worker's rating or count is affected.
10. **Test 10 (Duplicate Review Prevention):** After submitting a review for a worker, the review button for that slot is replaced by the submitted review. A second submission attempt returns an error.
11. **Test 11 (Per-Slot Earnings Release):** Marcus completing his slot on a 2-mover job releases \$75 to his available balance immediately. Jamar's balance is unchanged. The booking stays active until Jamar also completes.
12. **Test 12 (Duplicate Earnings Guard):** Triggering the completion action twice on the same slot credits earnings only once. `slot.payoutReleased = true` after first credit.

**Version 2 Stage 1.1 Tests (added):**
13. **Test 13 (Customer Booking Privacy):** Switching between Sarah Jenkins and David Miller displays only each customer's own active bookings, completed bookings, and addresses.
14. **Test 14 (Past-Date Booking Prevention):** New booking creation rejects past dates and past times using Dallas local time. Book Now generates immediate timestamp.
15. **Test 15 (Crew Size Enforcement):** A two-mover job with only 1 worker assigned cannot enter active working stages. Buttons are disabled; work can only begin once all slots are filled.
16. **Test 16 (Service Location & ZIP Validation):** Customer location uses street address and 5-digit Dallas pilot ZIP. Unsupported ZIP codes show clear pilot service-area errors.
17. **Test 17 (Pro Job Board Filters):** Pro job board offers Available to Me, Upcoming Jobs, and Conflicts / Ineligible filters, excluding expired past schedules.
18. **Test 18 (Pro Completed-Job History):** "My Completed Jobs" displays only the active Pro's completed tasks, individual payout, and individual rating with customer street addresses omitted.

**Version 2 Stage 1.2 Tests (added):**
19. **Test 19 (ASAP Matching Window & Pro Acceptance):** When a customer submits an ASAP moving request (2 movers), Marcus can accept slot 1 at T=0. Jamar can accept slot 2 at T+5, T+15, and T+30 minutes without being rejected as expired.
20. **Test 20 (ASAP Expiration Enforcement):** At T+65 minutes (past the 60-minute window), an unassigned slot is blocked with "ASAP matching window has expired" and categorized under Ineligible/Expired.
21. **Test 21 (Extend Search Window):** When the customer extends an expired search (+30 min), the new deadline is calculated from `max(now, existingDeadline) + 30m`. The booking returns to `waiting_for_pros` or `partially_filled` and becomes immediately acceptable on the job board.
22. **Test 22 (Separate Scheduled Expiration):** Scheduled appointments continue to enforce strict past-date/time checks. An appointment scheduled for earlier today or a past date cannot be booked or accepted.
23. **Test 23 (Multi-Worker Coordinated Intervals):** Multi-worker moving bookings share one coordinated work period `[startMin, endMin]` (accounting for 30m dispatch buffer). Pros with overlapping active jobs are blocked from double-booking.
24. **Test 24 (Rescheduling with Pro Conflict Unassignment):** Rescheduling a booking to a time when an assigned Pro has a schedule conflict unassigns the conflicting Pro, restores their pending balance, updates the booking status, and leaves non-conflicting Pros assigned.
25. **Test 25 (Timestamp Integrity):** `scheduledTime` strictly stores valid `HH:MM` timestamps. Human-readable statuses ("ASAP — Seeking Pros") are strictly presentation-layer labels rendered by `formatBookingTiming()`.

---

## 10. Stage 1.2 Matching & Scheduling Rules
- **Configurable ASAP Window:** Defined as `ASAP_MATCHING_WINDOW_MINUTES = 60` and `ASAP_DISPATCH_BUFFER_MINUTES = 30` in `data.js`.
- **Separate Expiration Logic:**
  - `timingType === 'asap'`: Expiration evaluated via `isAsapExpired(booking, nowMs)` comparing `nowMs > booking.asapExpiresAt`.
  - `timingType === 'scheduled'`: Expiration evaluated against exact Dallas appointment date and time (`booking.scheduledDate` and `booking.scheduledTime`).
- **Timestamp Separation:** All timestamps in state objects (`scheduledTime`, `asapRequestedAt`, `asapExpiresAt`) must be ISO strings or standard 24-hour time strings (`HH:MM`). Textual statuses such as `"ASAP — Seeking Pros (45m window remaining)"` or `"ASAP — Window Expired"` are strictly generated dynamically by `formatBookingTiming()`.
- **Multi-Worker Coordinated Work Window:** Function `getBookingWorkInterval(booking)` computes `{ date, startMin, endMin, durationMinutes }`. All workers on the booking share this period. `canProAcceptSlot()` verifies that candidate Pros have no overlapping active work intervals on that date (`startA < endB && startB < endA`).
- **Extend Search:** Function `extendAsapBooking(bookingId, additionalMinutes = 30)` sets `asapExpiresAt = max(now, existingDeadline) + additionalMinutes`, updates status back to `partially_filled` or `waiting_for_pros`, and logs a system dispatch notification.
- **Reschedule Booking:** Function `rescheduleBooking(bookingId, { newDate, newTime })` validates that the new appointment is in the future, updates schedule fields, and re-evaluates all assigned Pros with `canProAcceptSlot()`. Any Pro who does not fit is gracefully unassigned and their pending earnings adjusted.

---

## 11. Stage 2 Pro Wallet & Earnings Management Rules
- **Dual Balance Precision Architecture:**
  - Existing fields `availableBalance`, `pendingBalance`, and `lifetimeEarned` remain as 2-decimal floating-point numbers in dollar units for 100% backward compatibility with all customer, Pro, and matching views.
  - All new financial operations, fee deductions, net calculations, and ledger records internally compute in **integer cents** (`dollarsToCents`, `centsToDollars`) to completely prevent floating-point rounding errors.
- **Opening-Balance Snapshot:**
  - In `migrateStateIfNeeded()`, existing balances are preserved by inserting a non-balance-modifying `opening_balance_snapshot` record with `amountCents: 0`.
  - The migration is idempotent and gated by `WALLET_CONFIG.SCHEMA_VERSION = 2`. Repeated page reloads never duplicate snapshots or alter balances.
- **Earnings Ledger & Completion Idempotency:**
  - When a worker marks their assignment completed, `slot.payoutReleased` is set to `true`, pending balance decreases by the slot payout, available balance increases, lifetime earned increases, and an `earnings_credit` transaction is pushed to `pro.earnings.walletTransactions`.
  - Duplicate status updates on an already completed slot are rejected with an explicit error and do not generate duplicate balance credits or ledger entries.
- **Simulated Cash-Out Experience & Fees:**
  - **Instant Cash-Out:** Simulated debit-card payout with a flat $1.50 simulated fee (`WALLET_CONFIG.INSTANT_CASHOUT_FEE_CENTS = 150`). Status: `simulated_instant_confirmed`.
  - **Standard ACH:** Free simulated bank transfer ($0.00 fee). Status: `simulated_processing` (1–2 business days).
  - **Partial Withdrawals:** Workers can withdraw any amount between $1.00 and their available balance.
  - **Guard Conditions:** Withdrawals exceeding available balance, negative balances, and instant withdrawals smaller than or equal to the $1.50 fee ($1.00 instant) are strictly rejected.
  - **Lifetime Earnings Invariance:** Withdrawing funds strictly deducts from `availableBalance`; `lifetimeEarned` must never decrease.
- **Cash-Out Idempotency:**
  - Each cash-out operation accepts a stable `requestId`. If a request with the same `requestId` is re-submitted, the system returns the existing transaction without deducting funds a second time.
- **Simulated Receipts:**
  - Every withdrawal produces an interactive receipt modal displaying Pro name, transaction ID, date/time, method, gross amount, fee, net delivered, and the required disclosure: `SIMULATED TRANSACTION — NO REAL MONEY TRANSFERRED`.
  - Printable via browser print styles; re-openable anytime from the transaction history list.

---

## 12. Stage 2 Acceptance Test Benchmarks (Tests A–K)
1. **Test A (Earnings Credit):** Worker completes $75 assignment → pending decreases by $75, available increases by $75, lifetime increases by $75, exactly one `earnings_credit` transaction created.
2. **Test B (Independent Worker Earnings):** Multi-mover booking: Marcus completes slot 1 while Jamar remains pending → Marcus credited, Jamar pending, customer booking remains active.
3. **Test C (Duplicate Earnings Prevention):** Repeated completion call on the same slot is rejected with zero duplicate balance credit or transaction creation.
4. **Test D (Instant Cash-Out):** $100 withdrawal with $1.50 fee → $98.50 net delivered, $0 remaining available from $100, lifetime earnings unchanged, transaction and receipt recorded.
5. **Test E (Standard Cash-Out):** $100 withdrawal with $0.00 fee → $100 net delivered, $0 remaining available, lifetime earnings unchanged, `simulated_processing` status recorded.
6. **Test F (Insufficient Funds):** Attempt to withdraw more than available balance is strictly rejected with no negative balance or transaction creation.
7. **Test G (Duplicate Cash-Out Idempotency):** Resubmission with same `requestId` returns already-processed result without double balance deduction.
8. **Test H (Transaction History Persistence):** Completed jobs and withdrawals persist accurately across browser reloads; receipts remain accessible.
9. **Test I (Profile Isolation):** Switching between Marcus Davis and Elena Rodriguez shows strictly isolated balances, transactions, and receipts.
10. **Test J (Legacy Data Migration):** Loading state without `walletSchemaVersion` safely creates opening snapshots without fabricating cash-outs or duplicating earnings.
11. **Test K (Regression Testing):** Verified that customer booking, dynamic pricing, ASAP matching, scheduled appointments, crew-size enforcement, job-board acceptance, reviews, and cross-tab sync remain 100% operational.

---

## 13. Stage 3 Human-Controlled Admin & Dispatch Rules (Phase 1)
- **Role Isolation Architecture:**
  - Header navigation supports three independent roles: Customer (`customer`), Crewly Pro (`pro`), and Crewly Admin (`admin`).
  - Active role is persisted in `sessionStorage['crewly_active_role']` with URL parameter synchronization (`?role=admin`).
  - Switching role in one browser tab does not overwrite or mutate the role of any other concurrent tab (tab-scoped isolation).
  - Explicit classroom demonstration badge is displayed: client-side role switching is designed for academic evaluation in INSY 3331, not production RBAC/OAuth authentication.
- **State Schema Version 3 Migration:**
  - Gated by `state.adminSchemaVersion = 3`.
  - Initializes `adminAuditLog: []` (append-only administrative audit records) with baseline fictional demo entries.
  - Initializes `supportCases: []` with baseline fictional demo support records (e.g. `CASE-101`).
  - Preserves 100% of existing customer bookings, Pro earnings, wallet transactions, and ratings without balance corruption.
- **Rules-Based Operational Alerts (Deterministic):**
  - Evaluated dynamically at runtime via `getOperationalAlerts(state)` to prevent stale duplicate alert records in localStorage.
  - Explicitly identified as a deterministic operational rules engine, NOT an autonomous or generative AI agent.
  - Generates alerts for:
    1. Multi-worker staffing shortages (`partially_filled` bookings requiring full crew before work starts).
    2. Unassigned booking requests (`waiting_for_pros`).
    3. Expired ASAP matching windows (lapsed 60-minute window with unfilled slots).
    4. Approaching same-day scheduled appointments with unfilled positions.
    5. Open or under-review customer support tickets.
- **Financial Accounting Separation Standards:**
  - **Projected Gross Booking Value (GBV):** Aggregate customer price across open/active bookings.
  - **Completed-Job Gross Value:** Aggregate customer billings on finalized bookings.
  - **Platform Booking Fees:** Aggregate $10 booking fees recorded across bookings.
  - **Worker Compensation:** Aggregate worker payouts committed (pending) or disbursed (completed).
  - **Platform Gross Margin:** Total customer charges minus total worker compensation.
  - **Simulated Cash-Out Volume:** Aggregate volume and fees from simulated worker debit card and ACH withdrawals.
  - **Net Profit Disclosure:** Gross customer billings and platform gross margin must NEVER be identified as net profit. Commercial net profit deducts payment gateway processing (2.9% + $0.30), insurance, customer dispute reserves, background checks, and platform infrastructure.

---

## 14. Stage 3 Phase 2: Human-Controlled Dispatch Management & Audit Rules
- **Rule-Based Manual Assignment:**
  - Administrative manual assignment (`adminAssignPro`) strictly evaluates `canProAcceptSlot()` before modifying any booking or Pro record. No administrative overrides are permitted for verified skills, equipment, weekly availability, or schedule conflicts.
  - Requires documented administrative reason and operator confirmation checkbox.
  - Reuses the existing `assignProToSlot()` state transition logic: updates slot status, increments worker pending earnings by the exact slot payout, recalculates booking overall status (`fully_confirmed` if all slots filled), and logs sanitized system notification.
  - Appends an audit record to `state.adminAuditLog` with actionType `'worker_assigned'` and status `'success'`.
  - Ineligible assignment attempts are strictly rejected, and logged to `adminAuditLog` with actionType `'assignment_rejected'` and status `'failed'` for diagnostic auditing.
- **Pre-Work Worker Unassignment & Earnings Reversal:**
  - Administrative unassignment (`adminUnassignPro`) is restricted strictly to pre-work assignments (`slot.status === 'assigned'`).
  - Active work (`traveling`, `arrived`, `in_progress`) and finalized work (`completed`) are protected from ordinary dispatch unassignment and must be escalated to dispute resolution.
  - Reverses pending earnings using integer-cent precision (`pro.earnings.pendingBalance -= slot.payout`).
  - **Financial Discrepancy Guard:** If a worker's pending balance is less than the assignment payout, the action is strictly rejected with an explicit operational error. Never silently clamp with `Math.max(0, ...)` to conceal balance inconsistencies.
  - Completed earnings, withdrawal transactions, and lifetime earned balances are never altered.
  - Reopens vacant position (`slot.status = 'unassigned'`, clearing assigned Pro ID and name).
  - Recalculates booking status (`partially_filled` or `waiting_for_pros`).
  - Appends an audit record with actionType `'worker_unassigned'`.
- **Administrative Privacy & Sanitization:**
  - Administrative reasons and internal dispatch notes are preserved exclusively inside `state.adminAuditLog` and the demo Admin Dashboard.
  - Customer activity notifications in `booking.messages` remain strictly sanitized: announcing that crew staffing was updated without disclosing internal administrative reasons or individual worker payout dollar figures.
- **Historical Appointment Handling:**
  - Scheduled appointments whose dates have already passed (`scheduledDate < dallasNow.dateStr`) are flagged in the Needs Attention queue with `Historical Review Required`.
  - Manual assignment is disabled for past appointments until the customer reschedules to a valid future appointment date.

---

## 15. Stage 3 Phase 3: Supporting Administrative Operations & Reputation Protection Rules
- **Three-Tier Operational Pro Categorization (Adjustment 5):**
  - **Registered Pros:** Total active onboarded workforce (4 Dallas Pros).
  - **Available Pros Today:** Workers with weekly schedule availability enabled for the current Dallas local day of the week (`weeklyAvailability[todayName].enabled`).
  - **Booking Eligibility Inspector:** Directly evaluates `canProAcceptSlot()` for every open slot on a selected booking. A Pro is never claimed to be available for a job based solely on general day-of-week availability. Meaningful disqualification reasons (missing Verified Mover skill, missing verified lawn equipment, schedule conflict, or expired booking window) are surfaced explicitly.
- **Unified Case Management System (Adjustment 1):**
  - All operational inquiries, staffing shortages, customer support requests, and Trust & Safety review disputes reside in a single unified collection: `state.supportCases`.
  - Schema: `{ caseId, category ('support' | 'trust_safety'), bookingId, customerId, proId, reviewSlotId, issueType, priority, status ('open' | 'under_review' | 'resolved'), title, notes: [{ noteId, author, timestamp, text }], createdAt, updatedAt, resolvedAt }`.
  - Idempotency & Duplicate Prevention: Submissions with identical `idempotencyKey` return the existing case without re-creation. Creating a duplicate open case for the same booking and identical title is rejected with an operational error.
- **Reputation Protection Standards & Review Preservation (Adjustment 2):**
  - Disputing a review creates a linked Trust & Safety case in `state.supportCases` and flags the review with `disputed = true` and `disputeStatus = 'under_investigation'`.
  - **Strict Invariance:** Disputing a review NEVER deletes the review, alters original star ratings (`review.stars`), modifies worker average rating (`pro.rating`), alters review count (`pro.reviewCount`), penalizes the customer, or suspends the Pro.
  - Multi-Worker Review Independence: Reviews on multi-worker bookings are stored per-slot in `booking.workerReviews[]`. Flagging one worker's review as disputed never bleeds into or attaches disputes to other co-workers' reviews on the same booking.
- **Strictly Read-Only Financial Operations (Adjustment 3):**
  - Reuses Stage 2 Pro wallet ledger and booking data as single source of truth.
  - Opening or rendering the Financial Operations view guarantees ZERO state mutations, zero transaction creations, and zero balance adjustments.
  - Transparently distinguishes Projected Gross Booking Value, Completed-Job Gross Value, Platform Booking Fees, Projected Gross Margin, Realized Completed Margin, Total Platform Gross Margin, and Worker Earnings.
  - Prohibits identifying gross margin as net profit: explicit transparency disclaimers detail operating expenses, 2.9% + $0.30 gateway processing, general liability insurance, customer dispute reserves, background check costs, and cloud infrastructure.
  - Historical wallet snapshots (`opening_balance_snapshot`) and historical job imports are never double-counted in cash-out totals.
- **Customer Privacy & XSS Sanitization (Adjustment 4):**
  - Internal dispatcher notes, administrative reasons, and Trust & Safety investigation notes remain strictly confidential within the Admin Center. They are never pushed to `booking.messages` or exposed in customer views.
  - All user-entered titles, notes, and comments are sanitized via `escapeHtml()` to neutralize potential script injection.
- **Unified Administrative Audit Trail (Adjustment 1 & 5):**
  - Append-only audit logging for: `worker_assigned`, `worker_unassigned`, `assignment_rejected`, `support_case_created`, `support_case_status_updated`, `support_case_note_added`, `review_dispute_flagged`, and `trust_case_updated`.
  - Client-side demonstration log labeled for academic evaluation in INSY 3331.

---

## 16. Stage 3 Phase 4: Final End-to-End Testing, Browser Verification & Presentation Polish
- **Mandatory Browser Initialization & Strict ES Module Parsing:**
  - Verified with strict ES6 module parser (macOS WebKit/JavaScriptCore `jsc -m`).
  - Zero duplicate identifier declarations across all script files (resolved duplicate `flagReviewDispute`).
  - Zero unhandled module exceptions on application startup.
  - Clean client-side rendering verified across all 8 Admin tabs, Pro View, and Customer View.
- **Complete Customer-to-Admin-to-Pro Marketplace Lifecycle (Scenarios A–H):**
  - **Scenario A (Booking Creation):** Customer Sarah Jenkins books 2 movers for 3 hours at Uptown Dallas 75204. Demonstrates transparent customer pricing ($240 labor + $10 platform fee = $250 total) while strictly concealing individual worker payouts ($75/worker).
  - **Scenario B (First Worker Acceptance):** Marcus Davis accepts slot 1. Booking transitions to `partially_filled`. Marcus pending balance increases by exactly $75.00 once. Solo work progression (`traveling`, `arrived`, `in_progress`, `completed`) is strictly blocked until full crew is confirmed.
  - **Scenario C (Admin Dispatch):** Administrator inspects candidates. Elena and Carlos disqualified for missing moving credential; Marcus disqualified for duplicate assignment; Jamar Washington confirmed eligible. Admin assigns Jamar with documented reason. Booking transitions to `fully_confirmed`. Jamar pending balance credited $75.00. Customer message feed announces assignment without leaking payouts or internal administrative notes. Audit trail records `worker_assigned`.
  - **Scenario D (Job Lifecycle):** Both workers transition through required sequential states (`assigned` -> `traveling` -> `arrived` -> `in_progress` -> `completed`). Upon each worker completion, pending balance decreases, available balance increases, lifetime earned increases, and an `earnings_credit` transaction is appended to the worker's ledger. Booking completes only when both workers finish.
  - **Scenario E (Individual Reviews):** Customer submits separate reviews: Marcus (5 stars), Jamar (3 stars). Stored in `booking.workerReviews[]` with distinct worker attribution. Average ratings update accurately via weighted historical average (`(rating * count + stars) / (count + 1)`). Ratings do not bleed across workers. Duplicate reviews for the same assignment slot are blocked.
  - **Scenario F (Trust & Safety Dispute):** Administrator flags Jamar's review with documented reason. Unified Trust & Safety case created in `state.supportCases` (`CASE-TS-201`). Review marked `under_investigation`. Star rating (3★), worker average rating (4.63), and review count (15) strictly preserved. Marcus review remains undisputed. Audit trail records `review_dispute_flagged`.
  - **Scenario G (Customer Support):** Support case created, transitioned (Open -> Under Review -> Resolved), and internal dispatcher notes appended. Notes persist across reloads and remain strictly quarantined from customer messages.
  - **Scenario H (Financial Operations):** Admin financial summary calculates GBV ($315 completed), platform gross margin ($130 completed), and platform fees ($50). Ten consecutive recalculations verify ZERO mutations to wallet balances or transaction ledgers. Gross margin explicitly distinguished from commercial net profit.
- **Simulated Cash-Out Verification:**
  - Standard withdrawal ($0 fee): available balance decreases, net delivered equals requested amount, lifetime earned remains invariant.
  - Instant withdrawal ($1.50 fee): available balance decreases, net delivered equals amount minus $1.50 fee, lifetime earned remains invariant.
  - Partial withdrawals supported.
  - Insufficient funds strictly rejected.
  - Instant withdrawals <= $1.50 fee strictly rejected.
  - Idempotency with stable `requestId` prevents double withdrawals.
  - All cash-out cards, modals, and receipts explicitly labeled: `⚠️ SIMULATED TRANSACTION — NO REAL MONEY TRANSFERRED`.
- **Presentation Readiness & Academic Pilot Polish:**
  - Updated landing hero badges to state: `⚡ Dallas Pilot Demonstration — INSY 3331 Academic Simulation`, `✓ Pre-Screened Dallas Pro Profiles (Pilot Demo)`, and `✓ Transparent Demonstration Pricing Assumptions`.
  - Clarified that client-side role switcher is for academic demonstration, not production authentication.
  - Ensured no claims of live commercial operations, real background checks, active GPS tracking, or autonomous AI dispatch.
- **Responsive Layout Verification:**
  - Verified across Desktop (1440px), Tablet (768px), and Mobile (390px).
  - Refined `.header-container`, `.role-switcher-container`, `.role-pill-btn`, `.modal-dialog`, `.admin-subnav-container`, and `.pro-earnings-grid` with touch-friendly spacing and horizontal overflow scrolling for tables.
- **Portable Test Runner in `tests/`:**
  - `tests/test_es_module_startup.js` (23 assertions)
  - `tests/test_phase1_overview.py` (41 assertions)
  - `tests/test_phase2_dispatch.py` (72 assertions)
  - `tests/test_phase3_operations.py` (81 assertions)
  - `tests/test_phase4_e2e_marketplace.js` (140 assertions)
  - Master executable: `tests/run_all_tests.sh` executes all 357 assertions cleanly (100% pass rate).

---

## 17. Stage 3.5: Admin Booking Cancellation & Verified Job Completion
- **Operational Scope & Capabilities:**
  - Adds two human-controlled dispatch capabilities to the Crewly Admin Center:
    1. **Administrative All-or-Nothing Booking Cancellation**
    2. **Administrative Affirmative Job Completion Verification**
  - Fully integrated with multi-worker assignments, financial ledger integrity, simulated payouts, customer notification privacy, and administrative audit logging.
- **All-or-Nothing Booking Cancellation Rules (Product Lead Adjustment 2):**
  - **Eligibility:** Permitted only when a booking is in pre-work status (`waiting_for_pros`, `partially_filled`, `fully_confirmed`).
  - **Pre-Validation:** Pre-validates the entire booking and every assigned worker's attributable pending balance in integer cents *before* any state mutation. Rejects the operation entirely if any discrepancy is detected.
  - **Financial Reversal:** Reverses pending payouts in integer cents only for assigned positions where earnings are actively recorded as pending.
  - **Financial Invariance:** Completed earnings, available balances, lifetime earnings, and historical cash-outs are never modified by cancellation.
  - **Idempotency:** Cancelling an already-cancelled booking is strictly rejected without duplicate audit logs or state churn.
  - **Audit Snapshot:** Retains full cancellation history on the booking object:
    `cancellationSnapshot: { formerWorkers: [...], totalPayoutCentsReversed, previousStatus, cancelledAt, cancelledBy, reason, cancellationRequestId }`.
  - **Status & Exclusion:** Booking `overallStatus` transitions to `'cancelled'`. Cancelled bookings are permanently excluded from the Pro Job Board and cannot be claimed by workers.
  - **Refund Disclosure:** Customer refund status is marked *"Pending Manual Review — No Refund Processed"*. No automated simulated credit card refunds occur.
- **Protection of Active Work & Support Routing (Product Lead Adjustments 2 & 4):**
  - If any assigned worker has begun traveling, arrived on-site, or is currently in progress, administrative dispatch cancellation is strictly blocked.
  - Dispatchers are advised that work is actively underway.
  - The Admin UI renders an orange **"⚠️ Escalate to Support"** button on active bookings, opening the unified case-creation modal (`#modal-admin-create-case`) pre-populated with high priority, booking reference, and cancellation review notes for manual coordinator investigation.
- **Single Source of Truth for Verified Job Completion (Product Lead Adjustment 1):**
  - Does NOT implement a separate or divergent administrative payout release algorithm.
  - Directly reuses the shared `updateProAssignmentStatus(bookingId, slotId, 'completed')` completion engine after validating administrative verification standards.
  - Transitions assignment status to `completed`, safely moves pending earnings to available balance in integer cents, updates lifetime earnings, and appends an `earnings_credit` transaction to the worker's ledger.
  - Automatically transitions booking `overallStatus` to `completed` when all required positions are finished.
  - Financial discrepancy guard: strictly rejects completion if the worker's pending balance is less than the slot payout amount, preventing silent balance clamping.
  - Eligibility validation: blocks completion of unassigned positions, pre-work positions (`assigned`, `traveling`, `arrived`), and already completed positions.
- **Affirmative Verification Standards & Audit Trail (Product Lead Adjustments 3, 4, 5):**
  - Requires documented affirmative verification source clearly labeled as demonstration simulation:
    - `"Customer Direct Phone Confirmation (Demo Simulation)"`
    - `"On-Site Dispatcher Field Check (Demo Simulation)"`
    - `"Customer Support Ticket Verification (Demo Simulation)"`
  - Requires documented dispatcher notes/explanation and an explicit confirmation checkbox.
  - Appends immutable audit records to `state.adminAuditLog`:
    - `booking_canceled`: captures bookingId, previousStatus, newStatus (`cancelled`), reason, adminName, totalPayoutCentsReversed, and former worker count.
    - `admin_completion_verified`: captures bookingId, slotId, proId, previousStatus (`in_progress`), newStatus (`completed`), reason, adminName, and `verificationSource`.
    - `admin_lifecycle_action_rejected`: captures attempted cancellations of active work or invalid completion attempts.
- **Customer Privacy & Notification Sanitization (Product Lead Adjustment 4):**
  - Customer messages and status badges strictly conceal individual worker payouts, internal administrative notes, and operational rationale.
  - Customer feed displays sanitized notifications regarding cancellation or completion without financial data leaks.
- **Automated Verification & Master Runner:**
  - Dedicated test suite `tests/test_stage3_5_admin_cancel_complete.js` covering Tests A through J (73 assertions, 100% pass).
  - Dedicated bug regression suite `tests/test_chrome_issues_verification.js` covering modal checkbox verification and booking-to-worker status synchronization (34 assertions, 100% pass).
  - Master suite `tests/run_all_tests.sh` executes 7 suites covering 464 assertions with 100% pass rate.
- **Chrome Bug Fixes & Refinements:**
  - **Issue 1 (Modal Checkbox Recognition):** `handleConfirmAdminVerify()` in `app.js` now explicitly sets `confirmed: isConfirmed` inside the `verificationData` payload passed to `adminVerifyAndCompleteAssignment()`, ensuring the business logic recognizes affirmative user confirmation. Modal close/reset logic safely clears confirmation state on modal dismissal.
  - **Issue 2 (Lifecycle Status Synchronization):** `recalculateBookingStatus()` dynamically synchronizes booking `overallStatus` as workers advance through `traveling`, `arrived`, and `in_progress`. Bookings cannot transition to `completed` until every required worker completes. Admin dispatch card headers render distinct visual badges for active states (`⚡ In Progress`, `🚗 En Route / Traveling`, `📍 Arrived On Site`, `✓ Fully Confirmed`).





