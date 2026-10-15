import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBackendContext, handleApiRequest } from '../packages/backend/src/index.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const staticDir = resolve(__dirname, '../packages/backend/src/static')
const repoRoot = resolve(__dirname, '..')

let ctxPromise: ReturnType<typeof createBackendContext> | null = null
function getContext() {
  if (!ctxPromise) {
    ctxPromise = createBackendContext({ dbUrl: 'pglite:' })
  }
  return ctxPromise
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
  const p = url.pathname

  try {
    const ctx = await getContext()

    // 1. API routes
    if (p.startsWith('/api/')) {
      const handled = await handleApiRequest(ctx, req, res, p)
      if (handled) return
    }

    // 2. Static files
    if (req.method === 'GET') {
      const serveFile = (path: string, mime: string) => {
        if (existsSync(path)) {
          res.writeHead(200, { 'Content-Type': mime })
          res.end(readFileSync(path))
          return true
        }
        return false
      }

      if (p === '/' || p === '/student' || p === '/index.html') {
        if (serveFile(resolve(staticDir, 'student.html'), 'text/html; charset=utf-8')) return
      }
      if (p === '/tablet') {
        if (serveFile(resolve(staticDir, 'tablet.html'), 'text/html; charset=utf-8')) return
      }
      if (p === '/setup') {
        if (serveFile(resolve(staticDir, 'setup.html'), 'text/html; charset=utf-8')) return
      }
      if (p === '/offline-signing' || p === '/offline') {
        const offPath = resolve(repoRoot, 'tools/v2-offline-signing/offline-signing-check.html')
        if (serveFile(offPath, 'text/html; charset=utf-8')) return
      }
      if (p === '/styles.css') {
        if (serveFile(resolve(staticDir, 'styles.css'), 'text/css')) return
      }
      if (p === '/noble-secp256k1.js') {
        if (serveFile(resolve(staticDir, 'noble-secp256k1.js'), 'application/javascript')) return
      }
      if (p === '/qr-engine.js') {
        if (serveFile(resolve(staticDir, 'qr-engine.js'), 'application/javascript')) return
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  } catch (err) {
    console.error('Serverless error:', err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: (err as Error).message }))
  }
}
