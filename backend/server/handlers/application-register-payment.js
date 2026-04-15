/**
 * POST /api/portal?action=application-register-payment
 *
 * Public (no manager session). Creates or reuses an Applications row with
 * Application Paid = false before the applicant opens Stripe Checkout.
 * Stripe metadata will carry application_record_id for the webhook.
 */
import { airtableAuthHeaders, applicationsTableUrl, getApplicationsAirtableEnv } from '../lib/applications-airtable-env.js'
import { airtableCreateWithUnknownFieldRetry } from '../lib/airtable-write-retry.js'
import { resolveExpectedApplicationFeeUsd } from '../lib/stripe-application-fee-usd.js'

function escapeFormulaString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
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
  const feeDue = Math.round(resolveExpectedApplicationFeeUsd())

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required.' })
  }

  const baseUrl = applicationsTableUrl(env)
  const headers = airtableAuthHeaders(env.token)

  try {
    const findUrl = new URL(baseUrl)
    findUrl.searchParams.set(
      'filterByFormula',
      `AND(LOWER({Signer Email}) = '${escapeFormulaString(email)}', NOT({${escapeFormulaString(env.paidField)}}))`,
    )
    findUrl.searchParams.set('maxRecords', '1')
    findUrl.searchParams.append('fields[]', env.paidField)
    findUrl.searchParams.append('fields[]', 'Signer Email')

    const findRes = await fetch(findUrl.toString(), { headers })
    if (findRes.ok) {
      const findData = await findRes.json()
      const existing = findData.records?.[0]
      if (existing?.id) {
        return res.status(200).json({ applicationRecordId: existing.id, reused: true })
      }
    }

    const fields = {
      // Many bases use "Name" as the primary field; omit if unknown via create retry.
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
    return res.status(200).json({ applicationRecordId: created.id, reused: false })
  } catch (err) {
    console.error('[application-register-payment]', err)
    return res.status(500).json({ error: err?.message || 'Registration failed.' })
  }
}
