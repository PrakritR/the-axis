/**
 * POST /api/portal?action=work-order-ai-suggest
 * Suggests a short manager reply for a maintenance work order thread (Claude).
 */
import Anthropic from '@anthropic-ai/sdk'

const MODEL = process.env.ANTHROPIC_WORK_ORDER_MODEL || 'claude-3-5-haiku-20241022'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(503).json({
      error: 'AI suggestions are not configured. Add ANTHROPIC_API_KEY to your server environment.',
    })
  }

  const {
    title = '',
    description = '',
    property = '',
    status = '',
    priority = '',
    messages = [],
    managerName = 'Manager',
  } = req.body || {}

  const threadLines = (Array.isArray(messages) ? messages : [])
    .map((m) => {
      const role = m?.isAdmin ? 'Manager' : 'Resident'
      const text = String(m?.text || '').trim()
      if (!text) return null
      return `${role}: ${text}`
    })
    .filter(Boolean)

  const prompt = `You help a housing property manager reply to a maintenance work order by email/chat.

Write ONE short reply (2–5 sentences) the manager can send to the resident. Be professional, warm, and clear.
- Acknowledge the issue.
- If status is still open, mention you're looking into it or scheduling (do not promise a specific time unless the notes say so).
- Do NOT claim the repair is finished unless status clearly indicates resolved/closed.
- Do not include a subject line or "Dear …" unless essential.
- No bullet lists unless the thread is complex.

Manager name (sign-off optional): ${managerName}

Work order
---
Property / house: ${property || '—'}
Title: ${title || '—'}
Status: ${status || '—'}
Priority: ${priority || '—'}
Description:
${description || '—'}

Thread (newest may be last):
${threadLines.length ? threadLines.join('\n') : '(no prior messages)'}

Reply text only:`

  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })
    const blocks = msg.content || []
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (!text) {
      return res.status(502).json({ error: 'AI returned an empty suggestion. Try again.' })
    }
    return res.status(200).json({ suggestion: text })
  } catch (err) {
    console.error('[work-order-ai-suggest]', err)
    return res.status(500).json({ error: err?.message || 'AI request failed' })
  }
}
