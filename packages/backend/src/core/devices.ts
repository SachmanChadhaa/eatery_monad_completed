// Tablet device authorization and revocation (spec 5.3, D11).
import { canteenOrdersAbi } from '@canteenpos/sdk'
import type { Address, Hex } from 'viem'
import { transfer, write } from '@canteenpos/ops'
import type { BackendContext } from './context.ts'

export async function authorizeDevice(
  ctx: BackendContext,
  deviceAddress: Address,
  fundGas = true,
): Promise<{ txHash: Hex; deviceAddress: Address; fundedTx?: Hex }> {
  const receipt = await write(ctx.clients.owner, {
    address: ctx.deployment.address,
    abi: canteenOrdersAbi,
    functionName: 'authorizeDevice',
    args: [deviceAddress],
  })

  let fundedTx: Hex | undefined
  if (fundGas) {
    try {
      // Send 0.1 MON to device for gas
      const fundReceipt = await transfer(ctx.clients.owner, deviceAddress, 100_000_000_000_000_000n)
      fundedTx = fundReceipt.transactionHash
    } catch {
      // Ignored if owner balance is low or on anvil
    }
  }

  await ctx.indexer.syncOnce().catch(() => {})

  return {
    txHash: receipt.transactionHash,
    deviceAddress,
    fundedTx,
  }
}

export async function revokeDevice(
  ctx: BackendContext,
  deviceAddress: Address,
): Promise<{ txHash: Hex; deviceAddress: Address }> {
  const receipt = await write(ctx.clients.owner, {
    address: ctx.deployment.address,
    abi: canteenOrdersAbi,
    functionName: 'revokeDevice',
    args: [deviceAddress],
  })

  await ctx.indexer.syncOnce().catch(() => {})

  return {
    txHash: receipt.transactionHash,
    deviceAddress,
  }
}
