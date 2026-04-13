import React from 'react'
import { StatusPill } from '../components/PortalShell'
import {
  deriveApplicationApprovalState,
  applicationDisplayLabelFromApprovalState,
} from './applicationApprovalState.js'
import { parseAxisListingMetaBlock } from './axisListingMeta.js'

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
    pushIf('Furniture Included', room.furnitureIncluded)
    pushIf('Additional Features', room.additionalFeatures)
  }
  return items
}

function metaFinancialItems(meta) {
  if (!meta?.financials || typeof meta.financials !== 'object') return []
  const out = []
  const pushIf = (label, value) => {
    const v = formatApplicationDetailValue(value)
    if (v) out.push({ label, value: v })
  }
  pushIf('Security Deposit', meta.financials.securityDeposit)
  pushIf('Move-In Charges', meta.financials.moveInCharges)
  return out
}

function metaLeasingItems(meta) {
  if (!meta?.leasing || typeof meta.leasing !== 'object') return []
  const out = []
  const pushIf = (label, value) => {
    const v = formatApplicationDetailValue(value)
    if (v) out.push({ label, value: v })
  }
  pushIf('Full House Price', meta.leasing['Full House Price'])
  pushIf('Promotional Full House Price', meta.leasing['Promotional Full House Price'])
  pushIf('Lease Length Information', meta.leasing['Lease Length Information'])
  const packages = Array.isArray(meta.leasing['Leasing Packages']) ? meta.leasing['Leasing Packages'] : []
  for (const pkg of packages) {
    if (!pkg || typeof pkg !== 'object') continue
    const name = String(pkg['Bundle Name'] || 'Package').trim()
    pushIf(`${name} Monthly Rent`, pkg['Bundle Monthly Rent'])
    const rooms = Array.isArray(pkg['Bundle Rooms Included'])
      ? pkg['Bundle Rooms Included'].map((r) => String(r).trim()).filter(Boolean).join(', ')
      : ''
    if (rooms) out.push({ label: `${name} Rooms Included`, value: rooms })
  }
  return out
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
 * @param {{ application: { id: string, _airtable: object, applicantName: string, propertyName: string, status: string, approvalPending?: boolean }, partnerLabel?: string, onClose: () => void, adminReview?: { busy: boolean, onApprove: () => void, onReject: () => void, onUnapprove?: () => void } | null }} props
 */
export function ApplicationDetailPanel({ application, partnerLabel, onClose, adminReview = null }) {
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
            parsedExtraSections.push({ title: `${key} details`, items: parsedLines })
          } else {
            otherItems.push({ label: key, value: parsedMeta.userText })
          }
        }

        const roomItems = metaRoomsToItems(parsedMeta.meta)
        if (roomItems.length) parsedExtraSections.push({ title: 'Room details', items: roomItems })

        const finItems = metaFinancialItems(parsedMeta.meta)
        if (finItems.length) parsedExtraSections.push({ title: 'Financial summary', items: finItems })

        const leasingItems = metaLeasingItems(parsedMeta.meta)
        if (leasingItems.length) parsedExtraSections.push({ title: 'Leasing options', items: leasingItems })

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

      {adminReview && resolvedApprovalState === 'pending' ? (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
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
        </div>
      ) : adminReview && (resolvedApprovalState === 'approved' || resolvedApprovalState === 'rejected') && adminReview.onUnapprove ? (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={adminReview.busy}
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50"
            onClick={adminReview.onUnapprove}
          >
            {resolvedApprovalState === 'rejected' ? 'Remove rejection' : 'Remove approval'}
          </button>
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
            {sec.items.map((row) => (
              <div
                key={`${sec.title}-${row.label}`}
                className="grid gap-1 border-b border-slate-100 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4"
              >
                <dt className="text-xs font-semibold text-slate-500">{row.label}</dt>
                <dd className="text-sm text-slate-900 whitespace-pre-wrap break-words">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}
