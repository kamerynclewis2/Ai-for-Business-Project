# Crewly — On-Demand Home Services Marketplace (Dallas Pilot)

> **Course:** INSY 3331: Artificial Intelligence for Business  
> **Launch Market:** Dallas, Texas (Initial Pilot Neighborhoods)  
> **Platform Model:** Two-sided on-demand marketplace connecting Dallas residents with verified service professionals for moving, TV mounting, wall mounting, furniture assembly/disassembly, and lawn care.

---

## 1. Project Overview & Business Value

### The Problem
Finding dependable, qualified help for home tasks in the Dallas metroplex is frustrating. Customers must research multiple service providers, negotiate prices independently, coordinate schedules across different contractors, and take risks on unverified workers. At the same time, local gig workers and trade professionals struggle with irregular job flow, unpredictable earnings, and schedule conflicts.

### The Crewly Solution
Crewly delivers an **Uber-style on-demand and scheduled home services marketplace** featuring:
- **Upfront Transparent Pricing:** Platform-established standardized rates eliminate bidding and awkward price negotiations.
- **Multi-Worker Moving Teams:** Customers can book 2+ movers for apartment and house moves; Crewly deconstructs the request into independent worker assignments.
- **Partial Fulfillment Protection:** Multi-worker bookings remain in a clear "Partially Filled" state until all required worker positions are claimed.
- **Rule-Based Matching & Conflict Engine:** Validates verified skills, required equipment (e.g. commercial mowers), weekly availability, and prevents double-booking.
- **Strict Separation of Financial Visibility:** Customers see their total price and disclosed booking fee; Pros see their individual job payouts; Gross platform revenue is strictly reserved for the administrative/demo view.
- **Dual-Dashboard Architecture:** Real-time synchronization between Customer and Pro views across separate browser tabs without role conflicts.

---

## 2. Target Market Focus: Dallas, Texas

The initial pilot launch focuses on key Dallas neighborhoods:
- **Uptown Dallas** (High-rise moving, elevator access, TV mounting)
- **Downtown Dallas** (Apartment moving, delivery intake)
- **Deep Ellum** (Loft installations, furniture assembly)
- **Bishop Arts District** (Residential maintenance, lawn care)
- **Lakewood / East Dallas** (Single-family homes, yard care, mounting)
- **Oak Lawn** (Apartment & condo services)
- **Lower Greenville** (Residential assembly & moving)
- **Preston Hollow** (Multi-room art and mounting installations)

*Future expansion phases are planned for surrounding metroplex cities (Plano, Frisco, Arlington, and Fort Worth).*

---

## 3. Team Skill & Architecture

### Shared Antigravity Team Skill
The project includes a reusable Antigravity team skill located at:
```text
.agents/skills/crewly-product-rules/SKILL.md
```
This skill standardizes design guidelines, pricing constants, multi-worker assignment decomposition rules, verified credential policies, and verification checklists across team iterations.

### Technical Architecture
- **Zero Dependencies / No Build Step:** Built with pure HTML5, CSS3, and ES6 JavaScript modules.
- **GitHub Pages Ready:** Runs directly in any modern browser without npm, Node.js, databases, or API keys.
- **State Management:** Reactive browser `localStorage` under key `crewly_marketplace_state_v1`.
- **Multi-Tab Independence:** Selected role (`customer` vs. `pro`) is stored in `sessionStorage` and URL query parameters (`?role=customer` or `?role=pro`). Opening separate tabs allows simultaneous Customer and Pro testing without UI collision.
- **Live Cross-Tab Sync:** Listens to `window.addEventListener('storage', ...)` to sync state mutations across tabs in real-time.

---

## 4. Platform Pricing Model & Separation of Visibility

All pricing is labeled as **"Demonstration assumptions — Dallas pilot market"**.

| Service Category | Rate Type | Customer Rate | Worker Payout | Crewly Gross Margin |
| :--- | :--- | :--- | :--- | :--- |
| **Moving & Lifting** | Hourly | \$40 / worker-hr | \$25 / worker-hr | \$15 / worker-hr (37.5%) |
| **TV Mounting** | Fixed | \$109 flat rate | \$75 flat payout | \$34 (31.2%) |
| **Wall Mounting & Shelves** | Fixed | \$95 flat rate | \$65 flat payout | \$30 (31.6%) |
| **Furniture Assembly** | Fixed | \$90 flat rate | \$55 flat payout | \$35 (38.9%) |
| **Furniture Disassembly** | Fixed | \$80 flat rate | \$50 flat payout | \$30 (37.5%) |
| **Lawn Mowing & Basic Care** | Fixed | \$55 flat rate | \$35 flat payout | \$20 (36.4%) |
| **Platform Booking Fee** | Per Booking | \$10.00 | — | \$10.00 |

### Visibility Enforcements
1. **Customer View:** Displays Service Subtotal, Disclosed \$10 Booking Fee, and Total Customer Price. Worker payouts and platform margins are completely hidden.
2. **Crewly Pro View:** Displays the worker's individual offered payout for each assignment slot. Customer billing fees and platform margins are completely hidden.
3. **Admin / Demo Metrics Modal:** Displays total customer billings, total worker payouts, and **Gross Platform Revenue before operating expenses** (accurately distinguished from net profit).

