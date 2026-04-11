import React from 'react'
import { StatusPill } from '../components/PortalShell'
import { formatApplicationDetailValue } from './applicationDetailPanel.jsx'

/** Logical groupings for Properties / House rows in admin review */
export const PROPERTY_FIELD_GROUPS = [
  {
    title: 'Listing',
    fields: [
      ['Name', 'Name'],
      ['Property', 'Property label'],
      ['Address', 'Address'],
      ['Notes', 'Notes'],
    ],
  },
  {
    title: 'Approval & status',
    fields: [
      ['Approved', 'Approved'],
      ['Approval Status', 'Approval status'],
      ['Status', 'Status'],
      ['Axis Admin Listing Status', 'Admin listing status'],
    ],
  },
  {
    title: 'Management',
    fields: [
      ['Manager Email', 'Manager email'],
      ['Site Manager Email', 'Site manager email'],
    ],
  },
  {
    title: 'Partner / admin notes',
    fields: [
      ['Internal Notes', 'Internal notes'],
      ['Admin Notes', 'Admin notes'],
      ['Axis Partner Notes', 'Partner notes (visible)'],
      ['Partner Notes', 'Partner notes'],
    ],
  },
]

/**
 * @param {{ property: { id: string, name: string, address?: string, status: string, _airtable: object }, ownerLabel?: string, onClose?: () => void }} props
 */
export function PropertyDetailPanel({ property, ownerLabel, onClose }) {
  const raw = property?._airtable
  if (!raw) return null

  const fmt = formatApplicationDetailValue
  const shownKeys = new Set(['id', 'created_at'])
  const sections = []

  for (const group of PROPERTY_FIELD_GROUPS) {
    const items = []
    for (const [key, label] of group.fields) {
      shownKeys.add(key)
      const v = fmt(raw[key])
      if (v) items.push({ label, value: v })
    }
    if (items.length) sections.push({ title: group.title, items })
  }

  const otherItems = []
  for (const key of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    if (shownKeys.has(key)) continue
    const v = fmt(raw[key])
    if (v) otherItems.push({ label: key, value: v })
  }
  if (otherItems.length) sections.push({ title: 'Other fields (Airtable)', items: otherItems })

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
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/40 p-6 shadow-inner space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-black text-slate-900">Full property record</h3>
          <p className="mt-1 text-sm text-slate-600">
            {property.name}
            {ownerLabel && ownerLabel !== '—' ? ` · ${ownerLabel}` : ''}
          </p>
          <div className="mt-2">
            <StatusPill tone="blue">{property.status}</StatusPill>
          </div>
        </div>
        {onClose ? (
          <button type="button" className="shrink-0 text-sm font-semibold text-slate-500 hover:text-slate-800" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      <dl className="space-y-0 border-t border-slate-200 pt-4">
        <div className="grid gap-1 border-b border-slate-200 py-2 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Airtable record</dt>
          <dd className="font-mono text-xs text-slate-700">{property.id}</dd>
        </div>
        {property.address && property.address !== '—' ? (
          <div className="grid gap-1 border-b border-slate-200 py-2 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address (summary)</dt>
            <dd className="text-sm text-slate-800">{property.address}</dd>
          </div>
        ) : null}
        {submitted ? (
          <div className="grid gap-1 border-b border-slate-200 py-2 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Created</dt>
            <dd className="text-sm text-slate-800">{submitted}</dd>
          </div>
        ) : null}
      </dl>

      {sections.map((sec) => (
        <div key={sec.title}>
          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{sec.title}</h4>
          <dl className="rounded-2xl border border-slate-200 bg-white px-4">
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
