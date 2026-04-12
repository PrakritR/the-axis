/**
 * Runs the same /api/* handlers as Vercel locally (Node HTTP + Vercel-style req/res).
 * Use with Vite proxy (see vite.config.mjs). Loads ../.env if present (does not override existing env).
 */
import http from 'http'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { URL, fileURLToPath } from 'url'
import apiHandler from '../backend/api/[route].js'

function loadEnvFile() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
  if (!existsSync(envPath)) return
  const txt = readFileSync(envPath, 'utf8')
  for (const line of txt.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvFile()

const PORT = Number(process.env.LOCAL_API_PORT || 3001, 10)

function createVercelRes(nodeRes) {
  const chain = {
    json(body) {
      if (!nodeRes.headersSent) {
        nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8')
        nodeRes.end(JSON.stringify(body))
      }
    },
    end(chunk) {
      nodeRes.end(chunk !== undefined && chunk !== null ? chunk : undefined)
    },
  }
  return {
    status(code) {
      nodeRes.statusCode = code
      return chain
    },
    setHeader(name, value) {
      nodeRes.setHeader(name, value)
    },
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(undefined)
      const ct = String(req.headers['content-type'] || '')
      if (ct.includes('application/json')) {
        try {
          return resolve(JSON.parse(raw))
        } catch {
          return resolve(undefined)
        }
      }
      resolve(raw)
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, nodeRes) => {
  try {
    const host = req.headers.host || `127.0.0.1:${PORT}`
    const url = new URL(req.url || '/', `http://${host}`)
    if (!url.pathname.startsWith('/api/')) {
      nodeRes.statusCode = 404
      nodeRes.end('Not found')
      return
    }

    let body
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await readJsonBody(req)
    }

    const vercelReq = {
      method: req.method,
      url: url.pathname + url.search,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: req.headers,
      body,
    }

    const vercelRes = createVercelRes(nodeRes)
    await apiHandler(vercelReq, vercelRes)
  } catch (err) {
    console.error('[local-api]', err)
    if (!nodeRes.headersSent) {
      nodeRes.statusCode = 500
      nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8')
      nodeRes.end(JSON.stringify({ error: err?.message || 'Internal error' }))
    }
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[local-api] http://127.0.0.1:${PORT} (proxied from Vite as /api/*)`)
})
