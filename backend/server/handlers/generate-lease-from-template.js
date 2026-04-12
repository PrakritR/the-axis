/**
 * POST /api/generate-lease-from-template
 *
 * Builds a structured lease from the application record using the
 * leaseTemplate buildLease() logic (no AI / Claude). Saves to
 * "Lease Drafts" table with status "Draft Generated".
 *
 * Body: { applicationRecordId, overrides?, managerRecordId? }
 */
import { resolveManagerTenant, canEnforceTenant } from '../middleware/resolveManagerTenant.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPS_BASE_ID =
  process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID ||
  process.env.AIRTABLE_APPLICATIONS_BASE_ID ||
  CORE_BASE_ID
const APPS_TABLE =
  process.env.VITE_AIRTABLE_APPLICATIONS_TABLE ||
  process.env.AIRTABLE_APPLICATIONS_TABLE ||
  'Applications'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function normalizeRecordId(raw) {
  const s = String(raw || '').trim()
  return s.startsWith('APP-') ? s.slice(4) : s
}

function escapeFormula(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function airtableGet(url) {
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function airtablePost(table, fields, baseId = CORE_BASE_ID) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function airtablePatch(table, recordId, fields, baseId = CORE_BASE_ID) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function getApplication(recordId) {
  const url = `https://api.airtable.com/v0/${APPS_BASE_ID}/${encodeURIComponent(APPS_TABLE)}/${recordId}`
  const data = await airtableGet(url)
  return { id: data.id, ...data.fields }
}

async function getPropertyByName(name) {
  if (!name) return null
  const formula = encodeURIComponent(`{Name} = "${escapeFormula(name)}"`)
  const url = `https://api.airtable.com/v0/${CORE_BASE_ID}/Properties?filterByFormula=${formula}&maxRecords=1`
  const data = await airtableGet(url)
  const rec = data.records?.[0]
  return rec ? { id: rec.id, ...rec.fields } : null
}

async function findExistingDraft(applicationRecordId) {
  const formula = encodeURIComponent(`{Application Record ID} = "${escapeFormula(applicationRecordId)}"`)
  const url = `https://api.airtable.com/v0/${CORE_BASE_ID}/Lease%20Drafts?filterByFormula=${formula}&sort[0][field]=Updated%20At&sort[0][direction]=desc&maxRecords=1`
  const data = await airtableGet(url)
  const rec = data.records?.[0]
  return rec ? { id: rec.id, ...rec.fields } : null
}

// ─── Lease data builder (mirrors leaseTemplate.js — server-safe, no ESM imports) ─

function fmt(date) {
  if (!date) return '___________'
  const d = new Date(date + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '$0.00'
  const num = typeof n === 'string' ? parseFloat(n.replace(/[^0-9.-]/g, '')) : Number(n)
  if (isNaN(num)) return '$0.00'
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function buildLeaseData(app, propertyRecord, overrides = {}) {
  const propertyName = app['Property Name'] || ''
  const roomNumber = app['Room Number'] || ''
  const propertyAddress = app['Property Address'] || ''
  const tenantName = app['Signer Full Name'] || ''
  const tenantEmail = app['Signer Email'] || ''
  const tenantPhone = app['Signer Phone Number'] || ''
  const leaseStart = app['Lease Start Date'] || ''
  const leaseEnd = app['Lease End Date'] || ''
  const isMonthToMonth = Boolean(app['Month to Month'])
  const cosignerName = app['cosignerName'] || app['Co-Signer Name'] || ''

  const monthlyRent =
    overrides.rent ||
    Number(app['Rent Amount'] || app['Rent'] || 0) ||
    0

  const utilityFee =
    overrides.utilityFee != null
      ? overrides.utilityFee
      : Number(propertyRecord?.['Utilities Fee'] || app['Utilities Fee'] || 125)

  const securityDeposit =
    overrides.deposit != null
      ? overrides.deposit
      : Number(propertyRecord?.['Security Deposit'] || app['Security Deposit'] || Math.min(monthlyRent, 500))

  const adminFee = overrides.adminFee != null ? overrides.adminFee : 250

  // Prorated calculation
  let proratedRent = 0
  let proratedUtility = 0
  let proratedDays = 0
  if (leaseStart) {
    const start = new Date(leaseStart + 'T12:00:00')
    const endOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0)
    const daysInMonth = endOfMonth.getDate()
    const dayOfMonth = start.getDate()
    if (dayOfMonth > 1) {
      proratedDays = daysInMonth - dayOfMonth + 1
      const dailyRent = Math.round((monthlyRent / daysInMonth) * 100) / 100
      const dailyUtil = Math.round((utilityFee / daysInMonth) * 100) / 100
      proratedRent = Math.round(dailyRent * proratedDays * 100) / 100
      proratedUtility = Math.round(dailyUtil * proratedDays * 100) / 100
    }
  }

  const totalMoveIn = proratedRent + proratedUtility + monthlyRent + utilityFee + securityDeposit + adminFee

  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })

  return {
    agreementDate: today,
    landlordName: 'Prakrit Ramachandran',
    landlordAddress: '4709 A 8th Ave N, Seattle, WA 98105',
    tenantName,
    tenantEmail,
    tenantPhone,
    cosignerName,
    propertyName,
    propertyAddress,
    roomNumber,
    fullAddress: propertyAddress || `${propertyName} - Room ${roomNumber}`,
    leaseStart,
    leaseEnd,
    isMonthToMonth,
    leaseStartFmt: fmt(leaseStart),
    leaseEndFmt: fmt(leaseEnd),
    monthlyRent,
    utilityFee,
    securityDeposit,
    adminFee,
    proratedDays,
    proratedRent,
    proratedUtility,
    totalMoveIn,
    monthlyRentFmt: fmtMoney(monthlyRent),
    utilityFeeFmt: fmtMoney(utilityFee),
    securityDepositFmt: fmtMoney(securityDeposit),
    adminFeeFmt: fmtMoney(adminFee),
    proratedRentFmt: fmtMoney(proratedRent),
    proratedUtilityFmt: fmtMoney(proratedUtility),
    totalMoveInFmt: fmtMoney(totalMoveIn),
    monthlyTotalFmt: fmtMoney(monthlyRent + utilityFee),
    breakLeaseFee: fmtMoney(900),
  }
}

// ─── Exported helper (used by manager-approve-application.js) ─────────────────

export async function generateLeaseFromTemplate({ applicationRecordId, overrides = {}, generatedBy = 'Manager', ownerId = '' }) {
  const recordId = normalizeRecordId(applicationRecordId)
  if (!recordId) throw new Error('applicationRecordId is required')

  // Check for existing draft first
  const existing = await findExistingDraft(recordId)
  if (existing) return { draft: existing, created: false }

  const app = await getApplication(recordId)
  // Inherit Owner ID from the application if caller didn't provide one
  const resolvedOwnerId = ownerId || String(app['Owner ID'] || '').trim()

  const propertyRecord = await getPropertyByName(app['Property Name'])
  const leaseData = buildLeaseData(app, propertyRecord, overrides)

  const now = new Date().toISOString()
  const record = await airtablePost('Lease Drafts', {
    'Resident Name': leaseData.tenantName,
    'Resident Email': leaseData.tenantEmail,
    'Resident Record ID': String(app?.Resident?.[0] || app?.['Resident Record ID'] || '').trim(),
    Property: leaseData.propertyName,
    Unit: leaseData.roomNumber,
    'Lease Start Date': leaseData.leaseStart,
    'Lease End Date': leaseData.leaseEnd,
    'Rent Amount': leaseData.monthlyRent,
    'Deposit Amount': leaseData.securityDeposit,
    'Utilities Fee': leaseData.utilityFee,
    'Lease Term': app['Lease Term'] || (leaseData.isMonthToMonth ? 'Month-to-Month' : 'Fixed Term'),
    'AI Draft Content': '',
    'Manager Edited Content': '',
    'Lease JSON': JSON.stringify(leaseData),
    Status: 'Draft Generated',
    'Updated At': now,
    'Application Record ID': recordId,
    'Manager Notes': '',
    ...(resolvedOwnerId ? { 'Owner ID': resolvedOwnerId } : {}),
  })

  return { draft: { id: record.id, ...record.fields }, created: true }
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Data service not configured.' })

  const { applicationRecordId, overrides = {}, managerName } = req.body || {}

  let tenant = null
  try {
    tenant = await resolveManagerTenant(req)
  } catch (tenantErr) {
    return res.status(403).json({ error: tenantErr.message })
  }

  try {
    // If tenant is set, fetch the application first to run the ownership guard
    if (tenant) {
      const normalId = normalizeRecordId(applicationRecordId)
      if (normalId) {
        const app = await getApplication(normalId).catch(() => null)
        if (app && canEnforceTenant(tenant, app)) {
          return res.status(403).json({ error: 'Access denied: this application belongs to a different manager.' })
        }
      }
    }

    const { draft, created } = await generateLeaseFromTemplate({
      applicationRecordId,
      overrides,
      generatedBy: managerName || 'Manager',
      ownerId: tenant?.ownerId || '',
    })
    return res.status(200).json({
      draft,
      created,
      message: created ? 'Lease draft generated from template.' : 'Existing lease draft returned.',
    })
  } catch (err) {
    console.error('[generate-lease-from-template]', err)
    return res.status(500).json({ error: err.message || 'Failed to generate lease draft.' })
  }
}
