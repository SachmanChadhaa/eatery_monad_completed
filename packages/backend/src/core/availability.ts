// Item availability management (spec 6.1, D10, D12).
// Toggles item availability on-chain using the relayer key, making unserved orders refundable.
import { canteenOrdersAbi } from '@canteenpos/sdk'
import type { Hex } from 'viem'
import { write } from '@canteenpos/ops'
import type { BackendContext } from './context.ts'

export async function setItemAvailable(
  ctx: BackendContext,
  itemId: number,
  available: boolean,
): Promise<{ txHash: Hex; itemId: number; available: boolean }> {
  const receipt = await write(ctx.clients.relayer, {
    address: ctx.deployment.address,
    abi: canteenOrdersAbi,
    functionName: 'setItemAvailable',
    args: [itemId, available],
  })

  // Trigger indexer and check for unavailable refunds immediately
  await ctx.indexer.syncOnce().catch(() => {})

  return {
    txHash: receipt.transactionHash,
    itemId,
    available,
  }
}
