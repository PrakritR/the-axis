/**
 * When a manager approves an application, create pending Payments rows for security deposit,
 * first month rent, and first month utilities (idempotent via Notes markers).
 */
import {
  applicationApprovedUnitNumber,
  DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
} from '../../../shared/application-airtable-fields.js'
import { computeMoveInChargesFromApplication } from '../handlers/generate-lease-from-template.js'
import {
  SUBMITTED_MOVEIN_DEPOSIT_MARKER_PREFIX,
  SUBMITTED_MOVEIN_FIRST_RENT_MARKER_PREFIX,
  SUBMITTED_MOVEIN_FIRST_UTIL_MARKER_PREFIX,
} from './submitted-application-movein-payments.js'
import { adminFeeFromDepositMarker } from '../../../shared/payments-ledger-markers.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`

const RESIDENT_PROFILE_TABLE = 'Resident Profile'
const PAYMENTS_TABLE =
  process.env.VITE_AIRTABLE_PAYMENTS_TABLE || process.env.AIRTABLE_PAYMENTS_TABLE || 'Payments'

const APPLICATION_APPROVED_ROOM_FIELD = String(
  process.env.VITE_AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD ||
    process.env.AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD ||
    DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
).trim() || DEFAULT_AXIS_APPLICATION_APPROVED_ROOM

/** Airtable field name that links a Payments row to a Resident Profile record. */
const PAYMENTS_RESIDENT_LINK_FIELD =
  String(process.env.VITE_AIRTABLE_PAYMENTS_RESIDENT_LINK_FIELD || process.env.AIRTABLE_PAYMENTS_RESIDENT_LINK_FIELD || 'Resident').trim() || 'Resident'

const PAYMENTS_PROPERTY_LINK_FIELD =
  String(process.env.VITE_AIRTABLE_PAYMENTS_PROPERTY_LINK_FIELD || process.env.AIRTABLE_PAYMENTS_PROPERTY_LINK_FIELD || 'Property').trim() || 'Property'

const PROPERTIES_TABLE =
  String(process.env.VITE_AIRTABLE_PROPERTIES_TABLE || process.env.AIRTABLE_PROPERTIES_TABLE || 'Properties').trim() || 'Properties'

export const APPROVED_MOVEIN_DEPOSIT_MARKER_PREFIX = 'AXIS_APPROVED_MOVEIN_DEPOSIT:'
export const APPROVED_MOVEIN_FIRST_RENT_MARKER_PREFIX = 'AXIS_APPROVED_MOVEIN_FIRST_RENT:'
export const APPROVED_MOVEIN_FIRST_UTIL_MARKER_PREFIX = 'AXIS_APPROVED_MOVEIN_FIRST_UTILITIES:'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function escapeFormulaValue(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function airtableGet(url) {
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text.slice(0, 400))
  }
  return res.json()
}

async function airtablePost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text.slice(0, 400))
  }
  return res.json()
}

async function airtablePatchRecord(recordId, fields) {
  const enc = encodeURIComponent(PAYMENTS_TABLE)
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}/${encodeURIComponent(recordId)}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text.slice(0, 400))
  }
  return res.json()
}

function submittedMarkerForMoveInKey(key, appId) {
  const prefixes = {
    deposit: SUBMITTED_MOVEIN_DEPOSIT_MARKER_PREFIX,
    first_rent: SUBMITTED_MOVEIN_FIRST_RENT_MARKER_PREFIX,
    first_util: SUBMITTED_MOVEIN_FIRST_UTIL_MARKER_PREFIX,
  }
  const p = prefixes[key]
  return p ? `${p}${appId}` : ''
}

async function findFirstPaymentByNotesSubstring(markerSubstring) {
  if (!markerSubstring) return null
  const enc = encodeURIComponent(PAYMENTS_TABLE)
  const formula = `FIND("${escapeFormulaValue(markerSubstring)}", {Notes}) > 0`
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const data = await airtableGet(url)
  return data.records?.[0] || null
}

async function fetchResidentRecord(residentRecordId) {
  const enc = encodeURIComponent(RESIDENT_PROFILE_TABLE)
  const data = await airtableGet(`${CORE_AIRTABLE_BASE_URL}/${enc}/${encodeURIComponent(residentRecordId)}`)
  return { id: data.id, ...data.fields }
}

