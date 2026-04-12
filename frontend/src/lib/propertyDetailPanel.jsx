import React from 'react'
import { StatusPill } from '../components/PortalShell'
import { formatApplicationDetailValue } from './applicationDetailPanel.jsx'
import { PROPERTY_EDIT_REQUEST_FIELD } from './managerPropertyFormAirtableMap.js'

const MAX_ROOMS = 20
const MAX_BATHROOMS = 10
const MAX_KITCHENS = 3
const MAX_SHARED_SPACES = 3

function roomFields(n) {
  return [
    [`Room ${n} Name`, `Room ${n} name`],
    [`Room ${n} Rent`, `Room ${n} rent`],
    [`Room ${n} Availability`, `Room ${n} availability`],
    [`Room ${n} Furnished`, `Room ${n} furnished`],
    [`Room ${n} Utilities Description`, `Room ${n} utilities`],
    [`Room ${n} Utilities Cost`, `Room ${n} utilities cost`],
    [`Room ${n} Notes`, `Room ${n} notes`],
  ]
}

function bathroomFields(n) {
  return [
    [`Bathroom ${n}`, `Bathroom ${n} description`],
    [`Rooms Sharing Bathroom ${n}`, `Bathroom ${n} shared by`],
  ]
}

function kitchenFields(n) {
  return [
    [`Kitchen ${n}`, `Kitchen ${n} description`],
    [`Rooms Sharing Kitchen ${n}`, `Kitchen ${n} shared by`],
  ]
}

function sharedSpaceFields(n) {
  return [
    [`Shared Space ${n} Name`, `Shared space ${n} name`],
    [`Shared Space ${n} Type`, `Shared space ${n} type`],
    [`Access to Shared Space ${n}`, `Shared space ${n} access`],
  ]
}

