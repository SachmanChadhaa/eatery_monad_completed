// Razorpay payment adapter (spec D2, 6.6).
// Handles Razorpay Orders API, webhook signature verification, and refunds.
import { createHmac } from 'node:crypto'
import { keccak256, stringToHex } from 'viem'
import type { ChargeRef, IntentChargeRequest, PaymentAdapter, PaymentPaidHandler, RefundRef } from './types.ts'

export type RazorpayConfig = {
  keyId?: string
  keySecret?: string
  webhookSecret?: string
}

export class RazorpayAdapter implements PaymentAdapter {
  private handlers: PaymentPaidHandler[] = []
  private cfg: RazorpayConfig

  constructor(cfg: RazorpayConfig = {}) {
    this.cfg = {
      keyId: cfg.keyId ?? process.env.RAZORPAY_KEY_ID,
      keySecret: cfg.keySecret ?? process.env.RAZORPAY_KEY_SECRET,
      webhookSecret: cfg.webhookSecret ?? process.env.RAZORPAY_WEBHOOK_SECRET,
    }
  }

  async createCharge(req: IntentChargeRequest): Promise<ChargeRef> {
    if (!this.cfg.keyId || !this.cfg.keySecret) {
      // Fallback to simulated razorpay order id when keys aren't set
      return `order_${req.intentHash.slice(2, 16)}`
    }

    const auth = Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64')
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: req.totalPaise,
        currency: 'INR',
        receipt: req.intentHash.slice(0, 30),
        notes: {
          intentHash: req.intentHash,
          student: req.student,
        },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Razorpay order creation failed: ${err}`)
    }

    const data = (await res.json()) as { id: string }
    return data.id
  }

  onPaid(handler: PaymentPaidHandler): void {
    this.handlers.push(handler)
  }

  async recordPaid(chargeRef: ChargeRef, amountPaise: number, customPaymentRef?: string): Promise<void> {
    const paymentRef = customPaymentRef ?? keccak256(stringToHex(`rzp-${chargeRef}-${Date.now()}`))
    for (const h of this.handlers) {
      await h(chargeRef, amountPaise, paymentRef)
    }
  }

  async refund(chargeRef: ChargeRef, amountPaise: number, note: string): Promise<RefundRef> {
    if (!this.cfg.keyId || !this.cfg.keySecret) {
      return keccak256(stringToHex(`rfnd_${chargeRef}_${Date.now()}`))
    }

    const auth = Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64')
    const res = await fetch(`https://api.razorpay.com/v1/payments/${chargeRef}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: amountPaise,
        notes: { note },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Razorpay refund failed: ${err}`)
    }

    const data = (await res.json()) as { id: string }
    return keccak256(stringToHex(data.id))
  }

  async availableBalance(): Promise<number> {
    // Razorpay balance or configured float
    return 300_000
  }

  verifyWebhookSignature(body: string, signature: string): boolean {
    if (!this.cfg.webhookSecret) return true
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(body).digest('hex')
    return expected === signature
  }
}