async function moveInRowExists(residentRecordId, markerContains) {
  const enc = encodeURIComponent(PAYMENTS_TABLE)
  const rid = escapeFormulaValue(residentRecordId)
  const mk = escapeFormulaValue(markerContains)
  const lf = PAYMENTS_RESIDENT_LINK_FIELD
  const formula = `AND(OR({${lf}} = "${rid}", FIND("${rid}", ARRAYJOIN({${lf}})) > 0), FIND("${mk}", {Notes}) > 0)`
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const data = await airtableGet(url)
  return (data.records?.length ?? 0) > 0
}

async function airtableDelete(url) {
  const res = await fetch(url, { method: 'DELETE', headers: airtableHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text.slice(0, 400))
  }
  return true
}

/**
 * When an application returns to pending/rejected, remove unpaid Axis move-in lines
 * (same markers as createApprovedApplicationMoveInPayments) so a later re-approval
 * does not stack duplicates. Paid rows are kept.
 *
 * @param {string} applicationRecordId
 * @returns {Promise<{ deletedIds: string[], error?: string }>}
 */
export async function deleteUnpaidApprovedMoveInPaymentsForApplication(applicationRecordId) {
  const deletedIds = []
  const appId = String(applicationRecordId || '').trim()
  if (!AIRTABLE_TOKEN || !appId.startsWith('rec')) {
    return { deletedIds, error: !AIRTABLE_TOKEN ? 'token not configured' : 'bad application id' }
  }

  const mkD = `${APPROVED_MOVEIN_DEPOSIT_MARKER_PREFIX}${appId}`
  const mkR = `${APPROVED_MOVEIN_FIRST_RENT_MARKER_PREFIX}${appId}`
  const mkU = `${APPROVED_MOVEIN_FIRST_UTIL_MARKER_PREFIX}${appId}`
  const skD = `${SUBMITTED_MOVEIN_DEPOSIT_MARKER_PREFIX}${appId}`
  const skR = `${SUBMITTED_MOVEIN_FIRST_RENT_MARKER_PREFIX}${appId}`
  const skU = `${SUBMITTED_MOVEIN_FIRST_UTIL_MARKER_PREFIX}${appId}`
  const mkAdmin = adminFeeFromDepositMarker(appId)
  const formula = `AND(OR(FIND("${escapeFormulaValue(mkD)}", {Notes}) > 0, FIND("${escapeFormulaValue(mkR)}", {Notes}) > 0, FIND("${escapeFormulaValue(mkU)}", {Notes}) > 0, FIND("${escapeFormulaValue(skD)}", {Notes}) > 0, FIND("${escapeFormulaValue(skR)}", {Notes}) > 0, FIND("${escapeFormulaValue(skU)}", {Notes}) > 0, FIND("${escapeFormulaValue(mkAdmin)}", {Notes}) > 0), NOT(OR({Status} = "Paid", {Status} = "Partial", {Status} = "Posted")))`

  const enc = encodeURIComponent(PAYMENTS_TABLE)
  let offset = ''
  try {
    for (;;) {
      const qs = new URLSearchParams({
        filterByFormula: formula,
        pageSize: '100',
      })
      if (offset) qs.set('offset', offset)
      const data = await airtableGet(`${CORE_AIRTABLE_BASE_URL}/${enc}?${qs.toString()}`)
      const records = data.records || []
      for (const rec of records) {
        const id = String(rec?.id || '').trim()
        if (!id) continue
        try {
          await airtableDelete(`${CORE_AIRTABLE_BASE_URL}/${enc}/${encodeURIComponent(id)}`)
          deletedIds.push(id)
        } catch (err) {
          console.warn('[approved-application-movein-payments] delete row failed', id, err?.message || err)
        }
      }
      if (!data.offset) break
      offset = data.offset
    }
  } catch (err) {
    return { deletedIds, error: err?.message || String(err) }
  }

  return { deletedIds }
}

/**
 * Resident Profile `House` field may be a linked-record array of record IDs.
 * Return the first human-readable (non-record-ID) string value, or the fallback.
 */
