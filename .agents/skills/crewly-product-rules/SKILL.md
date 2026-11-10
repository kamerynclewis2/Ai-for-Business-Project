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

