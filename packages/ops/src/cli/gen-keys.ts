// Generates every server and demo key into .env.<CANTEEN_ENV> (default .env.testnet). Prints addresses only.
// An existing file is never overwritten: keys already in it are kept, and only missing ones are appended,
// so keys holding testnet funds are never lost.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'
import { KEY_NAMES, envFile } from '../keys.ts'

const file = envFile()
const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
if (!existing) writeFileSync(file, '# CanteenPOS keys. Never commit this file. Testnet only.\n', { mode: 0o600 })
console.log(`${existing ? 'Updating' : 'Writing'} ${file}\n`)

for (const name of KEY_NAMES) {
  const found = existing.match(new RegExp(`^${name}=(0x[0-9a-fA-F]{64})\\s*$`, 'm'))
  const pk = (found?.[1] as Hex | undefined) ?? generatePrivateKey()
  if (!found) appendFileSync(file, `${name}=${pk}\n`)
  console.log(`${name.replace(/_PK$/, '').padEnd(14)} ${privateKeyToAccount(pk).address}${found ? '' : '  (new)'}`)
}
