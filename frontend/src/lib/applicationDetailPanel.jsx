import React from 'react'
import { StatusPill } from '../components/PortalShell'
import {
  deriveApplicationApprovalState,
  applicationDisplayLabelFromApprovalState,
} from './applicationApprovalState.js'
import { parseAxisListingMetaBlock } from './axisListingMeta.js'
import { normalizeLeasingFromMeta } from './managerPropertyFormAirtableMap.js'

export function formatApplicationDetailValue(val) {
  if (val === null || val === undefined) return null
  if (Array.isArray(val)) {
    const joined = val.map((x) => String(x).trim()).filter(Boolean).join(', ')
    return joined || null
  }
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  if (typeof val === 'number' && Number.isFinite(val)) return String(val)
  const s = String(val).trim()
  return s || null
}

function parseLabeledLinesBlock(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const items = []
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const label = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (!label || !val) continue
    items.push({ label, value: val })
  }
  return items.length >= 3 ? items : []
}

function metaRoomsToItems(meta) {
  const rooms = Array.isArray(meta?.roomsDetail) ? meta.roomsDetail : []
  if (!rooms.length) return []
  const items = []
  for (const room of rooms) {
    if (!room || typeof room !== 'object') continue
    const label = String(room.label || '').trim() || 'Room'
    const pushIf = (k, v) => {
      const value = formatApplicationDetailValue(v)
      if (value) items.push({ label: `${label} ${k}`, value })
    }
    pushIf('Rent', room.rent)
    pushIf('Availability', room.availability)
    pushIf('Furnished', room.furnished)
    pushIf('Utilities', room.utilities)
    pushIf('Utilities Cost', room.utilitiesCost)
    pushIf('Floor/Notes', room.notes)
    pushIf('Bathroom setup', room.bathroomSetup)
    pushIf('Furniture Included', room.furnitureIncluded)
    pushIf('Additional Features', room.additionalFeatures)
    if (room.unavailable === true || room.unavailable === 1) {
      items.push({ label: `${label} — marked unavailable`, value: 'Yes' })
    }
  }
  return items
}

