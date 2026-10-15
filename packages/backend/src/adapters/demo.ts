// Demo payment adapter (spec D3, 6.6): simulated or cINR ERC-20 token.
// Allows seamless testing and buildathon demos without requiring Razorpay production credentials.
import { keccak256, stringToHex } from 'viem'
import type { ChargeRef, IntentChargeRequest, PaymentAdapter, PaymentPaidHandler, RefundRef } from './types.ts'

export class DemoAdapter implements PaymentAdapter {
  private handlers: PaymentPaidHandler[] = []
  private charges = new Map<string, { student: string; totalPaise: number; intentHash: string; paid: boolean }>()
  private balancePaise: number = 500_000 // 5,000 INR default float

  async createCharge(req: IntentChargeRequest): Promise<ChargeRef> {
    const chargeRef = `cinr_${req.intentHash.slice(2, 18)}_${Date.now()}`
    this.charges.set(chargeRef, {
      student: req.student.toLowerCase(),
      totalPaise: req.totalPaise,
      intentHash: req.intentHash,
      paid: false,
    })
    return chargeRef
  }

  onPaid(handler: PaymentPaidHandler): void {
    this.handlers.push(handler)
  }

  async recordPaid(chargeRef: ChargeRef, amountPaise: number, customPaymentRef?: string): Promise<void> {
    const c = this.charges.get(chargeRef)
    if (c) c.paid = true
    const paymentRef = customPaymentRef ?? keccak256(stringToHex(`pay-${chargeRef}-${Date.now()}`))
    this.balancePaise += amountPaise
    for (const h of this.handlers) {
      await h(chargeRef, amountPaise, paymentRef)
    }
  }

  async refund(chargeRef: ChargeRef, amountPaise: number, note: string): Promise<RefundRef> {
    const refundRef = keccak256(stringToHex(`refund-${chargeRef}-${note}-${Date.now()}`))
    this.balancePaise = Math.max(0, this.balancePaise - amountPaise)
    return refundRef
  }

  async availableBalance(): Promise<number> {
    return this.balancePaise
  }

  getCharge(chargeRef: string) {
    return this.charges.get(chargeRef)
  }
}
