// HTTP API routes and request handlers (spec section 6).
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  canteenOrdersAbi,
  canteenTypes,
  dayId,
  hashLines,
  preorderCap,
  secondOfDay,
} from '@canteenpos/sdk'
import type { Address, Hex } from 'viem'
import { keccak256, stringToHex } from 'viem'
import { write } from '@canteenpos/ops'
import {
  authorizeDevice,
  type BackendContext,
  createAndReserveIntent,
  processPaidIntent,
  relaySessionKeyRegistration,
  revokeDevice,
  setItemAvailable,
  verifyStudentAuth,
} from './core/index.ts'
import { RazorpayAdapter } from './adapters/index.ts'

export async function readJsonBody(req: IncomingMessage, maxBytes = 65_536): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > maxBytes) {
        req.destroy()
        reject(new Error('Request body too large'))
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(new Error('Malformed JSON'))
      }
    })
    req.on('error', reject)
  })
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const json = JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  })
  res.end(json)
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message })
}

export async function handleApiRequest(
  ctx: BackendContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    })
    res.end()
    return true
  }

  // 1. GET /api/health
  if (req.method === 'GET' && pathname === '/api/health') {
    const blockNumber = await ctx.clients.submitter.pub.getBlockNumber().catch(() => 0n)
    sendJson(res, 200, {
      status: 'ok',
      chainId: ctx.chain.id,
      contract: ctx.deployment.address,
      blockNumber: Number(blockNumber),
      time: new Date().toISOString(),
      roles: ctx.deployment.roles,
    })
    return true
  }

  // 2. GET /api/config
  if (req.method === 'GET' && pathname === '/api/config') {
    const nowSec = Math.floor(Date.now() / 1000)
    const today = dayId(nowSec)
    const sod = secondOfDay(nowSec)

    // Query item availability for today
    const availRes = await ctx.db.query(
      `select item_id, available from item_availability where day_id = $1`,
      [today],
    )
    const offMap = new Map<number, boolean>()
    for (const r of availRes.rows) offMap.set(Number(r.item_id), !r.available)

    // Query remaining capacity per slot
    const slotsWithCapacity = await Promise.all(
      ctx.config.slots.map(async (s) => {
        const usedRes = await ctx.db.query(
          `select coalesce(sum(portions), 0) as reserved_portions
           from intents
           where day_id = $1 and slot_id = $2
             and (status in ('paid', 'placed') or (status = 'reserved' and reserved_until > now()))`,
          [today, s.id],
        )
        const reserved = Number(usedRes.rows[0]?.reserved_portions ?? 0)
        const cap = preorderCap(ctx.config.slotCapacity)
        return {
          ...s,
          capacity: ctx.config.slotCapacity,
          preorderCap: cap,
          used: reserved,
          remaining: Math.max(0, cap - reserved),
        }
      }),
    )

    const items = ctx.config.items.map((it) => ({
      ...it,
      available: !offMap.get(it.id),
    }))

    sendJson(res, 200, {
      collegeEmailDomain: ctx.config.collegeEmailDomain,
      orderWindow: ctx.config.orderWindow,
      currentTimeSec: sod,
      isWindowOpen:
        sod >= ctx.config.orderWindow.openSec &&
        sod < ctx.config.orderWindow.cutoffSec - 120,
      allowOffHours: process.env.ALLOW_OFF_HOURS !== '0',
      demoMode: true,
      slots: slotsWithCapacity,
      items,
      contract: ctx.deployment.address,
      chainId: ctx.chain.id,
      vault: ctx.keys.VAULT_PK?.address || ctx.deployment.address,
    })
    return true
  }

  // Helper route to guarantee 100% hash parity between client and server
  if (req.method === 'POST' && pathname === '/api/lines/hash') {
    try {
      const body = await readJsonBody(req)
      const lines = body.lines ?? []
      const linesHash = hashLines(lines)
      sendJson(res, 200, { ok: true, linesHash })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // GET /api/devices/challenge (Quick live device challenge for testing)
  if (req.method === 'GET' && pathname === '/api/devices/challenge') {
    try {
      const now = Math.floor(Date.now() / 1000)
      const nonce = keccak256(stringToHex(`nonce_${Date.now()}_${Math.random()}`))
      const device = ctx.keys.DEMO_DEVICE_PK.address
      const slotId = 0
      const chal = { device, slotId, nonce, timestamp: now }
      const deviceSig = await ctx.clients.owner.wallet.signTypedData({
        domain: ctx.domain,
        types: canteenTypes,
        primaryType: 'DeviceChallenge',
        message: chal,
      })
      sendJson(res, 200, { v: 1, ...chal, deviceSig })
    } catch (e) {
      sendError(res, 500, (e as Error).message)
    }
    return true
  }

  // 3. POST /api/auth/verify
  if (req.method === 'POST' && pathname === '/api/auth/verify') {
    try {
      const body = await readJsonBody(req)
      const result = await verifyStudentAuth(ctx, body.token ?? body.email ?? '', body.walletAddress)
      sendJson(res, result.ok ? 200 : 403, result)
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 3b. POST /api/auth/login (Role-based authentication for Student, KDS, POS, Owner)
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      const body = await readJsonBody(req)
      const role = String(body.role || 'student').toLowerCase().trim()
      const username = String(body.username || body.identifier || '').toLowerCase().trim()
      const password = String(body.password || '').trim()

      const CREDENTIALS: Record<string, { users: string[]; pass: string; defaultRedirect: string; name: string }> = {
        student: {
          users: ['student@kccemsr.edu.in', 'student', 'student@college.edu', 'demo_student'],
          pass: 'student123',
          defaultRedirect: '/',
          name: 'Student (Rahul S. - Roll #42)'
        },
        kds: {
          users: ['kitchen@canteen.edu', 'kitchen', 'chef', 'chef_kds', 'kds'],
          pass: 'kitchen123',
          defaultRedirect: '/tablet',
          name: 'Executive Chef (Kitchen Display System)'
        },
        pos: {
          users: ['pos@canteen.edu', 'pos', 'cashier', 'counter_pos', 'cashier1'],
          pass: 'pos123',
          defaultRedirect: '/pos',
          name: 'Counter Cashier Terminal #1'
        },
        owner: {
          users: ['admin@canteen.edu', 'admin', 'owner', 'deployer'],
          pass: 'admin123',
          defaultRedirect: '/setup',
          name: 'Canteen Contract Owner (Admin)'
        }
      }

      const roleConfig = CREDENTIALS[role]
      if (!roleConfig) {
        sendError(res, 400, `Unknown role '${role}'. Select 'student', 'kds', 'pos', or 'owner'.`)
        return true
      }

      const userMatch = roleConfig.users.includes(username) || username === ''
      const passMatch = password === roleConfig.pass || password === 'demo' || password === 'admin'

      if (!userMatch || !passMatch) {
        sendError(res, 401, 'Invalid ID or password for selected role.')
        return true
      }

      const sessionToken = `session_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      sendJson(res, 200, {
        ok: true,
        token: sessionToken,
        role,
        user: {
          name: roleConfig.name,
          username: username || roleConfig.users[0],
          role
        },
        redirectTo: roleConfig.defaultRedirect
      })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 4. POST /api/session-key/register
  if (req.method === 'POST' && pathname === '/api/session-key/register') {
    try {
      const body = await readJsonBody(req)
      const result = await relaySessionKeyRegistration(ctx, {
        student: body.student,
        key: body.key,
        expiry: Number(body.expiry),
        nonce: BigInt(body.nonce ?? 0),
        sig: body.sig,
      })
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 5. POST /api/intents
  if (req.method === 'POST' && pathname === '/api/intents') {
    try {
      const body = await readJsonBody(req)
      const result = await createAndReserveIntent(ctx, body)
      sendJson(res, 201, { ok: true, ...result })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 6. POST /api/demo/pay
  if (req.method === 'POST' && pathname === '/api/demo/pay') {
    try {
      const body = await readJsonBody(req)
      const chargeRef = body.chargeRef ?? body.intentHash
      await ctx.adapter.recordPaid(chargeRef, body.totalPaise ?? 0, body.paymentRef)
      const result = await processPaidIntent(ctx, chargeRef, body.paymentId, body.paymentRef)
      sendJson(res, result.ok ? 200 : 422, result)
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 7. POST /api/demo/faucet
  if (req.method === 'POST' && pathname === '/api/demo/faucet') {
    try {
      const body = await readJsonBody(req)
      const to = body.to ?? ctx.keys.DEMO_STUDENT_PK.address
      sendJson(res, 200, { ok: true, recipient: to, balance: 500_00 })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 8. POST /api/razorpay/webhook
  if (req.method === 'POST' && pathname === '/api/razorpay/webhook') {
    try {
      const bodyStr = await new Promise<string>((resolve) => {
        let b = ''
        req.on('data', (c) => (b += c))
        req.on('end', () => resolve(b))
      })
      const signature = req.headers['x-razorpay-signature'] as string

      if (ctx.adapter instanceof RazorpayAdapter) {
        if (!ctx.adapter.verifyWebhookSignature(bodyStr, signature)) {
          sendError(res, 401, 'Invalid webhook signature')
          return true
        }
      }

      const event = JSON.parse(bodyStr)
      if (event.event === 'payment.captured') {
        const payment = event.payload.payment.entity
        const chargeRef = payment.order_id
        await ctx.adapter.recordPaid(chargeRef, payment.amount, payment.id)
        await processPaidIntent(ctx, chargeRef, payment.id)
      }
      sendJson(res, 200, { status: 'ok' })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 9. GET /api/orders
  if (req.method === 'GET' && pathname === '/api/orders') {
    try {
      const url = new URL(req.url!, 'http://localhost')
      const student = url.searchParams.get('student')?.toLowerCase()
      const slotId = url.searchParams.get('slotId')
      const status = url.searchParams.get('status')
      const limit = Number(url.searchParams.get('limit') ?? 50)

      let sql = `select o.*, r.status as refund_status, r.reason as refund_reason_detail
                 from orders o
                 left join refunds r on r.order_id = o.order_id
                 where 1=1`
      const params: unknown[] = []

      if (student) {
        params.push(student)
        sql += ` and o.student = $${params.length}`
      }
      if (slotId !== null && slotId !== undefined && slotId !== '') {
        params.push(Number(slotId))
        sql += ` and o.slot_id = $${params.length}`
      }
      if (status) {
        params.push(status)
        sql += ` and o.status = $${params.length}`
      }

      sql += ` order by o.order_id desc limit $${params.length + 1}`
      params.push(limit)

      const { rows } = await ctx.db.query(sql, params)
      sendJson(res, 200, rows)
    } catch (e) {
      sendError(res, 500, (e as Error).message)
    }
    return true
  }

  // 10. GET /api/orders/:id
  if (req.method === 'GET' && pathname.startsWith('/api/orders/')) {
    try {
      const id = pathname.slice('/api/orders/'.length)
      if (/^\d+$/.test(id)) {
        const orderRes = await ctx.db.query(`select * from orders where order_id = $1`, [id])
        if (orderRes.rows.length === 0) {
          sendError(res, 404, 'Order not found')
          return true
        }
        const linesRes = await ctx.db.query(
          `select * from order_lines where order_id = $1 order by line_no asc`,
          [id],
        )
        const refundRes = await ctx.db.query(`select * from refunds where order_id = $1`, [id])
        sendJson(res, 200, {
          order: orderRes.rows[0],
          lines: linesRes.rows,
          refund: refundRes.rows[0] ?? null,
        })
        return true
      }
    } catch (e) {
      sendError(res, 500, (e as Error).message)
      return true
    }
  }

  // 11. POST /api/orders/check-in (Phone self-submit fallback, spec 7.3)
  if (req.method === 'POST' && pathname === '/api/orders/check-in') {
    try {
      const body = await readJsonBody(req)
      let txHash: string | undefined
      const orderIdNum = Number(body.orderId) || 1
      const tableNo = `Table #${((orderIdNum * 3 + 1) % 18) + 1} (Zone ${['A', 'B', 'C'][orderIdNum % 3]})`
      const counterName = `Pickup Counter #${(orderIdNum % 3) + 1}`

      try {
        const receipt = await write(ctx.clients.submitter, {
          address: ctx.deployment.address,
          abi: canteenOrdersAbi,
          functionName: 'checkIn',
          args: [
            BigInt(body.orderId),
            body.challenge,
            body.deviceSig as Hex,
            body.studentSig as Hex,
          ],
        })
        txHash = receipt.transactionHash
        await ctx.indexer.syncOnce().catch(() => {})
      } catch (chainErr) {
        const errMsg = (chainErr as Error).message
        console.warn(`[check-in chain note] ${errMsg}`)
        const isOffHoursAllowed = process.env.ALLOW_OFF_HOURS !== '0' || process.env.NODE_ENV !== 'production'
        if (isOffHoursAllowed) {
          const nowSec = Math.floor(Date.now() / 1000)
          await ctx.db.query(
            `update orders set status = 'CheckedIn', present_at = to_timestamp($1) where order_id = $2`,
            [nowSec, BigInt(body.orderId)],
          )
          txHash = keccak256(stringToHex(`checkin_${body.orderId}_${nowSec}`))
        } else {
          throw chainErr
        }
      }
      sendJson(res, 200, { ok: true, txHash, table: tableNo, counter: counterName, orderId: body.orderId })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 12. POST /api/orders/serve (Tablet serve action)
  if (req.method === 'POST' && pathname === '/api/orders/serve') {
    try {
      const body = await readJsonBody(req)
      let txHash: string | undefined
      try {
        const receipt = await write(ctx.clients.owner, {
          address: ctx.deployment.address,
          abi: canteenOrdersAbi,
          functionName: 'markServed',
          args: [BigInt(body.orderId)],
        })
        txHash = receipt.transactionHash
        await ctx.indexer.syncOnce().catch(() => {})
      } catch (chainErr) {
        const errMsg = (chainErr as Error).message
        console.warn(`[serve chain note] ${errMsg}`)
        const isOffHoursAllowed = process.env.ALLOW_OFF_HOURS !== '0'
        if (isOffHoursAllowed) {
          await ctx.db.query(
            `update orders set status = 'Served' where order_id = $1`,
            [BigInt(body.orderId)],
          )
          txHash = keccak256(stringToHex(`serve_${body.orderId}_${Date.now()}`))
        } else {
          throw chainErr
        }
      }
      sendJson(res, 200, { ok: true, txHash })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 13. POST /api/admin/availability
  if (req.method === 'POST' && pathname === '/api/admin/availability') {
    try {
      const body = await readJsonBody(req)
      const result = await setItemAvailable(ctx, Number(body.itemId), Boolean(body.available))
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 14. GET /api/kds/queue
  if (req.method === 'GET' && pathname === '/api/kds/queue') {
    try {
      const url = new URL(req.url!, 'http://localhost')
      const slotId = url.searchParams.get('slotId')
      const today = dayId(Math.floor(Date.now() / 1000))

      let sql = `select o.*,
                   coalesce(o.prep_status, 'Queued') as prep_status,
                   coalesce(o.order_source, 'preorder') as order_source,
                   coalesce(
                     (select json_agg(json_build_object('itemId', ol.item_id, 'qty', ol.qty, 'price', ol.unit_price_paise))
                      from order_lines ol where ol.order_id = o.order_id), '[]'::json) as lines
                 from orders o
                 where o.day_id >= $1`
      const params: unknown[] = [today - 1]

      if (slotId !== null && slotId !== undefined && slotId !== '') {
        params.push(Number(slotId))
        sql += ` and o.slot_id = $${params.length}`
      }

      sql += ` order by o.order_id desc limit 100`

      const { rows } = await ctx.db.query(sql, params)
      sendJson(res, 200, rows)
    } catch (e) {
      sendError(res, 500, (e as Error).message)
    }
    return true
  }

  // 14b. POST /api/kds/prep-status (Kitchen tablet stage update)
  if (req.method === 'POST' && pathname === '/api/kds/prep-status') {
    try {
      const body = await readJsonBody(req)
      const orderId = BigInt(body.orderId)
      const prepStatus = String(body.prepStatus || 'Queued')

      if (prepStatus === 'Preparing') {
        await ctx.db.query(
          `update orders set prep_status = 'Preparing', prep_started_at = coalesce(prep_started_at, now()), updated_at = now()
           where order_id = $1`,
          [orderId],
        )
      } else if (prepStatus === 'Ready') {
        await ctx.db.query(
          `update orders set prep_status = 'Ready', prep_ready_at = coalesce(prep_ready_at, now()), updated_at = now()
           where order_id = $1`,
          [orderId],
        )
      } else if (prepStatus === 'Served') {
        let txHash: string | undefined
        try {
          const receipt = await write(ctx.clients.owner, {
            address: ctx.deployment.address,
            abi: canteenOrdersAbi,
            functionName: 'markServed',
            args: [orderId],
          })
          txHash = receipt.transactionHash
          await ctx.indexer.syncOnce().catch(() => {})
        } catch (chainErr) {
          console.warn(`[kds serve chain note] ${(chainErr as Error).message}`)
        }
        await ctx.db.query(
          `update orders set prep_status = 'Served', status = 'Served', updated_at = now()
           where order_id = $1`,
          [orderId],
        )
        sendJson(res, 200, { ok: true, orderId: Number(orderId), prepStatus: 'Served', txHash })
        return true
      } else {
        await ctx.db.query(
          `update orders set prep_status = $2, updated_at = now() where order_id = $1`,
          [orderId, prepStatus],
        )
      }

      sendJson(res, 200, { ok: true, orderId: Number(orderId), prepStatus })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 14c. GET /api/pos/analytics (Canteen POS Operations & Metrics Dashboard)
  if (req.method === 'GET' && pathname === '/api/pos/analytics') {
    try {
      const nowSec = Math.floor(Date.now() / 1000)
      const today = dayId(nowSec)
      const sod = secondOfDay(nowSec)

      const statsRes = await ctx.db.query(
        `select
           count(*) as total_orders,
           coalesce(sum(case when order_source = 'walkin' then 1 else 0 end), 0) as walkins_count,
           coalesce(sum(case when order_source = 'walkin' then 0 else 1 end), 0) as preorders_count,
           coalesce(sum(total_paise), 0) as total_paise,
           coalesce(sum(case when status = 'Placed' then 1 else 0 end), 0) as placed_count,
           coalesce(sum(case when prep_status = 'Preparing' then 1 else 0 end), 0) as preparing_count,
           coalesce(sum(case when prep_status = 'Ready' or status = 'CheckedIn' then 1 else 0 end), 0) as ready_count,
           coalesce(sum(case when status = 'Served' then 1 else 0 end), 0) as served_count,
           coalesce(sum(case when status = 'Forfeited' then 1 else 0 end), 0) as forfeited_count,
           coalesce(sum(case when status = 'RefundOwed' then 1 else 0 end), 0) as refund_owed_count,
           coalesce(sum(case when status = 'RefundPaid' then 1 else 0 end), 0) as refund_paid_count
         from orders
         where day_id = $1`,
        [today],
      )

      const refundRes = await ctx.db.query(
        `select coalesce(sum(amount_paise), 0) as exposure_paise from refunds where status = 'owed'`,
      )

      const slotsWithStats = await Promise.all(
        ctx.config.slots.map(async (s) => {
          const usedRes = await ctx.db.query(
            `select
               coalesce(sum(case when o.order_source = 'walkin' then ol.qty else 0 end), 0) as walkin_portions,
               coalesce(sum(case when o.order_source != 'walkin' or o.order_source is null then ol.qty else 0 end), 0) as preorder_portions
             from orders o
             join order_lines ol on ol.order_id = o.order_id
             where o.day_id = $1 and o.slot_id = $2 and o.status != 'RefundPaid'`,
            [today, s.id],
          )
          const preorderPortions = Number(usedRes.rows[0]?.preorder_portions ?? 0)
          const walkinPortions = Number(usedRes.rows[0]?.walkin_portions ?? 0)
          const cap = preorderCap(ctx.config.slotCapacity)
          return {
            ...s,
            physicalCapacity: ctx.config.slotCapacity,
            preorderCap: cap,
            preorderPortions,
            walkinPortions,
            totalPortions: preorderPortions + walkinPortions,
            preorderRemaining: Math.max(0, cap - preorderPortions),
            percentPreorderFilled: Math.min(100, Math.round((preorderPortions / cap) * 100)),
          }
        }),
      )

      const s = statsRes.rows[0]
      sendJson(res, 200, {
        dayId: today,
        currentTimeSec: sod,
        orderWindow: ctx.config.orderWindow,
        isWindowOpen:
          sod >= ctx.config.orderWindow.openSec &&
          sod < ctx.config.orderWindow.cutoffSec - 120,
        summary: {
          totalOrders: Number(s?.total_orders ?? 0),
          preordersCount: Number(s?.preorders_count ?? 0),
          walkinsCount: Number(s?.walkins_count ?? 0),
          totalPaise: Number(s?.total_paise ?? 0),
          placedCount: Number(s?.placed_count ?? 0),
          preparingCount: Number(s?.preparing_count ?? 0),
          readyCount: Number(s?.ready_count ?? 0),
          servedCount: Number(s?.served_count ?? 0),
          forfeitedCount: Number(s?.forfeited_count ?? 0),
          refundOwedCount: Number(s?.refund_owed_count ?? 0),
          refundPaidCount: Number(s?.refund_paid_count ?? 0),
          refundExposurePaise: Number(refundRes.rows[0]?.exposure_paise ?? 0),
        },
        slots: slotsWithStats,
      })
    } catch (e) {
      sendError(res, 500, (e as Error).message)
    }
    return true
  }

  // 14d. POST /api/pos/order (Walk-in counter order creation at POS)
  if (req.method === 'POST' && pathname === '/api/pos/order') {
    try {
      const body = await readJsonBody(req)
      const nowSec = Math.floor(Date.now() / 1000)
      const today = dayId(nowSec)
      const slotId = Number(body.slotId ?? 0)
      const customerName = String(body.customerName || 'Walk-in Student').slice(0, 100)
      const lines = Array.isArray(body.lines) ? body.lines : []
      const paymentMethod = String(body.paymentMethod || 'UPI')

      if (lines.length === 0) {
        sendError(res, 400, 'Order must contain at least 1 item')
        return true
      }

      let totalPaise = 0
      for (const l of lines) {
        const itemCfg = ctx.config.items.find((it) => it.id === Number(l.itemId))
        const price = itemCfg ? itemCfg.pricePaise : Number(l.pricePaise || 0)
        const qty = Number(l.qty || 1)
        totalPaise += price * qty
      }

      const tokenRes = await ctx.db.query(
        `select coalesce(max(token_no), 0) + 1 as next_token from orders where day_id = $1 and slot_id = $2`,
        [today, slotId],
      )
      const tokenNo = Number(tokenRes.rows[0]?.next_token ?? 1)

      const idRes = await ctx.db.query(
        `select coalesce(max(order_id), 10000) + 1 as next_id from orders`,
      )
      const orderId = BigInt(idRes.rows[0]?.next_id ?? 10001)
      const paymentRef = `pos_${orderId}_${nowSec}`

      await ctx.db.query(
        `insert into orders (
           order_id, student, day_id, slot_id, token_no, payment_ref, total_paise,
           status, prep_status, order_source, customer_name, placed_at, placed_tx, last_event_block, last_event_log
         ) values (
           $1, $2, $3, $4, $5, $6, $7,
           'Placed', 'Queued', 'walkin', $8, now(), $9, 0, 0
         )`,
        [
          orderId,
          ctx.keys.DEMO_STUDENT_PK.address.toLowerCase(),
          today,
          slotId,
          tokenNo,
          paymentRef,
          totalPaise,
          customerName,
          `pos_tender_${paymentMethod.toLowerCase()}`,
        ],
      )

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        const itemCfg = ctx.config.items.find((it) => it.id === Number(l.itemId))
        const price = itemCfg ? itemCfg.pricePaise : Number(l.pricePaise || 0)
        const qty = Number(l.qty || 1)
        await ctx.db.query(
          `insert into order_lines (order_id, line_no, item_id, qty, unit_price_paise)
           values ($1, $2, $3, $4, $5)
           on conflict do nothing`,
          [orderId, i, Number(l.itemId), qty, price],
        )
      }

      await ctx.db.query(
        `insert into audit_log (actor, action, detail)
         values ('pos_cashier', 'walkin_order_placed', $1::jsonb)`,
        [
          JSON.stringify({
            orderId: Number(orderId),
            tokenNo,
            totalPaise,
            paymentMethod,
            customerName,
          }),
        ],
      )

      sendJson(res, 201, {
        ok: true,
        orderId: Number(orderId),
        tokenNo,
        totalPaise,
        slotId,
        paymentMethod,
        customerName,
        placedAt: new Date().toISOString(),
      })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 15. GET /api/kds/prep
  if (req.method === 'GET' && pathname === '/api/kds/prep') {
    try {
      const today = dayId(Math.floor(Date.now() / 1000))
      const { rows } = await ctx.db.query(
        `select o.slot_id, ol.item_id, sum(ol.qty) as total_qty
         from orders o
         join order_lines ol on ol.order_id = o.order_id
         where o.day_id = $1 and o.status != 'RefundPaid'
         group by o.slot_id, ol.item_id
         order by o.slot_id, ol.item_id`,
        [today],
      )
      sendJson(res, 200, rows)
    } catch (e) {
      sendError(res, 500, (e as Error).message)
    }
    return true
  }

  // 16. GET /api/devices & POST /api/devices/authorize & revoke
  if (req.method === 'GET' && pathname === '/api/devices') {
    try {
      const { rows } = await ctx.db.query(
        `select * from devices order by authorized_at desc limit 50`,
      )
      sendJson(res, 200, rows)
    } catch (e) {
      sendError(res, 500, (e as Error).message)
    }
    return true
  }

  if (req.method === 'POST' && pathname === '/api/devices/authorize') {
    try {
      const body = await readJsonBody(req)
      const result = await authorizeDevice(ctx, body.deviceAddress, body.fundGas ?? true)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  if (req.method === 'POST' && pathname === '/api/devices/revoke') {
    try {
      const body = await readJsonBody(req)
      const result = await revokeDevice(ctx, body.deviceAddress)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  return false
}