function humanizeMetaKey(k) {
  const s = String(k || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
  if (!s) return 'Field'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function metaFinancialItems(meta) {
  if (!meta?.financials || typeof meta.financials !== 'object') return []
  const out = []
  const pushIf = (label, value) => {
    const v = formatApplicationDetailValue(value)
    if (v) out.push({ label, value: v })
  }
  pushIf('Security deposit (from listing)', meta.financials.securityDeposit)
  pushIf('Move-in charges (from listing)', meta.financials.moveInCharges)
  const seen = new Set(['securityDeposit', 'moveInCharges'])
  for (const [k, val] of Object.entries(meta.financials)) {
    if (seen.has(k)) continue
    pushIf(`${humanizeMetaKey(k)} (listing)`, val)
  }
  return out
}

function metaLeasingItems(meta) {
  if (!meta?.leasing || typeof meta.leasing !== 'object') return []
  const norm = normalizeLeasingFromMeta(meta.leasing)
  const out = []
  const pushIf = (label, value) => {
    const v = formatApplicationDetailValue(value)
    if (v) out.push({ label, value: v })
  }
  pushIf('Full house price (from listing)', norm.fullHousePrice)
  pushIf('Promotional full house price (from listing)', norm.promoPrice)
  pushIf('Lease length information (from listing)', norm.leaseLengthInfo)
  for (const b of norm.bundles) {
    const name = String(b.name || 'Leasing package').trim() || 'Leasing package'
    pushIf(`${name} — monthly rent`, b.price)
    if (b.rooms?.length) {
      out.push({
        label: `${name} — rooms included`,
        value: b.rooms.map((r) => String(r).trim()).filter(Boolean).join(', '),
      })
    }
  }
  return out
}

function metaPropertyListingItems(meta) {
  const out = []
  const pushIf = (label, value) => {
    const v = formatApplicationDetailValue(value)
    if (v) out.push({ label, value: v })
  }
  pushIf('Property type (from listing)', meta.propertyTypeOther)
  const bt = Number(meta.bathroomTotalDecimal)
  if (Number.isFinite(bt) && bt > 0) {
    out.push({ label: 'Total bathrooms (from listing)', value: String(bt) })
  }
  const windows = Array.isArray(meta.listingAvailabilityWindows) ? meta.listingAvailabilityWindows : []
  if (windows.length) {
    const parts = windows
      .map((w) => {
        const st = String(w?.start || '').trim()
        const en = String(w?.end || '').trim()
        if (!st) return ''
        if (!en) return `${st} onward`
        return `${st} – ${en}`
      })
      .filter(Boolean)
    if (parts.length) out.push({ label: 'Move-in availability (listing windows)', value: parts.join('; ') })
  }
  return out
}

function metaSharedSpacesListingItems(meta) {
  const rows = Array.isArray(meta.sharedSpacesDetail) ? meta.sharedSpacesDetail : []
  const out = []
  rows.forEach((row, i) => {
    if (!row || typeof row !== 'object') return
    const title = String(row.title || row.name || `Shared space ${i + 1}`).trim()
    const desc = String(row.description || row.notes || '').trim()
    const imgs = Array.isArray(row.imageUrls) ? row.imageUrls.filter(Boolean).length : 0
    const bits = [desc, imgs ? `${imgs} photo(s)` : ''].filter(Boolean)
    if (bits.length) out.push({ label: title, value: bits.join(' · ') })
  })
  return out
}

function metaListingVideosItems(meta) {
  const vids = Array.isArray(meta.listingVideos) ? meta.listingVideos : []
  if (!vids.length) return []
  const lines = vids
    .map((v, i) => {
      const o = v && typeof v === 'object' ? v : {}
      const label = String(o.label || `Video ${i + 1}`).trim()
      const url = String(o.url || o.src || '').trim()
      if (o.placeholder) {
        return `${label}${o.placeholderText ? ` — ${o.placeholderText}` : ' (coming soon)'}`
      }
      return url ? `${label}: ${url}` : label || null
    })
    .filter(Boolean)
  if (!lines.length) return []
  return [{ label: 'Listing video tours', value: lines.join('\n') }]
}

/** Airtable field → label (aligned with Apply.jsx signer application) */
export const APPLICATION_FIELD_GROUPS = [
  {
    title: 'Review',
    fields: [
      ['Approved', 'Approved'],
      ['Rejected', 'Rejected'],
      ['Approved At', 'Approved at'],
    ],
  },
  {
    title: 'Applicant',
    fields: [
      ['Signer Full Name', 'Full name'],
      ['Signer Email', 'Email'],
      ['Signer Phone Number', 'Phone'],
      ['Signer Date of Birth', 'Date of birth'],
      ['Signer SSN No.', 'SSN'],
      ['Signer Driving License No.', 'License / ID'],
    ],
  },
  {
    title: 'Property & lease',
    fields: [
      ['Property Name', 'Property'],
      ['Property Address', 'Address'],
      ['Room Number', 'Room / unit'],
      ['Lease Term', 'Lease term'],
      ['Month to Month', 'Month-to-month'],
      ['Lease Start Date', 'Lease start'],
      ['Lease End Date', 'Lease end'],
    ],
  },
  {
    title: 'Current address',
    fields: [
      ['Signer Current Address', 'Street'],
      ['Signer City', 'City'],
      ['Signer State', 'State'],
      ['Signer ZIP', 'ZIP'],
      ['Current Landlord Name', 'Landlord name'],
      ['Current Landlord Phone', 'Landlord phone'],
      ['Current Move-In Date', 'Move-in'],
      ['Current Move-Out Date', 'Move-out'],
      ['Current Reason for Leaving', 'Reason for leaving'],
    ],
  },
  {
    title: 'Previous address',
    fields: [
      ['Previous Address', 'Street'],
      ['Previous City', 'City'],
      ['Previous State', 'State'],
      ['Previous ZIP', 'ZIP'],
      ['Previous Landlord Name', 'Landlord name'],
      ['Previous Landlord Phone', 'Landlord phone'],
      ['Previous Move-In Date', 'Move-in'],
      ['Previous Move-Out Date', 'Move-out'],
      ['Previous Reason for Leaving', 'Reason for leaving'],
    ],
  },
  {
    title: 'Employment',
    fields: [
      ['Signer Employer', 'Employer'],
      ['Signer Employer Address', 'Employer address'],
      ['Signer Supervisor Name', 'Supervisor'],
      ['Signer Supervisor Phone', 'Supervisor phone'],
      ['Signer Job Title', 'Job title'],
      ['Signer Monthly Income', 'Monthly income'],
      ['Signer Annual Income', 'Annual income'],
      ['Signer Employment Start Date', 'Employment start'],
      ['Signer Other Income', 'Other income'],
    ],
  },
  {
    title: 'References',
    fields: [
      ['Reference 1 Name', 'Reference 1 name'],
      ['Reference 1 Relationship', 'Reference 1 relationship'],
      ['Reference 1 Phone', 'Reference 1 phone'],
      ['Reference 2 Name', 'Reference 2 name'],
      ['Reference 2 Relationship', 'Reference 2 relationship'],
      ['Reference 2 Phone', 'Reference 2 phone'],
    ],
  },
  {
    title: 'Household & background',
    fields: [
      ['Number of Occupants', 'Occupants'],
      ['Pets', 'Pets'],
      ['Eviction History', 'Eviction history'],
      ['Signer Bankruptcy History', 'Bankruptcy'],
      ['Signer Criminal History', 'Criminal history'],
      ['Has Co-Signer', 'Co-signer'],
    ],
  },
  {
    title: 'Consent & signature',
    fields: [
      ['Signer Consent for Credit and Background Check', 'Credit/background consent'],
      ['Signer Signature', 'Signature on file'],
      ['Signer Date Signed', 'Date signed'],
      ['Additional Notes', 'Notes'],
    ],
  },
]

export function applicationViewModelFromAirtableRow(row) {
  if (!row?.id) return null
  const approvalState = deriveApplicationApprovalState(row)
  return {
    id: row.id,
    _airtable: row,
    applicantName: String(row['Signer Full Name'] || '—').trim(),
    propertyName: String(row['Property Name'] || '—').trim(),
    approvalState,
    status: applicationDisplayLabelFromApprovalState(approvalState),
    approvalPending: approvalState === 'pending',
  }
}

/**
 * @param {{ application: { id: string, _airtable: object, applicantName: string, propertyName: string, status: string, approvalPending?: boolean }, partnerLabel?: string, onClose: () => void, adminReview?: { busy: boolean, onApprove: () => void, onReject: () => void, onUnapprove?: () => void, onRefund?: () => void } | null, afterSections?: React.ReactNode }} props
 */
export function ApplicationDetailPanel({ application, partnerLabel, onClose, adminReview = null, afterSections = null }) {
  const raw = application?._airtable
  if (!raw) return null

  const resolvedApprovalState = application.approvalState ?? deriveApplicationApprovalState(raw)

  const shownKeys = new Set(['id', 'created_at'])
  const sections = []

  for (const group of APPLICATION_FIELD_GROUPS) {
    const items = []
    for (const [key, label] of group.fields) {
      shownKeys.add(key)
      const v = formatApplicationDetailValue(raw[key])
      if (v) items.push({ label, value: v })
    }
    if (items.length) sections.push({ title: group.title, items })
  }

  const otherItems = []
  const parsedExtraSections = []
  for (const key of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    if (shownKeys.has(key)) continue
    const rawVal = raw[key]

    if (typeof rawVal === 'string') {
      const parsedMeta = parseAxisListingMetaBlock(rawVal)
      if (parsedMeta.meta) {
        if (parsedMeta.userText) {
          const parsedLines = parseLabeledLinesBlock(parsedMeta.userText)
          if (parsedLines.length) {
            parsedExtraSections.push({ title: `${key} (notes)`, items: parsedLines })
          } else {
            parsedExtraSections.push({
              title: `${key} (notes)`,
              items: [{ label: 'Free-form text', value: parsedMeta.userText }],
            })
          }
        }

        const propItems = metaPropertyListingItems(parsedMeta.meta)
        if (propItems.length) {
          parsedExtraSections.push({ title: 'Listing — property', items: propItems })
        }

        const roomItems = metaRoomsToItems(parsedMeta.meta)
        if (roomItems.length) {
          parsedExtraSections.push({ title: 'Listing — rooms', items: roomItems })
        }

        const finItems = metaFinancialItems(parsedMeta.meta)
        if (finItems.length) {
          parsedExtraSections.push({ title: 'Listing — financials', items: finItems })
        }

        const leasingItems = metaLeasingItems(parsedMeta.meta)
        if (leasingItems.length) {
          parsedExtraSections.push({ title: 'Listing — leasing & packages', items: leasingItems })
        }

        const spaceItems = metaSharedSpacesListingItems(parsedMeta.meta)
        if (spaceItems.length) {
          parsedExtraSections.push({ title: 'Listing — shared spaces', items: spaceItems })
        }

        const vidItems = metaListingVideosItems(parsedMeta.meta)
        if (vidItems.length) {
          parsedExtraSections.push({ title: 'Listing — media', items: vidItems })
        }

        continue
      }

      const parsedLines = parseLabeledLinesBlock(rawVal)
      if (parsedLines.length) {
        parsedExtraSections.push({ title: key, items: parsedLines })
        continue
      }
    }

    const v = formatApplicationDetailValue(rawVal)
    if (v) otherItems.push({ label: key, value: v })
  }
  sections.push(...parsedExtraSections)
  if (otherItems.length) sections.push({ title: 'Other fields', items: otherItems })

  const submitted = raw.created_at
    ? (() => {
        try {
          return new Date(raw.created_at).toLocaleString()
        } catch {
          return String(raw.created_at)
        }
      })()
    : null

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-black text-slate-900">{application.applicantName}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {application.propertyName}
            {partnerLabel && partnerLabel !== '—' ? ` · ${partnerLabel}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill tone="blue">{application.status}</StatusPill>
            {resolvedApprovalState === 'pending' ? (
              <span className="text-xs font-medium text-amber-700">
                {adminReview ? 'Pending review (manager or admin)' : 'Pending manager review'}
              </span>
            ) : null}
          </div>
        </div>
        <button type="button" className="shrink-0 text-sm font-semibold text-slate-500 hover:text-slate-800" onClick={onClose}>
          Close
        </button>
      </div>

      {adminReview ? (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {resolvedApprovalState === 'pending' ? (
            <>
              <button
                type="button"
                disabled={adminReview.busy}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={adminReview.onApprove}
              >
                Approve application
              </button>
              <button
                type="button"
                disabled={adminReview.busy}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-50"
                onClick={adminReview.onReject}
              >
                Reject
              </button>
            </>
          ) : null}

          {(resolvedApprovalState === 'approved' || resolvedApprovalState === 'rejected') && adminReview.onUnapprove ? (
            <button
              type="button"
              disabled={adminReview.busy}
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50"
              onClick={adminReview.onUnapprove}
            >
              Send back to pending
            </button>
          ) : null}

          {resolvedApprovalState !== 'approved' && adminReview.onRefund ? (
            <button
              type="button"
              disabled={adminReview.busy}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
              onClick={adminReview.onRefund}
            >
              Refund application fee
            </button>
          ) : null}
        </div>
      ) : null}

      <dl className="space-y-0 border-t border-slate-100 pt-4">
        {submitted ? (
          <div className="grid gap-1 border-b border-slate-100 py-2 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted</dt>
            <dd className="text-sm text-slate-800">{submitted}</dd>
          </div>
        ) : null}
      </dl>

      {sections.map((sec) => (
        <div key={sec.title}>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{sec.title}</h3>
          <dl className="rounded-2xl border border-slate-100 bg-slate-50/50 px-4">
            {sec.items.map((row, rowIdx) => (
              <div
                key={`${sec.title}-${rowIdx}-${row.label}`}
                className="grid gap-1 border-b border-slate-100 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4"
              >
                <dt className="text-xs font-semibold text-slate-500">{row.label}</dt>
                <dd className="text-sm text-slate-900 whitespace-pre-wrap break-words">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      {afterSections ? (
        <div className="border-t border-slate-200 pt-5">{afterSections}</div>
      ) : null}
    </div>
  )
}
