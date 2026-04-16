/**
 * POST /api/portal?action=application-submit-signer
 *
 * Public. PATCHes an existing Applications row. Payment is not required first:
 * applicants submit the full form, then pay the fee in the UI; Stripe webhook
 * sets Application Paid. This handler still sets Application Paid when:
 *  - promo waive (FEEWAIVE), OR
 *  - Application Fee Due (USD) on the row is 0 (no Stripe checkout).
 *
 * Client sends the same `fields` shape as the legacy direct-Airtable POST.
 */
import {
  airtableAuthHeaders,
  airtableErrorMessageFromBody,
  applicationsTableUrl,
  getApplicationsAirtableEnv,
  isAirtableModelOrPermissionsError,
} from '../lib/applications-airtable-env.js'
import { resolveExpectedApplicationFeeUsd } from '../lib/stripe-application-fee-usd.js'
import { createSubmittedApplicationFeePayment } from '../lib/submitted-application-fee-payment.js'
import { createSubmittedApplicationMoveInPayments } from '../lib/submitted-application-movein-payments.js'

function isPaidInAirtable(value) {
  if (value === true) return true
  if (value === false || value == null) return false
  const s = String(value).trim().toLowerCase()
  return s === 'yes' || s === 'true' || s === '1' || s === 'checked'
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const env = getApplicationsAirtableEnv()
  if (!env.token) {
    return res.status(500).json({ error: 'Data service is not configured on the server.' })
  }

  const applicationRecordId = String(req.body?.applicationRecordId || '').trim()
  const fields = req.body?.fields
  const promoWaive = Boolean(req.body?.promoWaive)
  const promoCode = String(req.body?.promoCode || '').trim().toUpperCase()

  if (!applicationRecordId.startsWith('rec')) {
    return res.status(400).json({ error: 'applicationRecordId is required.' })
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return res.status(400).json({ error: 'fields object is required.' })
  }

  const getUrl = `${applicationsTableUrl(env)}/${encodeURIComponent(applicationRecordId)}`
  const getRes = await fetch(getUrl, { headers: airtableAuthHeaders(env.token) })
  const getBody = await getRes.text()
  if (!getRes.ok) {
    if (isAirtableModelOrPermissionsError(getBody)) {
      console.error('[application-submit-signer] Airtable Applications not accessible', {
        baseId: env.baseId,
        table: env.table,
        httpStatus: getRes.status,
      })
      return res.status(503).json({
        error:
          'We could not connect to the application database (Airtable permissions or wrong base/table on the server). Try again later, use the email option on this page, or contact leasing. If you deploy this app: grant the server token access to the Applications table and set AIRTABLE_APPLICATIONS_BASE_ID / AIRTABLE_APPLICATIONS_TABLE if the table is not in the main base.',
      })
    }
    const detail = airtableErrorMessageFromBody(getBody)
    if (getRes.status === 404) {
      return res.status(404).json({
        error: detail
          ? `Application not found (${detail}). This can happen if the draft was created in another environment — start a new application or contact leasing.`
          : 'Application not found. This can happen if the draft was created in another environment — start a new application or contact leasing.',
      })
    }
    return res.status(502).json({
      error: detail || 'Could not load your application draft. Please try again.',
    })
  }
  const row = JSON.parse(getBody)

  const recordEmail = String(row.fields?.['Signer Email'] || '').trim().toLowerCase()
  const submittedEmail = String(fields['Signer Email'] || '').trim().toLowerCase()
  if (recordEmail && submittedEmail && recordEmail !== submittedEmail) {
    return res.status(403).json({ error: 'Email does not match this application record.' })
  }

  const promoOk = promoWaive && promoCode === 'FEEWAIVE'

  const defaultFeeUsd = resolveExpectedApplicationFeeUsd()
  const recordFeeRaw = env.feeDueField ? row.fields?.[env.feeDueField] : undefined
  const recordFeeNum = recordFeeRaw != null && String(recordFeeRaw).trim() !== '' ? Number(recordFeeRaw) : NaN
  const feeRequired = Number.isFinite(recordFeeNum) ? recordFeeNum > 0 : defaultFeeUsd > 0

  const paid = isPaidInAirtable(row.fields?.[env.paidField])

  const existingSig = String(row.fields?.[env.signatureField] || row.fields?.['Signer Signature'] || '').trim()
  const incomingSig = String(fields['Signer Signature'] || fields[env.signatureField] || '').trim()
  if (existingSig && incomingSig && existingSig === incomingSig) {
    return res.status(200).json({ id: row.id, fields: row.fields, idempotent: true })
  }

  const patchFields = { ...fields }
  delete patchFields[env.paidField]
  if (env.sessionField) delete patchFields[env.sessionField]
  if (promoOk) patchFields[env.paidField] = true
  if (!feeRequired) patchFields[env.paidField] = true

  const patchRes = await fetch(getUrl, {
    method: 'PATCH',
    headers: airtableAuthHeaders(env.token),
    body: JSON.stringify({ fields: patchFields, typecast: true }),
  })
  const text = await patchRes.text()
  if (!patchRes.ok) {
    if (isAirtableModelOrPermissionsError(text)) {
      console.error('[application-submit-signer] PATCH blocked — Airtable Applications not accessible', {
        baseId: env.baseId,
        table: env.table,
        httpStatus: patchRes.status,
      })
      return res.status(503).json({
        error:
          'We could not save to the application database (Airtable permissions or wrong base/table on the server). Try again later, use the email option on this page, or contact leasing.',
      })
    }
    console.error('[application-submit-signer]', patchRes.status, text.slice(0, 600))
    return res.status(502).json({
      error: airtableErrorMessageFromBody(text) || 'Could not save application to Airtable.',
    })
  }

  const saved = JSON.parse(text)

  const mergedApplication = {
    id: applicationRecordId,
    ...(saved.fields || {}),
    ...patchFields,
  }

  // Fire-and-forget: record the fee status in the Payments table so both the
  // manager and (after approval) the resident can see it.
  const effectiveFee = Number.isFinite(recordFeeNum) ? recordFeeNum : resolveExpectedApplicationFeeUsd()
  createSubmittedApplicationFeePayment({
    applicationRecordId,
    feeUsd: effectiveFee,
    paid: paid || promoOk || !feeRequired,
    waived: promoOk,
    promoCode: promoOk ? promoCode : undefined,
    signerFullName: String(fields['Signer Full Name'] || fields['Name'] || '').trim() || undefined,
    signerEmail: String(fields['Signer Email'] || '').trim().toLowerCase() || undefined,
    propertyName: String(fields['Property Name'] || '').trim() || undefined,
    roomNumber: String(fields['Room Number'] || '').trim() || undefined,
  }).catch(() => { /* non-critical */ })

  // Pending move-in lines (deposit / first rent / utilities) — same math as lease draft; no Resident until approval.
  createSubmittedApplicationMoveInPayments({ application: mergedApplication }).catch(() => { /* non-critical */ })

  return res.status(200).json(saved)
}
