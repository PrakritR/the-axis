#!/usr/bin/env node
/**
 * Backfill paid "Application fee" Payments rows for approved residents (e.g. Arnav, Fathima).
 *
 * Usage (from repo `the-axis/`):
 *   node scripts/backfill-application-fee-payments.mjs --names "Arnav,Fathima"
 *   node scripts/backfill-application-fee-payments.mjs --resident recXXXX,recYYYY
 *
 * Requires .env with AIRTABLE_TOKEN / VITE_AIRTABLE_TOKEN and base id vars (same as local API).
 */
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createApprovedApplicationFeePayments } from '../backend/server/lib/approved-application-fee-payment.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env')
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

const TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPS_BASE_ID =
  process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID ||
  process.env.AIRTABLE_APPLICATIONS_BASE_ID ||
  CORE_BASE_ID
const APPLICATIONS_TABLE =
  process.env.VITE_AIRTABLE_APPLICATIONS_TABLE ||
  process.env.AIRTABLE_APPLICATIONS_TABLE ||
  'Applications'
const RESIDENT_TABLE = 'Resident Profile'

const CORE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`
const APPS_URL = `https://api.airtable.com/v0/${APPS_BASE_ID}`

function headers() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

async function get(url) {
  const r = await fetch(url, { headers: headers() })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

function mapRecord(record) {
  return { id: record.id, ...record.fields }
}

function parseArgs() {
  const argv = process.argv.slice(2)
  let names = ''
  let residents = ''
  for (const a of argv) {
    if (a.startsWith('--names=')) names = a.slice('--names='.length)
    if (a.startsWith('--resident=')) residents = a.slice('--resident='.length)
  }
  return {
    nameTokens: names
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    residentIds: residents
      .split(',')
      .map((s) => s.trim())
      .filter((id) => id.startsWith('rec')),
  }
}

async function fetchApplication(appRecId) {
  const enc = encodeURIComponent(APPLICATIONS_TABLE)
  const data = await get(`${APPS_URL}/${enc}/${encodeURIComponent(appRecId)}`)
  return mapRecord(data)
}

async function listResidentsByNameTokens(tokens) {
  if (!tokens.length) return []
  const esc = (t) => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const parts = tokens.map((t) => `FIND("${esc(t)}", LOWER({Name})) > 0`)
  const formula = `OR(${parts.join(',')})`
  const enc = encodeURIComponent(RESIDENT_TABLE)
  const url = `${CORE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=50`
  const data = await get(url)
  return (data.records || []).map(mapRecord)
}

async function main() {
  if (!TOKEN) {
    console.error('Missing AIRTABLE_TOKEN / VITE_AIRTABLE_TOKEN')
    process.exit(1)
  }
  const { nameTokens, residentIds } = parseArgs()
  let residents = []
  if (residentIds.length) {
    for (const id of residentIds) {
      const enc = encodeURIComponent(RESIDENT_TABLE)
      const data = await get(`${CORE_URL}/${enc}/${encodeURIComponent(id)}`)
      residents.push(mapRecord(data))
    }
  } else if (nameTokens.length) {
    residents = await listResidentsByNameTokens(nameTokens)
  } else {
    console.error('Pass --names="Arnav,Fathima" or --resident=recAAA,recBBB')
    process.exit(1)
  }

  for (const res of residents) {
    const appLinks = (Array.isArray(res.Applications) ? res.Applications : []).filter(
      (id) => typeof id === 'string' && id.startsWith('rec'),
    )
    if (!appLinks.length) {
      console.warn('[skip] no Applications link on resident', res.Name, res.id)
      continue
    }

    let application = null
    for (const aid of appLinks) {
      try {
        const app = await fetchApplication(aid)
        const isApproved =
          app.Approved === true ||
          String(app['Application Status'] || '').toLowerCase().includes('approved') ||
          String(app['Approval Status'] || '').toLowerCase().includes('approved')
        if (isApproved) {
          application = app
          break
        }
      } catch (e) {
        console.warn('[skip] could not load application', aid, e.message)
      }
    }
    if (!application) {
      console.warn('[skip] no approved application on linked records', res.Name, res.id)
      continue
    }

    const out = await createApprovedApplicationFeePayments({
      application,
      residentRecordIds: [res.id],
    })
    console.log(
      res.Name || res.id,
      '→',
      out.createdIds?.length ? `created ${out.createdIds.join(', ')}` : 'no new row',
      out.error || out.skippedReason || '',
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
