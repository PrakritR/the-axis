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
import { resolveLeaseDetails } from '../lib/axis-properties.js'
import { isApplicationApprovedForLease } from '../lib/application-approval-lease-guard.js'
import {
  applicationLeaseRoomNumber,
  DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
} from '../../../shared/application-airtable-fields.js'

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

const APPLICATION_APPROVED_ROOM_FIELD = String(
  process.env.VITE_AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD ||
    process.env.AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD ||
    DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
).trim() || DEFAULT_AXIS_APPLICATION_APPROVED_ROOM

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
  const escaped = escapeFormula(name)
  const candidates = [`{Name} = "${escaped}"`, `{Property Name} = "${escaped}"`]
  for (const f of candidates) {
    const formula = encodeURIComponent(f)
    const url = `https://api.airtable.com/v0/${CORE_BASE_ID}/Properties?filterByFormula=${formula}&maxRecords=1`
    const data = await airtableGet(url)
    const rec = data.records?.[0]
    if (rec) return { id: rec.id, ...rec.fields }
  }
  return null
}

async function findExistingDraft(applicationRecordId) {
  const formula = encodeURIComponent(`{Application Record ID} = "${escapeFormula(applicationRecordId)}"`)
  const url = `https://api.airtable.com/v0/${CORE_BASE_ID}/Lease%20Drafts?filterByFormula=${formula}&sort[0][field]=Updated%20At&sort[0][direction]=desc&maxRecords=1`
  const data = await airtableGet(url)
  const rec = data.records?.[0]
  return rec ? { id: rec.id, ...rec.fields } : null
}

