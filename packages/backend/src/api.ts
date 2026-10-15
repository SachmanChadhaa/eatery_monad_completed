// HTTP API routes and request handlers (spec section 6).
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  canteenOrdersAbi,
  dayId,
  preorderCap,
  secondOfDay,
} from '@canteenpos/sdk'
import type { Address, Hex } from 'viem'
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
      slots: slotsWithCapacity,
      items,
      contract: ctx.deployment.address,
      chainId: ctx.chain.id,
    })
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
      await ctx.indexer.syncOnce().catch(() => {})
      sendJson(res, 200, { ok: true, txHash: receipt.transactionHash })
    } catch (e) {
      sendError(res, 400, (e as Error).message)
    }
    return true
  }

  // 12. POST /api/orders/serve (Tablet serve action)
  if (req.method === 'POST' && pathname === '/api/orders/serve') {
    try {
      const body = await readJsonBody(req)
      const receipt = await write(ctx.clients.owner, {
        address: ctx.deployment.address,
        abi: canteenOrdersAbi,
        functionName: 'markServed',
        args: [BigInt(body.orderId)],
      })
      await ctx.indexer.syncOnce().catch(() => {})
      sendJson(res, 200, { ok: true, txHash: receipt.transactionHash })
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

      let sql = `select o.*, coalesce(
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
