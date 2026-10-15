// Shared backend context: database, viem clients, keys, contracts, and payment adapter.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  canteenConfig,
  canteenDomain,
  canteenOrdersAbi,
  cinrAbi,
  monadTestnet,
} from '@canteenpos/sdk'
import type { Deployment, KeyName } from '@canteenpos/ops'
import { clientsFor, loadKeys, repoRoot, targetChain } from '@canteenpos/ops'
import { type Db, Indexer, migrate, openDb } from '@canteenpos/indexer'
import type { Chain, PrivateKeyAccount, TypedDataDomain } from 'viem'
import { foundry } from 'viem/chains'
import { DemoAdapter, type PaymentAdapter, RazorpayAdapter } from '../adapters/index.ts'

export interface BackendContext {
  db: Db
  chain: Chain
  domain: TypedDataDomain
  deployment: Deployment
  keys: Record<KeyName, PrivateKeyAccount>
  clients: {
    owner: ReturnType<typeof clientsFor>
    submitter: ReturnType<typeof clientsFor>
    attester: ReturnType<typeof clientsFor>
    refunder: ReturnType<typeof clientsFor>
    relayer: ReturnType<typeof clientsFor>
    vault: ReturnType<typeof clientsFor>
  }
  adapter: PaymentAdapter
  indexer: Indexer
  config: typeof canteenConfig
}

export async function createBackendContext(opts?: {
  dbUrl?: string
  adapter?: 'demo' | 'razorpay'
  deploymentPath?: string
}): Promise<BackendContext> {
  const chain = targetChain()
  const isVercel = !!process.env.VERCEL || process.env.NOW_REGION !== undefined
  const defaultPgUrl = 'postgres://canteen:canteen@127.0.0.1:5433/canteen'
  const fallbackDir = resolve(repoRoot, '.data', 'pglite')
  const defaultFallbackUrl = process.env.TEST === '1' || isVercel ? 'pglite:' : `pglite:${fallbackDir}`

  const dbUrl = opts?.dbUrl ?? (isVercel ? 'pglite:' : (process.env.DATABASE_URL ?? defaultPgUrl))

  let db: Db
  try {
    db = await openDb(dbUrl)
    await migrate(db)
  } catch (err) {
    if (db!) {
      await db.close().catch(() => {})
    }
    console.warn(`[CanteenPOS] Could not connect to database (${dbUrl}): ${(err as Error).message}`)
    console.warn(`[CanteenPOS] Automatically falling back to embedded database (${defaultFallbackUrl}) - no Docker required.`)
    db = await openDb(defaultFallbackUrl)
    await migrate(db)
  }

  // Load keys
  const keys = loadKeys()

  // Load deployment
  const depPath =
    opts?.deploymentPath ??
    process.env.DEPLOYMENT ??
    resolve(repoRoot, 'deployments', `${chain.id}.json`)

  let deployment: Deployment
  if (existsSync(depPath)) {
    deployment = JSON.parse(readFileSync(depPath, 'utf8'))
  } else {
    // Fallback deployment for testing
    deployment = {
      chainId: chain.id,
      address: '0x83edd38e28e43c608c0d30b60a03adac1eacbc33',
      deployBlock: 0,
      txHash: '0x0',
      deployer: keys.OWNER_PK.address,
      openSec: canteenConfig.orderWindow.openSec,
      cutoffSec: canteenConfig.orderWindow.cutoffSec,
      roles: {
        attester: keys.ATTESTER_PK.address,
        refunder: keys.REFUNDER_PK.address,
        relayer: keys.RELAYER_PK.address,
      },
      deployedAt: new Date().toISOString(),
    }
  }

  const domain = canteenDomain(chain.id, deployment.address)

  const clients = {
    owner: clientsFor(keys.OWNER_PK, chain),
    submitter: clientsFor(keys.SUBMITTER_PK, chain),
    attester: clientsFor(keys.ATTESTER_PK, chain),
    refunder: clientsFor(keys.REFUNDER_PK, chain),
    relayer: clientsFor(keys.RELAYER_PK, chain),
    vault: clientsFor(keys.VAULT_PK, chain),
  }

  const adapter =
    opts?.adapter === 'razorpay' || process.env.PAYMENT_ADAPTER === 'razorpay'
      ? new RazorpayAdapter()
      : new DemoAdapter()

  const indexer = new Indexer(db, clients.submitter.pub, {
    chainId: chain.id,
    address: deployment.address,
    deployBlock: deployment.deployBlock,
    confirmations: chain.id === foundry.id ? 0 : Number(process.env.CONFIRMATIONS ?? 2),
    log: (m) => {
      if (process.env.NODE_ENV !== 'test') console.log(`[indexer] ${m}`)
    },
  })

  try {
    await indexer.init()
  } catch (e) {
    console.warn(`[indexer init warning] ${(e as Error).message}`)
  }

  return {
    db,
    chain,
    domain,
    deployment,
    keys,
    clients,
    adapter,
    indexer,
    config: canteenConfig,
  }
}
