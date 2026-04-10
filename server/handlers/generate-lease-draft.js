// ─── Lease Draft Generation API ───────────────────────────────────────────────
// POST /api/generate-lease-draft
//
// Full workflow:
//   1. Receives lease data (resident, property, dates, rent, etc.)
//   2. Calls Claude (claude-opus-4-6) to generate a professional lease document
//   3. Saves the AI draft to Airtable "Lease Drafts" table with status "Draft Generated"
//   4. Creates an audit log entry in the "Audit Log" table
//   5. Returns the created draft record to the manager
//
// The draft is intentionally NOT published at this point — a human manager must
// review, edit, and explicitly approve before it reaches the resident portal.

import Anthropic from '@anthropic-ai/sdk'

const AIRTABLE_TOKEN = process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

async function airtablePost(table, fields) {
  const res = await fetch(`${AIRTABLE_BASE_URL}/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable "${table}" error: ${text}`)
  }
  return res.json()
}

// Audit log insertion — non-fatal: log errors to console but don't fail the request
async function logAuditEvent({ leaseDraftId, actionType, performedBy, performedByRole, notes = '' }) {
  try {
    await airtablePost('Audit Log', {
      'Lease Draft ID': leaseDraftId,
      'Action Type': actionType,
      'Performed By': performedBy,
      'Performed By Role': performedByRole,
      'Timestamp': new Date().toISOString(),
      'Notes': notes,
    })
  } catch (err) {
    console.warn('[Audit Log] Insert failed (non-fatal):', err.message)
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return res.status(500).json({ error: 'AI API key is not configured on this server. Add ANTHROPIC_API_KEY to Vercel environment variables.' })
  }

  const {
    residentName,
    residentEmail,
    residentRecordId,
    property,
    unit,
    leaseStartDate,
    leaseEndDate,
    rentAmount,
    depositAmount,
    utilitiesFee,
    leaseTerm,
    applicationRecordId,
    generatedBy,
    generatedByRole,
  } = req.body || {}

  // Validate minimum required fields
  if (!residentName || !property || !leaseStartDate) {
    return res.status(400).json({
      error: 'Missing required fields: residentName, property, and leaseStartDate are required.',
    })
  }

  try {
    // ── Step 1: Generate lease text with Claude ──────────────────────────────
    const client = new Anthropic({ apiKey: anthropicKey })

    const leasePrompt = `You are a professional real estate attorney drafting a residential lease agreement for Axis Seattle Housing, LLC — a residential rental housing operator in Seattle, WA.

Generate a complete, professionally formatted residential lease agreement with the following details:

PARTIES:
- Landlord: Axis Seattle Housing, LLC
- Tenant/Resident: ${residentName}
- Tenant Email: ${residentEmail || 'On file with management'}

PROPERTY:
- Property Address: ${property}, Seattle, WA
- Unit/Room: ${unit || 'As assigned by management'}

LEASE TERMS:
- Lease Type: ${leaseTerm || 'Fixed Term'}
- Commencement Date: ${leaseStartDate}
- Expiration Date: ${leaseEndDate || 'Month-to-month continuation after initial term'}
- Monthly Rent: $${rentAmount || '0'}/month
- Security Deposit: $${depositAmount || '0'}
- Monthly Utilities Fee: $${utilitiesFee || '0'}/month (covers water, electricity, gas, high-speed WiFi)

Generate the full lease agreement with ALL of the following numbered sections. Each section must have a clear heading and substantive content:

1. PARTIES AND PREMISES
2. LEASE TERM
3. RENT AND PAYMENT TERMS
4. SECURITY DEPOSIT
5. UTILITIES AND SERVICES INCLUDED
6. OCCUPANCY AND PERMITTED USE
7. SHARED SPACES AND HOUSE RULES
8. FURNISHINGS AND PERSONAL PROPERTY
9. MAINTENANCE AND REPAIRS
10. ENTRY BY LANDLORD
11. PETS AND SMOKING POLICY
12. SUBLETTING AND ASSIGNMENT
13. ALTERATIONS AND IMPROVEMENTS
14. MOVE-OUT AND SURRENDER OF PREMISES
15. DEFAULT AND LANDLORD REMEDIES
16. QUIET ENJOYMENT
17. GENERAL PROVISIONS
18. GOVERNING LAW (Washington State)
19. ENTIRE AGREEMENT AND AMENDMENTS
20. SIGNATURES

Important requirements:
- Reference Washington State Residential Landlord-Tenant Act (RCW Chapter 59.18) where applicable
- Include specific clauses about shared housing etiquette, common areas, and co-tenant responsibilities
- Make the language clear, complete, and legally professional
- For the signatures section, use EXACTLY these placeholders (do not fill them in):
  Tenant Signature: [RESIDENT SIGNATURE]
  Tenant Printed Name: [RESIDENT PRINT NAME]
  Date: [DATE SIGNED]
  Landlord/Manager Signature: [MANAGER SIGNATURE]
  Landlord/Manager Printed Name: [MANAGER PRINT NAME]
  Date: [DATE SIGNED]
- Begin the document with the title "RESIDENTIAL LEASE AGREEMENT" centered at the top`

    const aiResponse = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: leasePrompt }],
    })

    const aiDraftContent = aiResponse.content[0]?.text || ''

    if (!aiDraftContent) {
      throw new Error('AI returned empty content. Please try again.')
    }

    // ── Step 2: Save draft to Airtable ───────────────────────────────────────
    const now = new Date().toISOString()

    const draftRecord = await airtablePost('Lease Drafts', {
      'Resident Name': residentName,
      'Resident Email': residentEmail || '',
      'Resident Record ID': residentRecordId || '',
      'Property': property,
      'Unit': unit || '',
      'Lease Start Date': leaseStartDate,
      'Lease End Date': leaseEndDate || '',
      'Rent Amount': rentAmount ? Number(rentAmount) : 0,
      'Deposit Amount': depositAmount ? Number(depositAmount) : 0,
      'Utilities Fee': utilitiesFee ? Number(utilitiesFee) : 0,
      'Lease Term': leaseTerm || '',
      'AI Draft Content': aiDraftContent,
      'Manager Edited Content': '',
      'Status': 'Draft Generated',
      'Updated At': now,
      'Application Record ID': applicationRecordId || '',
      'Manager Notes': '',
    })

    // ── Step 3: Audit log ────────────────────────────────────────────────────
    await logAuditEvent({
      leaseDraftId: draftRecord.id,
      actionType: 'Draft Generated',
      performedBy: generatedBy || 'System',
      performedByRole: generatedByRole || 'Manager',
      notes: `AI lease draft generated for ${residentName} at ${property}${unit ? `, ${unit}` : ''}. Model: claude-opus-4-6.`,
    })

    return res.status(200).json({
      draft: {
        id: draftRecord.id,
        ...draftRecord.fields,
      },
    })
  } catch (err) {
    console.error('[generate-lease-draft] Error:', err)
    return res.status(500).json({
      error: err.message || 'Failed to generate lease draft. Please try again.',
    })
  }
}
