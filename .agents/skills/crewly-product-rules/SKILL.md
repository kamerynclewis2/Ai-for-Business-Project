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
- **Demo State & Persistence:** Uses browser `localStorage` for cross-tab data synchronization. The selected active view role (Customer vs. Pro) is stored in `sessionStorage` or URL query parameter (`?role=customer` or `?role=pro`) so separate browser tabs can operate simultaneously as Customer and Pro without overriding each other's view.

---

## 2. Pricing & Financial Terminology Rules
- **Demonstration Labeling:** All prices, fees, and calculations must display: `"Demonstration assumptions — Dallas pilot market"`.
- **Visibility Separation:**
  1. **Customer View:** Shows service subtotal, platform booking fee (\$10), and customer total. Customer never sees Pro payouts or platform gross revenue.
  2. **Crewly Pro View:** Shows the worker's individual offered payout for that assignment. Pro does not see other workers' payouts or platform fees.
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
  - A single Pro cannot claim more than one worker position on the same concurrent moving job.

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

---

## 5. Technical Limitations & Required Transparency Disclosures
- **Simulated Payments:** Balances and cash-outs are client-side simulations. No real money or payment gateway is integrated.
- **Simulated GPS & Geolocation:** Dallas neighborhood distances are mock values. No live telematics or background device GPS is active.
- **Simulated In-App Messaging:** Communications between Customer and Pro are mock event logs stored in browser storage.
- **Rules-Based Intake:** The intake system is smart and dynamic, driven by declarative decision trees. It must not be marketed as live generative AI.

---

## 6. Verification & Test Scenarios
Every build iteration must pass the following five test benchmarks:
1. **Test 1 (Two-Worker Moving):** Customer books 2 movers for 3 hours. System creates 2 separate worker slots. Total customer price is \$250. Booking remains partially confirmed until both Pros accept.
2. **Test 2 (TV Mounting Intake):** Smart intake branches on TV size, wall type, bracket ownership. Calculates \$109 + \$10 fee = \$119. Pro sees \$75 payout.
3. **Test 3 (Lawn Care Equipment Enforcement):** Lawn job requires verified equipment. Workers lacking verified mower are blocked with explanatory badge.
4. **Test 4 (Service Bundling):** Moving + TV Mounting + Assembly combined in one checkout. Deconstructed into individual worker roles; partial fulfillment warnings active until completely filled.
5. **Test 5 (Conflict & Unavailability Prevention):** Pro with overlapping active booking cannot accept a conflicting job. Detailed reason displayed.
