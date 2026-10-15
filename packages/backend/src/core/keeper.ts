// Background keeper worker (spec 6.1, 5.3).
// Automatically calls markForfeit for expired orders and flagUnserved for abandoned checked-in orders.
import { canteenOrdersAbi } from '@canteenpos/sdk'
import { write } from '@canteenpos/ops'
import type { BackendContext } from './context.ts'

export class Keeper {
  private ctx: BackendContext
  private running = false
  private timer?: NodeJS.Timeout

  constructor(ctx: BackendContext) {
    this.ctx = ctx
  }

  start(intervalMs = 30_000): void {
    if (this.running) return
    this.running = true
    this.tick()
    this.timer = setInterval(() => this.tick(), intervalMs)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearInterval(this.timer)
  }

  async tick(): Promise<{ forfeits: number; unserved: number; unavailable: number }> {
    let forfeits = 0
    let unserved = 0
    let unavailable = 0

    try {
      const nowSec = Math.floor(Date.now() / 1000)

      // 1. Check for Placed orders past claim window + submit grace (30 min + 30 min = 3600 s)
      const forfeitRes = await this.ctx.db.query(
        `select order_id, claim_start from orders
         where status = 'Placed'
           and claim_start is not null
           and claim_start + interval '60 minutes' < to_timestamp($1)`,
        [nowSec],
      )

      for (const row of forfeitRes.rows) {
        try {
          await write(this.ctx.clients.submitter, {
            address: this.ctx.deployment.address,
            abi: canteenOrdersAbi,
            functionName: 'markForfeit',
            args: [BigInt(row.order_id)],
          })
          forfeits++
        } catch {
          // May fail if already forfeited or refundable
        }
      }

      // 2. Check for CheckedIn orders past presentAt + serve grace (20 minutes = 1200 s)
      const unservedRes = await this.ctx.db.query(
        `select order_id, present_at from orders
         where status = 'CheckedIn'
           and present_at is not null
           and present_at + interval '20 minutes' < to_timestamp($1)`,
        [nowSec],
      )

      for (const row of unservedRes.rows) {
        try {
          await write(this.ctx.clients.submitter, {
            address: this.ctx.deployment.address,
            abi: canteenOrdersAbi,
            functionName: 'flagUnserved',
            args: [BigInt(row.order_id)],
          })
          unserved++
        } catch {
          // May fail if already marked served or flagged
        }
      }

      // 3. Check for orders containing items that were toggled unavailable
      const unavailRes = await this.ctx.db.query(
        `select distinct o.order_id
         from orders o
         join order_lines ol on ol.order_id = o.order_id
         join item_availability ia on ia.day_id = o.day_id and ia.item_id = ol.item_id
         where o.status in ('Placed', 'CheckedIn')
           and ia.available = false
           and ia.changed_at >= o.placed_at`,
      )

      for (const row of unavailRes.rows) {
        try {
          await write(this.ctx.clients.submitter, {
            address: this.ctx.deployment.address,
            abi: canteenOrdersAbi,
            functionName: 'claimUnavailableRefund',
            args: [BigInt(row.order_id)],
          })
          unavailable++
        } catch {
          // Ignore
        }
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[keeper error] ${(err as Error).message}`)
      }
    }

    return { forfeits, unserved, unavailable }
  }
}
