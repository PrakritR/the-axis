import React from 'react'
import { StatusPill } from '../components/PortalShell'
import {
  deriveApplicationApprovalState,
  applicationDisplayLabelFromApprovalState,
} from './applicationApprovalState.js'

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

/** Airtable field → label (aligned with Apply.jsx signer application) */
export const APPLICATION_FIELD_GROUPS = [
  {
    title: 'Review',
    fields: [
      ['Approved', 'Approved'],
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
  for (const key of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    if (shownKeys.has(key)) continue
    const v = formatApplicationDetailValue(raw[key])
    if (v) otherItems.push({ label: key, value: v })
  }
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
      ) : adminReview && resolvedApprovalState === 'approved' && adminReview.onUnapprove ? (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={adminReview.busy}
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50"
            onClick={adminReview.onUnapprove}
          >
            Remove approval
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
