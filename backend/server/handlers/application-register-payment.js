/**
 * POST /api/portal?action=application-register-payment
 *
 * Public (no manager session). Creates or reuses an Applications row before Stripe Checkout.
 * Reuses the same Airtable row for an email while the application is still incomplete
 * (no signer signature), including after a successful payment — avoids duplicate rows that
 * strand payment on one record while the UI holds another id.
 *
 * Stripe metadata carries application_record_id for the webhook.
 */
import { airtableAuthHeaders, applicationsTableUrl, getApplicationsAirtableEnv } from '../lib/applications-airtable-env.js'
import { airtableCreateWithUnknownFieldRetry } from '../lib/airtable-write-retry.js'
import { resolveExpectedApplicationFeeUsd } from '../lib/stripe-application-fee-usd.js'

function escapeFormulaString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

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

  const email = String(req.body?.email || '').trim().toLowerCase()
  const fullName = String(req.body?.fullName || '').trim() || 'Pending payment'
  const propertyName = String(req.body?.propertyName || '').trim()
  const roomNumber = String(req.body?.roomNumber || '').trim()
  const feeDue = Math.round(resolveExpectedApplicationFeeUsd() * 100) / 100

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required.' })
  }

  const baseUrl = applicationsTableUrl(env)
  const headers = airtableAuthHeaders(env.token)

  try {
    /** Prefer newest incomplete row (no signature) for this email — includes paid + unsigned. */
    const listUrl = new URL(baseUrl)
    listUrl.searchParams.set('filterByFormula', `LOWER({Signer Email})='${escapeFormulaString(email)}'`)
    listUrl.searchParams.set('maxRecords', '50')
    listUrl.searchParams.append('fields[]', env.paidField)
    listUrl.searchParams.append('fields[]', 'Signer Email')
    listUrl.searchParams.append('fields[]', env.signatureField)

    const listRes = await fetch(listUrl.toString(), { headers })
    let existing = null
    if (listRes.ok) {
      const listData = await listRes.json()
      const recs = Array.isArray(listData.records) ? listData.records : []
      const incomplete = recs.filter((r) => !String(r.fields?.[env.signatureField] || '').trim())
      incomplete.sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0))
      existing = incomplete[0] || null
    }

    if (existing?.id) {
      const alreadyPaid = isPaidInAirtable(existing.fields?.[env.paidField])
      return res.status(200).json({
        applicationRecordId: existing.id,
        reused: true,
        alreadyPaid: alreadyPaid,
      })
    }

    const fields = {
      Name: fullName,
      'Signer Email': email,
      'Signer Full Name': fullName,
      [env.paidField]: false,
    }
    if (propertyName) fields['Property Name'] = propertyName
    if (roomNumber) fields['Room Number'] = roomNumber
    if (env.feeDueField && feeDue >= 0) fields[env.feeDueField] = feeDue

    let created
    try {
      created = await airtableCreateWithUnknownFieldRetry({
        baseId: env.baseId,
        token: env.token,
        tableName: env.table,
        fields,
      })
    } catch (e1) {
      const paidVariants = [false, 0, 'No', 'Unpaid', 'Pending', 'Incomplete']
      const base = {
        Name: fullName,
        'Signer Email': email,
        'Signer Full Name': fullName,
      }
      if (propertyName) base['Property Name'] = propertyName
      if (roomNumber) base['Room Number'] = roomNumber
      if (env.feeDueField && feeDue >= 0) base[env.feeDueField] = feeDue
      let last = e1
      for (const pv of paidVariants) {
        try {
          const attempt = { ...base, [env.paidField]: pv }
          created = await airtableCreateWithUnknownFieldRetry({
            baseId: env.baseId,
            token: env.token,
            tableName: env.table,
            fields: attempt,
          })
          last = null
          break
        } catch (e2) {
          last = e2
        }
      }
      if (last) {
        console.error('[application-register-payment]', String(last?.message || last).slice(0, 500))
        return res.status(502).json({
          error:
            'Could not create application payment row in Airtable. Ensure required fields allow a minimal draft (Signer Email, Application Paid checkbox, optional fee-due field).',
        })
      }
    }
    return res.status(200).json({ applicationRecordId: created.id, reused: false, alreadyPaid: false })
  } catch (err) {
    console.error('[application-register-payment]', err)
    return res.status(500).json({ error: err?.message || 'Registration failed.' })
  }
}
