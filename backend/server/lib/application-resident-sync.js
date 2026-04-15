/**
 * Keep Resident Profile rows in sync with Applications approval/rejection
 * (resident portal reads Approved / Application Approval on Resident Profile).
 */

import {
  applicationApprovedUnitNumber,
  DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
} from '../../../shared/application-airtable-fields.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`
const RESIDENT_PROFILE_TABLE = 'Resident Profile'

const APPLICATION_REJECTED_FIELD = String(
  process.env.VITE_AIRTABLE_APPLICATION_REJECTED_FIELD ||
    process.env.AIRTABLE_APPLICATION_REJECTED_FIELD ||
    'Rejected',
).trim() || 'Rejected'

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

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

async function airtableGet(url) {
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }
  return res.json()
}

async function airtablePatch(url, fields) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }
  return res.json()
}

function escapeFormulaValue(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export async function listResidentsMatchingApplication(applicationRecordId, signerEmail) {
  const enc = encodeURIComponent(RESIDENT_PROFILE_TABLE)
  const byId = new Map()

  const run = async (formula) => {
    const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=25`
    const data = await airtableGet(url)
    for (const rec of data.records || []) {
      byId.set(rec.id, mapRecord(rec))
    }
  }

  const email = String(signerEmail || '').trim().toLowerCase()
  if (email) {
    await run(`LOWER({Email}) = "${escapeFormulaValue(email)}"`)
  }

  const appId = String(applicationRecordId || '').trim()
  if (appId.startsWith('rec')) {
    try {
      await run(`FIND("${escapeFormulaValue(appId)}", ARRAYJOIN({Applications})) > 0`)
    } catch (err) {
      console.warn(
        '[application-resident-sync] Applications-linked resident lookup skipped (field may not exist)',
        err?.message || err,
      )
    }
  }

  return [...byId.values()]
}

export async function patchResidentRecord(recordId, fields) {
  const enc = encodeURIComponent(RESIDENT_PROFILE_TABLE)
  return airtablePatch(`${CORE_AIRTABLE_BASE_URL}/${enc}/${recordId}`, fields)
}

/**
 * Resident portal checks Approved / Application Approval — keep in sync when an application is approved.
 */
export async function markMatchingResidentsApproved(application, ownerId) {
  const appId = application?.id
  const email = application?.['Signer Email']
  let rows = []
  try {
    rows = await listResidentsMatchingApplication(appId, email)
  } catch (err) {
    console.warn('[application-resident-sync] could not list residents', err)
    return { updatedIds: [], error: String(err?.message || err) }
  }

  const updatedIds = []
  const approvedUnit = applicationApprovedUnitNumber(application, APPLICATION_APPROVED_ROOM_FIELD)
  for (const r of rows) {
    try {
      const fields = {
        Approved: true,
        'Application Approval': 'Approved',
      }
      if (ownerId && !String(r['Owner ID'] || '').trim()) {
        fields['Owner ID'] = ownerId
      }
      if (approvedUnit) {
        fields['Unit Number'] = approvedUnit
      }
      await patchResidentRecord(r.id, fields)
      updatedIds.push(r.id)
    } catch (firstErr) {
      try {
        await patchResidentRecord(r.id, {
          Approved: true,
          'Application Approval': 'Approved',
          ...(approvedUnit ? { 'Unit Number': approvedUnit } : {}),
        })
        updatedIds.push(r.id)
      } catch (err) {
        try {
          await patchResidentRecord(r.id, { Approved: true, ...(approvedUnit ? { 'Unit Number': approvedUnit } : {}) })
          updatedIds.push(r.id)
        } catch (err2) {
          console.warn('[application-resident-sync] resident approve patch failed', r.id, firstErr, err, err2)
        }
      }
    }
  }
  return { updatedIds }
}

/**
 * Clear approval on matching Resident Profile rows when the application is rejected.
 */
export async function markMatchingResidentsRejected(application) {
  const appId = application?.id
  const email = application?.['Signer Email']
  let rows = []
  try {
    rows = await listResidentsMatchingApplication(appId, email)
  } catch (err) {
    console.warn('[application-resident-sync] could not list residents for reject', err)
    return { updatedIds: [], error: String(err?.message || err) }
  }

  const updatedIds = []
  for (const r of rows) {
    const fullRejectFields = {
      Approved: false,
      'Application Approval': 'Rejected',
      [APPLICATION_REJECTED_FIELD]: true,
    }
    try {
      await patchResidentRecord(r.id, fullRejectFields)
      updatedIds.push(r.id)
    } catch (firstErr) {
      try {
        await patchResidentRecord(r.id, {
          Approved: false,
          'Application Approval': 'Rejected',
        })
        updatedIds.push(r.id)
      } catch (secondErr) {
        try {
          await patchResidentRecord(r.id, { Approved: false })
          updatedIds.push(r.id)
        } catch (err) {
          console.warn('[application-resident-sync] resident reject patch failed', r.id, firstErr, secondErr, err)
        }
      }
    }
  }
  return { updatedIds }
}
