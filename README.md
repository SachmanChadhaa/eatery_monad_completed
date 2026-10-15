# CanteenPOS

Paid pre-orders for a campus canteen, with a student-signed check-in at the counter recorded on Monad. Rupees never touch the contract: it is the public rulebook and ledger, and refunds are paid off-chain and logged on-chain. The full design is in [CanteenPOS_SPEC_v2.md](CanteenPOS_SPEC_v2.md).

**Live on Monad testnet:** [`0x83edd38e28e43c608c0d30b60a03adac1eacbc33`](https://testnet.monadvision.com/address/0x83edd38e28e43c608c0d30b60a03adac1eacbc33) (source verified).

## Layout

| Path | What it is |
| :--- | :--- |
| `contracts/` | `CanteenOrders.sol` and its Foundry tests (unit, fuzz, invariant, gas: 92 passing) |
| `packages/sdk` | EIP-712 types and signing helpers, ABI, chain and canteen config |
| `packages/ops` | Key generation, deploy, funding |
| `packages/indexer` | Postgres schema, chain indexer and CLI, end-to-end test, testnet smoke script |
| `packages/backend` | Core API, payment adapters (cINR & Razorpay), keeper, refund executor, and web app |
| `config/canteen.json` | Slots, items, prices, capacity, college email domain |
| `deployments/` | Deployed addresses and deploy blocks |
| `tools/v2-offline-signing` | Phone test for offline session-key signing |
| `docs/` | Phase status and decisions: start with `P0_STATUS.md` |

## Setup & Build

Needs Node 23.6+ (TypeScript runs directly), [Foundry](https://getfoundry.sh), and Docker Desktop for Postgres.

```bash
git clone --recurse-submodules https://github.com/sachmanchadha-ui/eatery_monad_completed.git
cd eatery_monad_completed
npm install
npm run build                            # builds contracts & verifies TypeScript across all workspaces
```

If you cloned without `--recurse-submodules`, run `git submodule update --init --recursive` before `forge build`.

## Running the Web App & Backend Server

```bash
npm start                                # starts backend API, indexer, keeper, and Web UIs on port 3000
```

Access the deployment-ready web apps:
- **Student PWA**: `http://localhost:3000/` (Menu, slot picker, cart, cINR/UPI pay, confirmation token, offline counter check-in)
- **Tablet KDS**: `http://localhost:3000/tablet` (Rotating challenge QR, camera scanner, live 3-column queue board, prep summary, sold-out toggles)
- **Owner Admin Portal**: `http://localhost:3000/setup` (Device authorization, gas funding, revoke, schedule, event stream)
- **Offline Signing Test**: `http://localhost:3000/offline-signing`

## Tests

Run all test suites across the stack with a single command:

```bash
npm test                                 # runs all 4 test suites: contracts, sdk, indexer, backend
```

Or run individual suites:

```bash
npm run test:contracts                   # contract: 92 Foundry tests (unit, fuzz, invariant, gas)
npm run test:sdk                         # TS signatures accepted by the contract (boots anvil)
npm run test:indexer                     # indexer end to end (anvil + in-memory Postgres)
npm run test:backend                     # backend lifecycle: auth, intents, payments, keeper, refunds
```

## Running against testnet

```bash
docker compose up -d                                    # Postgres on 127.0.0.1:5433
npm run indexer -w @canteenpos/indexer -- sync          # index the live contract
npm run indexer -w @canteenpos/indexer -- status        # today's orders
```

Anything that sends transactions (`deploy`, `fund`, `smoke`) needs `.env.testnet` with the server keys. It is gitignored and must never be committed. Get it from the repo owner over a private channel, not through GitHub.