function tryParseLeaseJson(fields) {
  const raw = fields?.['Lease JSON']
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  try {
    const o = JSON.parse(s)
    return o && typeof o === 'object' ? o : null
  } catch {
    return null
  }
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

/** Keep in sync with frontend `axisListingMeta.js` */
const AXIS_LISTING_META_START = '---AXIS_LISTING_META_JSON---'

function parseAxisListingMetaFromRecord(propertyRecord) {
  const raw = String(propertyRecord?.['Other Info'] || '').trim()
  if (!raw) return null
  const idx = raw.indexOf(AXIS_LISTING_META_START)
  if (idx === -1) return null
  const jsonPart = raw.slice(idx + AXIS_LISTING_META_START.length).trim()
  try {
    const meta = JSON.parse(jsonPart)
    return meta && typeof meta === 'object' ? meta : null
  } catch {
    return null
  }
}

function parseMoneyLike(val) {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) return val
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

function getFieldCaseInsensitive(record, fieldName) {
  if (!record || !fieldName) return undefined
  if (Object.prototype.hasOwnProperty.call(record, fieldName)) return record[fieldName]
  const target = String(fieldName).trim().toLowerCase()
  if (!target) return undefined
  for (const key of Object.keys(record)) {
    if (String(key).trim().toLowerCase() === target) return record[key]
  }
  return undefined
}

function roomSlotNumber(roomValue) {
  const m = String(roomValue || '').match(/(\d+)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n >= 1 && n <= 40 ? n : null
}

function roomFieldValue(propertyRecord, roomValue, suffixes = []) {
  const n = roomSlotNumber(roomValue)
  if (!n || !propertyRecord) return undefined
  for (const suffix of suffixes) {
    const field = `Room ${n} ${suffix}`
    const value = getFieldCaseInsensitive(propertyRecord, field)
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return undefined
}

function roomLabelsMatch(appRoom, metaLabel) {
  const a = String(appRoom || '').trim().toLowerCase()
  const b = String(metaLabel || '').trim().toLowerCase()
  if (!a || !b) return false
  if (a === b) return true
  const strip = (s) => s.replace(/^room\s*/i, '').trim()
  if (strip(a) === strip(b)) return true
  const da = a.match(/\d+/)
  const db = b.match(/\d+/)
  if (da && db && da[0] === db[0]) return true
  return false
}

function rentFromRoomsDetailMeta(meta, appRoomNumber) {
  const rooms = Array.isArray(meta?.roomsDetail) ? meta.roomsDetail : []
  for (const detail of rooms) {
    if (!detail || typeof detail !== 'object') continue
    const label = detail.label || ''
    if (!roomLabelsMatch(appRoomNumber, label)) continue
    const r = parseMoneyLike(detail.rent)
    if (r != null && r > 0) return r
  }
  return null
}

function rentFromRoomRentColumns(propertyRecord, appRoomNumber) {
  const m = String(appRoomNumber || '').match(/(\d+)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (n < 1 || n > 20) return null
  const field = `Room ${n} Rent`
  const r = parseMoneyLike(propertyRecord?.[field])
  return r != null && r > 0 ? r : null
}

function rentFromLeasingBundles(meta, appRoomNumber) {
  const leasing = meta?.leasing && typeof meta.leasing === 'object' ? meta.leasing : null
  if (!leasing) return null
  const packages = leasing['Leasing Packages']
  if (!Array.isArray(packages)) return null
  for (const pkg of packages) {
    if (!pkg || typeof pkg !== 'object') continue
    const roomsRaw = pkg['Bundle Rooms Included']
    const arr = Array.isArray(roomsRaw) ? roomsRaw : []
    const matches = arr.some((r) => roomLabelsMatch(appRoomNumber, r))
    if (!matches) continue
    const bundleRent = parseMoneyLike(pkg['Bundle Monthly Rent'])
    if (bundleRent == null || bundleRent <= 0) continue
    if (arr.length <= 1) return bundleRent
    return Math.round((bundleRent / arr.length) * 100) / 100
  }
  return null
}

function resolveMonthlyRent(app, propertyRecord, overrides, axisRent = 0) {
  if (overrides.rent != null && overrides.rent !== '') {
    const o = parseMoneyLike(overrides.rent)
    if (o != null && o > 0) return o
  }
  const appCandidates = [
    app['Rent Amount'],
    app.Rent,
    app['Monthly Rent'],
    app['Proposed Rent'],
    app['Offered Rent'],
    app['Room Rent'],
  ]
  for (const f of appCandidates) {
    const v = parseMoneyLike(f)
    if (v != null && v > 0) return v
  }

  const roomNum = app['Room Number'] || ''
  if (propertyRecord && roomNum) {
    const meta = parseAxisListingMetaFromRecord(propertyRecord)
    if (meta) {
      const fromDetail = rentFromRoomsDetailMeta(meta, roomNum)
      if (fromDetail != null) return fromDetail
      const fromBundle = rentFromLeasingBundles(meta, roomNum)
      if (fromBundle != null) return fromBundle
    }
    const fromCol = rentFromRoomRentColumns(propertyRecord, roomNum)
    if (fromCol != null) return fromCol
  }

  if (propertyRecord) {
    const propLevel = ['Monthly Rent', 'Base Rent', 'Rent', 'Default Rent', 'Listed Rent']
    for (const key of propLevel) {
      const v = parseMoneyLike(propertyRecord[key])
      if (v != null && v > 0) return v
    }
  }

  // Fall back to axis-properties.js room rent (most reliable for known properties)
  if (axisRent > 0) return axisRent

  return 0
}

function resolveUtilityFee(app, propertyRecord, overrides, axisDefault = 0) {
  if (overrides.utilityFee != null && overrides.utilityFee !== '') {
    const o = parseMoneyLike(overrides.utilityFee)
    if (o != null) return o
  }
  const roomSpecific = parseMoneyLike(
    roomFieldValue(propertyRecord, app?.['Room Number'], ['Utilities Cost', 'Utilities cost', 'Utilities Fee', 'Utility Fee']),
  )
  if (roomSpecific != null && roomSpecific > 0) return roomSpecific

  const v = parseMoneyLike(app['Utilities Fee'] ?? propertyRecord?.['Utilities Fee'])
  if (v != null && v > 0) return v

  if (typeof axisDefault === 'number' && axisDefault > 0) return axisDefault
  return 0
}

function resolveRoomUtilitySummary(app, propertyRecord) {
  const roomSpecific = roomFieldValue(propertyRecord, app?.['Room Number'], ['Utilities'])
  if (roomSpecific != null && String(roomSpecific).trim()) return String(roomSpecific).trim()
  const fallback = getFieldCaseInsensitive(propertyRecord, 'Utilities')
  return fallback != null && String(fallback).trim() ? String(fallback).trim() : ''
}

function resolveRoomFurnished(app, propertyRecord) {
  const roomSpecific = roomFieldValue(propertyRecord, app?.['Room Number'], ['Furnished'])
  if (roomSpecific != null && String(roomSpecific).trim()) return String(roomSpecific).trim()
  const fallback = getFieldCaseInsensitive(propertyRecord, 'Furnished')
  return fallback != null && String(fallback).trim() ? String(fallback).trim() : ''
}

function resolveRoomFurnitureIncluded(app, propertyRecord) {
  const roomSpecific = roomFieldValue(propertyRecord, app?.['Room Number'], ['Furniture included', 'Furniture Included'])
  if (roomSpecific != null && String(roomSpecific).trim()) return String(roomSpecific).trim()
  return ''
}

function resolveSecurityDeposit(app, propertyRecord, monthlyRent, overrides, axisDefault = null) {
  if (overrides.deposit != null && overrides.deposit !== '') {
    const o = parseMoneyLike(overrides.deposit)
    if (o != null) return o
  }
  for (const f of [app['Security Deposit'], app['Deposit Amount']]) {
    const v = parseMoneyLike(f)
    if (v != null && v > 0) return v
  }
  if (propertyRecord) {
    const meta = parseAxisListingMetaFromRecord(propertyRecord)
    const mf = parseMoneyLike(meta?.financials?.securityDeposit)
    if (mf != null && mf > 0) return mf
    const pr = parseMoneyLike(propertyRecord['Security Deposit'])
    if (pr != null && pr > 0) return pr
  }
  if (axisDefault != null && axisDefault > 0) return axisDefault
  return 0
}

function buildLeaseData(app, propertyRecord, overrides = {}) {
  const propertyName = app['Property Name'] || ''
  const effectiveRoomLabel = applicationLeaseRoomNumber(app, APPLICATION_APPROVED_ROOM_FIELD)
  const appForRoomPricing = { ...app, 'Room Number': effectiveRoomLabel || app['Room Number'] }
  const roomRaw = String(appForRoomPricing['Room Number'] || '').trim()
  const roomDigits = roomRaw.match(/(\d+)/)?.[1] || roomRaw
  const roomNumber = roomDigits || ''
  const roomLabel = roomRaw
    ? (/^room\s*/i.test(roomRaw) ? roomRaw.replace(/\s+/g, ' ').trim() : `Room ${roomRaw}`)
    : ''

  // ── Axis-properties authoritative lookup (room rent, utilities, deposit, bathroom, amenities) ──
  const axisDetails = resolveLeaseDetails(propertyName, roomNumber, overrides)

  const propertyAddress =
    app['Property Address'] ||
    propertyRecord?.Address ||
    propertyRecord?.['Property Address'] ||
    axisDetails.propertyAddress ||
    ''
  const tenantName = app['Signer Full Name'] || ''
  const tenantEmail = app['Signer Email'] || ''
  const tenantPhone = app['Signer Phone Number'] || ''
  const leaseStart = app['Lease Start Date'] || ''
  const leaseEnd = app['Lease End Date'] || ''
  const isMonthToMonth = Boolean(app['Month to Month'])
  const cosignerName = app['cosignerName'] || app['Co-Signer Name'] || ''

  let monthlyRent = resolveMonthlyRent(appForRoomPricing, propertyRecord, overrides, axisDetails.rent)
  /** Apply flow: Month-to-Month option is +$25/mo over listed room rent */
  if (monthlyRent > 0 && (app['Month to Month'] === true || app['Month to Month'] === 1)) {
    monthlyRent += 25
  }

  const utilityFee = resolveUtilityFee(appForRoomPricing, propertyRecord, overrides, axisDetails.utilitiesFee)
  const roomUtilitiesSummary = resolveRoomUtilitySummary(appForRoomPricing, propertyRecord)
  const roomFurnished = resolveRoomFurnished(appForRoomPricing, propertyRecord)
  const roomFurnitureIncluded = resolveRoomFurnitureIncluded(appForRoomPricing, propertyRecord)
  const securityDeposit = resolveSecurityDeposit(app, propertyRecord, monthlyRent, overrides, axisDetails.securityDeposit)
  let adminFee = 0
  if (overrides.adminFee != null && overrides.adminFee !== '') {
    const o = parseMoneyLike(overrides.adminFee)
    if (o != null) adminFee = o
  } else {
    const fromApp = parseMoneyLike(
      app['Admin Fee'] ?? app['Administration Fee'] ?? app['Move-in Admin Fee'] ?? app['Administrative Fee'],
    )
    if (fromApp != null && fromApp > 0) adminFee = fromApp
    else if (typeof axisDetails.adminFee === 'number' && axisDetails.adminFee > 0) adminFee = axisDetails.adminFee
  }

  let lastMonthRent = 0
  if (overrides.lastMonthRent != null && String(overrides.lastMonthRent).trim() !== '') {
    const fromOverride = parseMoneyLike(overrides.lastMonthRent)
    lastMonthRent = fromOverride != null ? fromOverride : Number(overrides.lastMonthRent) || 0
  } else {
    const fromApp = parseMoneyLike(app['Last Month Rent'])
    lastMonthRent = fromApp != null ? fromApp : 0
  }

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

  const totalMoveIn =
    proratedRent + proratedUtility + monthlyRent + utilityFee + securityDeposit + adminFee + lastMonthRent

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
    roomLabel,
    fullAddress: propertyAddress
      ? `${propertyAddress}${roomLabel ? `, ${roomLabel}` : ''}`
      : `${propertyName}${roomLabel ? ` - ${roomLabel}` : ''}`,
    leaseStart,
    leaseEnd,
    isMonthToMonth,
    leaseStartFmt: fmt(leaseStart),
    leaseEndFmt: fmt(leaseEnd),
    monthlyRent,
    utilityFee,
    securityDeposit,
    lastMonthRent,
    adminFee,
    proratedDays,
    proratedRent,
    proratedUtility,
    totalMoveIn,
    monthlyRentFmt: fmtMoney(monthlyRent),
    utilityFeeFmt: fmtMoney(utilityFee),
    roomUtilitiesSummary,
    roomFurnished,
    roomFurnitureIncluded,
    securityDepositFmt: fmtMoney(securityDeposit),
    lastMonthRentFmt: fmtMoney(lastMonthRent),
    adminFeeFmt: fmtMoney(adminFee),
    proratedRentFmt: fmtMoney(proratedRent),
    proratedUtilityFmt: fmtMoney(proratedUtility),
    totalMoveInFmt: fmtMoney(totalMoveIn),
    monthlyTotalFmt: fmtMoney(monthlyRent + utilityFee),
    /** Only shown in lease body when > 0; otherwise generic early-termination language without a dollar figure */
    breakLeaseFee: '',
    breakLeaseFeeAmount: 0,
    // Property-specific from axis-properties.js
    bathroomNote: axisDetails.bathroomNote || '',
    bathroomGroup: axisDetails.bathroomGroup || '',
    amenities: axisDetails.amenities || [],
  }
}

// ─── Exported helper (used by manager-approve-application.js) ─────────────────

export async function generateLeaseFromTemplate({
  applicationRecordId,
  overrides = {},
  generatedBy = 'Manager',
  ownerId = '',
  forceRegenerate = false,
}) {
  const recordId = normalizeRecordId(applicationRecordId)
  if (!recordId) throw new Error('applicationRecordId is required')

  const app = await getApplication(recordId)
  if (!isApplicationApprovedForLease(app)) {
    throw new Error('Lease drafts can only be generated for approved applications.')
  }

  const existing = await findExistingDraft(recordId)
  if (existing) {
    const parsed = tryParseLeaseJson(existing)
    if (!forceRegenerate && parsed) {
      return { draft: existing, created: false }
    }
  }
  const resolvedOwnerId = ownerId || String(app['Owner ID'] || '').trim()
  const propertyRecord = await getPropertyByName(app['Property Name'])
  const leaseData = buildLeaseData(app, propertyRecord, overrides)
  const now = new Date().toISOString()

  const coreFields = {
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
    'Lease JSON': JSON.stringify(leaseData),
    'Updated At': now,
    ...(resolvedOwnerId ? { 'Owner ID': resolvedOwnerId } : {}),
  }

  if (existing) {
    const updated = await airtablePatch('Lease Drafts', existing.id, coreFields)
    return { draft: { id: updated.id, ...updated.fields }, created: false }
  }

  const record = await airtablePost('Lease Drafts', {
    ...coreFields,
    'AI Draft Content': '',
    'Manager Edited Content': '',
    Status: 'Draft Generated',
    'Application Record ID': recordId,
    'Manager Notes': '',
  })

  return { draft: { id: record.id, ...record.fields }, created: true }
}

/**
 * Monthly rent, utilities, deposit, and lease start for an application — same math as lease draft generation.
 * Used when creating pending move-in payment rows on approval (no lease draft required).
 */
export async function computeMoveInChargesFromApplication(application, overrides = {}) {
  if (!application || typeof application !== 'object') {
    throw new Error('Application record required.')
  }
  const propertyRecord = await getPropertyByName(application['Property Name'])
  return buildLeaseData(application, propertyRecord, overrides)
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Data service not configured.' })

  const { applicationRecordId, overrides = {}, managerName, forceRegenerate = false } = req.body || {}

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
      forceRegenerate: Boolean(forceRegenerate),
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
