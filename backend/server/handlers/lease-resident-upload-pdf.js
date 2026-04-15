/**
 * POST /api/portal?action=lease-resident-upload-pdf
 *
 * Uploads a PDF to the current Lease Versions row for a draft (server-side Airtable token).
 * Body (JSON): leaseDraftId, residentRecordId, residentEmail, fileName, fileBase64
 * NO_AUTH — access verified against the lease draft row.
 */

import { draftBelongsToResident } from '../lib/lease-draft-resident-access.js'
import {
  isLeaseVersionUploaderOrDateUnknownField,
  leaseVersionDocUploaderPayload,
  leaseVersionLegacyUploaderPayload,
  stripLeaseVersionUploaderFieldVariants,
} from '../../../shared/lease-version-airtable-uploader-fields.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

const LEASE_VERSION_ATTACHMENT_FIELDS = ['PDF File', 'PDF', 'Attachment', 'File']
const MAX_FILE_BYTES = 3.5 * 1024 * 1024

function escapeFormulaValue(value) {
  return String(value).replace(/"/g, '\\"')
}

function atHeaders(json = true) {
  const h = { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

async function atGetJson(url) {
  const res = await fetch(url, { headers: atHeaders(true) })
  const text = await res.text()
  if (!res.ok) throw new Error(text.slice(0, 500))
  return JSON.parse(text)
}

async function atPostJson(path, bodyObj) {
  const res = await fetch(path, {
    method: 'POST',
    headers: atHeaders(true),
    body: JSON.stringify(bodyObj),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(text.slice(0, 500))
  return JSON.parse(text)
}

async function atPatchJson(path, bodyObj) {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: atHeaders(true),
    body: JSON.stringify(bodyObj),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(text.slice(0, 500))
  return JSON.parse(text)
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

function airtableUnknownFieldNameFromErrorMessage(message) {
  const raw = String(message || '').trim()
  try {
    const j = JSON.parse(raw)
    const m = j?.error?.message
    if (typeof m !== 'string') return null
    const match = m.match(/Unknown field name:\s*"([^"]+)"/i)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function isUnknownAttachmentFieldError(message) {
  return /unknown field name|field .* does not exist|cannot find field/i.test(String(message || ''))
}

function extractAttachmentUrl(uploadResponse, fieldName) {
  const fields = uploadResponse?.fields || uploadResponse?.record?.fields || {}
  const attachments = fields?.[fieldName]
  if (!Array.isArray(attachments)) return ''
  const first = attachments.find((item) => typeof item?.url === 'string' && item.url.trim())
  return first?.url?.trim() || ''
}

async function uploadAttachmentToRecord(table, recordId, fieldName, buffer, fileName, mimeType) {
  const formData = new FormData()
  const blob = new Blob([buffer], { type: mimeType || 'application/pdf' })
  formData.append('file', blob, fileName)
  formData.append('filename', fileName)
  formData.append('contentType', mimeType || 'application/pdf')

  const res = await fetch(
    `https://content.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${recordId}/${encodeURIComponent(fieldName)}/uploadAttachment`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      body: formData,
    },
  )
  const text = await res.text()
  if (!res.ok) throw new Error(text.slice(0, 500))
  return JSON.parse(text)
}

async function writeLeaseVersionCreateOrPatch({ recordId, coreFields, uploaderMeta }) {
  const { name, role, isoTime, recordId: uploaderRecordId } = uploaderMeta
  const path = recordId
    ? `${BASE_URL}/${encodeURIComponent('Lease Versions')}/${recordId}`
    : `${BASE_URL}/${encodeURIComponent('Lease Versions')}`
  const method = recordId ? 'PATCH' : 'POST'
  const run = async (fields) => {
    const data =
      method === 'PATCH'
        ? await atPatchJson(path, { fields, typecast: true })
        : await atPostJson(path, { fields, typecast: true })
    return mapRecord(data)
  }
  const firstFields = {
    ...coreFields,
    ...leaseVersionLegacyUploaderPayload({ name, role, isoTime }),
  }
  try {
    return await run(firstFields)
  } catch (err) {
    const unknown = airtableUnknownFieldNameFromErrorMessage(err.message)
    if (!unknown || !isLeaseVersionUploaderOrDateUnknownField(unknown)) throw err
    const nextFields = {
      ...stripLeaseVersionUploaderFieldVariants(firstFields),
      ...leaseVersionDocUploaderPayload({ name, isoTime, uploaderRecordId }),
    }
    return await run(nextFields)
  }
}

async function patchLeaseVersionFinalizeFields({ recordId, corePatch, uploaderMeta }) {
  const isoTime = new Date().toISOString()
  const path = `${BASE_URL}/${encodeURIComponent('Lease Versions')}/${recordId}`
  const firstFields = { ...corePatch, 'Upload Date': isoTime }
  const run = async (fields) => mapRecord(await atPatchJson(path, { fields, typecast: true }))
  try {
    return await run(firstFields)
  } catch (err) {
    const unknown = airtableUnknownFieldNameFromErrorMessage(err.message)
    if (!unknown || !isLeaseVersionUploaderOrDateUnknownField(unknown)) throw err
    const { name, recordId: uploaderRecordId } = uploaderMeta
    const nextFields = {
      ...stripLeaseVersionUploaderFieldVariants(firstFields),
      ...leaseVersionDocUploaderPayload({ name, isoTime, uploaderRecordId }),
    }
    return await run(nextFields)
  }
}

async function getCurrentLeaseVersionRow(draftId) {
  const url = new URL(`${BASE_URL}/${encodeURIComponent('Lease Versions')}`)
  url.searchParams.set('filterByFormula', `{Lease Draft ID} = "${escapeFormulaValue(draftId)}"`)
  url.searchParams.set('sort[0][field]', 'Version Number')
  url.searchParams.set('sort[0][direction]', 'desc')
  const data = await atGetJson(url.toString())
  const rows = (data.records || []).map(mapRecord)
  return rows.find((row) => Boolean(row['Is Current'])) || rows[0] || null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

  const {
    leaseDraftId,
    residentRecordId,
    residentEmail,
    fileName: rawFileName,
    fileBase64,
  } = req.body || {}

  const draftId = String(leaseDraftId || '').trim()
  const rid = String(residentRecordId || '').trim()
  const email = String(residentEmail || '').trim().toLowerCase()
  const b64 = String(fileBase64 || '').replace(/\s/g, '')
  const fileName = String(rawFileName || 'lease.pdf').trim() || 'lease.pdf'

  if (!draftId.startsWith('rec')) return res.status(400).json({ error: 'leaseDraftId is required.' })
  if (!rid.startsWith('rec') || !email) {
    return res.status(400).json({ error: 'residentRecordId and residentEmail are required.' })
  }
  if (!b64) return res.status(400).json({ error: 'fileBase64 is required.' })
  if (!/\.pdf$/i.test(fileName) && !String(req.body?.mimeType || '').includes('pdf')) {
    return res.status(400).json({ error: 'File must be a PDF.' })
  }

  let buffer
  try {
    buffer = Buffer.from(b64, 'base64')
  } catch {
    return res.status(400).json({ error: 'Invalid file encoding.' })
  }
  if (!buffer.length) return res.status(400).json({ error: 'Empty file.' })
  if (buffer.length > MAX_FILE_BYTES) {
    return res.status(400).json({
      error: `PDF is too large (max ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB). Try compressing the file or contact your manager.`,
    })
  }

  try {
    const currentDraft = await atGetJson(`${BASE_URL}/${encodeURIComponent('Lease Drafts')}/${draftId}`)
    const fields = currentDraft.fields || {}
    const draftRow = { id: currentDraft.id, ...fields }
    if (!draftBelongsToResident(draftRow, rid, email)) {
      return res.status(403).json({ error: 'Access denied.' })
    }

    const current = await getCurrentLeaseVersionRow(draftId)
    const versionNumber = Number(current?.['Version Number'] || draftRow['Current Version'] || 1) || 1
    const existingPdfUrl = String(current?.['PDF URL'] || '').trim()
    const isoTime = new Date().toISOString()
    const uploaderName = String(fields['Resident Name'] || email || 'Resident').slice(0, 200)

    const coreFields = {
      'Lease Draft ID': draftId,
      'Version Number': versionNumber,
      'File Name': fileName || `lease-v${versionNumber}.pdf`,
      'Notes': '',
      'Is Current': true,
    }
    if (existingPdfUrl) coreFields['PDF URL'] = existingPdfUrl

    const uploaderMeta = {
      name: uploaderName,
      role: 'Resident',
      isoTime,
      recordId: rid,
    }

    const saved = await writeLeaseVersionCreateOrPatch({
      recordId: current?.id || null,
      coreFields,
      uploaderMeta,
    })

    let uploadedUrl = ''
    let lastFieldError = null
    for (const fieldName of LEASE_VERSION_ATTACHMENT_FIELDS) {
      try {
        const uploadResponse = await uploadAttachmentToRecord(
          'Lease Versions',
          saved.id,
          fieldName,
          buffer,
          fileName,
          'application/pdf',
        )
        uploadedUrl = extractAttachmentUrl(uploadResponse, fieldName)
        if (!uploadedUrl) {
          const refreshed = await atGetJson(`${BASE_URL}/${encodeURIComponent('Lease Versions')}/${saved.id}`)
          uploadedUrl = extractAttachmentUrl(refreshed, fieldName)
        }
        if (uploadedUrl) break
        lastFieldError = new Error(`Uploaded PDF but could not read URL from ${fieldName}.`)
      } catch (err) {
        lastFieldError = err
        if (isUnknownAttachmentFieldError(err?.message)) continue
        throw err
      }
    }

    if (!uploadedUrl) {
      throw lastFieldError || new Error('Could not upload PDF. Add a PDF attachment field to Lease Versions.')
    }

    await patchLeaseVersionFinalizeFields({
      recordId: saved.id,
      corePatch: {
        'PDF URL': uploadedUrl,
        'File Name': fileName || saved['File Name'] || `lease-v${versionNumber}.pdf`,
        'Notes': '',
        'Is Current': true,
      },
      uploaderMeta,
    })

    await atPatchJson(`${BASE_URL}/${encodeURIComponent('Lease Drafts')}/${draftId}`, {
      fields: {
        'Current Version': versionNumber,
        'Updated At': new Date().toISOString(),
      },
      typecast: true,
    }).catch(() => {})

    return res.status(200).json({
      ok: true,
      versionNumber,
      leaseVersionId: saved.id,
      pdfUrl: uploadedUrl,
      fileName: fileName || saved['File Name'] || `lease-v${versionNumber}.pdf`,
    })
  } catch (err) {
    console.error('[lease-resident-upload-pdf]', err)
    return res.status(500).json({ error: err.message || 'Upload failed.' })
  }
}
