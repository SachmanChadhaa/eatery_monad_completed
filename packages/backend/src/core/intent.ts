// Order intent validation and capacity reservation (spec 6.1, R1, D5, D6, D7).
import {
  canteenTypes,
  dayId,
  hashLines,
  intentStructHash,
  type Line,
  type OrderIntent,
  preorderCap,
  secondOfDay,
  totalPaise,
} from '@canteenpos/sdk'
import type { Address, Hex } from 'viem'
import { recoverTypedDataAddress } from 'viem'
import type { BackendContext } from './context.ts'

export interface CreateIntentInput {
  intent: {
    student: Address
    slotId: number
    linesHash: Hex
    totalPaise: number
    nonce: string | bigint
    deadline: number
  }
  lines: Line[]
  studentSig: Hex
  authToken?: string
}

export interface IntentResult {
  intentHash: Hex
  chargeRef: string
  totalPaise: number
  reservedUntil: string
  slotId: number
}

export async function createAndReserveIntent(
  ctx: BackendContext,
  input: CreateIntentInput,
): Promise<IntentResult> {
  const intent: OrderIntent = {
    student: input.intent.student,
    slotId: input.intent.slotId,
    linesHash: input.intent.linesHash,
    totalPaise: Number(input.intent.totalPaise),
    nonce: BigInt(input.intent.nonce),
    deadline: Number(input.intent.deadline),
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const today = dayId(nowSec)
  const sod = secondOfDay(nowSec)

  // 1. Time window check (07:00 to 08:58 IST), unless off-hours allowed for testing/demo
  const allowOffHours = process.env.ALLOW_OFF_HOURS === '1' || process.env.NODE_ENV === 'test'
  if (!allowOffHours) {
    if (sod < ctx.config.orderWindow.openSec || sod >= ctx.config.orderWindow.cutoffSec - 120) {
      throw new Error('Order window is 07:00 - 08:58 IST.')
    }
  }

  // 2. Deadline check
  if (nowSec > intent.deadline) {
    throw new Error('Intent deadline expired.')
  }

  // 3. Lines validation
  if (!input.lines || input.lines.length === 0 || input.lines.length > 4) {
    throw new Error('Cart must have between 1 and 4 lines.')
  }

  const expectedLinesHash = hashLines(input.lines)
  if (intent.linesHash.toLowerCase() !== expectedLinesHash.toLowerCase()) {
    throw new Error('linesHash mismatch.')
  }

  let calculatedTotal = 0
  let portions = 0
  for (const l of input.lines) {
    if (l.qty <= 0 || l.qty > 10) throw new Error('Quantity must be between 1 and 10 per item.')
    const itemCfg = ctx.config.items.find((it) => it.id === l.itemId)
    if (!itemCfg) throw new Error(`Unknown item ${l.itemId}.`)
    if (l.unitPricePaise !== itemCfg.pricePaise) {
      throw new Error(`Item ${l.itemId} price changed: expected ${itemCfg.pricePaise}, got ${l.unitPricePaise}.`)
    }
    calculatedTotal += l.unitPricePaise * l.qty
    portions += l.qty
  }

  if (calculatedTotal !== intent.totalPaise) {
    throw new Error(`Total price mismatch: calculated ${calculatedTotal}, intent has ${intent.totalPaise}.`)
  }

  // 4. Student session key verification
  const iHash = intentStructHash(intent)
  const recoveredKey = await recoverTypedDataAddress({
    domain: ctx.domain,
    types: canteenTypes,
    primaryType: 'OrderIntent',
    message: intent,
    signature: input.studentSig,
  })

  // Look up registered session key from database or chain
  const keyRow = await ctx.db.query(
    `select key_address, expiry from session_keys where student = $1`,
    [intent.student.toLowerCase()],
  )

  if (keyRow.rows.length === 0) {
    // If not in database cache, check contract sessionKeys
    const [contractKey, contractExpiry] = (await ctx.clients.submitter.pub.readContract({
      address: ctx.deployment.address,
      abi: [
        {
          type: 'function',
          name: 'sessionKeys',
          inputs: [{ name: '', type: 'address' }],
          outputs: [
            { name: 'key', type: 'address' },
            { name: 'expiry', type: 'uint48' },
          ],
          stateMutability: 'view',
        },
      ],
      functionName: 'sessionKeys',
      args: [intent.student],
    })) as [Address, number]

    if (
      !contractKey ||
      contractKey === '0x0000000000000000000000000000000000000000' ||
      recoveredKey.toLowerCase() !== contractKey.toLowerCase()
    ) {
      throw new Error(`Signature does not match registered session key.`)
    }
    if (nowSec > Number(contractExpiry)) {
      throw new Error('Session key expired.')
    }
  } else {
    const k = keyRow.rows[0]
    if (k.key_address.toLowerCase() !== recoveredKey.toLowerCase()) {
      throw new Error(`Signature recovered ${recoveredKey}, but registered key is ${k.key_address}.`)
    }
    if (new Date(k.expiry).getTime() < Date.now()) {
      throw new Error('Registered session key has expired.')
    }
  }

  // 5. Nonce check
  const nonceUsed = await ctx.db.query(
    `select 1 from intents where student = $1 and (intent_json->>'nonce')::numeric = $2 and status in ('reserved', 'paid', 'placed')`,
    [intent.student.toLowerCase(), intent.nonce.toString()],
  )
  if (nonceUsed.rows.length > 0) {
    throw new Error('Intent nonce already used.')
  }

  // 6. Capacity reservation check
  const cap = preorderCap(ctx.config.slotCapacity)
  const usedRes = await ctx.db.query(
    `select coalesce(sum(portions), 0) as reserved_portions
     from intents
     where day_id = $1 and slot_id = $2
       and (status in ('paid', 'placed') or (status = 'reserved' and reserved_until > now()))`,
    [today, intent.slotId],
  )
  const currentlyReserved = Number(usedRes.rows[0]?.reserved_portions ?? 0)
  if (currentlyReserved + portions > cap) {
    throw new Error(`Slot ${intent.slotId} capacity full (cap: ${cap}, requested: ${portions}, currently booked: ${currentlyReserved}).`)
  }

  // 7. Create charge via adapter
  const chargeRef = await ctx.adapter.createCharge({
    intentHash: iHash,
    student: intent.student,
    totalPaise: intent.totalPaise,
  })

  const reservedUntil = new Date(Date.now() + 5 * 60 * 1000)

  // 8. Store intent in Postgres
  await ctx.db.query(
    `insert into intents (
       intent_hash, student, day_id, slot_id, portions, lines_json, total_paise,
       intent_json, student_sig, razorpay_order_id, status, reserved_until
     ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, 'reserved', $11)
     on conflict (intent_hash) do update set
       status = 'reserved', reserved_until = excluded.reserved_until, razorpay_order_id = excluded.razorpay_order_id`,
    [
      iHash,
      intent.student.toLowerCase(),
      today,
      intent.slotId,
      portions,
      JSON.stringify(input.lines),
      intent.totalPaise,
      JSON.stringify({
        ...intent,
        nonce: intent.nonce.toString(),
      }),
      input.studentSig,
      chargeRef,
      reservedUntil.toISOString(),
    ],
  )

  return {
    intentHash: iHash,
    chargeRef,
    totalPaise: intent.totalPaise,
    reservedUntil: reservedUntil.toISOString(),
    slotId: intent.slotId,
  }
}
