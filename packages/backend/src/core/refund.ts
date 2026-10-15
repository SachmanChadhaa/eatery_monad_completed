// Refund executor (spec 6.1, 5.3).
// Monitors RefundOwed orders, executes the payment refund via the adapter,
// and logs recordRefundPaid on-chain using the refunder key.
import { canteenOrdersAbi } from '@canteenpos/sdk'
import type { Hex } from 'viem'
import { write } from '@canteenpos/ops'
import type { BackendContext } from './context.ts'

export class RefundExecutor {
  private ctx: BackendContext
  private running = false
  private timer?: NodeJS.Timeout

  constructor(ctx: BackendContext) {
    this.ctx = ctx
  }

  start(intervalMs = 15_000): void {
    if (this.running) return
    this.running = true
    this.tick()
    this.timer = setInterval(() => this.tick(), intervalMs)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearInterval(this.timer)
  }

  async tick(): Promise<{ processed: number; errors: number }> {
    let processed = 0
    let errors = 0

    try {
      // Find orders with status 'owed' in refunds table
      const res = await this.ctx.db.query(
        `select r.order_id, r.reason, r.amount_paise, o.payment_ref, o.intent_hash, i.razorpay_order_id
         from refunds r
         join orders o on o.order_id = r.order_id
         left join intents i on i.intent_hash = o.intent_hash
         where r.status = 'owed'
         order by r.owed_at asc
         limit 10`,
      )

      for (const row of res.rows) {
        try {
          const orderId = BigInt(row.order_id)
          const chargeRef = row.razorpay_order_id ?? row.payment_ref
          const amountPaise = Number(row.amount_paise)

          // 1. Issue refund through adapter
          const refundRef = await this.ctx.adapter.refund(
            chargeRef,
            amountPaise,
            `Order #${orderId} refund: ${row.reason}`,
          )

          // 2. Call recordRefundPaid from refunder key on-chain
          const receipt = await write(this.ctx.clients.refunder, {
            address: this.ctx.deployment.address,
            abi: canteenOrdersAbi,
            functionName: 'recordRefundPaid',
            args: [orderId, refundRef as Hex],
          })

          // 3. Update database
          await this.ctx.db.query(
            `update refunds set status = 'paid', provider_refund_id = $1, refund_ref = $2,
               recorded_tx = $3, paid_at = now()
             where order_id = $4`,
            [refundRef, refundRef, receipt.transactionHash, orderId],
          )

          processed++
        } catch (err) {
          errors++
          if (process.env.NODE_ENV !== 'test') {
            console.warn(`[refund executor error for order ${row.order_id}] ${(err as Error).message}`)
          }
        }
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[refund executor poll error] ${(err as Error).message}`)
      }
    }

    return { processed, errors }
  }
}
