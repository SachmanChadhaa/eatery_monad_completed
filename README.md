# CanteenPOS · Zero-Loss Campus Canteen OS on Monad

> **A fund-free, on-chain order state machine that turns morning canteen chaos into a paid, deterministic prep baseline.**  
> Powered by Monad's sub-second finality and near-zero gas, EIP-712 offline presence signatures, official Lucide icons, and a high-voltage Neo-Violent Brutalist interface suite.

[![Monad Testnet](https://img.shields.io/badge/Monad%20Testnet-Chain%2010143-a855f7?style=for-the-badge&logo=ethereum)](https://testnet.monadvision.com/address/0x83edd38e28e43c608c0d30b60a03adac1eacbc33)
[![Tests Passing](https://img.shields.io/badge/All%20Tests-119%2F119%20Passing-00ff88?style=for-the-badge)](https://github.com/SachmanChadhaa/eatery_monad_completed)
[![Design System](https://img.shields.io/badge/UI-Neo--Violent%20Brutalist-ccff00?style=for-the-badge)](#neo-violent-brutalist-design-system)
[![Icons](https://img.shields.io/badge/Icons-Lucide%20Icons-00f0ff?style=for-the-badge)](https://lucide.dev)

---

## 1. Executive Summary & Operational Framing

A college campus canteen cooks on intuition. Two catastrophic operational losses repeat daily:
1. **Under-preparation:** Kitchen stockouts in the 12:30 lunch rush lead to lost revenue and hungry students.
2. **Over-preparation:** Hundreds of unsold portions end up thrown away as food waste.
3. **Informal WhatsApp pre-orders fail** because a verbal promise carries zero cost—when students skip pickup, the canteen absorbs 100% of the loss.

### How CanteenPOS Solves This
- **Paid Pre-Order Window (07:00 – 08:58 IST):** Students select a pickup slot and pay via UPI or testnet MON before 09:00.
- **Strict 30% Pre-Order Cap:** Pre-orders are hard-capped on-chain at **30% of physical kitchen capacity**. Walk-ups constitute 70–80% of real canteen volume, so pre-orders serve as a **guaranteed, paid morning prep baseline**—not an unpredictable demand forecast.
- **No-Show Forfeiture:** An unclaimed pre-order forfeits to the canteen after the claim window plus grace period. No-show loss is eliminated.
- **Two-Way EIP-712 Check-in Handshake:** At the counter, the student's phone and canteen tablet perform a cryptographic challenge-response handshake. Even if the student's phone loses network in a basement cafeteria, signing works completely offline.
- **Fund-Free Smart Contract:** Rupees never touch the smart contract. The contract operates strictly as the public, tamper-proof rulebook and ledger. Off-chain payments and refunds are handled through the merchant's Razorpay or crypto vault and logged on-chain.
- **Strict Separation of Privileges & Auth Guards:** No cross-role shortcuts exist in the headers. Users cannot jump between Student, POS, KDS, and Owner interfaces without explicitly logging out and authenticating through `/login`.
- **Vector Iconography:** Powered by official Lucide icons across all screens—no raw emojis are used.

---

## 2. The 4 Unified Interfaces

CanteenPOS provides a complete ecosystem connecting students, kitchen chefs, counter cashiers, and canteen owners:

```
                                +-----------------------------------+
                                |    UNIFIED ACCESS GATEWAY         |
                                |            /login                 |
                                +-----------------+-----------------+
                                                  |
         +-----------------------+----------------+-----------------------+
         |                       |                                        |
         v                       v                                        v
+--------------------+  +--------------------+                  +--------------------+
|   STUDENT MENU     |  |   CANTEEN POS      |                  |   KITCHEN TABLET   |
|   / or /student    |  |   /pos or /canteen |                  |   /tablet or /kds  |
| - Browse cart menu |  | - Walk-in POS desk |                  | - 4-stage prep KDS |
| - Slot picker (30%)|  | - Counter QR screen|                  | - Active cook tally|
| - Camera check-in  |  | - Table assignment |                  | - Sound alerts     |
| - Token pass slip  |  | - Thermal receipts |                  | - Morning baseline |
+--------------------+  +--------------------+                  +--------------------+
                                 |                                        |
                                 +-------------------+--------------------+
                                                     |
                                                     v
                                        +-------------------------+
                                        |    OWNER ADMIN SETUP    |
                                        |          /setup         |
                                        | - Authorize tablet keys |
                                        | - Fund gas budgets      |
                                        | - Schedule slot changes |
                                        +-------------------------+
```

### 1. Unified Access Gateway (`/login`)
* **Role-Based Authentication:** Single brutalist entry portal to authenticate into Student, POS, KDS, or Owner interfaces.
* **Strict Auth Guards:** Visiting `/`, `/pos`, `/tablet`, or `/setup` without an active matching session immediately redirects to `/login?role=<role>`. Direct inter-role shortcuts have been removed; users must click `[Log Out]` to switch roles.
* **1-Click Quick-Fill Demo Bar:** Evaluators can click one button to auto-fill credentials for any role and log in instantly.
* **Session Persistence:** Origin-bound session tokens stored locally to display active user credentials across terminals.

### 2. Student Pre-Order PWA (`/` or `/student`)
* **Pre-order Cart:** Max 4 lines per order.
* **Slot Capacity Reservation:** Real-time remaining portion counts against the 30% on-chain cap.
* **In-Person Counter Check-In:** Students scan the rotating challenge displayed at the canteen counter using their phone camera or image upload.
* **Offline Presence Signing:** Signs `CheckIn(orderId, challengeHash)` using origin-bound secp256k1 session key in IndexedDB with zero cellular reception.
* **Token Slip & MonadVision Link:** Displays assigned token `#` (e.g. `12:30 · #14`) and direct on-chain verification links.

### 3. College Canteen POS & Operations Dashboard (`/pos` or `/canteen`)
* **Physical Counter QR Display & Table Check-In Simulation:**
  * Displays the live rotating challenge QR broadcast at Pickup Counter #1.
  * Allows counter cashier or evaluator to simulate a student scanning the counter QR (`[Check In at Counter & Assign Table]`), cryptographically verifying presence and assigning a physical dining hall table (`Table #4 (Zone A)`).
  * Automatically dispatches checked-in orders to the kitchen KDS with audio confirmation!
* **Cashier Quick-Order POS:** Fast counter ordering terminal for the 70–80% walk-up students. Generates instant token numbers, prints thermal receipt slips, and pushes orders directly to the kitchen display.
* **Thermal Paper Receipt Modal:** Authentic neo-brutalist thermal paper receipt slip with jagged tear edges, giant token banner, customer ID, itemized lines, and barcode simulation.
* **Operations Analytics:** Real-time counters for Pre-orders vs Walk-ins, total revenue (₹ and MON), orders actively cooking, orders ready at counter, and refund liability exposure.
* **Pre-Order Rush Slot Capacity Tracker:** Visual progress bars for 12:00, 12:30, 13:00, and 13:30 rush slots tracking portions against the 30% cap.
* **Menu Stock & Availability Master:** 1-click toggles calling [`setItemAvailable`](file:///G:/eatery_monad_completed/packages/backend/src/api.ts#L433) on Monad. Toggling an item out-of-stock automatically protects students by making unserved orders refundable on-chain (Spec D10).

### 4. Kitchen Tablet System / KDS (`/tablet` or `/kitchen`)
* **4-Stage Interactive Preparation Board ("See orders and prepare them"):**
  1. **To Cook (Queued):** Incoming pre-orders and POS walk-in tickets. Chef taps `[Start Cooking]` to claim ticket.
  2. **In Prep (Cooking):** Active orders on the grill/fryer with pulsing amber border and live elapsed cooking stopwatch (`Cooking: Xm`). Features interactive checklist to cross off items as they finish. Chef taps `[Mark Ready / Plated]` when plated.
  3. **Ready / Counter Pickup:** Plated food on pickup racks.
     * **Student Arrival Alert:** When the student arrives and checks in at the counter, the ticket pulses in cyber-green with banner `AT COUNTER · READY FOR HANDOVER` and plays a distinct chime!
     * **Overdue Penalty Alert (Spec 8.3):** If an order is checked in for > 10 min without being served, ticket flashes red (`URGENT (>10m)! SERVE BEFORE GRACE EXPIRES`) to avoid automatic refund owes.
     * Chef taps `[Hand Over & Serve]` to submit [`markServed`](file:///G:/eatery_monad_completed/packages/backend/src/api.ts#L398) to Monad!
  4. **Served:** Archive of completed orders.
* **Active Batch Prep Tally Bar:** Header aggregates all pending dishes across active tickets (e.g. `BATCH PREP TALLY: 5x Mumbai Vada Pav · 3x Masala Dosa · 8x Masala Chai`).
* **Morning Baseline Prep Summary:** Aggregated morning demand from `getSlotDemand` locked at 09:00 IST for advance batch cooking.
* **Web Audio Chimes:** Built-in multi-frequency audio alerts (new order, student checked-in, urgent alert) with mute toggle (`Audio: ON/OFF`).
* **Kiosk Mode:** `[Kiosk]` button for fullscreen tablet mounting.

### 5. Owner Admin Portal (`/setup`)
* Injected MetaMask connector for owner key.
* Authorize new canteen tablet devices and fund gas in one click.
* Revoke lost or stolen tablets (historical check-ins remain valid).
* Schedule tomorrow's menu prices, item availability, and slot capacities.

---

## 3. Demo Credentials Directory

The unified login portal at `/login` supports role-based authentication. Use these pre-configured credentials:

| Role | Username / ID | Password | Target Interface | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Canteen POS** | `pos@canteen.edu` | `pos123` | `/pos` | Cashier quick-order desk & operations analytics |
| **Kitchen KDS** | `kitchen@canteen.edu` | `kitchen123` | `/tablet` | 4-stage kitchen preparation display system |
| **Student** | `student@kccemsr.edu.in` | `student123` | `/` or `/student` | Pre-order menu, slot reservation, offline check-in |
| **Owner Admin** | `admin@canteen.edu` | `admin123` | `/setup` | Tablet device authorization & schedule settings |

*(Tip: On the `/login` page, you can also click the quick-preset buttons at the bottom to auto-populate any role.)*

---

## 4. Smart Contract State Machine (`CanteenOrders.sol`)

The on-chain state machine governs order transitions, challenge verification, and forfeiture:

```
                    placeOrder (attested, 07:00 - 08:58 IST)
                               |
                               v
                           [Placed]
                  |            |               |
    checkIn       |            | markForfeit   | claimUnavailableRefund
    (student +    |            | (anyone, after| (anyone, if any line's item
     device sigs) |            |  claim window | went unavailable after
                  v            |  + submit     | the order was placed)
           [CheckedIn]         |  grace, and   |
            |        |         v  not refundable)
  markServed|        |    [Forfeited]          |
  (device)  |        | flagUnserved            |
            v        | (anyone, after          v
        [Served]     |  presentAt+SERVE_GRACE) [RefundOwed] <----+
                     +-----------------------> [RefundOwed]     |
                                                   |             |
                                    recordRefundPaid (refunder)  |
                                                   v             |
                                             [RefundPaid]        |
```

### Cryptographic Guarantees (EIP-712)
* **Domain Separator:** `name="CanteenOrders"`, `version="1"`, `chainId=10143`, `verifyingContract=0x83edd38e...`.
* **Bounded-Use Tablet Challenge:** Rotating 30-second challenge QR signed by the tablet's authorized key. Hard cap of **8 check-ins per challenge** blocks remote screenshots while avoiding counter line serialization.
* **Offline Signing Protocol:**
  1. Tablet generates challenge `DeviceChallenge(device, slotId, nonce, timestamp)`.
  2. Student phone scans tablet QR, verifies device signature locally, and signs `CheckIn(orderId, challengeHash)` using their origin-bound session key in IndexedDB.
  3. Student phone displays response QR; tablet scans and submits `checkIn`.
  4. If the tablet drops the message or loses connection, the student's phone retains the signed payload and submits it directly once back online.

---

## 5. Neo-Violent Brutalist Design System

The entire user experience is built on a custom **Neo-Violent Brutalist** visual language designed for extreme contrast, rapid glanceability, and tactile feedback in busy canteen environments:

* **Canvas Void:** Pitch carbon-violet (`#08060f`)
* **Slabs & Surfaces:** Deep brutalist violet (`#120e24`), elevated plate (`#1a1433`)
* **High-Voltage Neons:**
  * **Electric Violet:** `#a855f7` (Primary branding & buttons)
  * **Toxic Acid Lime:** `#ccff00` (Tokens, POS accents, active highlights)
  * **Hazard Orange:** `#ff5500` (Kitchen cooking timers & active prep badges)
  * **Electric Cyan:** `#00f0ff` (Student badges & network sync indicators)
  * **Cyber Green:** `#00ff88` (Confirmed check-ins & served orders)
  * **Shock Crimson:** `#ff0055` (Sold out alerts & overdue order warnings)
* **Brutalist Outlines:** Heavy solid pitch-black borders (`2.5px solid #000000`)
* **Tactile Drop Shadows:** Hard, un-blurred offset shadows (`4px 4px 0px #000000`, `6px 6px 0px #000000`)
* **Typography:** `Syne` (Brutalist display headings), `Space Grotesk` (Labels & UI), `JetBrains Mono` (Tokens, hashes, timers).

---

## 6. Repository Layout

| Directory / File | Description |
| :--- | :--- |
| [`contracts/`](file:///G:/eatery_monad_completed/contracts) | Foundry Solidity contracts (`CanteenOrders.sol`, `CINR.sol`) and test suites |
| [`packages/backend/`](file:///G:/eatery_monad_completed/packages/backend) | Node.js / Next.js HTTP API, background keeper, refund executor, and static web views |
| [`packages/indexer/`](file:///G:/eatery_monad_completed/packages/indexer) | PostgreSQL / PGlite database schema and real-time Monad chain event indexer |
| [`packages/ops/`](file:///G:/eatery_monad_completed/packages/ops) | Deployment scripts, key management, testnet funding utilities |
| [`packages/sdk/`](file:///G:/eatery_monad_completed/packages/sdk) | Viem TypeScript signing helpers, EIP-712 types, contract ABIs |
| [`public/`](file:///G:/eatery_monad_completed/public) | Standalone client assets: `login.html`, `pos.html`, `tablet.html`, `index.html`, `setup.html` |
| [`config/canteen.json`](file:///G:/eatery_monad_completed/config/canteen.json) | Operational parameters: slots, rush times, items, prices, 30% cap configuration |
| [`deployments/10143.json`](file:///G:/eatery_monad_completed/deployments/10143.json) | Monad Testnet deployed addresses, owner, attester, refunder, and device roles |
| [`CanteenPOS_SPEC_v2.md`](file:///G:/eatery_monad_completed/CanteenPOS_SPEC_v2.md) | Locked engineering specification and operational threat model |

---

## 7. Setup & Local Development

### Prerequisites
* **Node.js:** v23.6+ (native TypeScript execution support)
* **Foundry:** `forge` for compiling Solidity contracts and running tests
* **PostgreSQL / PGlite:** PGlite runs out of the box in WASM; Docker PostgreSQL is optional for production.

### Installation
```bash
git clone --recurse-submodules https://github.com/sachmanchadha-ui/eatery_monad_completed.git
cd eatery_monad_completed
npm install
npm run build
```

### Starting the Server
```bash
npm start
```
The server starts at `http://localhost:3000`:
* **Unified Login Gateway:** `http://localhost:3000/login`
* **Canteen POS & Dashboard:** `http://localhost:3000/pos`
* **Kitchen Tablet KDS:** `http://localhost:3000/tablet`
* **Student Pre-Order Menu:** `http://localhost:3000/`
* **Owner Admin Portal:** `http://localhost:3000/setup`
* **Offline Signing Test Suite:** `http://localhost:3000/offline-signing`

---

## 8. Test Suite

The repository features comprehensive automated test coverage across smart contracts, signing helpers, indexer, and backend APIs:

```bash
npm test
```

### Individual Test Suites
* **Smart Contracts (Foundry):**
  ```bash
  npm run test:contracts
  ```
  Runs 92 Foundry tests across unit tests, fuzz tests (1000 runs per invariant), gas benchmarks, and time-skew tests.
* **TypeScript SDK & Signatures:**
  ```bash
  npm run test:sdk
  ```
  Spins up local Anvil, deploys `CanteenOrders.sol`, and verifies hash parity and EIP-712 signature verification between TypeScript viem and Solidity ecrecover.
* **Database & Chain Indexer:**
  ```bash
  npm run test:indexer
  ```
  Validates end-to-end event sync, idempotent block processing, and database reconstruction from chain logs.
* **Backend HTTP API & Lifecycles:**
  ```bash
  npm run test:backend
  ```
  Validates authentication, POS walk-in order generation, KDS preparation lifecycle updates (`Queued` ➔ `Preparing` ➔ `Ready` ➔ `Served`), intent reservations, and automated refunds.
* **TypeScript Typechecking:**
  ```bash
  npm run typecheck
  ```
  Verifies type safety across all 4 workspaces with 0 errors.

---

## 9. API Reference

| Method & Route | Access | Description |
| :--- | :--- | :--- |
| `POST /api/auth/login` | Public | Role-based authentication (`student`, `pos`, `kds`, `owner`) |
| `POST /api/auth/verify` | Public | Validates student Google `.edu.in` domain / Privy token |
| `GET /api/config` | Public | Active order window, slots, portion capacities, and menu items |
| `POST /api/intents` | Student | Reserves slot capacity (5-min lock) and validates student EIP-712 intent |
| `POST /api/pos/order` | POS Cashier | Creates walk-up counter order with auto token generation and pushes to KDS |
| `GET /api/pos/analytics` | POS / Manager | Real-time operations KPIs, Pre-order vs Walk-in split, and slot capacity meters |
| `POST /api/kds/prep-status` | Kitchen Tablet | Updates ticket stage (`Preparing` ➔ `Ready` ➔ `Served`) |
| `GET /api/kds/queue` | Kitchen Tablet | Real-time kitchen queue filtered by slot with active cooking timers |
| `GET /api/kds/prep` | Kitchen Tablet | Aggregated morning demand counts frozen at 09:00 IST for batch cooking |
| `POST /api/orders/check-in` | Student / Tablet | Submits two-way EIP-712 challenge & response handshake to Monad |
| `POST /api/orders/serve` | Tablet Device | Calls `markServed(orderId)` from authorized tablet device key |
| `POST /api/admin/availability`| Owner / Relayer | Toggles item sold-out status on-chain, triggering student refund protection |
| `GET /api/orders` | Authenticated | Queries order ledger filtered by student, slot, or status |
| `POST /api/devices/authorize` | Owner | Authorizes a new tablet device address on Monad and funds gas |

---

## 10. Testnet Deployment Verification

* **Contract:** `CanteenOrders.sol`
* **Network:** Monad Testnet
* **Chain ID:** `10143`
* **Contract Address:** [`0x83edd38e28e43c608c0d30b60a03adac1eacbc33`](https://testnet.monadvision.com/address/0x83edd38e28e43c608c0d30b60a03adac1eacbc33)
* **RPC URL:** `https://testnet-rpc.monad.xyz`
* **Explorer:** [https://testnet.monadvision.com](https://testnet.monadvision.com)

---

## License

MIT License. Designed and built for the Monad ecosystem.
