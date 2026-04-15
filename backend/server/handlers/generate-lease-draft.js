// ─── Lease Draft Generation API ───────────────────────────────────────────────
// POST /api/generate-lease-draft
//
// Full workflow:
//   1. Receives lease data (resident, property, dates, rent, etc.)
//   2. Calls Claude (claude-opus-4-6) to generate a professional lease document
//   3. Saves the AI draft to "Lease Drafts" table with status "Draft Generated"
//   4. Creates an audit log entry in the "Audit Log" table
//   5. Returns the created draft record to the manager
//
// The draft is intentionally NOT published at this point — a human manager must
// review, edit, and explicitly approve before it reaches the resident portal.

import Anthropic from '@anthropic-ai/sdk'
import {
  evaluateLeaseAccessPrereqs,
  normalizeLeaseAccessRequirement,
  paymentsIndicateFirstMonthRentPaid,
  paymentsIndicateSecurityDepositPaid,
} from '../../../shared/lease-access-requirements.js'
import {
  applicationLeaseRoomNumber,
  applicationHasApprovedUnitAssigned,
  DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
} from '../../../shared/application-airtable-fields.js'
import { isApplicationApprovedForLease } from '../lib/application-approval-lease-guard.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
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
    throw new Error(`Records API "${table}" error: ${text}`)
  }
  return res.json()
}