---

## 5. Verification: Five Required Test Scenarios

| Test # | Scenario | Inputs & Actions | Expected Result | Actual Result | Status |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **1** | **Multi-Worker Moving Request** | Customer books Moving in Uptown Dallas: 2 workers for 3 hours. | Subtotal = \$240 (2 × 3 × \$40), \$10 booking fee, **\$250 customer total**. Creates 2 discrete worker slots (`Lead Mover` and `Mover Position 2`), each with **\$75 payout**. Status remains `Partially Filled (0/2)` until both Pros accept. | Subtotal is exactly \$240, Total is \$250. 2 separate slots generated. Booking status reflects partial fulfillment until both positions are claimed. | **PASSED** |
| **2** | **TV Mounting Guided Intake** | Customer selects TV Mounting: 65" TV, Drywall, customer owns bracket. | Dynamic intake branches on wall type and bracket. Guaranteed price: **\$109 + \$10 fee = \$119**. Worker payout: **\$75**. Job card displays technical specifications. | Form adapts dynamically; quote displays \$119 total; Pro sees \$75 payout; technical specs attach to booking. | **PASSED** |
| **3** | **Lawn Equipment Enforcement** | Customer books Lawn Mowing in Lakewood. | Pro Carlos (owns verified mower & trimmer) sees job as **Available to Accept**. Pro Marcus (owns no mower) sees job card **grayed out** with explicit badge: `Ineligible: Missing platform-verified lawn equipment`. | Verified credentials checked; Pro lacking equipment is strictly blocked with explicit badge reason. | **PASSED** |
| **4** | **Multi-Worker Assignment Progression** | Mover 1 (Marcus Davis) accepts Position 1 on a 2-mover job. Position 2 remains open. | Booking shows `⚠️ Partially Filled: 1 of 2 workers assigned. Waiting for additional Pro.` Booking does NOT confirm until second Pro accepts. | Booking status displays `partially_filled (1/2)`. Transitions to `fully_confirmed` only after both positions are filled. | **PASSED** |
| **5** | **Availability & Schedule Conflict Prevention** | Pro Marcus is assigned to Booking CRW-1001 on Nov 8 at 10:00 AM. He attempts to accept another booking on Nov 8 at 11:00 AM. | Acceptance is blocked. System displays: `Schedule Conflict: You are already assigned to booking CRW-1001 around this time.` | Overlapping time slot detected; acceptance blocked with clear explanatory message. | **PASSED** |

---

## 6. How to Run & Demonstrate

### Running Locally
Because Crewly uses native ES6 JavaScript modules, open the folder using any standard local static server (e.g., Python's built-in HTTP server or VS Code Live Server):

```bash
# From the project directory:
python -m http.server 8000
```
Open your browser to: `http://localhost:8000`

### Dual-Tab Demonstration (Customer & Pro side-by-side)
1. In Tab 1, open `http://localhost:8000/?role=customer`.
2. In Tab 2 (or click **"Open in New Tab ↗"** in the header), open `http://localhost:8000/?role=pro`.
3. In Tab 1 (Customer), book a moving job with 2 workers for 3 hours.
4. Switch to Tab 2 (Pro). Notice the two assignment slots appear instantly on the Dallas Job Board without page reloads!
5. In Tab 2, select **Marcus Davis (Gold Pro)** and click **Accept Job**.
6. Switch back to Tab 1. Notice the booking instantly updates to: `⚠️ Partially Filled (1 of 2 workers assigned)` and displays Marcus Davis as Lead Mover.
7. In Tab 2, switch Pro Profile to **Jamar Washington (Bronze Pro)** and accept Position 2.
8. Switch back to Tab 1: The booking automatically transitions to `✓ Fully Confirmed`!
9. In Tab 2, use the lifecycle stepper (`Mark En Route` ➔ `Mark Arrived` ➔ `Start Work` ➔ `Complete`).
10. Watch earnings transfer from **Pending** to **Available**, test the **Simulated Cash-Out**, and submit a **Customer Star Rating & Review**.
11. Click **Marketplace Metrics** in the top banner to inspect **Gross Platform Revenue before operating expenses**.
12. Click **🔄 Reset Demo Data** at any time to restore the initial Dallas seed state.

---

## 7. Transparent Technical Disclosures

In accordance with academic standards for INSY 3331:
1. **Simulated Payments:** All balances, payouts, and instant cash-out transfers are client-side simulations recorded in `localStorage`. No real credit card or bank credentials are required or processed.
2. **Simulated Dallas Geolocation:** Distances and transit steps are simulated based on sample Dallas neighborhood coordinates. No live background telematics or GPS is active.
3. **Simulated Messaging:** In-app communication is an interactive browser-stored event log.
4. **Transparent Rule-Based Intake:** The guided intake system uses dynamic conditional logic and decision trees. It is not represented as live generative AI.
5. **Gross Platform Revenue:** Financial metrics represent platform gross revenue before operating expenses (support, infrastructure, insurance), not net profit.
