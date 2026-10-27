import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBackendContext, handleApiRequest } from '../packages/backend/src/index.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const staticDir = resolve(__dirname, '../packages/backend/src/static')
const publicDir = resolve(repoRoot, 'public')

let ctxPromise: ReturnType<typeof createBackendContext> | null = null
function getContext() {
  if (!ctxPromise) {
    ctxPromise = createBackendContext({ dbUrl: 'pglite:' })
  }
  return ctxPromise
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
  const rawPath = (req.headers['x-matched-path'] as string) || url.pathname
  const pathParam = url.searchParams.get('path')
  let p = pathParam ? `/api/${pathParam}` : (rawPath.startsWith('/api') ? rawPath : url.pathname)

  // Normalize path
  if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1)

  try {
    const ctx = await getContext()

    // 1. API routes
    if (p.startsWith('/api/') || p === '/api') {
      const handled = await handleApiRequest(ctx, req, res, p)
      if (handled) return
    }

    // 2. Static files fallback
    if (req.method === 'GET') {
      const serveFile = (paths: string[], mime: string) => {
        for (const filePath of paths) {
          if (existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': mime })
            res.end(readFileSync(filePath))
            return true
          }
        }
        return false
      }

      if (p === '/login' || p === '/login.html' || p === '/auth') {
        if (serveFile([resolve(publicDir, 'login.html'), resolve(staticDir, 'login.html')], 'text/html; charset=utf-8')) return
      }
      if (p === '/' || p === '/student' || p === '/index.html') {
        if (serveFile([resolve(publicDir, 'index.html'), resolve(staticDir, 'student.html')], 'text/html; charset=utf-8')) return
      }
      if (p === '/pos' || p === '/canteen' || p === '/pos.html') {
        if (serveFile([resolve(publicDir, 'pos.html'), resolve(staticDir, 'pos.html')], 'text/html; charset=utf-8')) return
      }
      if (p === '/tablet' || p === '/kitchen' || p === '/kds' || p === '/tablet.html') {
        if (serveFile([resolve(publicDir, 'tablet.html'), resolve(staticDir, 'tablet.html')], 'text/html; charset=utf-8')) return
      }
      if (p === '/setup') {
        if (serveFile([resolve(publicDir, 'setup.html'), resolve(staticDir, 'setup.html')], 'text/html; charset=utf-8')) return
      }
      if (p === '/offline-signing' || p === '/offline') {
        if (serveFile([resolve(publicDir, 'offline-signing.html'), resolve(repoRoot, 'tools/v2-offline-signing/offline-signing-check.html')], 'text/html; charset=utf-8')) return
      }
      if (p === '/styles.css') {
        if (serveFile([resolve(publicDir, 'styles.css'), resolve(staticDir, 'styles.css')], 'text/css')) return
      }
      if (p === '/noble-secp256k1.js') {
        if (serveFile([resolve(publicDir, 'noble-secp256k1.js'), resolve(staticDir, 'noble-secp256k1.js')], 'application/javascript')) return
      }
      if (p === '/jsqr.js') {
        if (serveFile([resolve(publicDir, 'jsqr.js'), resolve(staticDir, 'jsqr.js')], 'application/javascript')) return
      }
      if (p === '/qr-engine.js') {
        if (serveFile([resolve(publicDir, 'qr-engine.js'), resolve(staticDir, 'qr-engine.js')], 'application/javascript')) return
      }
      if (p === '/lucide.js') {
        if (serveFile([resolve(publicDir, 'lucide.js'), resolve(staticDir, 'lucide.js')], 'application/javascript')) return
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
