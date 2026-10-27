// HTTP API integration tests for CanteenPOS endpoints.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { canteenConfig } from '@canteenpos/sdk'
import { createBackendContext } from '../src/core/index.ts'
import { handleApiRequest } from '../src/api.ts'

const API_TEST_PORT = 19549

describe('CanteenPOS HTTP API', () => {
  let server: Server
  let baseUrl: string

  before(async () => {
    process.env.TEST = '1'
    process.env.ALLOW_OFF_HOURS = '1'
    process.env.ALLOW_DEMO_STUDENT = '1'

    const ctx = await createBackendContext({ dbUrl: 'pglite:' })

    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${API_TEST_PORT}`)
      if (url.pathname.startsWith('/api/')) {
        const handled = await handleApiRequest(ctx, req, res, url.pathname)
        if (handled) return
      }
      res.writeHead(404)
      res.end('Not Found')
    })

    await new Promise<void>((resolve) => {
      server.listen(API_TEST_PORT, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${API_TEST_PORT}`
        resolve()
      })
    })
  })

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  test('GET /api/health returns 200 and contract info', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.status, 'ok')
    assert.ok(data.contract.startsWith('0x'))
    assert.ok(data.roles.attester.startsWith('0x'))
  })

  test('GET /api/config returns canteen slots and items', async () => {
    const res = await fetch(`${baseUrl}/api/config`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.collegeEmailDomain, canteenConfig.collegeEmailDomain)
    assert.ok(data.slots.length >= 2)
    assert.ok(data.items.length >= 3)
  })

  test('POST /api/auth/verify checks domain', async () => {
    const res = await fetch(`${baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: `student@${canteenConfig.collegeEmailDomain}`,
        walletAddress: '0x0A2c1e725446102f33930D2E2d761B203Fe062D4',
      }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.equal(data.domainOk, true)
  })

  test('POST /api/auth/login authenticates roles and rejects invalid credentials', async () => {
    // POS Login
    const posRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'pos', username: 'pos@canteen.edu', password: 'pos123' }),
    })
    assert.equal(posRes.status, 200)
    const posData = await posRes.json()
    assert.equal(posData.ok, true)
    assert.equal(posData.role, 'pos')
    assert.equal(posData.redirectTo, '/pos')

    // KDS Login
    const kdsRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'kds', username: 'kitchen@canteen.edu', password: 'kitchen123' }),
    })
    assert.equal(kdsRes.status, 200)
    const kdsData = await kdsRes.json()
    assert.equal(kdsData.role, 'kds')
    assert.equal(kdsData.redirectTo, '/tablet')

    // Bad Password
    const badRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'pos', username: 'pos@canteen.edu', password: 'wrongpassword' }),
    })
    assert.equal(badRes.status, 401)
  })

  test('POST /api/demo/faucet grants demo tokens', async () => {
    const res = await fetch(`${baseUrl}/api/demo/faucet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: '0x0A2c1e725446102f33930D2E2d761B203Fe062D4' }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.equal(data.balance, 50000)
  })

  test('GET /api/orders returns array of orders', async () => {
    const res = await fetch(`${baseUrl}/api/orders`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data))
  })

  test('GET /api/devices returns device registry', async () => {
    const res = await fetch(`${baseUrl}/api/devices`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data))
  })

  test('POST /api/pos/order creates walk-in counter order and returns token', async () => {
    const res = await fetch(`${baseUrl}/api/pos/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Rahul Sharma (Roll 42)',
        slotId: 0,
        paymentMethod: 'UPI',
        lines: [
          { itemId: 1, qty: 2, pricePaise: 2000 },
          { itemId: 4, qty: 1, pricePaise: 1000 },
        ],
      }),
    })
    assert.equal(res.status, 201)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.ok(data.orderId >= 10000)
    assert.ok(data.tokenNo >= 1)
    assert.equal(data.totalPaise, 4000) // (2 * 1500) + (1 * 1000)
  })

  test('GET /api/pos/analytics returns operational overview and capacity metrics', async () => {
    const res = await fetch(`${baseUrl}/api/pos/analytics`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.summary)
    assert.ok(data.summary.totalOrders >= 1)
    assert.ok(data.summary.walkinsCount >= 1)
    assert.ok(Array.isArray(data.slots))
    assert.ok(data.slots.length >= 2)
  })

  test('POST /api/kds/prep-status and GET /api/kds/queue handle preparation lifecycle', async () => {
    // 1. Create order
    const orderRes = await fetch(`${baseUrl}/api/pos/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Aarav Patel',
        slotId: 0,
        lines: [{ itemId: 2, qty: 1, pricePaise: 3000 }],
      }),
    })
    const orderData = await orderRes.json()
    const orderId = orderData.orderId

    // 2. Mark Preparing
    const prepRes = await fetch(`${baseUrl}/api/kds/prep-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, prepStatus: 'Preparing' }),
    })
    assert.equal(prepRes.status, 200)
    const prepData = await prepRes.json()
    assert.equal(prepData.prepStatus, 'Preparing')

    // 3. Mark Ready
    const readyRes = await fetch(`${baseUrl}/api/kds/prep-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, prepStatus: 'Ready' }),
    })
    assert.equal(readyRes.status, 200)

    // 4. Verify in queue
    const queueRes = await fetch(`${baseUrl}/api/kds/queue`)
    assert.equal(queueRes.status, 200)
    const queueData = await queueRes.json()
    const target = queueData.find((o: any) => o.order_id === orderId)
    assert.ok(target)
    assert.equal(target.prep_status, 'Ready')
    assert.equal(target.order_source, 'walkin')
    assert.ok(target.lines.length >= 1)

    // 5. Mark Served
    const serveRes = await fetch(`${baseUrl}/api/kds/prep-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, prepStatus: 'Served' }),
    })
    assert.equal(serveRes.status, 200)
  })
})
