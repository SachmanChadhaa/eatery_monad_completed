// CanteenPOS Backend Server (spec section 6).
// Runs the HTTP API, serves the Student PWA, Tablet KDS, and Owner Setup portal,
// and runs the background chain indexer, keeper, and refund executor.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBackendContext, Keeper, RefundExecutor } from './core/index.ts'
import { handleApiRequest } from './api.ts'

const here = dirname(fileURLToPath(import.meta.url))
const staticDir = resolve(here, 'static')
const repoRoot = resolve(here, '../../..')
const PORT = Number(process.env.PORT || 3000)

async function main() {
  console.log(`Starting CanteenPOS backend...`)
  const ctx = await createBackendContext()

  // Start background workers
  const keeper = new Keeper(ctx)
  const refundExecutor = new RefundExecutor(ctx)

  keeper.start(30_000)
  refundExecutor.start(15_000)

  // Start indexer sync
  const stopIndexer = new AbortController()
  ctx.indexer.run(1500, stopIndexer.signal).catch((err) => {
    console.warn(`[indexer loop error] ${(err as Error).message}`)
  })

  // Static file caches
  const readStatic = (file: string) => {
    const p = resolve(staticDir, file)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  const studentHtml = readStatic('student.html') ?? ''
  const loginHtml = readStatic('login.html') ?? ''
  const posHtml = readStatic('pos.html') ?? ''
  const tabletHtml = readStatic('tablet.html') ?? ''
  const setupHtml = readStatic('setup.html') ?? ''
  const stylesCss = readStatic('styles.css') ?? ''
  const qrEngineJs = readStatic('qr-engine.js') ?? ''
  const nobleJs = readStatic('noble-secp256k1.js') ?? ''
  const jsqrJs = readStatic('jsqr.js') ?? ''
  const lucideJs = readStatic('lucide.js') ?? ''

  const offlineCheckPath = resolve(repoRoot, 'tools/v2-offline-signing/offline-signing-check.html')
  const offlineCheckHtml = existsSync(offlineCheckPath) ? readFileSync(offlineCheckPath, 'utf8') : ''

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
    const p = url.pathname

    try {
      // 1. API routes
      if (p.startsWith('/api/')) {
        const handled = await handleApiRequest(ctx, req, res, p)
        if (handled) return
      }

      // 2. Static files & Web views
      if (req.method === 'GET') {
        if (p === '/login' || p === '/login.html' || p === '/auth') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(loginHtml)
          return
        }
        if (p === '/' || p === '/student' || p === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(studentHtml)
          return
        }
        if (p === '/pos' || p === '/canteen' || p === '/pos.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(posHtml)
          return
        }
        if (p === '/tablet' || p === '/kitchen' || p === '/kds' || p === '/tablet.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(tabletHtml)
          return
        }
        if (p === '/setup') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(setupHtml)
          return
        }
        if (p === '/offline-signing' || p === '/offline') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(offlineCheckHtml)
          return
        }
        if (p === '/styles.css') {
          res.writeHead(200, { 'Content-Type': 'text/css' })
          res.end(stylesCss)
          return
        }
        if (p === '/qr-engine.js') {
          res.writeHead(200, { 'Content-Type': 'application/javascript' })
          res.end(qrEngineJs)
          return
        }
        if (p === '/noble-secp256k1.js') {
          res.writeHead(200, { 'Content-Type': 'application/javascript' })
          res.end(nobleJs)
          return
        }
        if (p === '/jsqr.js') {
          res.writeHead(200, { 'Content-Type': 'application/javascript' })
          res.end(jsqrJs)
          return
        }
        if (p === '/lucide.js') {
          res.writeHead(200, { 'Content-Type': 'application/javascript' })
          res.end(lucideJs)
          return
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    } catch (err) {
      console.error(`[server error] ${p}:`, err)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: (err as Error).message }))
    }
  })

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`)
    console.log(`  CanteenPOS Server live on port ${PORT}`)
    console.log(`  Student PWA:    http://localhost:${PORT}/`)
    console.log(`  Tablet KDS:     http://localhost:${PORT}/tablet`)
    console.log(`  Owner Setup:    http://localhost:${PORT}/setup`)
    console.log(`  Offline Sign:   http://localhost:${PORT}/offline-signing`)
    console.log(`  Health API:     http://localhost:${PORT}/api/health`)
    console.log(`========================================\n`)
  })

  const shutdown = () => {
    console.log('Shutting down server...')
    keeper.stop()
    refundExecutor.stop()
    stopIndexer.abort()
    server.close(() => {
      ctx.db.close().then(() => {
        console.log('Server gracefully stopped.')
        process.exit(0)
      })
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Fatal server startup error:', err)
    process.exit(1)
  })
}

export { main }
