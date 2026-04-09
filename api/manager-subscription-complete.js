const STRIPE_API = 'https://api.stripe.com/v1'
const AIRTABLE_TOKEN = process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function stripeHeaders(secretKey) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

function escapeFormulaValue(value) {
  return String(value || '').replace(/"/g, '\\"')
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

function deriveManagerId(recordId) {
  const suffix = String(recordId || '').replace(/^rec/i, '').toUpperCase()
  return `MGR-${suffix}`
}

function extractPhoneFromNotes(notes) {
  const match = String(notes || '').match(/(?:^|\n)Phone:\s*(.+?)(?:\n|$)/i)
  return match ? match[1].trim() : ''
}

function extractMetadataValue(notes, label) {
  const escapedLabel = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(notes || '').match(new RegExp(`(?:^|\\n)${escapedLabel}:\\s*(.+?)(?:\\n|$)`, 'i'))
  return match ? match[1].trim() : ''
}

function planDetails(planType) {
  if (planType === 'business') {
    return {
      planType: 'business',
      houseAccess: '10+ houses',
      platformAccess: 'Rent collection, announcements, and work orders',
    }
  }

  return {
    planType: 'pro',
    houseAccess: '1-2 houses',
    platformAccess: 'Rent collection, announcements, and work orders',
  }
}

function mergeManagerNotes(existingNotes, metadata) {
  const labels = ['Phone', 'Plan', 'Billing', 'House Access', 'Platform Access']
  let stripped = String(existingNotes || '').trim()

  labels.forEach((label) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    stripped = stripped.replace(new RegExp(`(?:^|\\n)${escapedLabel}:\\s*.+?(?=\\n|$)`, 'gi'), '')
  })

  stripped = stripped.replace(/^\n+|\n+$/g, '').trim()

  const parts = []
  if (metadata.phone) parts.push(`Phone: ${metadata.phone}`)
  if (metadata.planType) parts.push(`Plan: ${metadata.planType}`)
  if (metadata.billingInterval) parts.push(`Billing: ${metadata.billingInterval}`)
  if (metadata.houseAccess) parts.push(`House Access: ${metadata.houseAccess}`)
  if (metadata.platformAccess) parts.push(`Platform Access: ${metadata.platformAccess}`)
  if (stripped) parts.push(stripped)
  return parts.join('\n')
}

function extractManagerPhone(manager, fallbackPhone = '') {
  return String(manager?.Phone || '').trim() || extractPhoneFromNotes(manager?.Notes) || String(fallbackPhone || '').trim()
}

async function getManagerByEmail(email) {
  const formula = encodeURIComponent(`{Email} = "${escapeFormulaValue(email)}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/Managers?filterByFormula=${formula}&maxRecords=1`
  const atRes = await fetch(url, { headers: airtableHeaders() })
  if (!atRes.ok) throw new Error('Database error')
  const data = await atRes.json()
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

async function createManager(fields) {
  const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Managers`, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!atRes.ok) {
    throw new Error(await atRes.text())
  }
  return mapRecord(await atRes.json())
}

async function updateManager(recordId, fields) {
  const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Managers/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!atRes.ok) {
    throw new Error(await atRes.text())
  }
  return mapRecord(await atRes.json())
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Airtable token is not configured on the server yet.' })
  }
  if (!secretKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on the server yet.' })
  }

  const sessionId = String(req.query?.session_id || '').trim()
  if (!sessionId) {
    return res.status(400).json({ error: 'session_id is required.' })
  }

  try {
    const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: stripeHeaders(secretKey),
    })
    const text = await stripeRes.text()
    if (!stripeRes.ok) {
      return res.status(502).json({ error: `Stripe session error ${stripeRes.status}: ${text}` })
    }

    const session = JSON.parse(text)
    const email = String(
      session.customer_details?.email ||
      session.customer_email ||
      session.metadata?.manager_email ||
      ''
    ).trim().toLowerCase()
    const name = String(session.metadata?.manager_name || session.customer_details?.name || '').trim()
    const phone = String(session.metadata?.manager_phone || session.customer_details?.phone || '').trim()
    const billingInterval = String(session.metadata?.billing_interval || 'monthly').trim().toLowerCase() === 'annual' ? 'annual' : 'monthly'
    const planType = String(session.metadata?.plan_type || 'pro').trim().toLowerCase() === 'business' ? 'business' : 'pro'
    const details = planDetails(planType)

    if (!email) {
      return res.status(400).json({ error: 'Stripe session did not include a manager email.' })
    }

    if (session.mode !== 'subscription' || !session.subscription) {
      return res.status(400).json({ error: 'This Stripe session is not a manager subscription session.' })
    }

    if (!['paid', 'no_payment_required'].includes(session.payment_status || '')) {
      return res.status(400).json({ error: 'The subscription checkout has not completed payment yet.' })
    }

    let manager = await getManagerByEmail(email)
    if (!manager) {
      manager = await createManager({
        Name: name || email.split('@')[0],
        Email: email,
        tier: details.planType,
        Active: true,
        Notes: mergeManagerNotes('', {
          phone,
          planType: details.planType,
          billingInterval,
          houseAccess: details.houseAccess,
          platformAccess: details.platformAccess,
        }),
      })
    }

    const derivedManagerId = deriveManagerId(manager.id)
    const nextFields = {}

    if (manager['Manager ID'] !== derivedManagerId) {
      nextFields['Manager ID'] = derivedManagerId
    }

    if (!manager.Name && name) {
      nextFields.Name = name
    }
    if (manager.tier !== details.planType) {
      nextFields.tier = details.planType
    }

    const nextNotes = mergeManagerNotes(manager.Notes, {
      phone,
      planType: details.planType,
      billingInterval,
      houseAccess: details.houseAccess,
      platformAccess: details.platformAccess,
    })
    if (nextNotes !== String(manager.Notes || '').trim()) {
      nextFields.Notes = nextNotes
    }

    if (Object.keys(nextFields).length > 0) {
      manager = await updateManager(manager.id, nextFields)
    }

    return res.status(200).json({
      email,
      name: manager.Name || name || email.split('@')[0],
      phone: extractManagerPhone(manager, phone),
      managerId: derivedManagerId,
      accountExists: Boolean(manager.Password),
      planType: extractMetadataValue(manager.Notes, 'Plan') || details.planType,
      billingInterval: extractMetadataValue(manager.Notes, 'Billing') || billingInterval,
      houseAccess: extractMetadataValue(manager.Notes, 'House Access') || details.houseAccess,
      platformAccess: extractMetadataValue(manager.Notes, 'Platform Access') || details.platformAccess,
      message: manager.Password
        ? 'Subscription verified. You can sign in now.'
        : `Subscription verified. Your manager ID is ${derivedManagerId}. Use it to create your manager account below.`,
    })
  } catch (err) {
    console.error('Manager subscription completion error:', err)
    return res.status(500).json({ error: 'Could not verify the manager subscription.' })
  }
}