function resolveHouseText(houseField, fallback) {
  if (typeof houseField === 'string') {
    const s = houseField.trim()
    if (s && !/^rec[A-Za-z0-9]{14,}$/.test(s)) return s
  } else if (Array.isArray(houseField)) {
    for (const x of houseField) {
      const s = String(x ?? '').trim()
      if (s && !/^rec[A-Za-z0-9]{14,}$/.test(s)) return s
    }
  }
  return typeof fallback === 'string' ? fallback.trim() : ''
}

function dueDateFromLeaseStart(leaseStart) {
  const s = String(leaseStart || '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return new Date().toISOString().slice(0, 10)
}

async function fetchPropertyRecordIdForPayments(propertyName) {
  const name = String(propertyName || '').trim()
  if (!name || !AIRTABLE_TOKEN) return ''
  const enc = encodeURIComponent(PROPERTIES_TABLE)
  const formula = `{Property Name} = "${escapeFormulaValue(name)}"`
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  try {
    const data = await airtableGet(url)
    return String(data.records?.[0]?.id || '').trim()
  } catch {
    return ''
  }
}

function moveInKindForSpec(spec) {
  if (spec.key === 'deposit') return 'Security deposit'
  if (spec.key === 'first_rent') return 'First month rent'
  if (spec.key === 'first_util') return 'First month utilities'
  return 'Move-in'
}

async function findAdministrativeFeeChargeForApplication(applicationRecordId) {
  const marker = adminFeeFromDepositMarker(applicationRecordId)
  const enc = encodeURIComponent(PAYMENTS_TABLE)
  const formula = `AND(FIND("${escapeFormulaValue(marker)}", {Notes}) > 0, {Type} = "Administrative fee")`
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  try {
    const data = await airtableGet(url)
    return data.records?.[0] || null
  } catch {
    return null
  }
}

async function applyAdminFeeSplitFromSecurityDeposit({
  paymentsPostUrl,
  applicationRecordId,
  depositRecordId,
  adminFeeUsd,
  residentRecordId,
  propertyName,
  roomNumber,
  resName,
  resEmail,
  propertyRecordId,
  dueDate,
}) {
  const appId = String(applicationRecordId || '').trim()
  const depId = String(depositRecordId || '').trim()
  if (!appId.startsWith('rec') || !depId.startsWith('rec')) return

  const marker = adminFeeFromDepositMarker(appId)
  const existingFee = await findAdministrativeFeeChargeForApplication(appId)
  if (existingFee?.id) return

  const enc = encodeURIComponent(PAYMENTS_TABLE)
  let depFields = {}
  try {
    const dep = await airtableGet(`${CORE_AIRTABLE_BASE_URL}/${enc}/${encodeURIComponent(depId)}`)
    depFields = dep.fields || {}
  } catch (err) {
    console.warn('[approved-application-movein-payments] admin fee split: could not read deposit', err?.message || err)
    return
  }

  const prevNotes = String(depFields.Notes || '').trim()
  const allocationHint = `reclassified to administrative fee line (application ${appId})`
  if (prevNotes.includes(allocationHint) && !existingFee?.id) {
    console.warn(
      '[approved-application-movein-payments] deposit notes show a prior admin allocation but no fee row; skipping split to avoid double reduction',
    )
    return
  }

  const amount = Math.round(Number(depFields.Amount) * 100) / 100
  const balanceRaw = Number(depFields.Balance)
  const balance = Number.isFinite(balanceRaw) ? Math.max(0, Math.round(balanceRaw * 100) / 100) : Math.max(0, amount)
  const admin = Math.max(0, Math.round(Number(adminFeeUsd) * 100) / 100)
  const alloc = Math.min(admin, balance, amount)
  if (!(alloc > 0)) return

  const newAmount = Math.round((amount - alloc) * 100) / 100
  const newBalance = Math.max(0, Math.min(balance, Math.round(newAmount * 100) / 100))
  const adjFragment = `Administrative allocation: ${alloc} reclassified to administrative fee line (application ${appId}).`
  const nextNotes = prevNotes.includes(adjFragment.trim()) ? prevNotes : `${prevNotes} ${adjFragment}`.trim()

  await airtablePatchRecord(depId, {
    Amount: newAmount,
    Balance: newBalance,
    Notes: nextNotes,
  })

  const lf = PAYMENTS_RESIDENT_LINK_FIELD
  const pf = PAYMENTS_PROPERTY_LINK_FIELD
  const fields = {
    [lf]: [residentRecordId],
    Amount: alloc,
    Balance: alloc,
    Status: 'Unpaid',
    'Due Date': dueDate,
    Type: 'Administrative fee',
    Category: 'Fee',
    Kind: 'Administrative costs',
    'Line Item Type': 'Move-in allocation',
    Month: 'Administrative fee',
    Notes: `Administrative fee (portion of security deposit at approval). ${marker}`,
    'Resident Name': resName || undefined,
    'Resident Email': resEmail || undefined,
    'Property Name': propertyName || undefined,
    'Room Number': roomNumber || undefined,
  }
  if (propertyRecordId && /^rec[a-zA-Z0-9]{14,}$/.test(String(propertyRecordId))) {
    fields[pf] = [propertyRecordId]
  }
  await airtablePost(paymentsPostUrl, { fields, typecast: true })
}

/**
 * @param {{ application: Record<string, unknown>, residentRecordIds: string[] }} p
 * @returns {Promise<{ createdIds: string[], skipped: string[], error?: string }>}
 */
export async function createApprovedApplicationMoveInPayments({ application, residentRecordIds }) {
  const createdIds = []
  const skipped = []
  if (!AIRTABLE_TOKEN) {
    return { createdIds, skipped, error: 'Airtable token not configured' }
  }

  const appId = String(application?.id || '').trim()
  if (!appId.startsWith('rec')) {
    return { createdIds, skipped, error: 'missing application id' }
  }

  let leaseData
  try {
    leaseData = await computeMoveInChargesFromApplication(application, {})
  } catch (err) {
    return { createdIds, skipped, error: err?.message || String(err) }
  }

  const due = dueDateFromLeaseStart(leaseData.leaseStart)
  const propName = String(leaseData.propertyName || application['Property Name'] || '').trim()
  const roomNum = String(
    leaseData.roomNumber || applicationApprovedUnitNumber(application, APPLICATION_APPROVED_ROOM_FIELD) || '',
  ).trim()

  const deposit = Math.round(Number(leaseData.securityDeposit) * 100) / 100
  const rent = Math.round(Number(leaseData.monthlyRent) * 100) / 100
  const util = Math.round(Number(leaseData.utilityFee) * 100) / 100

  const ids = Array.isArray(residentRecordIds)
    ? [...new Set(residentRecordIds.filter((x) => String(x || '').startsWith('rec')))]
    : []

  const encPay = encodeURIComponent(PAYMENTS_TABLE)
  const payUrl = `${CORE_AIRTABLE_BASE_URL}/${encPay}`

  const markerDeposit = `${APPROVED_MOVEIN_DEPOSIT_MARKER_PREFIX}${appId}`
  const markerRent = `${APPROVED_MOVEIN_FIRST_RENT_MARKER_PREFIX}${appId}`
  const markerUtil = `${APPROVED_MOVEIN_FIRST_UTIL_MARKER_PREFIX}${appId}`

  const propertyRecordId = await fetchPropertyRecordIdForPayments(propName)
  const pf = PAYMENTS_PROPERTY_LINK_FIELD

  for (let ri = 0; ri < ids.length; ri++) {
    const rid = ids[ri]
    let primaryDepositRecordId = null
    try {
      const resRow = await fetchResidentRecord(rid)
      const resName = String(resRow.Name || application['Signer Full Name'] || '').trim()
      const resEmail = String(resRow.Email || application['Signer Email'] || '').trim().toLowerCase()
      // Use application-derived propName as primary source; resident profile `House` may be a
      // linked-record array of property record IDs rather than a human-readable string.
      const prop = propName || resolveHouseText(resRow.House, '')
      const unit = String(resRow['Unit Number'] || roomNum).trim()

      const rows = [
        deposit > 0 && {
          key: 'deposit',
          existsMarker: markerDeposit,
          amount: deposit,
          Type: 'Security Deposit',
          Month: 'Security deposit',
          Notes: `Pending security deposit when application was approved. ${markerDeposit}`,
        },
        rent > 0 && {
          key: 'first_rent',
          existsMarker: markerRent,
          amount: rent,
          Type: 'First month rent',
          Month: 'First month rent',
          Notes: `Pending first month rent when application was approved. ${markerRent}`,
        },
        util > 0 && {
          key: 'first_util',
          existsMarker: markerUtil,
          amount: util,
          Type: 'Utilities',
          Month: 'First month utilities',
          Notes: `Pending first month utilities when application was approved. ${markerUtil}`,
        },
      ].filter(Boolean)

      for (const spec of rows) {
        if (ri === 0) {
          const subTag = submittedMarkerForMoveInKey(spec.key, appId)
          const subRec = await findFirstPaymentByNotesSubstring(subTag)
          if (subRec?.id) {
            try {
              const prevNotes = String(subRec.fields?.Notes || '')
              const approvedTag = spec.existsMarker
              const nextNotes = prevNotes.includes(approvedTag)
                ? prevNotes
                : `${prevNotes} Approved move-in line. ${approvedTag}`.trim()
              const claimFields = {
                [PAYMENTS_RESIDENT_LINK_FIELD]: [rid],
                Amount: spec.amount,
                Balance: spec.amount,
                Status: 'Unpaid',
                'Due Date': due,
                Type: spec.Type,
                Category: 'Rent',
                Kind: moveInKindForSpec(spec),
                'Line Item Type': 'Move-in',
                Month: spec.Month,
                Notes: nextNotes,
                'Resident Name': resName || undefined,
                'Resident Email': resEmail || undefined,
                'Property Name': prop || undefined,
                'Room Number': unit || undefined,
              }
              if (propertyRecordId) claimFields[pf] = [propertyRecordId]
              await airtablePatchRecord(subRec.id, claimFields)
              createdIds.push(subRec.id)
              if (spec.key === 'deposit') primaryDepositRecordId = subRec.id
              continue
            } catch (claimErr) {
              console.warn('[approved-application-movein-payments] claim submitted row failed', subRec.id, claimErr)
              skipped.push(`${rid}:${spec.key}:claim_failed`)
              continue
            }
          }
        }

        if (await moveInRowExists(rid, spec.existsMarker)) {
          skipped.push(`${rid}:${spec.key}`)
          if (ri === 0 && spec.key === 'deposit') {
            const hit = await findFirstPaymentByNotesSubstring(spec.existsMarker)
            if (hit?.id) primaryDepositRecordId = hit.id
          }
          continue
        }
        const postFields = {
          [PAYMENTS_RESIDENT_LINK_FIELD]: [rid],
          Amount: spec.amount,
          Balance: spec.amount,
          Status: 'Unpaid',
          'Due Date': due,
          Type: spec.Type,
          Category: 'Rent',
          Kind: moveInKindForSpec(spec),
          'Line Item Type': 'Move-in',
          Month: spec.Month,
          Notes: spec.Notes,
          'Resident Name': resName || undefined,
          'Resident Email': resEmail || undefined,
          'Property Name': prop || undefined,
          'Room Number': unit || undefined,
        }
        if (propertyRecordId) postFields[pf] = [propertyRecordId]
        const created = await airtablePost(payUrl, {
          fields: postFields,
          typecast: true,
        })
        if (created?.id) {
          createdIds.push(created.id)
          if (ri === 0 && spec.key === 'deposit') primaryDepositRecordId = created.id
        }
      }

      if (ri === 0) {
        const admin = Math.round(Number(leaseData.adminFee) * 100) / 100
        if (admin > 0 && primaryDepositRecordId) {
          try {
            await applyAdminFeeSplitFromSecurityDeposit({
              paymentsPostUrl: payUrl,
              applicationRecordId: appId,
              depositRecordId: primaryDepositRecordId,
              adminFeeUsd: admin,
              residentRecordId: rid,
              propertyName: prop,
              roomNumber: unit,
              resName,
              resEmail,
              propertyRecordId,
              dueDate: due,
            })
          } catch (adminErr) {
            console.warn('[approved-application-movein-payments] admin fee split failed', adminErr?.message || adminErr)
          }
        }
      }
    } catch (err) {
      console.warn('[approved-application-movein-payments] skip resident', rid, err?.message || err)
      skipped.push(rid)
    }
  }

  return { createdIds, skipped }
}
