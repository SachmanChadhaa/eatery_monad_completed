// Payment adapter interface (CanteenPOS spec v2, section 6.6).
// Adapts between the order state machine and a payment provider (cINR demo token or Razorpay UPI).

export type ChargeRef = string
export type RefundRef = string

export interface IntentChargeRequest {
  intentHash: string
  student: string
  totalPaise: number
}

export type PaymentPaidHandler = (
  chargeRef: ChargeRef,
  amountPaise: number,
  paymentRef: string,
) => Promise<void> | void

export interface PaymentAdapter {
  /** Create a payment charge or order with the provider. */
  createCharge(req: IntentChargeRequest): Promise<ChargeRef>

  /** Register callback for payment capture. */
  onPaid(handler: PaymentPaidHandler): void

  /** Trigger payment as paid (used by webhook or demo checkout). */
  recordPaid(chargeRef: ChargeRef, amountPaise: number, paymentRef?: string): Promise<void>

  /** Issue a refund against a previous charge. */
  refund(chargeRef: ChargeRef, amountPaise: number, note: string): Promise<RefundRef>

  /** Available balance in paise that can cover open refund exposure. */
  availableBalance(): Promise<number>
}
