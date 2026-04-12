#!/usr/bin/env node
/**
 * backfill-owner-id.mjs
 *
 * One-time migration script: stamps the canonical Owner ID field (= manager's
 * Airtable record ID) on every record in the object graph:
 *
 *   Properties         → Owner ID = linked manager's rec ID
 *   Applications       → Owner ID = property's Owner ID (matched on Property Name)
 *   Resident Profile   → Owner ID = property's Owner ID (matched on House field)
 *   Lease Drafts       → Owner ID = application's Owner ID (matched on Application Record ID)
 *   Work Orders        → Owner ID = resident's Owner ID (matched on resident email)
 *
 * Run once after adding Owner ID fields to all tables in Airtable:
 *   node scripts/backfill-owner-id.mjs [--dry-run] [--table=Properties]
 *
 * Options:
 *   --dry-run         Print what would be written without actually PATCHing anything
 *   --table=<name>    Run only for a specific table (useful for re-running partial migrations)
 *   --verbose         Print every record patch
 *
 * Prerequisites:
 *   - AIRTABLE_TOKEN env var (or .env file at repo root)
 *   - VITE_AIRTABLE_BASE_ID env var
 *   - Owner ID field must already exist in each table in Airtable
 */

import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

// ─── Config ──────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnv()

const TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPS_BASE_ID = process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || process.env.AIRTABLE_APPLICATIONS_BASE_ID || BASE_ID
const APPS_TABLE = process.env.VITE_AIRTABLE_APPLICATIONS_TABLE || process.env.AIRTABLE_APPLICATIONS_TABLE || 'Applications'

