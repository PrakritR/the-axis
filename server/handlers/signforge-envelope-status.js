/**
 * POST /api/portal?action=signforge-envelope-status
 * Body: { envelopeId: string }
 * Proxies SignForge GET /api/v1/envelopes/{id} with the server API key.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.SIGNFORGE_API_KEY
  if (!apiKey) {
    return res.status(501).json({ error: 'SIGNFORGE_API_KEY is not configured.' })
  }

  const envelopeId = String(req.body?.envelopeId || '').trim()
  if (!envelopeId) {
    return res.status(400).json({ error: 'envelopeId is required.' })
  }

  try {
    const sfRes = await fetch(`https://signforge.io/api/v1/envelopes/${encodeURIComponent(envelopeId)}`, {
      headers: { 'X-API-Key': apiKey },
    })
    const data = await sfRes.json().catch(() => ({}))
    if (!sfRes.ok) {
      return res.status(sfRes.status).json({
        error: data.error || data.message || `SignForge HTTP ${sfRes.status}`,
        details: data,
      })
    }
    return res.status(200).json({ ok: true, envelope: data })
  } catch (err) {
    console.error('[signforge-envelope-status]', err)
    return res.status(500).json({ error: err.message || 'SignForge status request failed.' })
  }
}
