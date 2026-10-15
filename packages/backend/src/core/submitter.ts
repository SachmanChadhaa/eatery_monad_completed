// Order payment capture, attestation signing, and contract order placement (spec 5.3, 6.1, R1).
import {
  canteenOrdersAbi,
  canteenTypes,
  type Line,
  type OrderIntent,
  signPaymentAttestation,
} from '@canteenpos/sdk'
import type { Address, Hex } from 'viem'
import { decodeEventLog, keccak256, stringToHex } from 'viem'
import { write } from '@canteenpos/ops'
import type { BackendContext } from './context.ts'

export interface PlaceOrderResult {
  ok: boolean
  orderId?: bigint
  tokenNo?: number
  txHash?: Hex
  paymentRef: Hex
  attestation: Hex
  refunded?: boolean
  error?: string
}

export async function processPaidIntent(
  ctx: BackendContext,
  chargeRefOrIntentHash: string,
  providerPaymentId?: string,
  explicitPaymentRef?: Hex,
): Promise<PlaceOrderResult> {
  // 1. Look up intent
  const res = await ctx.db.query(
    `select intent_hash, student, slot_id, lines_json, total_paise, intent_json, student_sig, razorpay_order_id, status
     from intents
     where intent_hash = $1 or razorpay_order_id = $1`,
    [chargeRefOrIntentHash],
  )

  if (res.rows.length === 0) {
    throw new Error(`Intent not found for ${chargeRefOrIntentHash}.`)
  }

  const row = res.rows[0]
  const intentJson = row.intent_json
  const lines: Line[] = row.lines_json
  const studentSig: Hex = row.student_sig

  const intent: OrderIntent = {
    student: intentJson.student as Address,
    slotId: Number(intentJson.slotId),
    linesHash: intentJson.linesHash as Hex,
    totalPaise: Number(intentJson.totalPaise),
    nonce: BigInt(intentJson.nonce),
    deadline: Number(intentJson.deadline),
  }

  // 2. Generate or use paymentRef
  const paymentRef: Hex =
    explicitPaymentRef ??
    keccak256(stringToHex(`pay_${row.intent_hash}_${providerPaymentId ?? Date.now()}`))

  // 3. Record payment in database
  await ctx.db.query(
    `insert into payments (payment_ref, intent_hash, provider_payment_id, amount_paise)
     values ($1, $2, $3, $4)
     on conflict (payment_ref) do nothing`,
    [paymentRef, row.intent_hash, providerPaymentId ?? 'demo_pay', intent.totalPaise],
  )

  // 4. Attester key signs PaymentAttestation(intentHash, paymentRef)
  const attestation = await signPaymentAttestation(
    ctx.keys.ATTESTER_PK,
    ctx.domain,
    intent,
    paymentRef,
  )

  await ctx.db.query(
    `update intents set status = 'paid', payment_ref = $1, attestation = $2 where intent_hash = $3`,
    [paymentRef, attestation, row.intent_hash],
  )

  // 5. Submitter places order on-chain
  try {
    const receipt = await write(ctx.clients.submitter, {
      address: ctx.deployment.address,
      abi: canteenOrdersAbi,
      functionName: 'placeOrder',
      args: [intent, lines, studentSig, paymentRef, attestation],
    })

    // Find OrderPlaced event
    let orderId: bigint | undefined
    let tokenNo: number | undefined

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: canteenOrdersAbi,
          data: log.data,
          topics: log.topics,
        })
        if (decoded.eventName === 'OrderPlaced') {
          orderId = (decoded.args as any).orderId as bigint
          tokenNo = Number((decoded.args as any).tokenNo)
          break
        }
      } catch {
        // Not an event from our contract or wrong topic
      }
    }

    if (orderId !== undefined) {
      await ctx.db.query(
        `update intents set status = 'placed', order_id = $1 where intent_hash = $2`,
        [orderId, row.intent_hash],
      )
    }


    return {
      ok: true,
      orderId,
      tokenNo,
      txHash: receipt.transactionHash,
      paymentRef,
      attestation,
    }
  } catch (err) {
    const errorMsg = (err as Error).message

    // Spec 6.1 failure handling: if placeOrder reverts, automatic refund through adapter
    let refunded = false
    try {
      await ctx.adapter.refund(
        row.razorpay_order_id ?? row.intent_hash,
        intent.totalPaise,
        `placeOrder revert: ${errorMsg.slice(0, 50)}`,
      )
      refunded = true
    } catch (refErr) {
      console.error(`Automatic off-chain refund failed for ${row.intent_hash}: ${(refErr as Error).message}`)
    }

    await ctx.db.query(
      `update intents set status = 'refunded', failure = $1 where intent_hash = $2`,
      [errorMsg, row.intent_hash],
    )

    return {
      ok: false,
      refunded,
      error: errorMsg,
      paymentRef,
      attestation,
    }
  }
}
