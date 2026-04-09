/**
 * Starts local API (port 3001) and Vite dev server together.
 * This is the default `npm run dev` — /api/* is proxied to match production.
 * Use `npm run dev:vite` for frontend-only (no local API).
 */
import { spawn } from 'child_process'
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

console.log('[dev] Local API → http://127.0.0.1:3001  ·  Vite → http://localhost:5173  (/api proxied)\n')

const api = spawn('node', ['scripts/local-api-server.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
})

const vite = spawn(viteBin, [], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
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
