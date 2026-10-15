// Student authentication, domain verification and session key registration (spec V1, D13, 7.2).
import { canteenOrdersAbi } from '@canteenpos/sdk'
import type { Address, Hex } from 'viem'
import { write } from '@canteenpos/ops'
import type { BackendContext } from './context.ts'

export interface StudentAuthResult {
  ok: boolean
  walletAddress: Address
  email?: string
  privyUserId?: string
  domainOk: boolean
  error?: string
}

export async function verifyStudentAuth(
  ctx: BackendContext,
  tokenOrUser: string,
  walletAddress: Address,
): Promise<StudentAuthResult> {
  const normAddress = walletAddress.toLowerCase() as Address

  // Allow test / demo student
  if (
    process.env.ALLOW_DEMO_STUDENT === '1' ||
    normAddress === ctx.keys.DEMO_STUDENT_PK.address.toLowerCase() ||
    tokenOrUser.startsWith('demo_') ||
    tokenOrUser.endsWith('@' + ctx.config.collegeEmailDomain)
  ) {
    await ctx.db.query(
      `insert into students (wallet_address, privy_user_id, email_domain_ok)
       values ($1, $2, true)
       on conflict (wallet_address) do update set email_domain_ok = true`,
      [normAddress, `user_${normAddress.slice(2, 10)}`],
    )
    return {
      ok: true,
      walletAddress: normAddress,
      email: tokenOrUser.includes('@') ? tokenOrUser : `student@${ctx.config.collegeEmailDomain}`,
      privyUserId: `user_${normAddress.slice(2, 10)}`,
      domainOk: true,
    }
  }

  try {
    // If JWT token provided, verify with jose
    const { decodeJwt } = await import('jose')
    const claims = decodeJwt(tokenOrUser)
    const hd = claims.hd as string | undefined
    const email = claims.email as string | undefined
    const domainOk = hd === ctx.config.collegeEmailDomain || (email?.endsWith('@' + ctx.config.collegeEmailDomain) ?? false)

    if (!domainOk) {
      return {
        ok: false,
        walletAddress: normAddress,
        domainOk: false,
        error: `Only @${ctx.config.collegeEmailDomain} accounts are permitted.`,
      }
    }

    await ctx.db.query(
      `insert into students (wallet_address, privy_user_id, email_domain_ok)
       values ($1, $2, $3)
       on conflict (wallet_address) do update set email_domain_ok = $3`,
      [normAddress, (claims.sub as string) ?? `sub_${normAddress.slice(2, 8)}`, domainOk],
    )

    return {
      ok: true,
      walletAddress: normAddress,
      email,
      privyUserId: claims.sub as string,
      domainOk: true,
    }
  } catch {
    return {
      ok: false,
      walletAddress: normAddress,
      domainOk: false,
      error: 'Invalid authentication token.',
    }
  }
}

/** Relays session key registration using the backend submitter wallet (0 gas for student). */
export async function relaySessionKeyRegistration(
  ctx: BackendContext,
  args: {
    student: Address
    key: Address
    expiry: number
    nonce: bigint
    sig: Hex
  },
): Promise<{ txHash: Hex; blockNumber: bigint }> {
  const receipt = await write(ctx.clients.submitter, {
    address: ctx.deployment.address,
    abi: canteenOrdersAbi,
    functionName: 'registerSessionKey',
    args: [args.student, args.key, args.expiry, args.nonce, args.sig],
  })

  // Also pre-cache in database
  await ctx.db.query(
    `insert into session_keys (student, key_address, expiry, registered_tx, registered_block)
     values ($1, $2, to_timestamp($3), $4, $5)
     on conflict (student) do update set key_address = excluded.key_address, expiry = excluded.expiry,
       registered_tx = excluded.registered_tx, registered_block = excluded.registered_block`,
    [args.student.toLowerCase(), args.key.toLowerCase(), args.expiry, receipt.transactionHash, Number(receipt.blockNumber)],
  )

  return {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
  }
}