if (!TOKEN) {
  console.error('ERROR: AIRTABLE_TOKEN is not set. Add it to your .env file or environment.')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const VERBOSE = args.includes('--verbose')
const ONLY_TABLE = (args.find((a) => a.startsWith('--table=')) || '').replace('--table=', '') || null

if (DRY_RUN) console.log('🔍  DRY RUN — no Airtable records will be written.\n')

// ─── Airtable helpers ─────────────────────────────────────────────────────────

function atHeaders() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

function tableUrl(table, baseId = BASE_ID) {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`
}

async function listAll(table, baseId = BASE_ID, fields = []) {
  const records = []
  let offset = null
  do {
    const url = new URL(tableUrl(table, baseId))
    if (offset) url.searchParams.set('offset', offset)
    if (fields.length) fields.forEach((f) => url.searchParams.append('fields[]', f))
    url.searchParams.set('pageSize', '100')
    const res = await fetch(url.toString(), { headers: atHeaders() })
    if (!res.ok) throw new Error(`GET ${table}: ${await res.text()}`)
    const data = await res.json()
    for (const r of data.records || []) records.push({ id: r.id, ...r.fields })
    offset = data.offset || null
  } while (offset)
  return records
}

async function patch(table, recordId, fields, baseId = BASE_ID) {
  if (DRY_RUN) return
  const res = await fetch(`${tableUrl(table, baseId)}/${recordId}`, {
    method: 'PATCH',
    headers: atHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(`PATCH ${table}/${recordId}: ${await res.text()}`)
}

// Rate-limit: Airtable allows 5 req/s on free tier. We batch with a small delay.
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function patchBatch(table, updates, baseId = BASE_ID) {
  let patched = 0
  for (const { id, fields } of updates) {
    if (VERBOSE) console.log(`  PATCH ${table} ${id}`, fields)
    await patch(table, id, fields, baseId)
    patched++
    if (patched % 5 === 0) await sleep(220) // stay under 5 req/s
  }
  return patched
}

// ─── Step 1: Properties ───────────────────────────────────────────────────────

async function backfillProperties(managers) {
  console.log('\n📋  Properties → Owner ID')

  // Build lookup: manager email → rec ID, manager ID → rec ID
  const byEmail = new Map()
  const byManagerId = new Map()
  for (const m of managers) {
    const email = String(m.Email || '').trim().toLowerCase()
    if (email) byEmail.set(email, m.id)
    const mid = String(m['Manager ID'] || '').trim().toUpperCase()
    if (mid) byManagerId.set(mid, m.id)
  }

  const properties = await listAll('Properties')
  console.log(`  Found ${properties.length} properties`)

  const updates = []
  for (const p of properties) {
    if (String(p['Owner ID'] || '').trim()) continue // already set

    let ownerId = ''

    // Try linked Manager Profile record IDs
    for (const field of ['Manager Profile', 'Manager', 'Site Manager', 'Property Manager']) {
      const links = Array.isArray(p[field]) ? p[field] : (typeof p[field] === 'string' && p[field].startsWith('rec') ? [p[field]] : [])
      if (links.length) { ownerId = links[0]; break }
    }

    // Try email match
    if (!ownerId) {
      for (const field of ['Manager Email', 'Site Manager Email']) {
        const email = String(p[field] || '').trim().toLowerCase()
        if (email && byEmail.has(email)) { ownerId = byEmail.get(email); break }
      }
    }

    // Try Manager ID text match
    if (!ownerId) {
      const mid = String(p['Manager ID'] || '').trim().toUpperCase()
      if (mid && byManagerId.has(mid)) ownerId = byManagerId.get(mid)
    }

    if (ownerId) {
      updates.push({ id: p.id, fields: { 'Owner ID': ownerId } })
      if (VERBOSE) console.log(`  → ${p.Name || p.id}: Owner ID = ${ownerId}`)
    } else {
      console.warn(`  ⚠️  No manager found for property: ${p.Name || p.id}`)
    }
  }

  const patched = await patchBatch('Properties', updates)
  console.log(`  ✓ ${patched} properties updated (${updates.length - patched} skipped / already set)`)

  // Return map: property name → owner ID
  const nameToOwner = new Map()
  for (const p of properties) {
    const name = String(p['Property Name'] || p.Name || p.Property || '').trim()
    const ownerId = String(p['Owner ID'] || '').trim()
      || updates.find((u) => u.id === p.id)?.fields?.['Owner ID']
      || ''
    if (name && ownerId) nameToOwner.set(name.toLowerCase(), ownerId)
  }
  return nameToOwner
}

// ─── Step 2: Applications ─────────────────────────────────────────────────────

async function backfillApplications(propertyNameToOwner) {
  console.log('\n📋  Applications → Owner ID')
  const apps = await listAll(APPS_TABLE, APPS_BASE_ID)
  console.log(`  Found ${apps.length} applications`)

  const updates = []
  for (const app of apps) {
    if (String(app['Owner ID'] || '').trim()) continue

    const pName = String(app['Property Name'] || '').trim().toLowerCase()
    const ownerId = propertyNameToOwner.get(pName) || ''
    if (ownerId) {
      updates.push({ id: app.id, fields: { 'Owner ID': ownerId } })
    } else if (pName) {
      console.warn(`  ⚠️  No owner found for application property: "${pName}"`)
    }
  }

  const patched = await patchBatch(APPS_TABLE, updates, APPS_BASE_ID)
  console.log(`  ✓ ${patched} applications updated`)

  // Return map: application rec ID → owner ID
  const idToOwner = new Map()
  for (const app of apps) {
    const ownerId = String(app['Owner ID'] || '').trim()
      || updates.find((u) => u.id === app.id)?.fields?.['Owner ID']
      || ''
    if (ownerId) idToOwner.set(app.id, ownerId)
  }
  return idToOwner
}

// ─── Step 3: Resident Profile ─────────────────────────────────────────────────

async function backfillResidents(propertyNameToOwner) {
  console.log('\n📋  Resident Profile → Owner ID')
  const residents = await listAll('Resident Profile')
  console.log(`  Found ${residents.length} residents`)

  const updates = []
  for (const r of residents) {
    if (String(r['Owner ID'] || '').trim()) continue

    const house = String(r.House || r['Property Name'] || '').trim().toLowerCase()
    const ownerId = propertyNameToOwner.get(house) || ''
    if (ownerId) {
      updates.push({ id: r.id, fields: { 'Owner ID': ownerId } })
    } else if (house) {
      console.warn(`  ⚠️  No owner found for resident house: "${house}"`)
    }
  }

  const patched = await patchBatch('Resident Profile', updates)
  console.log(`  ✓ ${patched} residents updated`)

  // Return map: email → owner ID (for work orders)
  const emailToOwner = new Map()
  for (const r of residents) {
    const email = String(r.Email || '').trim().toLowerCase()
    const ownerId = String(r['Owner ID'] || '').trim()
      || updates.find((u) => u.id === r.id)?.fields?.['Owner ID']
      || ''
    if (email && ownerId) emailToOwner.set(email, ownerId)
  }
  return emailToOwner
}

// ─── Step 4: Lease Drafts ─────────────────────────────────────────────────────

async function backfillLeaseDrafts(appIdToOwner) {
  console.log('\n📋  Lease Drafts → Owner ID')
  const drafts = await listAll('Lease Drafts')
  console.log(`  Found ${drafts.length} lease drafts`)

  const updates = []
  for (const d of drafts) {
    if (String(d['Owner ID'] || '').trim()) continue

    const appId = String(d['Application Record ID'] || '').trim()
    const ownerId = (appId && appIdToOwner.get(appId)) || ''
    if (ownerId) {
      updates.push({ id: d.id, fields: { 'Owner ID': ownerId } })
    } else if (appId) {
      console.warn(`  ⚠️  No owner found for lease draft (app: ${appId})`)
    }
  }

  const patched = await patchBatch('Lease Drafts', updates)
  console.log(`  ✓ ${patched} lease drafts updated`)
}

// ─── Step 5: Work Orders ──────────────────────────────────────────────────────

async function backfillWorkOrders(emailToOwner) {
  console.log('\n📋  Work Orders → Owner ID')
  let workOrders = []
  try {
    workOrders = await listAll('Work Orders')
  } catch {
    console.log('  ⚠️  Work Orders table not found or inaccessible — skipping.')
    return
  }
  console.log(`  Found ${workOrders.length} work orders`)

  const updates = []
  for (const w of workOrders) {
    if (String(w['Owner ID'] || '').trim()) continue

    const email = String(w['Resident Email'] || w.Email || w['Submitter Email'] || '').trim().toLowerCase()
    const ownerId = (email && emailToOwner.get(email)) || ''
    if (ownerId) {
      updates.push({ id: w.id, fields: { 'Owner ID': ownerId } })
    }
  }

  const patched = await patchBatch('Work Orders', updates)
  console.log(`  ✓ ${patched} work orders updated`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔐  Axis Owner ID Back-fill Migration')
  console.log(`    Base: ${BASE_ID}`)
  if (ONLY_TABLE) console.log(`    Scope: ${ONLY_TABLE} only`)
  console.log()

  // Always load managers — they are needed as the source of truth for Owner IDs
  console.log('👥  Loading Manager Profile records…')
  const managers = await listAll('Manager Profile')
  console.log(`    Found ${managers.length} managers`)

  const run = (name) => !ONLY_TABLE || ONLY_TABLE.toLowerCase() === name.toLowerCase()

  let propertyNameToOwner = new Map()
  let appIdToOwner = new Map()
  let emailToOwner = new Map()

  if (run('Properties') || run('Applications') || run('Resident Profile') || run('Lease Drafts') || run('Work Orders') || !ONLY_TABLE) {
    propertyNameToOwner = await backfillProperties(managers)
  }
  if (run('Applications') || run('Lease Drafts') || !ONLY_TABLE) {
    appIdToOwner = await backfillApplications(propertyNameToOwner)
  }
  if (run('Resident Profile') || run('Work Orders') || !ONLY_TABLE) {
    emailToOwner = await backfillResidents(propertyNameToOwner)
  }
  if (run('Lease Drafts') || !ONLY_TABLE) {
    await backfillLeaseDrafts(appIdToOwner)
  }
  if (run('Work Orders') || !ONLY_TABLE) {
    await backfillWorkOrders(emailToOwner)
  }

  console.log('\n✅  Migration complete.')
  if (DRY_RUN) console.log('    (dry run — no records were written)')
}

main().catch((err) => {
  console.error('\n❌  Migration failed:', err.message || err)
  process.exit(1)
})
