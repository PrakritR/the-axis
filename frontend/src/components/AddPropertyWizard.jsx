/**
 * AddPropertyWizard
 *
 * Strict 8-step guided wizard for creating a property listing.
 * Every required field is enforced with inline validation before the user
 * can advance. All inputs map directly to Airtable field names via the
 * centralized managerPropertyFormAirtableMap constants.
 *
 * Props:
 *   manager             – authenticated manager record (for preview check + record id)
 *   onClose()           – called when wizard should close without saving
 *   onCreated(record)   – called after a successful Airtable write
 *   createPropertyAdmin – async fn(fields) → record  (passed from Manager.jsx scope)
 */

import React, { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from './Modal'
import { uploadPropertyImage } from '../lib/airtable'
import {
  serializeManagerAddPropertyToAirtableFields,
  emptyRoomRow,
  emptyBathroomRow,
  emptyKitchenRow,
  emptyLaundryRow,
  emptySharedSpaceRow,
  adjustRoomAccessLabels,
  clampInt,
  MAX_ROOM_SLOTS,
  MAX_BATHROOM_SLOTS,
  MAX_KITCHEN_SLOTS,
  MAX_SHARED_SPACE_SLOTS,
  MAX_LAUNDRY_SLOTS,
  AMENITY_OPTIONS,
  PET_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  FURNISHED_OPTIONS,
  SHARED_SPACE_TYPE_OPTIONS,
  BATHROOM_TYPE_OPTIONS,
  KITCHEN_TYPE_OPTIONS,
} from '../lib/managerPropertyFormAirtableMap.js'

// ─── Wizard step metadata ─────────────────────────────────────────────────────
const STEPS = [
  { id: 'basics',   label: 'Basics' },
  { id: 'rooms',    label: 'Rooms' },
  { id: 'baths',    label: 'Bathrooms' },
  { id: 'kitchens', label: 'Kitchens' },
  { id: 'shared',   label: 'Shared Spaces' },
  { id: 'laundry',  label: 'Laundry & Parking' },
  { id: 'media',    label: 'Photos & Notes' },
  { id: 'pricing',  label: 'Pricing & Leases' },
]

const DEFAULT_LEASE_INFO =
  '3-month, 9-month, 12-month, and month-to-month (+$25/month). Start and end dates are flexible unless noted otherwise.'

// ─── Validation ───────────────────────────────────────────────────────────────
function validateBasics(basics, appFee) {
  const e = {}
  const name = String(basics.name || '').trim()
  if (!name) e.name = 'Property name is required'
  else if (name.length < 3) e.name = 'Must be at least 3 characters'

  if (!String(basics.address || '').trim()) e.address = 'Address is required'

  if (!basics.propertyType) e.propertyType = 'Property type is required'
  if (basics.propertyType === 'Other' && !String(basics.propertyTypeOther || '').trim())
    e.propertyTypeOther = 'Describe the property type'

  if (!basics.pets) e.pets = 'Pet policy is required'

  const afStr = String(appFee ?? '')
  if (afStr === '') e.applicationFee = 'Required — enter 0 if no fee'
  else if (!Number.isFinite(Number(afStr)) || Number(afStr) < 0)
    e.applicationFee = 'Enter a valid number (0 or more)'

  const sdStr = String(basics.securityDeposit ?? '')
  if (sdStr === '') e.securityDeposit = 'Required — enter 0 if none'
  else if (!Number.isFinite(Number(sdStr)) || Number(sdStr) < 0)
    e.securityDeposit = 'Enter a valid number (0 or more)'

  const mcStr = String(basics.moveInCharges ?? '')
  if (mcStr === '') e.moveInCharges = 'Required — enter 0 if none'
  else if (!Number.isFinite(Number(mcStr)) || Number(mcStr) < 0)
    e.moveInCharges = 'Enter a valid number (0 or more)'

  return e
}

function validateRooms(rooms) {
  const e = {}
  if (!rooms.length) { e._global = 'At least one room is required'; return e }
  rooms.forEach((room, i) => {
    const rentStr = String(room.rent ?? '')
    if (rentStr === '') e[`r${i}_rent`] = 'Monthly rent is required'
    else if (!Number.isFinite(Number(rentStr)) || Number(rentStr) < 0)
      e[`r${i}_rent`] = 'Enter a valid number (0 or more)'

    if (!room.availability) e[`r${i}_avail`] = 'Availability date is required'
    if (!room.furnished) e[`r${i}_furn`] = 'Furnished status is required'

    if ((room.furnished === 'Yes' || room.furnished === 'Partial') && !String(room.furnitureIncluded || '').trim())
      e[`r${i}_furnInc`] = 'List what furniture is included'
  })
  return e
}

function validateBathrooms(bathrooms) {
  const e = {}
  bathrooms.forEach((bath, i) => {
    if (!bath.kind) e[`b${i}_kind`] = 'Bathroom type is required'
    if (!Array.isArray(bath.access) || bath.access.length === 0)
      e[`b${i}_access`] = 'Select at least one room with access'
  })
  return e
}

function validateKitchens(kitchens) {
  const e = {}
  kitchens.forEach((kit, i) => {
    if (!kit.kind) e[`k${i}_kind`] = 'Kitchen type is required'
    if (!Array.isArray(kit.access) || kit.access.length === 0)
      e[`k${i}_access`] = 'Select at least one room with access'
  })
  return e
}

function validateSharedSpaces(spaces) {
  const e = {}
  spaces.forEach((space, i) => {
    if (!space.type) e[`s${i}_type`] = 'Space type is required'
    if (space.type === 'Other' && !String(space.typeOther || '').trim())
      e[`s${i}_typeOther`] = 'Describe this space'
  })
  return e
}

function validateLaundryParking(laundry, parking) {
  const e = {}
  if (laundry?.enabled) {
    ;(laundry.rows || []).forEach((row, i) => {
      if (!String(row.type || '').trim())
        e[`l${i}_type`] = 'Laundry type is required'
    })
  }
  if (parking?.enabled && !String(parking.type || '').trim())
    e.parkingType = 'Parking type is required'
  return e
}

function validatePricing(leasing) {
  const e = {}
  if (!String(leasing.leaseLengthInfo || '').trim())
    e.leaseLengthInfo = 'Lease length information is required'

  if (String(leasing.fullHousePrice || '').trim()) {
    const n = Number(leasing.fullHousePrice)
    if (!Number.isFinite(n) || n <= 0)
      e.fullHousePrice = 'Enter a positive dollar amount'
  }

  ;(leasing.bundles || []).forEach((b, i) => {
    if (!String(b.name || '').trim()) e[`bnd${i}_name`] = 'Bundle name is required'
    const p = String(b.price || '')
    if (!p) e[`bnd${i}_price`] = 'Monthly rent is required'
    else if (!Number.isFinite(Number(p)) || Number(p) <= 0)
      e[`bnd${i}_price`] = 'Enter a positive dollar amount'
    if (!Array.isArray(b.rooms) || b.rooms.length === 0)
      e[`bnd${i}_rooms`] = 'Select at least one room'
  })
  return e
}

function getStepErrors(stepIdx, state) {
  const { basics, appFee, rooms, bathrooms, kitchens, sharedSpaces, laundry, parking, leasing } = state
  switch (stepIdx) {
    case 0: return validateBasics(basics, appFee)
    case 1: return validateRooms(rooms)
    case 2: return validateBathrooms(bathrooms)
    case 3: return validateKitchens(kitchens)
    case 4: return validateSharedSpaces(sharedSpaces)
    case 5: return validateLaundryParking(laundry, parking)
    case 6: return {}
    case 7: return validatePricing(leasing)
    default: return {}
  }
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────
function FieldError({ msg }) {
  if (!msg) return null
  return (
    <p className="mt-1.5 flex items-start gap-1 text-xs font-medium text-red-600">
      <span className="mt-px shrink-0">⚠</span>
      <span>{msg}</span>
    </p>
  )
}

function Req() {
  return <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
}

function SectionHeading({ children }) {
  return <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{children}</div>
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AddPropertyWizard({ manager, onClose, onCreated, createPropertyAdmin }) {
  // ── Step state ───────────────────────────────────────────────────────────────
  const [step, setStep] = useState(0)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const scrollRef = useRef(null)

  // ── Form state ───────────────────────────────────────────────────────────────
  const [basics, setBasics] = useState({
    name: '', address: '', propertyType: '', propertyTypeOther: '',
    amenities: [], amenitiesOther: '', pets: '',
    securityDeposit: '', moveInCharges: '',
  })
  const [appFee, setAppFee] = useState('')
  const [rooms, setRooms] = useState([emptyRoomRow()])
  const [bathrooms, setBathrooms] = useState([])
  const [kitchens, setKitchens] = useState([])
  const [sharedSpaces, setSharedSpaces] = useState([])
  const [laundry, setLaundry] = useState({ enabled: false, rows: [], generalAccess: [] })
  const [parking, setParking] = useState({ enabled: false, type: '', fee: '' })
  const [otherInfo, setOtherInfo] = useState('')
  const [images, setImages] = useState([])
  const [leasing, setLeasing] = useState({
    fullHousePrice: '', promoPrice: '', leaseLengthInfo: DEFAULT_LEASE_INFO, bundles: [],
  })
  const imageInputRef = useRef(null)
  const dropRef = useRef(null)

  // ── Derived ──────────────────────────────────────────────────────────────────
  const rc = clampInt(rooms.length, 1, MAX_ROOM_SLOTS)
  const roomOptions = Array.from({ length: rc }, (_, i) => `Room ${i + 1}`)
  const formState = { basics, appFee, rooms, bathrooms, kitchens, sharedSpaces, laundry, parking, leasing }

  const currentErrors = useMemo(
    () => attempted ? getStepErrors(step, formState) : {},
    // deps: all form state + step + attempted flag
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attempted, step, basics, appFee, rooms, bathrooms, kitchens, sharedSpaces, laundry, parking, leasing],
  )
  const stepIsValid = Object.keys(getStepErrors(step, formState)).length === 0

  // ── Reset ─────────────────────────────────────────────────────────────────────
  function resetForm() {
    setStep(0); setAttempted(false); setSaving(false)
    setBasics({ name: '', address: '', propertyType: '', propertyTypeOther: '', amenities: [], amenitiesOther: '', pets: '', securityDeposit: '', moveInCharges: '' })
    setAppFee('')
    setRooms([emptyRoomRow()])
    setBathrooms([]); setKitchens([]); setSharedSpaces([])
    setLaundry({ enabled: false, rows: [], generalAccess: [] })
    setParking({ enabled: false, type: '', fee: '' })
    setOtherInfo('')
    setImages(prev => { prev.forEach(img => URL.revokeObjectURL(img.preview)); return [] })
    setLeasing({ fullHousePrice: '', promoPrice: '', leaseLengthInfo: DEFAULT_LEASE_INFO, bundles: [] })
  }

  function handleClose() {
    if (!saving) { resetForm(); onClose() }
  }

  // ── Navigation ────────────────────────────────────────────────────────────────
  function handleNext(e) {
    e?.preventDefault()
    const errs = getStepErrors(step, formState)
    if (Object.keys(errs).length > 0) {
      setAttempted(true)
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setAttempted(false)
    setStep(s => s + 1)
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }

  function handleBack() {
    setAttempted(false)
    setStep(s => s - 1)
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }

  // ── Submit ────────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    if (manager?.role === 'preview') {
      toast.error('Adding properties is disabled in preview mode')
      return
    }
    // Final cross-step validation guard
    for (let i = 0; i < STEPS.length; i++) {
      const errs = getStepErrors(i, formState)
      if (Object.keys(errs).length > 0) {
        setStep(i); setAttempted(true)
        toast.error(`Please fix errors on step "${STEPS[i].label}" before submitting.`)
        return
      }
    }
    setSaving(true)
    try {
      const roomsPayload = rooms.map(({ media, ...rest }) => rest)
      const fields = serializeManagerAddPropertyToAirtableFields({
        basics,
        roomCount: rc,
        bathroomCount: clampInt(bathrooms.length, 0, MAX_BATHROOM_SLOTS),
        kitchenCount: clampInt(kitchens.length, 0, MAX_KITCHEN_SLOTS),
        laundry,
        parking,
        rooms: roomsPayload,
        bathrooms,
        kitchens,
        sharedSpaces,
        applicationFee: appFee,
        otherInfo,
        managerRecordId: manager?.id,
        leasing,
      })

      const created = await createPropertyAdmin(fields)

      // Property gallery images (non-fatal individually)
      for (const img of images) {
        try { await uploadPropertyImage(created.id, img.file) } catch { /* non-fatal */ }
      }
      // Per-room media
      for (let ri = 0; ri < rooms.length; ri++) {
        for (const item of rooms[ri].media || []) {
          try {
            const f = item.file
            const renamed = new File([f], `axis-r${ri + 1}-${f.name}`, { type: f.type || 'application/octet-stream' })
            await uploadPropertyImage(created.id, renamed)
          } catch { /* non-fatal */ }
        }
      }

      toast.success('Submitted — pending admin approval')
      onCreated(created)
      resetForm()
      onClose()
    } catch (err) {
      const raw = err?.message || 'Could not save property'
      const friendly = raw.includes('UNKNOWN_FIELD_NAME')
        ? 'A field name does not match Airtable — check the field mapping file.'
        : raw.includes('INVALID_VALUE_FOR_COLUMN')
        ? 'One or more field values are in the wrong format for Airtable.'
        : raw.includes('INVALID_PERMISSIONS')
        ? 'Missing Airtable write permissions — check your API token.'
        : raw
      toast.error(friendly)
    } finally {
      setSaving(false)
    }
  }

  // ── Room helpers ──────────────────────────────────────────────────────────────
  function updateRoom(idx, patch) {
    setRooms(prev => { const next = [...prev]; next[idx] = { ...next[idx], ...patch }; return next })
  }
  function addRoom() {
    setRooms(prev => prev.length < MAX_ROOM_SLOTS ? [...prev, emptyRoomRow()] : prev)
  }
  function removeRoom(idx) {
    setRooms(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx))
    const fix = arr => adjustRoomAccessLabels(arr, idx)
    setBathrooms(prev => prev.map(b => ({ ...b, access: fix(b.access) })))
    setKitchens(prev => prev.map(k => ({ ...k, access: fix(k.access) })))
    setSharedSpaces(prev => prev.map(s => ({ ...s, access: fix(s.access) })))
    setLeasing(L => ({ ...L, bundles: (L.bundles || []).map(b => ({ ...b, rooms: fix(b.rooms || []) })) }))
    setLaundry(l => ({
      ...l,
      generalAccess: fix(l.generalAccess || []),
      rows: (l.rows || []).map(r => ({ ...r, access: fix(r.access || []) })),
    }))
  }
  function addRoomMedia(roomIdx, fileList) {
    const valid = Array.from(fileList || []).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    if (!valid.length) return
    const entries = valid.map(file => ({ id: `${Date.now()}-${Math.random()}`, file, preview: URL.createObjectURL(file) }))
    setRooms(prev => prev.map((r, i) => i === roomIdx ? { ...r, media: [...(r.media || []), ...entries] } : r))
  }
  function removeRoomMedia(roomIdx, mediaId) {
    setRooms(prev => prev.map((r, i) => {
      if (i !== roomIdx) return r
      const removed = (r.media || []).find(m => m.id === mediaId)
      if (removed?.preview) URL.revokeObjectURL(removed.preview)
      return { ...r, media: (r.media || []).filter(m => m.id !== mediaId) }
    }))
  }

  // ── Bathroom helpers ──────────────────────────────────────────────────────────
  function updateBath(idx, patch) {
    setBathrooms(prev => { const next = [...prev]; next[idx] = { ...next[idx], ...patch }; return next })
  }
  function addBath() { setBathrooms(prev => prev.length < MAX_BATHROOM_SLOTS ? [...prev, emptyBathroomRow()] : prev) }
  function removeBath(idx) { setBathrooms(prev => prev.filter((_, i) => i !== idx)) }

  // ── Kitchen helpers ───────────────────────────────────────────────────────────
  function updateKitchen(idx, patch) {
    setKitchens(prev => { const next = [...prev]; next[idx] = { ...next[idx], ...patch }; return next })
  }
  function addKitchen() { setKitchens(prev => prev.length < MAX_KITCHEN_SLOTS ? [...prev, emptyKitchenRow()] : prev) }
  function removeKitchen(idx) { setKitchens(prev => prev.filter((_, i) => i !== idx)) }

  // ── Shared space helpers ──────────────────────────────────────────────────────
  function updateSpace(idx, patch) {
    setSharedSpaces(prev => { const next = [...prev]; next[idx] = { ...next[idx], ...patch }; return next })
  }
  function addSpace() { setSharedSpaces(prev => prev.length < MAX_SHARED_SPACE_SLOTS ? [...prev, emptySharedSpaceRow()] : prev) }
  function removeSpace(idx) { setSharedSpaces(prev => prev.filter((_, i) => i !== idx)) }

  // ── Laundry helpers ───────────────────────────────────────────────────────────
  function updateLaundryRow(idx, patch) {
    setLaundry(l => { const rows = [...(l.rows || [])]; rows[idx] = { ...rows[idx], ...patch }; return { ...l, rows } })
  }
  function addLaundryRow() { setLaundry(l => ({ ...l, rows: [...(l.rows || []), emptyLaundryRow()] })) }
  function removeLaundryRow(idx) { setLaundry(l => ({ ...l, rows: (l.rows || []).filter((_, i) => i !== idx) })) }

  // ── Bundle helpers ────────────────────────────────────────────────────────────
  function addBundle() { setLeasing(L => ({ ...L, bundles: [...(L.bundles || []), { name: '', price: '', rooms: [] }] })) }
  function updateBundle(idx, patch) {
    setLeasing(L => { const b = [...(L.bundles || [])]; b[idx] = { ...b[idx], ...patch }; return { ...L, bundles: b } })
  }
  function removeBundle(idx) { setLeasing(L => ({ ...L, bundles: (L.bundles || []).filter((_, i) => i !== idx) })) }

  // ── Image helpers ─────────────────────────────────────────────────────────────
  function addImageFiles(files) {
    const valid = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (!valid.length) return
    const entries = valid.map(f => ({ id: `${Date.now()}-${Math.random()}`, file: f, preview: URL.createObjectURL(f), caption: '' }))
    setImages(prev => [...prev, ...entries])
  }
  function moveImage(idx, delta) {
    setImages(prev => {
      const j = idx + delta
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  // ── CSS class helpers ─────────────────────────────────────────────────────────
  const BASE_INPUT = 'w-full rounded-2xl border bg-white px-4 py-3 text-sm transition focus:outline-none focus:ring-2'
  const OK_INPUT   = `${BASE_INPUT} border-slate-200 focus:border-[#2563eb] focus:ring-[#2563eb]/20`
  const ERR_INPUT  = `${BASE_INPUT} border-red-300 bg-red-50/40 focus:border-red-400 focus:ring-red-400/20`
  const LBL = 'mb-1.5 block text-xs font-semibold text-slate-700'

  function ic(errKey) { return currentErrors[errKey] ? ERR_INPUT : OK_INPUT }

  // ── Room chip toggle helper ───────────────────────────────────────────────────
  function RoomChips({ access, onChange }) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {roomOptions.map(r => {
          const on = Array.isArray(access) && access.includes(r)
          return (
            <button
              key={r}
              type="button"
              onClick={() => onChange(on ? access.filter(x => x !== r) : [...(access || []), r])}
              className={[
                'rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition',
                on
                  ? 'border-[#2563eb] bg-[#2563eb]/10 text-[#2563eb]'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white',
              ].join(' ')}
            >
              {r}
            </button>
          )
        })}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step renders
  // ─────────────────────────────────────────────────────────────────────────────

  function renderBasics() {
    const e = currentErrors
    return (
      <div className="space-y-5">
        {/* Identity */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
          <SectionHeading>Property identity</SectionHeading>
          <div>
            <label className={LBL}>Property name <Req /></label>
            <input
              className={ic('name')}
              value={basics.name}
              onChange={ev => setBasics(b => ({ ...b, name: ev.target.value }))}
              placeholder="e.g. Maple Co-op"
              maxLength={120}
            />
            <FieldError msg={e.name} />
          </div>
          <div>
            <label className={LBL}>Full address <Req /></label>
            <input
              className={ic('address')}
              value={basics.address}
              onChange={ev => setBasics(b => ({ ...b, address: ev.target.value }))}
              placeholder="123 Main St, Seattle, WA 98101"
            />
            <FieldError msg={e.address} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LBL}>Property type <Req /></label>
              <select
                className={ic('propertyType')}
                value={basics.propertyType}
                onChange={ev => setBasics(b => ({
                  ...b,
                  propertyType: ev.target.value,
                  propertyTypeOther: ev.target.value === 'Other' ? b.propertyTypeOther : '',
                }))}
              >
                <option value="">Select type…</option>
                {PROPERTY_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <FieldError msg={e.propertyType} />
            </div>
            <div>
              <label className={LBL}>Pet policy <Req /></label>
              <select
                className={ic('pets')}
                value={basics.pets}
                onChange={ev => setBasics(b => ({ ...b, pets: ev.target.value }))}
              >
                <option value="">Select policy…</option>
                {PET_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <FieldError msg={e.pets} />
            </div>
          </div>
          {basics.propertyType === 'Other' && (
            <div>
              <label className={LBL}>Custom property type <Req /></label>
              <input
                className={ic('propertyTypeOther')}
                value={basics.propertyTypeOther}
                onChange={ev => setBasics(b => ({ ...b, propertyTypeOther: ev.target.value }))}
                placeholder="Describe the property type"
              />
              <FieldError msg={e.propertyTypeOther} />
            </div>
          )}
        </div>

        {/* Fees */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
          <SectionHeading>Fees</SectionHeading>
          <p className="text-xs text-slate-500">All three fee fields are required. Enter 0 if not applicable.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={LBL}>Application fee ($) <Req /></label>
              <input
                className={ic('applicationFee')}
                type="number"
                min="0"
                step="1"
                value={appFee}
                onChange={ev => setAppFee(ev.target.value)}
                placeholder="0"
              />
              <FieldError msg={e.applicationFee} />
            </div>
            <div>
              <label className={LBL}>Security deposit ($) <Req /></label>
              <input
                className={ic('securityDeposit')}
                type="number"
                min="0"
                step="1"
                value={basics.securityDeposit}
                onChange={ev => setBasics(b => ({ ...b, securityDeposit: ev.target.value }))}
                placeholder="0"
              />
              <FieldError msg={e.securityDeposit} />
            </div>
            <div>
              <label className={LBL}>Move-in charges ($) <Req /></label>
              <input
                className={ic('moveInCharges')}
                type="number"
                min="0"
                step="1"
                value={basics.moveInCharges}
                onChange={ev => setBasics(b => ({ ...b, moveInCharges: ev.target.value }))}
                placeholder="0"
              />
              <FieldError msg={e.moveInCharges} />
            </div>
          </div>
        </div>

        {/* Amenities */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <SectionHeading>Amenities <span className="ml-1 font-normal normal-case text-slate-400">(optional)</span></SectionHeading>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {AMENITY_OPTIONS.map(a => {
              const checked = Array.isArray(basics.amenities) && basics.amenities.includes(a)
              return (
                <label key={a} className={[
                  'flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition',
                  checked ? 'border-[#2563eb] bg-[#2563eb]/5 text-[#2563eb]' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
                ].join(' ')}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={ev => {
                      const on = ev.target.checked
                      setBasics(b => {
                        const cur = Array.isArray(b.amenities) ? b.amenities : []
                        return { ...b, amenities: on ? [...cur, a] : cur.filter(x => x !== a) }
                      })
                    }}
                  />
                  {a}
                </label>
              )
            })}
          </div>
          <div>
            <label className={`${LBL} mt-1`}>Other amenities</label>
            <input
              className={OK_INPUT}
              value={basics.amenitiesOther}
              onChange={ev => setBasics(b => ({ ...b, amenitiesOther: ev.target.value }))}
              placeholder="Comma-separated extras, e.g. Hot tub, Guest parking"
            />
          </div>
        </div>
      </div>
    )
  }

  function renderRooms() {
    const e = currentErrors
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <strong className="font-semibold text-slate-800">Required per room:</strong> monthly rent, availability date, and furnished status.
          Furniture list is also required when furnished is Yes or Partial.
        </div>
        {e._global && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{e._global}</div>
        )}

        {rooms.map((room, idx) => (
          <div key={`room-${idx}`} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2563eb]/10 text-xs font-black text-[#2563eb]">
                  {idx + 1}
                </div>
                <div className="text-sm font-black text-slate-800">Room {idx + 1}</div>
              </div>
              {rooms.length > 1 && (
                <button type="button" onClick={() => removeRoom(idx)} className="text-[11px] font-bold text-red-500 hover:text-red-700">
                  Remove
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LBL}>Room name <span className="font-normal text-slate-400">(optional)</span></label>
                <input
                  className={OK_INPUT}
                  value={room.label}
                  onChange={ev => updateRoom(idx, { label: ev.target.value })}
                  placeholder="e.g. Front bedroom"
                />
              </div>
              <div>
                <label className={LBL}>Monthly rent ($) <Req /></label>
                <input
                  className={ic(`r${idx}_rent`)}
                  type="number"
                  min="0"
                  step="1"
                  value={room.rent}
                  onChange={ev => updateRoom(idx, { rent: ev.target.value })}
                  placeholder="e.g. 950"
                />
                <FieldError msg={e[`r${idx}_rent`]} />
              </div>
              <div>
                <label className={LBL}>Available from <Req /></label>
                <input
                  className={ic(`r${idx}_avail`)}
                  type="date"
                  value={room.availability}
                  onChange={ev => updateRoom(idx, { availability: ev.target.value })}
                />
                <FieldError msg={e[`r${idx}_avail`]} />
              </div>
              <div>
                <label className={LBL}>Furnished <Req /></label>
                <select
                  className={ic(`r${idx}_furn`)}
                  value={room.furnished}
                  onChange={ev => updateRoom(idx, { furnished: ev.target.value })}
                >
                  <option value="">Select…</option>
                  {FURNISHED_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <FieldError msg={e[`r${idx}_furn`]} />
              </div>

              {(room.furnished === 'Yes' || room.furnished === 'Partial') && (
                <div className="sm:col-span-2">
                  <label className={LBL}>Furniture included <Req /></label>
                  <input
                    className={ic(`r${idx}_furnInc`)}
                    value={room.furnitureIncluded}
                    onChange={ev => updateRoom(idx, { furnitureIncluded: ev.target.value })}
                    placeholder="e.g. Bed, desk, dresser, chair"
                  />
                  <FieldError msg={e[`r${idx}_furnInc`]} />
                </div>
              )}

              <div>
                <label className={LBL}>Utilities cost ($/mo) <span className="font-normal text-slate-400">(optional)</span></label>
                <input
                  className={OK_INPUT}
                  type="number"
                  min="0"
                  step="1"
                  value={room.utilitiesCost}
                  onChange={ev => updateRoom(idx, { utilitiesCost: ev.target.value })}
                  placeholder="0"
                />
              </div>

              <div className="sm:col-span-2">
                <label className={LBL}>Additional features <span className="font-normal text-slate-400">(optional)</span></label>
                <input
                  className={OK_INPUT}
                  value={room.additionalFeatures}
                  onChange={ev => updateRoom(idx, { additionalFeatures: ev.target.value })}
                  placeholder="e.g. Keypad lock, private balcony, AC"
                />
              </div>

              <div className="sm:col-span-2">
                <label className={LBL}>Notes <span className="font-normal text-slate-400">(optional)</span></label>
                <textarea
                  className={`${OK_INPUT} min-h-[56px] resize-y`}
                  value={room.notes}
                  onChange={ev => updateRoom(idx, { notes: ev.target.value })}
                  placeholder="Anything else about this room"
                  rows={2}
                />
              </div>

              {idx === 0 && (
                <div className="sm:col-span-2">
                  <label className={LBL}>Utilities description <span className="font-normal text-slate-400">(Room 1 only — optional)</span></label>
                  <textarea
                    className={`${OK_INPUT} min-h-[56px] resize-y`}
                    value={room.utilities}
                    onChange={ev => updateRoom(idx, { utilities: ev.target.value })}
                    placeholder="e.g. Water + gas included, tenant pays electric"
                    rows={2}
                  />
                </div>
              )}

              <div className="sm:col-span-2">
                <label className={LBL}>Room photos / videos <span className="font-normal text-slate-400">(optional)</span></label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center text-xs text-slate-500 transition hover:border-[#2563eb]/50 hover:bg-blue-50/20">
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={ev => { addRoomMedia(idx, ev.target.files); ev.target.value = '' }}
                  />
                  Drag & drop or click to add files for this room
                </label>
                {(room.media || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {room.media.map(m => (
                      <div key={m.id} className="relative h-20 w-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                        {m.file?.type?.startsWith('video/')
                          ? <div className="flex h-full items-center justify-center text-[10px] font-semibold text-slate-500">Video</div>
                          : <img src={m.preview} alt="" className="h-full w-full object-cover" />
                        }
                        <button
                          type="button"
                          onClick={() => removeRoomMedia(idx, m.id)}
                          className="absolute right-0.5 top-0.5 rounded-full bg-white/90 px-1.5 text-[10px] font-bold text-red-600 shadow"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {rooms.length < MAX_ROOM_SLOTS && (
          <button
            type="button"
            onClick={addRoom}
            className="w-full rounded-xl border border-dashed border-[#2563eb]/40 px-4 py-3 text-sm font-semibold text-[#2563eb] transition hover:border-[#2563eb] hover:bg-[#2563eb]/5"
          >
            + Add room
          </button>
        )}
      </div>
    )
  }

  function renderBathrooms() {
    const e = currentErrors
    return (
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Optional — add if this property has bathrooms. <strong>If added, type and room access are required.</strong>
        </p>
        {bathrooms.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">
            No bathrooms added. Click below to add one.
          </div>
        ) : bathrooms.map((bath, idx) => (
          <div key={`bath-${idx}`} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">{idx + 1}</div>
                <div className="text-sm font-black text-slate-800">Bathroom {idx + 1}</div>
              </div>
              <button type="button" onClick={() => removeBath(idx)} className="text-[11px] font-bold text-red-500 hover:text-red-700">Remove</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LBL}>Name <span className="font-normal text-slate-400">(optional)</span></label>
                <input className={OK_INPUT} value={bath.label} onChange={ev => updateBath(idx, { label: ev.target.value })} placeholder="e.g. Hall bath, Primary suite" />
              </div>
              <div>
                <label className={LBL}>Type <Req /></label>
                <select className={ic(`b${idx}_kind`)} value={bath.kind} onChange={ev => updateBath(idx, { kind: ev.target.value })}>
                  <option value="">Select type…</option>
                  {BATHROOM_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <FieldError msg={e[`b${idx}_kind`]} />
              </div>
              <div className="sm:col-span-2">
                <label className={LBL}>Details <span className="font-normal text-slate-400">(optional)</span></label>
                <textarea className={`${OK_INPUT} min-h-[64px]`} value={bath.description} onChange={ev => updateBath(idx, { description: ev.target.value })} placeholder="Floor, fixtures, condition, access notes…" rows={2} />
              </div>
              <div className="sm:col-span-2">
                <label className={`${LBL} mb-2`}>Room access <Req /></label>
                <RoomChips access={bath.access} onChange={access => updateBath(idx, { access })} />
                <FieldError msg={e[`b${idx}_access`]} />
              </div>
            </div>
          </div>
        ))}
        {bathrooms.length < MAX_BATHROOM_SLOTS && (
          <button type="button" onClick={addBath} className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            + Add bathroom
          </button>
        )}
      </div>
    )
  }

  function renderKitchens() {
    const e = currentErrors
    return (
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Optional — add if this property has shared kitchens or kitchenettes. <strong>If added, type and room access are required.</strong>
        </p>
        {kitchens.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">
            No kitchens added. Click below to add one.
          </div>
        ) : kitchens.map((kit, idx) => (
          <div key={`kit-${idx}`} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">{idx + 1}</div>
                <div className="text-sm font-black text-slate-800">Kitchen {idx + 1}</div>
              </div>
              <button type="button" onClick={() => removeKitchen(idx)} className="text-[11px] font-bold text-red-500 hover:text-red-700">Remove</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LBL}>Name <span className="font-normal text-slate-400">(optional)</span></label>
                <input className={OK_INPUT} value={kit.label} onChange={ev => updateKitchen(idx, { label: ev.target.value })} placeholder="e.g. Main kitchen" />
              </div>
              <div>
                <label className={LBL}>Type <Req /></label>
                <select className={ic(`k${idx}_kind`)} value={kit.kind} onChange={ev => updateKitchen(idx, { kind: ev.target.value })}>
                  <option value="">Select type…</option>
                  {KITCHEN_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <FieldError msg={e[`k${idx}_kind`]} />
              </div>
              <div className="sm:col-span-2">
                <label className={LBL}>Details <span className="font-normal text-slate-400">(optional)</span></label>
                <textarea className={`${OK_INPUT} min-h-[64px]`} value={kit.description} onChange={ev => updateKitchen(idx, { description: ev.target.value })} placeholder="Appliances, shared vs private, condition…" rows={2} />
              </div>
              <div className="sm:col-span-2">
                <label className={`${LBL} mb-2`}>Room access <Req /></label>
                <RoomChips access={kit.access} onChange={access => updateKitchen(idx, { access })} />
                <FieldError msg={e[`k${idx}_access`]} />
              </div>
            </div>
          </div>
        ))}
        {kitchens.length < MAX_KITCHEN_SLOTS && (
          <button type="button" onClick={addKitchen} className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            + Add kitchen
          </button>
        )}
      </div>
    )
  }

  function renderSharedSpaces() {
    const e = currentErrors
    return (
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Optional — add common areas renters share. <strong>If added, space type is required.</strong>
        </p>
        {sharedSpaces.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">
            No shared spaces added yet. Add one if applicable.
          </div>
        ) : sharedSpaces.map((space, idx) => (
          <div key={`space-${idx}`} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">{idx + 1}</div>
                <div className="text-sm font-black text-slate-800">Shared space {idx + 1}</div>
              </div>
              <button type="button" onClick={() => removeSpace(idx)} className="text-[11px] font-bold text-red-500 hover:text-red-700">Remove</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LBL}>Name <span className="font-normal text-slate-400">(optional)</span></label>
                <input className={OK_INPUT} value={space.name} onChange={ev => updateSpace(idx, { name: ev.target.value })} placeholder="e.g. Main living room" />
              </div>
              <div>
                <label className={LBL}>Type <Req /></label>
                <select className={ic(`s${idx}_type`)} value={space.type} onChange={ev => updateSpace(idx, { type: ev.target.value })}>
                  <option value="">Select type…</option>
                  {SHARED_SPACE_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <FieldError msg={e[`s${idx}_type`]} />
              </div>
              {space.type === 'Other' && (
                <div className="sm:col-span-2">
                  <label className={LBL}>Describe this space <Req /></label>
                  <input className={ic(`s${idx}_typeOther`)} value={space.typeOther} onChange={ev => updateSpace(idx, { typeOther: ev.target.value })} placeholder="What is this space?" />
                  <FieldError msg={e[`s${idx}_typeOther`]} />
                </div>
              )}
              <div className="sm:col-span-2">
                <label className={`${LBL} mb-2`}>Room access <span className="font-normal text-slate-400">(optional)</span></label>
                <RoomChips access={space.access} onChange={access => updateSpace(idx, { access })} />
              </div>
            </div>
          </div>
        ))}
        {sharedSpaces.length < MAX_SHARED_SPACE_SLOTS && (
          <button type="button" onClick={addSpace} className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
            + Add shared space
          </button>
        )}
      </div>
    )
  }

  function renderLaundryParking() {
    const e = currentErrors
    return (
      <div className="space-y-5">
        {/* Laundry */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
          <SectionHeading>Laundry</SectionHeading>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={laundry.enabled}
              onChange={ev => setLaundry(l => ({ ...l, enabled: ev.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 accent-[#2563eb]"
            />
            Laundry on site
          </label>
          {laundry.enabled && (
            <div className="space-y-4 border-t border-slate-100 pt-4">
              <div>
                <label className={`${LBL} mb-2`}>General room access (all laundry) <span className="font-normal text-slate-400">(optional)</span></label>
                <RoomChips
                  access={laundry.generalAccess || []}
                  onChange={generalAccess => setLaundry(l => ({ ...l, generalAccess }))}
                />
              </div>
              <div className="text-xs font-semibold text-slate-500">Laundry locations (up to {MAX_LAUNDRY_SLOTS})</div>
              {(laundry.rows || []).map((row, idx) => (
                <div key={`ld-${idx}`} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <div className="flex-1 space-y-3">
                    <div>
                      <label className={LBL}>Laundry type <Req /></label>
                      <input
                        className={ic(`l${idx}_type`)}
                        value={row.type}
                        onChange={ev => updateLaundryRow(idx, { type: ev.target.value })}
                        placeholder="e.g. In-unit W/D, Shared washer in basement"
                      />
                      <FieldError msg={e[`l${idx}_type`]} />
                    </div>
                    <div>
                      <label className={`${LBL} mb-2`}>Room access <span className="font-normal text-slate-400">(optional)</span></label>
                      <RoomChips
                        access={row.access || []}
                        onChange={access => updateLaundryRow(idx, { access })}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLaundryRow(idx)}
                    className="mt-6 shrink-0 rounded-lg border border-red-200 px-2 py-1 text-[11px] font-bold text-red-500 hover:bg-red-50"
                  >✕</button>
                </div>
              ))}
              {(laundry.rows || []).length < MAX_LAUNDRY_SLOTS && (
                <button type="button" onClick={addLaundryRow} className="rounded-xl border border-dashed border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  + Add laundry location
                </button>
              )}
            </div>
          )}
        </div>

        {/* Parking */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
          <SectionHeading>Parking</SectionHeading>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={parking.enabled}
              onChange={ev => setParking(p => ({ ...p, enabled: ev.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 accent-[#2563eb]"
            />
            Parking available
          </label>
          {parking.enabled && (
            <div className="grid gap-3 sm:grid-cols-2 border-t border-slate-100 pt-4">
              <div>
                <label className={LBL}>Parking type <Req /></label>
                <input
                  className={ic('parkingType')}
                  value={parking.type}
                  onChange={ev => setParking(p => ({ ...p, type: ev.target.value }))}
                  placeholder="e.g. Street, assigned garage, driveway"
                />
                <FieldError msg={e.parkingType} />
              </div>
              <div>
                <label className={LBL}>Parking fee ($/mo) <span className="font-normal text-slate-400">(optional)</span></label>
                <input
                  className={OK_INPUT}
                  type="number"
                  min="0"
                  step="1"
                  value={parking.fee}
                  onChange={ev => setParking(p => ({ ...p, fee: ev.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderMedia() {
    return (
      <div className="space-y-5">
        <div>
          <label className={LBL}>Other / additional info <span className="font-normal text-slate-400">(optional)</span></label>
          <p className="mb-2 text-xs text-slate-500">House rules, move-in process, lease terms, access details, utilities breakdown, neighbourhood notes.</p>
          <textarea
            className={`${OK_INPUT} min-h-[96px] resize-y`}
            value={otherInfo}
            onChange={ev => setOtherInfo(ev.target.value)}
            placeholder="e.g. Tenant handles their own internet. Move-in requires 1-month notice…"
            rows={4}
          />
        </div>
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Property photos <span className="font-normal normal-case text-slate-400">(optional)</span>
          </div>
          <div
            ref={dropRef}
            onDrop={ev => { ev.preventDefault(); dropRef.current?.classList.remove('border-[#2563eb]', 'bg-blue-50/40'); addImageFiles(ev.dataTransfer.files) }}
            onDragOver={ev => { ev.preventDefault(); dropRef.current?.classList.add('border-[#2563eb]', 'bg-blue-50/40') }}
            onDragLeave={() => dropRef.current?.classList.remove('border-[#2563eb]', 'bg-blue-50/40')}
            onClick={() => imageInputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center transition hover:border-[#2563eb] hover:bg-blue-50/30"
          >
            <div className="text-sm font-semibold text-slate-500">Drag & drop images, or <span className="text-[#2563eb]">click to upload</span></div>
            <div className="mt-1 text-xs text-slate-400">JPG, PNG, WEBP · optional caption per image</div>
            <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={ev => addImageFiles(ev.target.files)} />
          </div>
          {images.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((img, idx) => (
                <div key={img.id} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <img src={img.preview} alt="" className="h-32 w-full object-cover" />
                  <div className="absolute left-1.5 top-1.5 flex gap-1">
                    <button type="button" disabled={idx === 0} onClick={ev => { ev.stopPropagation(); moveImage(idx, -1) }} className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 shadow disabled:opacity-30">↑</button>
                    <button type="button" disabled={idx >= images.length - 1} onClick={ev => { ev.stopPropagation(); moveImage(idx, 1) }} className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 shadow disabled:opacity-30">↓</button>
                  </div>
                  <button type="button" onClick={ev => { ev.stopPropagation(); URL.revokeObjectURL(img.preview); setImages(prev => prev.filter(i => i.id !== img.id)) }} className="absolute right-1.5 top-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-red-600 shadow hover:bg-red-50">✕</button>
                  <div className="p-2">
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#2563eb]/40"
                      placeholder="Caption (optional)"
                      value={img.caption}
                      onChange={ev => setImages(prev => prev.map(i => i.id === img.id ? { ...i, caption: ev.target.value } : i))}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderPricing() {
    const e = currentErrors
    return (
      <div className="space-y-5">
        {/* Full house pricing */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-4">
          <SectionHeading>Full property pricing <span className="font-normal normal-case text-slate-400">(optional)</span></SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LBL}>Full rent ($/mo)</label>
              <input
                className={ic('fullHousePrice')}
                type="number"
                min="0"
                step="1"
                value={leasing.fullHousePrice}
                onChange={ev => setLeasing(L => ({ ...L, fullHousePrice: ev.target.value }))}
                placeholder="e.g. 6200"
              />
              <FieldError msg={e.fullHousePrice} />
            </div>
            <div>
              <label className={LBL}>Promo rent ($/mo) <span className="font-normal text-slate-400">(optional)</span></label>
              <input
                className={OK_INPUT}
                type="number"
                min="0"
                step="1"
                value={leasing.promoPrice}
                onChange={ev => setLeasing(L => ({ ...L, promoPrice: ev.target.value }))}
                placeholder="e.g. 5800"
              />
            </div>
          </div>
        </div>

        {/* Lease length */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <SectionHeading>Lease length info <Req /></SectionHeading>
          <p className="text-xs text-slate-500">Shown to applicants — describe available lease terms.</p>
          <textarea
            className={ic('leaseLengthInfo')}
            value={leasing.leaseLengthInfo}
            onChange={ev => setLeasing(L => ({ ...L, leaseLengthInfo: ev.target.value }))}
            rows={3}
          />
          <FieldError msg={e.leaseLengthInfo} />
        </div>

        {/* Leasing bundles */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <SectionHeading>Leasing bundles <span className="font-normal normal-case text-slate-400">(optional)</span></SectionHeading>
          <p className="text-xs text-slate-500">Group rooms together with a shared monthly price. Each bundle requires a name, rent, and at least one room.</p>
          {(leasing.bundles || []).map((b, bidx) => (
            <div key={`bnd-${bidx}`} className="rounded-xl border border-slate-100 bg-slate-50/90 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-700">Bundle {bidx + 1}</div>
                <button type="button" onClick={() => removeBundle(bidx)} className="text-[11px] font-bold text-red-600 hover:underline">Remove</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={LBL}>Bundle name <Req /></label>
                  <input className={ic(`bnd${bidx}_name`)} value={b.name} onChange={ev => updateBundle(bidx, { name: ev.target.value })} placeholder="e.g. Second floor rental" />
                  <FieldError msg={e[`bnd${bidx}_name`]} />
                </div>
                <div>
                  <label className={LBL}>Monthly rent ($) <Req /></label>
                  <input className={ic(`bnd${bidx}_price`)} type="number" min="0" step="1" value={b.price} onChange={ev => updateBundle(bidx, { price: ev.target.value })} placeholder="e.g. 3100" />
                  <FieldError msg={e[`bnd${bidx}_price`]} />
                </div>
                <div className="sm:col-span-2">
                  <label className={`${LBL} mb-2`}>Included rooms <Req /></label>
                  <div className="flex flex-wrap gap-1.5">
                    {roomOptions.map(r => {
                      const on = Array.isArray(b.rooms) && b.rooms.includes(r)
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            const next = new Set(Array.isArray(b.rooms) ? b.rooms : [])
                            if (next.has(r)) next.delete(r); else next.add(r)
                            updateBundle(bidx, { rooms: [...next] })
                          }}
                          className={[
                            'rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition',
                            on ? 'border-[#2563eb] bg-[#2563eb]/10 text-[#2563eb]' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                          ].join(' ')}
                        >{r}</button>
                      )
                    })}
                  </div>
                  <FieldError msg={e[`bnd${bidx}_rooms`]} />
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addBundle} className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            + Add bundle
          </button>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────
  const stepRenders = [renderBasics, renderRooms, renderBathrooms, renderKitchens, renderSharedSpaces, renderLaundryParking, renderMedia, renderPricing]
  const isLastStep = step === STEPS.length - 1
  const hasErrors = Object.keys(currentErrors).length > 0

  return (
    <Modal onClose={handleClose}>
      <form onSubmit={isLastStep ? handleSubmit : handleNext} noValidate>

        {/* Header */}
        <div className="pr-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">
            New property · Step {step + 1} of {STEPS.length}
          </div>
          <h3 className="mt-1 text-2xl font-black text-slate-900">{STEPS[step].label}</h3>
        </div>

        {/* Progress bar */}
        <div className="mt-4 flex gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              title={s.label}
              className={[
                'h-1.5 flex-1 rounded-full transition-all duration-300',
                i < step ? 'bg-[#2563eb]' : i === step ? 'bg-[#2563eb]/50' : 'bg-slate-200',
              ].join(' ')}
            />
          ))}
        </div>

        {/* Validation error banner */}
        {attempted && hasErrors && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <strong className="font-semibold">Fix the highlighted errors below</strong> to continue.
          </div>
        )}

        {/* Step content */}
        <div ref={scrollRef} className="mt-6 max-h-[min(70vh,640px)] overflow-y-auto pr-1">
          {stepRenders[step]?.()}
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={saving}
            onClick={step === 0 ? handleClose : handleBack}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {step === 0 ? 'Cancel' : '← Back'}
          </button>

          <div className="flex items-center gap-3">
            {attempted && hasErrors && !stepIsValid && (
              <span className="hidden text-xs font-medium text-red-500 sm:inline">Errors above</span>
            )}
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {isLastStep
                ? saving ? 'Submitting…' : 'Submit for review'
                : 'Next →'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
