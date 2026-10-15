import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.CHAIN = 'anvil'
process.env.CONFIRMATIONS = '0'
process.env.ALLOW_OFF_HOURS = '1'
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  keccak256,
  parseEther,
  stringToHex,
} from 'viem'
import type { Address, Hex, PrivateKeyAccount } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import {
  buildIntent,
  canteenConfig,
  canteenDomain,
  canteenOrdersAbi,
  dayId,
  dayStart,
  hashLines,
  intentStructHash,
  type Line,
  preorderCap,
  signIntent,
  signSessionKeyAuth,
} from '@canteenpos/sdk'
import {
  ANVIL_PK,
  deployCanteen,
  startAnvil,
  write,
  type Clients,
  type Deployment,
} from '@canteenpos/ops'
import { Indexer, migrate, openDb, type Db } from '@canteenpos/indexer'
import { DemoAdapter, RazorpayAdapter } from '../src/adapters/index.ts'
import {
  createAndReserveIntent,
  type BackendContext,
  Keeper,
  processPaidIntent,
  RefundExecutor,
  relaySessionKeyRegistration,
  setItemAvailable,
  verifyStudentAuth,
} from '../src/core/index.ts'

const TEST_PORT = 19548

describe('CanteenPOS Backend Core', () => {
  let stopAnvil: () => void
  let rpc: string
  let db: Db
  let dep: Deployment
  let ctx: BackendContext
  let day: number

  const owner = privateKeyToAccount(ANVIL_PK)
  const attester = privateKeyToAccount(generatePrivateKey())
  const refunder = privateKeyToAccount(generatePrivateKey())
  const relayer = privateKeyToAccount(generatePrivateKey())
  const student = privateKeyToAccount(generatePrivateKey())
  const session = privateKeyToAccount(generatePrivateKey())

  const pub = () => createPublicClient({ chain: foundry, transport: http(rpc), cacheTime: 0 })
  const as = (account: PrivateKeyAccount): Clients => ({
    pub: pub() as Clients['pub'],
    wallet: createWalletClient({ account, chain: foundry, transport: http(rpc) }),
  })

  async function at(ts: number) {
    const tc = createTestClient({ chain: foundry, mode: 'anvil', transport: http(rpc) })
    await tc.setNextBlockTimestamp({ timestamp: BigInt(ts) })
    await tc.mine({ blocks: 1 })
  }

  before(async () => {
    // 1. Boot anvil
    const anvil = await startAnvil(TEST_PORT)
    rpc = anvil.rpc
    stopAnvil = anvil.stop

    // Fund accounts
    const testClient = createTestClient({ chain: foundry, mode: 'anvil', transport: http(rpc) })
    for (const a of [attester, refunder, relayer, student, session]) {
      await testClient.setBalance({ address: a.address, value: parseEther('10') })
    }

    // Move to 06:00 IST tomorrow and deploy
    const initialBlock = await pub().getBlock()
    day = dayId(Number(initialBlock.timestamp)) + 1
    await at(dayStart(day) + 6 * 3600)

    // 2. Deploy CanteenOrders on anvil
    dep = await deployCanteen(as(owner), {
      openSec: canteenConfig.orderWindow.openSec,
      cutoffSec: canteenConfig.orderWindow.cutoffSec,
      roles: { attester: attester.address, refunder: refunder.address, relayer: relayer.address },
      slotCapacity: canteenConfig.slotCapacity,
      slots: canteenConfig.slots,
      items: canteenConfig.items,
      devices: [owner.address],
    })

    // Move to 08:00 IST for order placement window
    await at(dayStart(day) + 8 * 3600)

    // 3. Open in-memory PGlite database
    db = await openDb('pglite:')
    await migrate(db)

    const domain = canteenDomain(foundry.id, dep.address)

    const indexer = new Indexer(db, pub(), {
      chainId: foundry.id,
      address: dep.address,
      deployBlock: dep.deployBlock,
      confirmations: 0,
    })
    await indexer.init()

    const adapter = new DemoAdapter()

    ctx = {
      db,
      chain: foundry,
      domain,
      deployment: dep,
      keys: {
        OWNER_PK: owner,
        ATTESTER_PK: attester,
        REFUNDER_PK: refunder,
        RELAYER_PK: relayer,
        SUBMITTER_PK: owner,
        VAULT_PK: owner,
        DEMO_DEVICE_PK: owner,
        DEMO_STUDENT_PK: student,
        DEMO_SESSION_PK: session,
      },
      clients: {
        owner: as(owner),
        submitter: as(owner),
        attester: as(attester),
        refunder: as(refunder),
        relayer: as(relayer),
        vault: as(owner),
      },
      adapter,
      indexer,
      config: canteenConfig,
    }
  })

  after(async () => {
    if (db) await db.close()
    if (stopAnvil) stopAnvil()
  })

  test('DemoAdapter charge, payment callback, refund, and balance', async () => {
    const adapter = new DemoAdapter()
    let paidCalled = false

    adapter.onPaid((ref, amt, payRef) => {
      paidCalled = true
      assert.equal(amt, 3000)
    })

    const chargeRef = await adapter.createCharge({
      intentHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      student: student.address,
      totalPaise: 3000,
    })
    assert.ok(chargeRef.startsWith('cinr_'))

    await adapter.recordPaid(chargeRef, 3000)
    assert.equal(paidCalled, true)

    const refundRef = await adapter.refund(chargeRef, 3000, 'test refund')
    assert.ok(refundRef.startsWith('0x'))
    assert.ok((await adapter.availableBalance()) >= 0)
  })

  test('Student authentication and Google domain verification', async () => {
    // Valid domain
    const valid = await verifyStudentAuth(ctx, `student@${canteenConfig.collegeEmailDomain}`, student.address)
    assert.equal(valid.ok, true)
    assert.equal(valid.domainOk, true)

    // Foreign domain
    const invalid = await verifyStudentAuth(ctx, 'hacker@gmail.com', '0x1111111111111111111111111111111111111111')
    assert.equal(invalid.ok, false)
    assert.equal(invalid.domainOk, false)
  })

  test('Relay session key registration on-chain', async () => {
    const block = await pub().getBlock()
    const expiry = Number(block.timestamp) + 29 * 86400
    const nonce = 0n

    const auth = {
      student: student.address,
      key: session.address,
      expiry,
      nonce,
    }

    const sig = await signSessionKeyAuth(student, ctx.domain, auth)

    const relayed = await relaySessionKeyRegistration(ctx, {
      student: student.address,
      key: session.address,
      expiry,
      nonce,
      sig,
    })

    assert.ok(relayed.txHash.startsWith('0x'))
    await ctx.indexer.syncOnce()

    const { rows } = await db.query('select * from session_keys where student = $1', [
      student.address.toLowerCase(),
    ])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].key_address.toLowerCase(), session.address.toLowerCase())
  })

  test('Intent creation and slot capacity reservation', async () => {
    process.env.ALLOW_OFF_HOURS = '1'
    const block = await pub().getBlock()
    const vada = canteenConfig.items[0]
    const lines: Line[] = [{ itemId: vada.id, qty: 2, unitPricePaise: vada.pricePaise }]

    const intent = buildIntent({
      student: student.address,
      slotId: 0,
      lines,
      nonce: 101n,
      deadline: Number(block.timestamp) + 600,
    })

    const studentSig = await signIntent(session, ctx.domain, intent)

    const res = await createAndReserveIntent(ctx, {
      intent,
      lines,
      studentSig,
    })

    assert.equal(res.intentHash, intentStructHash(intent))
    assert.ok(res.chargeRef.length > 0)

    // Verify stored in DB
    const { rows } = await db.query('select * from intents where intent_hash = $1', [res.intentHash])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'reserved')
  })

  test('Payment capture, attestation signing, and contract order placement', async () => {
    const block = await pub().getBlock()
    const vada = canteenConfig.items[0]
    const lines: Line[] = [{ itemId: vada.id, qty: 2, unitPricePaise: vada.pricePaise }]

    const intent = buildIntent({
      student: student.address,
      slotId: 0,
      lines,
      nonce: 102n,
      deadline: Number(block.timestamp) + 600,
    })

    const studentSig = await signIntent(session, ctx.domain, intent)
    const reserved = await createAndReserveIntent(ctx, { intent, lines, studentSig })

    // Simulate payment capture & auto-submit
    const placed = await processPaidIntent(ctx, reserved.chargeRef)
    assert.equal(placed.ok, true)
    assert.ok(placed.orderId !== undefined && placed.orderId > 0n)
    assert.equal(placed.tokenNo, 1)

    // Sync indexer with chain head
    await ctx.indexer.catchUp()

    const { rows } = await db.query('select * from orders where order_id = $1', [placed.orderId])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'Placed')
    assert.equal(rows[0].token_no, 1)
  })

  test('Item availability toggle, unavailable refund claim, and refund executor', async () => {
    // 1. Place an order for Dosa
    const block = await pub().getBlock()
    const dosa = canteenConfig.items[1]
    const lines: Line[] = [{ itemId: dosa.id, qty: 1, unitPricePaise: dosa.pricePaise }]

    const intent = buildIntent({
      student: student.address,
      slotId: 1,
      lines,
      nonce: 103n,
      deadline: Number(block.timestamp) + 600,
    })

    const studentSig = await signIntent(session, ctx.domain, intent)
    const reserved = await createAndReserveIntent(ctx, { intent, lines, studentSig })
    const placed = await processPaidIntent(ctx, reserved.chargeRef)
    assert.equal(placed.ok, true)
    await ctx.indexer.catchUp()

    // 2. Kitchen toggles Dosa unavailable (spec D10)
    await setItemAvailable(ctx, dosa.id, false)
    await ctx.indexer.catchUp()

    // 3. Keeper tick flags unavailable order as RefundOwed
    const keeper = new Keeper(ctx)
    await keeper.tick()
    await ctx.indexer.catchUp()

    const owedOrder = await db.query('select * from orders where order_id = $1', [placed.orderId])
    assert.equal(owedOrder.rows[0].status, 'RefundOwed')

    // 4. Refund executor tick pays the refund and calls recordRefundPaid
    const executor = new RefundExecutor(ctx)
    const res = await executor.tick()
    assert.ok(res.processed >= 1)
    await ctx.indexer.catchUp()

    const paidOrder = await db.query('select * from orders where order_id = $1', [placed.orderId])
    assert.equal(paidOrder.rows[0].status, 'RefundPaid')
  })
})
