#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const contractsDir = resolve(__dirname, '..', 'contracts')

function findForge() {
  const exe = process.platform === 'win32' ? 'forge.exe' : 'forge'
  const local = join(homedir(), '.foundry', 'bin', exe)
  if (existsSync(local)) return { bin: local, isDirect: true }
  return { bin: exe, isDirect: false }
}

const args = process.argv.slice(2)
const { bin, isDirect } = findForge()
const outArtifact = join(contractsDir, 'out', 'CanteenOrders.sol', 'CanteenOrders.json')

const child = spawn(bin, args, {
  cwd: contractsDir,
  stdio: 'inherit',
  shell: !isDirect && process.platform === 'win32'
})

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    if (args[0] === 'build' && existsSync(outArtifact)) {
      console.warn('[CanteenPOS] Foundry (forge) not found; using existing precompiled artifacts in contracts/out.')
      process.exit(0)
    }
    console.error(`[CanteenPOS] Error: Foundry (forge) was not found at "${bin}" or in system PATH.`)
    console.error('[CanteenPOS] Please install Foundry from https://getfoundry.sh or ensure ~/.foundry/bin is in PATH.')
    process.exit(1)
  }
  console.error(err)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
