/**
 * POST /api/portal?action=lease-resident-download-generated-pdf
 *
 * Same output as lease-download-generated-pdf, but authenticates the caller
 * as the lease resident (record id + email) instead of a manager session.
 * Registered as NO_AUTH — body must prove access to the draft row.
 */

import { buildLeasePdfHtml, buildStructuredLeasePdfHtml } from '../lib/lease-html-document.js'
import { renderHtmlToPdfBuffer } from '../lib/lease-puppeteer-pdf.js'
import { draftBelongsToResident } from '../lib/lease-draft-resident-access.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

function atHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

async function atGetLeaseDraft(recordId) {
  const res = await fetch(`${BASE_URL}/Lease%20Drafts/${encodeURIComponent(recordId)}`, {
    headers: atHeaders(),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t.slice(0, 400))
  }
  const data = await res.json()
  return { id: data.id, ...data.fields }
}

function filenameSlug(draft) {
  const prop = String(draft?.Property || 'lease')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'lease'
  return `axis-generated-lease-${prop}.pdf`
}

function htmlForDraft(draft) {
  const leaseJsonRaw = String(draft['Lease JSON'] || '').trim()
  let html = ''
  if (leaseJsonRaw) {
    try {
      const parsed = JSON.parse(leaseJsonRaw)
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        html = buildStructuredLeasePdfHtml(parsed)
      }
    } catch {
      /* fall through */
    }
  }
  if (!html) {
    const aiDraft = String(draft['AI Draft Content'] || '').trim()
    if (aiDraft) {
      const subtitle = [draft.Property, draft.Unit].filter(Boolean).join(' · ')
      html = buildLeasePdfHtml({
        title: 'RESIDENTIAL LEASE AGREEMENT',
        subtitle,
        bodyText: aiDraft,
      })
    }
  }
  return html
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

  const { leaseDraftId, residentRecordId, residentEmail } = req.body || {}
  const id = String(leaseDraftId || '').trim()
  const rid = String(residentRecordId || '').trim()
  const email = String(residentEmail || '').trim().toLowerCase()

  if (!id.startsWith('rec')) {
    return res.status(400).json({ error: 'leaseDraftId (record id) is required.' })
  }
  if (!rid.startsWith('rec') || !email) {
    return res.status(400).json({ error: 'residentRecordId and residentEmail are required.' })
  }

  try {
    const draft = await atGetLeaseDraft(id)
    if (!draftBelongsToResident(draft, rid, email)) {
      return res.status(403).json({ error: 'Access denied.' })
    }

    const html = htmlForDraft(draft)
    if (!html) {
      return res.status(400).json({
        error:
          'No generated lease is available yet. Generate the lease (Lease JSON or AI draft) before downloading.',
      })
    }

    const pdfBuffer = await renderHtmlToPdfBuffer(html)
    const name = filenameSlug(draft)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    return res.status(200).send(Buffer.from(pdfBuffer))
  } catch (err) {
    console.error('[lease-resident-download-generated-pdf]', err)
    return res.status(500).json({ error: err.message || 'Could not generate PDF.' })
  }
}
