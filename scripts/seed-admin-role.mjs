#!/usr/bin/env node
/**
 * One-time (or repeatable) seed: assign internal `admin` role for an app_users row.
 *
 * Prereq: that user has signed in at least once so POST /api/sync-app-user created app_users.
 *
 * Usage:
 *   ADMIN_SEED_EMAIL=you@company.com node scripts/seed-admin-role.mjs
 *
 * Loads ../.env if present (does not override existing process.env).
 */
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { assignRoleByEmail } from '../backend/server/lib/app-user-roles-service.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnvFile() {
  const envPath = join(__dirname, '..', '.env')
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

const email = String(process.env.ADMIN_SEED_EMAIL || '').trim().toLowerCase()
if (!email || !email.includes('@')) {
  console.error('Set ADMIN_SEED_EMAIL to the app_users.email for your real account (e.g. you@company.com).')
  process.exit(1)
}

try {
  const row = await assignRoleByEmail({ email, role: 'admin', isPrimary: true })
  console.log('OK — admin role assigned (upserted).')
  console.log(JSON.stringify(row, null, 2))
} catch (e) {
  console.error(e?.message || e)
  process.exit(1)
}
