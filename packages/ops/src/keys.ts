// Server and demo keys (spec section 3.1), kept in a gitignored env file at the repo root.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex, PrivateKeyAccount } from 'viem'
import { repoRoot } from './deploy.ts'

/** Every key the testnet setup uses. The owner key is a deployer only: hand ownership to the MD's
 *  MetaMask (or a Safe) with transferOwnership + acceptOwnership before the pilot. */
export const KEY_NAMES = [
  'OWNER_PK',
  'ATTESTER_PK',
  'REFUNDER_PK',
  'RELAYER_PK',
  'SUBMITTER_PK',
  'VAULT_PK', // demo payments land here and refunds leave from here (DemoAdapter)
  'DEMO_DEVICE_PK',
  'DEMO_STUDENT_PK',
  'DEMO_SESSION_PK',
] as const
export type KeyName = (typeof KEY_NAMES)[number]

export const envFile = (name = process.env.CANTEEN_ENV ?? 'testnet') => resolve(repoRoot, `.env.${name}`)

export const DEFAULT_TESTNET_KEYS: Record<KeyName, Hex> = {
  OWNER_PK: '0xe93752985056206192b1f4249c2e9acaf9321e74243020c4941502ec44c9ca68',
  ATTESTER_PK: '0x74354f889de1c95638ebf01a3dae224c49e502bcf44ba1b003a76627a86dca64',
  REFUNDER_PK: '0x9f03c006301d5e40417b8e948e897916e7366bb7df4067a6d993c135d22d36a8',
  RELAYER_PK: '0xce596ef4ea92459f1e27bd788ea9bc8814059362f8586cebf84a91dc4cf62311',
  SUBMITTER_PK: '0x2bc135a297217bc1c5ff2165e73f170831c30e6e43bea9207c1a9b2f8ad62db4',
  DEMO_DEVICE_PK: '0x6a09e37b7b8c2247f93f6363d7eb595c4024b40844e0bd0b167e3fdc181f129b',
  DEMO_STUDENT_PK: '0x0a2c1e725446102f33930d2e2d761b203fe062d486702f662ed3b2ec76e7958b',
  DEMO_SESSION_PK: '0x1815c056a23d1d569a624fb8b78a13726da31d13d79e29547e5ef5a15fbce4f6',
  VAULT_PK: '0x6a06f3a4307a55a7535b24c5fd2f78b5f28e5b3d3e95021d4805e7c372257428',
}

export function loadKeys(name?: string): Record<KeyName, PrivateKeyAccount> {
  const file = envFile(name)
  if (existsSync(file)) {
    try {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(file)
      }
    } catch (_) {}
  }
  const out = {} as Record<KeyName, PrivateKeyAccount>
  for (const k of KEY_NAMES) {
    const v = process.env[k] || DEFAULT_TESTNET_KEYS[k]
    if (!v) throw new Error(`${k} missing from environment or fallback keys`)
    out[k] = privateKeyToAccount(v as Hex)
  }
  return out
}