/** Logical groupings for Properties / House rows in admin review */
export const PROPERTY_FIELD_GROUPS = [
  {
    title: 'Listing',
    fields: [
      ['Name', 'Property name'],
      ['Address', 'Address'],
      ['Housing Type', 'Housing type'],
      ['Description', 'Description'],
      ['Amenities', 'Amenities'],
      ['Pets', 'Pets'],
      ['Notes', 'Submission notes'],
      ['Other Info', 'Other / additional info'],
    ],
  },
  {
    title: 'Approval & status',
    fields: [
      ['Approved', 'Approved'],
      ['Approval Status', 'Approval status'],
      ['Status', 'Status'],
      ['Axis Admin Listing Status', 'Admin listing status'],
      [PROPERTY_EDIT_REQUEST_FIELD, 'Edit request notes (manager)'],
    ],
  },
  {
    title: 'Fees',
    fields: [
      ['Utilities Fee', 'Utilities fee'],
      ['Security Deposit', 'Security deposit'],
      ['Application Fee', 'Application fee'],
    ],
  },
  {
    title: 'Counts',
    fields: [
      ['Room Count', 'Rooms'],
      ['Bathroom Count', 'Bathrooms'],
      ['Kitchen Count', 'Kitchens'],
      ['Number of Shared Spaces', 'Shared spaces'],
    ],
  },
  {
    title: 'Bathroom access summary',
    fields: [
      ['Bathroom Access', 'Bathroom access overview'],
    ],
  },
  {
    title: 'Laundry',
    fields: [
      ['Laundry', 'Laundry on site'],
      ['Laundry Type', 'Laundry type'],
      ['Laundry Description', 'Laundry description'],
      ['Rooms Sharing Laundry', 'Rooms sharing laundry'],
    ],
  },
  {
    title: 'Parking',
    fields: [
      ['Parking', 'Parking available'],
      ['Parking Type', 'Parking type'],
      ['Parking Fee', 'Parking fee'],
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

  // ── Core field groups ──────────────────────────────────────────────────────
  for (const group of PROPERTY_FIELD_GROUPS) {
    const items = []
    for (const [key, label] of group.fields) {
      shownKeys.add(key)
      const v = fmt(raw[key])
      if (v) items.push({ label, value: v })
    }
    if (items.length) sections.push({ title: group.title, items })
  }

  // ── Dynamic room sections ──────────────────────────────────────────────────
  const roomCount = Number(raw['Room Count']) || 0
  const roomItems = []
  for (let n = 1; n <= Math.min(roomCount || MAX_ROOMS, MAX_ROOMS); n++) {
    const hasAny = roomFields(n).some(([key]) => raw[key] != null && raw[key] !== '' && raw[key] !== false)
    if (!hasAny) continue
    for (const [key, label] of roomFields(n)) {
      shownKeys.add(key)
      const v = fmt(raw[key])
      if (v) roomItems.push({ label, value: v })
    }
  }
  // Also mark all possible room keys as shown to avoid "Other fields" duplication
  for (let n = 1; n <= MAX_ROOMS; n++) {
    for (const [key] of roomFields(n)) shownKeys.add(key)
  }
  if (roomItems.length) sections.push({ title: 'Rooms', items: roomItems })

  // ── Dynamic bathroom sections ──────────────────────────────────────────────
  const bathroomCount = Number(raw['Bathroom Count']) || 0
  const bathroomItems = []
  for (let n = 1; n <= Math.min(bathroomCount || MAX_BATHROOMS, MAX_BATHROOMS); n++) {
    const hasAny = bathroomFields(n).some(([key]) => raw[key] != null && raw[key] !== '')
    if (!hasAny) continue
    for (const [key, label] of bathroomFields(n)) {
      shownKeys.add(key)
      const v = fmt(raw[key])
      if (v) bathroomItems.push({ label, value: v })
    }
  }
  for (let n = 1; n <= MAX_BATHROOMS; n++) {
    for (const [key] of bathroomFields(n)) shownKeys.add(key)
  }
  if (bathroomItems.length) sections.push({ title: 'Bathrooms', items: bathroomItems })

  // ── Dynamic kitchen sections ───────────────────────────────────────────────
  const kitchenCount = Number(raw['Kitchen Count']) || 0
  const kitchenItems = []
  for (let n = 1; n <= Math.min(kitchenCount || MAX_KITCHENS, MAX_KITCHENS); n++) {
    const hasAny = kitchenFields(n).some(([key]) => raw[key] != null && raw[key] !== '')
    if (!hasAny) continue
    for (const [key, label] of kitchenFields(n)) {
      shownKeys.add(key)
      const v = fmt(raw[key])
      if (v) kitchenItems.push({ label, value: v })
    }
  }
  for (let n = 1; n <= MAX_KITCHENS; n++) {
    for (const [key] of kitchenFields(n)) shownKeys.add(key)
  }
  if (kitchenItems.length) sections.push({ title: 'Kitchens', items: kitchenItems })

  // ── Shared spaces ──────────────────────────────────────────────────────────
  shownKeys.add('Number of Shared Spaces')
  const spaceCount = Number(raw['Number of Shared Spaces']) || 0
  const sharedItems = []
  for (let n = 1; n <= Math.min(spaceCount || MAX_SHARED_SPACES, MAX_SHARED_SPACES); n++) {
    const hasAny = sharedSpaceFields(n).some(([key]) => {
      const v = raw[key]
      return v != null && v !== '' && !(Array.isArray(v) && v.length === 0)
    })
    if (!hasAny) continue
    for (const [key, label] of sharedSpaceFields(n)) {
      shownKeys.add(key)
      const v = fmt(raw[key])
      if (v) sharedItems.push({ label, value: v })
    }
  }
  for (let n = 1; n <= MAX_SHARED_SPACES; n++) {
    for (const [key] of sharedSpaceFields(n)) shownKeys.add(key)
  }
  if (sharedItems.length) sections.push({ title: 'Shared Spaces', items: sharedItems })

  // ── Remaining / unknown fields ─────────────────────────────────────────────
  const otherItems = []
  for (const key of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    if (shownKeys.has(key)) continue
    const v = fmt(raw[key])
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
        {property.address && property.address !== '—' ? (
          <div className="grid gap-1 border-b border-slate-200 py-2 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address</dt>
            <dd className="text-sm text-slate-800">{property.address}</dd>
          </div>
        ) : null}
        {submitted ? (
          <div className="grid gap-1 border-b border-slate-200 py-2 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted</dt>
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