async function airtableGet(url) {
  const res = await fetch(url, {
    headers: airtableHeaders(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Records API read error: ${text}`)
  }
  return res.json()
}

async function listPaymentsForResidentRecordId(residentRecordId) {
  const rid = String(residentRecordId || '').trim()
  if (!rid.startsWith('rec')) return []
  const formula = encodeURIComponent(`FIND("${escapeFormulaValue(rid)}", ARRAYJOIN({Resident})) > 0`)
  const url = `${AIRTABLE_BASE_URL}/Payments?filterByFormula=${formula}&pageSize=100`
  try {
    const data = await airtableGet(url)
    return (data.records || []).map((r) => ({ id: r.id, ...r.fields }))
  } catch {
    return []
  }
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

function normalizeApplicationRecordId(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  return value.startsWith('APP-') ? value.slice(4) : value
}

function escapeFormulaValue(value) {
  return String(value || '').replace(/"/g, '\\"')
}

async function findExistingDraftByApplicationRecordId(applicationRecordId) {
  const recordId = normalizeApplicationRecordId(applicationRecordId)
  if (!recordId) return null
  const formula = encodeURIComponent(`{Application Record ID} = "${escapeFormulaValue(recordId)}"`)
  const url = `${AIRTABLE_BASE_URL}/Lease%20Drafts?filterByFormula=${formula}&sort[0][field]=Updated%20At&sort[0][direction]=desc&maxRecords=1`
  const data = await airtableGet(url)
  const rec = data.records?.[0]
  return rec ? { id: rec.id, ...rec.fields } : null
}

async function findPropertyByName(propertyName) {
  const name = String(propertyName || '').trim()
  if (!name) return null
  const formula = encodeURIComponent(`{Property Name} = "${escapeFormulaValue(name)}"`)
  const url = `${AIRTABLE_BASE_URL}/Properties?filterByFormula=${formula}&maxRecords=1`
  const data = await airtableGet(url)
  const rec = data.records?.[0]
  return rec ? { id: rec.id, ...rec.fields } : null
}

function buildLeasePrompt({
  residentName,
  residentEmail,
  property,
  unit,
  leaseStartDate,
  leaseEndDate,
  rentAmount,
  depositAmount,
  utilitiesFee,
  leaseTerm,
}) {
  const facts = `FACTS (use exactly; do not invent amounts, dates, or amenities):
- Landlord: Axis Seattle Housing, LLC
- Resident: ${residentName}
- Resident email: ${residentEmail || 'On file with management'}
- Property: ${property}, Seattle, WA
- Room / unit: ${unit || 'As assigned by management'}
- Lease type: ${leaseTerm || 'Fixed term'}
- Commencement: ${leaseStartDate}
- Expiration / continuation: ${leaseEndDate || 'Month-to-month after initial term unless otherwise agreed in writing'}
- Monthly rent: $${rentAmount || '0'}/month
- Security deposit: $${depositAmount || '0'}
- Monthly utilities / household services fee (if any): $${utilitiesFee || '0'}/month (describe as shared-household allocation; do not invent inclusions beyond typical utilities/Wi-Fi unless stated)`

  return `${facts}

You are drafting a Washington State residential tenancy for **shared housing** (private room + common areas). The output must be suitable for professional property management: **legally careful**, **readable**, and **split into two parts** — do not mash addenda into unreadable walls of text.

## OUTPUT FORMAT (mandatory)

1. Start with a centered title: **RESIDENTIAL LEASE AGREEMENT**
2. Subtitle line: **Axis Seattle Housing, LLC · State of Washington**
3. **PART I — CORE lease** — numbered sections 1 through 22 (headings like "1. Parties and Premises"). Use short paragraphs and bold lead-ins where helpful.
4. A horizontal rule or clear "PART II — ADDENDA" divider.
5. **PART II — Addenda** — each addendum lettered **ADDENDUM A** through **ADDENDUM K** with its own heading and substantive clauses (not one-liners).
6. End with **SIGNATURES** using EXACTLY these placeholders (do not fill):
   Tenant Signature: [RESIDENT SIGNATURE]
   Tenant Printed Name: [RESIDENT PRINT NAME]
   Date: [DATE SIGNED]
   Landlord/Manager Signature: [MANAGER SIGNATURE]
   Landlord/Manager Printed Name: [MANAGER PRINT NAME]
   Date: [DATE SIGNED]

If any fact above is missing for a clause, use **[MISSING DATA]** — do not guess.

## PART I — Required core sections (minimum)

1. **Parties and Premises** — landlord, resident, co-living description, Seattle/WA situs, integration with addenda.
2. **Lease Term** — fixed vs month-to-month; **RCW 59.18.200**: **20 days'** written notice before the end of a rental period for tenant termination where that statute applies (never confuse 20 days with landlord entry notice).
3. **Rent and Payment** — due date, methods, **RCW 59.18.140** late fee (must be in writing in the lease; no unconscionable fees). **Payment allocation order** (e.g. damage → utilities → fees → past rent → current rent) unless law requires otherwise. **Returned payment / NSF**: actual bank fees plus **reasonable** returned-payment fee capped by **RCW 62A.3-421** or lower. **Fee stacking**: state that lawful fees do not compound unlawfully; late fee applies only to delinquent **rent** as statute contemplates. Optional **notice preparation / statutory notice pass-through** only to the extent expressly allowed by Washington law (if uncertain, say "only if permitted by statute" rather than inventing a dollar amount).
4. **Security Deposit** — **RCW 59.18.260** (receipt, holding, wrongful retention), **RCW 59.18.280** (21-day itemized statement after tenancy ends). Tie deposit to **written baseline condition** (see Addendum A). Deductions may not include **ordinary wear and tear**.
5. **Utilities & services** — if a flat utilities fee is stated, explain allocation, billing with rent, **non-payment as monetary default** after proper notice where allowed, **no account transfer** without landlord consent, and **adjustment**: landlord may change the monthly utilities component with **not less than thirty (30) days' prior written notice** where lawful (if a change is not permitted, say resident may terminate with statutory notice instead of accepting — phrase in a Washington-compliant way).
6. **Occupancy & guests** — single primary resident; guest limits; unauthorized occupants.
7. **Shared spaces & house rules** — kitchen/bath/laundry etiquette; trash; cannabis smoking outdoors only where lawful; noise.
8. **Furnishings & personal property** — landlord vs resident property; no removal of landlord furnishings.
9. **Maintenance & repairs** — **RCW 59.18.060** habitability; **RCW 59.18.070** timelines after written notice where applicable; resident reporting; **no grease/chemicals** in drains; emergencies (911 + notify landlord). **Tenant maintenance**: HVAC filters per schedule, promptly report leaks, keep drains clear, reset breakers/GFCIs only when safe, pest reporting.
10. **Safety devices & disclosures** — include a subsection titled **SMOKE DETECTORS (RCW 43.44.110)** with substantially this language (may merge sentences but do not omit concepts): Resident acknowledges and the landlord certifies that the property is equipped with smoke detectors as required by RCW 43.44.110. Resident shall maintain devices per manufacturer (batteries/power, testing), notify management of malfunctions, and **not remove or disable** smoke detectors. Add **carbon monoxide alarms** where required (**RCW 19.27.530** / code). Add **domestic hot water** / anti-scald (code-compliant tempering; resident shall not adjust water heater controls without permission). Add **general fire safety**: no obstruction of egress, no misuse of extension cords, no open flame hazards except as law allows.
11. **Lead-based paint** — if building may be pre-1978, include federal **42 U.S.C. §4852d / 40 C.F.R. Part 745** pamphlet receipt and disclosure; if unknown, say disclosure completed to best of landlord knowledge or attach **[MISSING DATA]** for year built.
12. **Entry** — **RCW 59.18.150**: **24 hours' written notice** for non-emergency entry to the **private room**; emergencies without prior notice when reasonably necessary; common-area entry for management without same notice when appropriate.
13. **Pets, smoking, cannabis** — Washington-appropriate; default no pets without written consent.
14. **Assignment / subletting** — prior written consent; unauthorized subletting as breach.
15. **Alterations** — no alterations without written consent.
16. **Insurance** — strongly recommend **renters insurance** (liability + personal property); landlord not insurer of resident contents.
17. **Liability & indemnity** — to the extent permitted by Washington law: limitation of landlord liability except for gross negligence/willful misconduct or where statute forbids limitation; **no duty as to crime by third parties** (no guaranty of security); resident indemnity for resident/guest-caused claims **except** landlord negligence/willful misconduct; **survival** of key provisions.
18. **Move-out & surrender** — broom-clean; keys/fobs; **professional cleaning** standard if left unreasonably dirty; carpet cleaning only for **tenant-caused** damage/stains beyond wear and tear, with itemization.
19. **Early termination / lease break** — **duty to mitigate** under Washington law; resident liable for **actual damages** and **unpaid lawful charges** through the earlier of (a) lease end or (b) date a **replacement tenant** acceptable to landlord begins paying rent; **documented re-leasing costs** (advertising, screening, reasonable admin). Optional **reasonable administrative lease-break fee** only if framed as **reasonable estimate of actual turnover costs** and not a penalty — if you include a dollar amount and none is provided in facts, use **[LEASE BREAK FEE TBD]**.
20. **Default & remedies** — pay-or-vacate / comply notices under **RCW 59.12** and **RCW 59.18** as applicable; no unlawful self-help lockouts or utility shutoff for eviction purposes.
21. **Quiet enjoyment** — statutory covenant where applicable.
22. **Legal enforcement** — **Severability** (reform-to-minimum-extent clause). **No oral modification**; integrated agreement **with addenda**. **Attorneys' fees**: prevailing party to the extent allowed by **RCW 59.18.290** and other applicable Washington law (do not promise fees in consumer contexts where prohibited). **Venue**: King County, Washington (or county where premises sit if different — if property is Seattle, King County is appropriate). **Waiver**: no waiver unless in writing; course of dealing does not waive.

## PART II — Addenda (each required; letter as shown)

**ADDENDUM A — Property Condition & Move-In Inspection (Deposit Baseline)**  
Joint move-in inspection; **Property Condition Checklist**; resident may submit **written list of existing deficiencies within fourteen (14) calendar days** after possession; integration with **RCW 59.18.260 / 59.18.280** deposit accounting; photographs encouraged.

**ADDENDUM B — Deposit Deductions, Cleaning & Repair Standards**  
Itemized categories: unpaid rent/charges; damage beyond wear/tear; **reasonable** cleaning to restore to **rent-ready** standard; **carpet** only for tenant-caused damage; **lost keys/fobs** at documented cost; **after-hours lockout** fees at actual cost if posted; **hourly repair labor** billed at landlord's **documented** internal rate or vendor invoice **not to exceed prevailing reasonable market rates** (no padded "penalty" rates). Estimates for work above a reasonable threshold (e.g. $250) when practicable.

**ADDENDUM C — Utilities, Billing & Household Services**  
Flat fee mechanics; true-up if lawfully allowed; **30-day notice** for changes; dispute process (written notice + meeting); cooperation with energy audits.

**ADDENDUM D — Bed Bugs**  
Reporting; cooperation with inspection/treatment; **tenant-caused** treatment costs if infestation attributable to resident conduct; withholding treatment = breach.

**ADDENDUM E — Mold, Moisture & Ventilation**  
Moisture control (bathroom fans, wiping condensation, reporting leaks within 24 hours); **no painting over mold**; landlord response for building-system moisture; tenant responsibility for tenant-caused humidity.

**ADDENDUM F — Pests (General), Garbage & Sanitation**  
Integrated pest management cooperation; secured food/trash; fines only as lawful charges with notice.

**ADDENDUM G — Rules, Nuisance & Conduct**  
Detailed quiet hours; harassment zero tolerance; common-area scheduling; parking/bike rules placeholder; **noise/nuisance** enforcement steps (notice + cure).

**ADDENDUM H — Cosigner / Guaranty** (if no cosigner, state "Not used for this tenancy" in one sentence)

**ADDENDUM I — Renters Insurance & Liability Limits**  
Minimum suggested liability coverage **[e.g. $100,000]** as recommendation only unless otherwise required by landlord policy in writing; additional interest / named additional insured optional.

**ADDENDUM J — Emergency & Mass Communication**  
Contact tree; shelter-in-place; city alert systems (informational).

**ADDENDUM K — Entire Agreement Order of Precedence**  
Core + addenda; if conflict, safer interpretation for habitability/statutory rights wins.

## Washington compliance reminders (do not contradict)

- **RCW 59.18.200** — **20-day** tenant notice to end month-to-month / periodic tenancy (not for landlord private-room entry).
- **RCW 59.18.150** — **24-hour** written notice for non-emergency entry to resident's **private room**.
- Deposits: **RCW 59.18.260**, return/itemization **RCW 59.18.280** (21 days after tenancy ends and possession delivered).
- Late fees **RCW 59.18.140** — agreed in writing in the lease; reasonable.
- No **penalty** early-termination charges disguised as liquidated damages—tie to **actual damages + mitigation**.

Tone: modern, clear, **Axis-branded** professionalism — not archaic ALL-CAPS spam. Use bullet lists inside addenda where it improves clarity.

Generate the full document now.`
}

export async function createLeaseDraft({
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
}) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    throw new Error('AI API key is not configured on this server. Add ANTHROPIC_API_KEY to Vercel environment variables.')
  }

  if (!residentName || !property || !leaseStartDate) {
    throw new Error('Missing required fields: residentName, property, and leaseStartDate are required.')
  }

  const existingDraft = await findExistingDraftByApplicationRecordId(applicationRecordId)
  if (existingDraft) {
    return { draft: existingDraft, created: false }
  }

  const client = new Anthropic({ apiKey: anthropicKey })
  const leasePrompt = buildLeasePrompt({
    residentName,
    residentEmail,
    property,
    unit,
    leaseStartDate,
    leaseEndDate,
    rentAmount,
    depositAmount,
    utilitiesFee,
    leaseTerm,
  })

  const aiResponse = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 16384,
    messages: [{ role: 'user', content: leasePrompt }],
  })

  const aiDraftContent = aiResponse.content[0]?.text || ''
  if (!aiDraftContent) {
    throw new Error('AI returned empty content. Please try again.')
  }

  const now = new Date().toISOString()
  const propertyRecord = await findPropertyByName(property)
  const payments = residentRecordId ? await listPaymentsForResidentRecordId(residentRecordId) : []
  const snap = normalizeLeaseAccessRequirement(propertyRecord?.['Lease Access Requirement'])
  const sdP = paymentsIndicateSecurityDepositPaid(payments)
  const fmP = paymentsIndicateFirstMonthRentPaid(payments)
  const accessEval = evaluateLeaseAccessPrereqs({
    requirement: snap,
    securityDepositPaid: sdP,
    firstMonthRentPaid: fmP,
    managerSignWithoutPayOverride: false,
  })

  const draftRecord = await airtablePost('Lease Drafts', {
    'Resident Name': residentName,
    'Resident Email': residentEmail || '',
    'Resident Record ID': residentRecordId || '',
    Property: property,
    Unit: unit || '',
    'Lease Start Date': leaseStartDate,
    'Lease End Date': leaseEndDate || '',
    'Rent Amount': rentAmount ? Number(rentAmount) : 0,
    'Deposit Amount': depositAmount ? Number(depositAmount) : 0,
    'Utilities Fee': utilitiesFee ? Number(utilitiesFee) : 0,
    'Lease Term': leaseTerm || '',
    'AI Draft Content': aiDraftContent,
    'Manager Edited Content': '',
    Status: 'Draft Generated',
    'Updated At': now,
    'Application Record ID': normalizeApplicationRecordId(applicationRecordId) || '',
    'Manager Notes': '',
    'Lease Access Requirement Snapshot': snap,
    'Lease Access Granted': accessEval.met,
    'Lease Access Block Reason': accessEval.met ? '' : accessEval.blockReason,
    ...(accessEval.met ? { 'Lease Access Granted At': now } : {}),
  })

  await logAuditEvent({
    leaseDraftId: draftRecord.id,
    actionType: 'Draft Generated',
    performedBy: generatedBy || 'System',
    performedByRole: generatedByRole || 'Manager',
    notes: `AI lease draft generated for ${residentName} at ${property}${unit ? `, ${unit}` : ''}. Model: claude-opus-4-6.`,
  })

  return {
    draft: {
      id: draftRecord.id,
      ...draftRecord.fields,
    },
    created: true,
  }
}

export async function createLeaseDraftFromApplication({
  application,
  generatedBy,
  generatedByRole,
}) {
  if (!isApplicationApprovedForLease(application)) {
    throw new Error('Lease drafts are only created for approved applications.')
  }
  const propertyName = String(application?.['Property Name'] || '').trim()
  const propertyRecord = await findPropertyByName(propertyName)
  const approvedRoomField = String(
    process.env.VITE_AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD ||
      process.env.AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD ||
      DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
  ).trim() || DEFAULT_AXIS_APPLICATION_APPROVED_ROOM
  const unitFromApp = applicationLeaseRoomNumber(application, approvedRoomField)
  if (!applicationHasApprovedUnitAssigned(application, approvedRoomField)) {
    throw new Error(
      'Set the approved unit/room on the application before generating a lease — the lease uses that assignment, not the applicant’s first choice.',
    )
  }

  return createLeaseDraft({
    residentName: String(application?.['Signer Full Name'] || '').trim(),
    residentEmail: String(application?.['Signer Email'] || '').trim(),
    residentRecordId: String(application?.Resident?.[0] || '').trim(),
    property: propertyName,
    unit: String(unitFromApp || '').trim(),
    leaseStartDate: application?.['Lease Start Date'] || '',
    leaseEndDate: application?.['Lease End Date'] || '',
    rentAmount: application?.['Rent Amount'] || application?.Rent || 0,
    depositAmount: propertyRecord?.['Security Deposit'] || application?.['Security Deposit'] || 0,
    utilitiesFee: propertyRecord?.['Utilities Fee'] || application?.['Utilities Fee'] || 0,
    leaseTerm: String(application?.['Lease Term'] || '').trim(),
    applicationRecordId: application?.id || application?.['Application Record ID'] || application?.['Application ID'] || '',
    generatedBy,
    generatedByRole,
  })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
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

  try {
    const { draft } = await createLeaseDraft({
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
    })
    return res.status(200).json({
      draft,
    })
  } catch (err) {
    console.error('[generate-lease-draft] Error:', err)
    return res.status(500).json({
      error: err.message || 'Failed to generate lease draft. Please try again.',
    })
  }
}
