const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const ADMIN_PROFILE_TABLE = process.env.AIRTABLE_ADMIN_PROFILE_TABLE || 'Admin Profile'
const TABLE_ENC = encodeURIComponent(ADMIN_PROFILE_TABLE)

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Server data connection is not configured yet.' })
  }

  const { airtableRecordId, email, name, phone } = req.body || {}
  const recordId = String(airtableRecordId || '').trim()
  const em = String(email || '').trim().toLowerCase()
  const normalizedName = String(name || '').trim()
  const normalizedPhone = String(phone || '').trim()

  if (!recordId || !recordId.startsWith('rec')) {
    return res.status(400).json({ error: 'Valid admin profile record is required to save changes.' })
  }
  if (!em || !em.includes('@')) {
    return res.status(400).json({ error: 'Email is required.' })
  }
  if (!normalizedName && !normalizedPhone) {
    return res.status(400).json({ error: 'At least name or phone is required.' })
  }

  try {
    const getUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ENC}/${recordId}`
    const atRes = await fetch(getUrl, { headers: airtableHeaders() })
    if (!atRes.ok) {
      return res.status(404).json({ error: 'Admin profile record not found.' })
    }
    const record = await atRes.json()
    const rowEmail = String(record.fields?.Email || '')
      .trim()
      .toLowerCase()
    if (rowEmail !== em) {
      return res.status(403).json({ error: 'Email does not match this profile record.' })
    }

    const updates = {}
    if (normalizedName) updates.Name = normalizedName
    if (normalizedPhone) updates['Phone Number'] = normalizedPhone

    const patchRes = await fetch(getUrl, {
      method: 'PATCH',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: updates, typecast: true }),
    })
    if (!patchRes.ok) {
      const errText = await patchRes.text().catch(() => '')
      console.warn('[admin-update-profile] patch failed', patchRes.status, errText.slice(0, 200))
      return res.status(500).json({ error: 'Could not update admin profile.' })
    }
    const updated = await patchRes.json()
    const f = updated.fields || {}
    return res.status(200).json({
      name: String(f.Name || normalizedName || '').trim(),
      phone: String(f['Phone Number'] || normalizedPhone || '').trim(),
    })
  } catch (err) {
    console.error('[admin-update-profile]', err)
    return res.status(500).json({ error: 'Could not update admin profile.' })
  }
}
