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
})
