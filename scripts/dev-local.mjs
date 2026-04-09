/**
 * Vite + local API together (forms, tour, manager APIs work locally).
 * Default `npm run dev` is Vite only — use `npm run dev:full` when you need /api on localhost.
 */
import { spawn } from 'child_process'
import net from 'net'
import { fileURLToPath } from 'url'
import path from 'path'
import { existsSync } from 'fs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const viteBin = path.join(root, 'node_modules', '.bin', `vite${isWin ? '.cmd' : ''}`)

if (!existsSync(viteBin)) {
  console.error('Run npm install in the-axis first.')
  process.exit(1)
}

const envFile = path.join(root, '.env')
if (!existsSync(envFile)) {
  console.warn('No .env found — copy .env.example to .env for API keys and integrations.')
}

/** @param {number} startPort */
function findFreePort(startPort) {
  const maxAttempts = 50
  return new Promise((resolve, reject) => {
    const tryListen = (port, attemptsLeft) => {
      if (attemptsLeft <= 0) {
        reject(new Error(`No free TCP port found starting at ${startPort}`))
        return
      }
      const server = net.createServer()
      server.unref()
      server.once('error', (err) => {
        server.close()
        if (err.code === 'EADDRINUSE') tryListen(port + 1, attemptsLeft - 1)
        else reject(err)
      })
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address()
        const p = typeof addr === 'object' && addr ? addr.port : port
        server.close(() => resolve(p))
      })
    }
    tryListen(startPort, maxAttempts)
  })
}

const preferredApiPort = Number(process.env.LOCAL_API_PORT || 3001, 10) || 3001

const apiPort = await findFreePort(preferredApiPort)
if (apiPort !== preferredApiPort) {
  console.warn(`[dev] Port ${preferredApiPort} busy — using API port ${apiPort} (proxy updated).\n`)
}

const childEnv = { ...process.env, LOCAL_API_PORT: String(apiPort) }

console.log(
  `[dev] Local API → http://127.0.0.1:${apiPort}  ·  Site → http://localhost:5174  (/api proxied)\n`
)

const api = spawn('node', ['scripts/local-api-server.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: childEnv,
})

const vite = spawn(viteBin, [], {
  cwd: root,
  stdio: 'inherit',
  env: childEnv,
})

function shutdown(signal) {
  api.kill(signal)
  vite.kill(signal)
}

process.on('SIGINT', () => {
  shutdown('SIGINT')
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdown('SIGTERM')
  process.exit(0)
})

api.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    vite.kill('SIGTERM')
    process.exit(code)
  }
})
vite.on('exit', (code) => {
  api.kill('SIGTERM')
  process.exit(code ?? 0)
})
