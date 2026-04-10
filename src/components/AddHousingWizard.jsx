import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { createRoomForProperty, getAirtableRoomsTableName } from '../lib/airtable'

const inputCls =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'

const labelCls = 'mb-1.5 block text-sm font-semibold text-slate-700'

const PROFILE_START = '--- Axis property profile (JSON) ---'
const PROFILE_END = '--- End profile ---'

function mergeAxisPropertyProfileIntoNotes(existingNotes, profileObject) {
  const raw = String(existingNotes || '')
  const re = new RegExp(`${PROFILE_START}[\\s\\S]*?${PROFILE_END}`, 'g')
  const stripped = raw.replace(re, '').trim()
  const json = JSON.stringify(profileObject)
  const block = `${PROFILE_START}\n${json}\n${PROFILE_END}`
  return stripped ? `${stripped}\n\n${block}` : block
}

const LAUNDRY_PROPERTY_TYPES = [
  { value: '', label: 'Select laundry type…' },
  { value: 'in_unit', label: 'In-unit (washer/dryer in the home)' },
  { value: 'out_of_unit', label: 'Out of unit / shared laundry on-site' },
  { value: 'none', label: 'No laundry on-site' },
]

const PARKING_PROPERTY_TYPES = [
  { value: '', label: 'Select parking type…' },
  { value: 'street', label: 'Street parking' },
  { value: 'designated', label: 'Designated / assigned spot(s)' },
  { value: 'garage', label: 'Garage / covered parking' },
  { value: 'lot', label: 'Surface / open lot' },
  { value: 'carport', label: 'Carport' },
  { value: 'none', label: 'No parking' },
  { value: 'other', label: 'Other (describe in notes)' },
]

const LAUNDRY_ROOM_ACCESS = [
  { value: '', label: 'Select…' },
  { value: 'building_default', label: 'Same as building default' },
  { value: 'in_unit', label: 'In-unit laundry in this room' },
  { value: 'shared_on_site', label: 'Shared on-site (not in room)' },
  { value: 'none', label: 'No laundry for this room' },
]

const PARKING_ROOM_ACCESS = [
  { value: '', label: 'Select…' },
  { value: 'building_default', label: 'Same as building default' },
  { value: 'designated', label: 'Designated spot with this room' },
  { value: 'street', label: 'Street parking only' },
  { value: 'none', label: 'No parking' },
  { value: 'other', label: 'Other (see notes)' },
]

function propertyLaundryLabel(value) {
  return LAUNDRY_PROPERTY_TYPES.find((t) => t.value === value)?.label || ''
}

function propertyParkingLabel(value) {
  return PARKING_PROPERTY_TYPES.find((t) => t.value === value)?.label || ''
}

function emptyRoom() {
  return {
    roomNumber: '',
    monthlyRent: '',
    furnishingLevel: 'none',
    furnishingDetail: '',
    kitchenIncluded: '',
    laundryAccess: '',
    laundrySharesWith: '',
    parkingAccess: '',
    parkingDetail: '',
    floor: '',
    bathroomType: '',
    squareFeet: '',
    bedSize: '',
    deskIncluded: null,
    acIncluded: null,
    storageNotes: '',
    windowsLight: '',
    roomNotes: '',
    availability: '',
  }
}

const BATH_OPTIONS = ['', 'Private', 'Shared', 'Ensuite / attached']

/**
 * Multi-step add housing: property details + room-by-room inventory (Airtable Rooms table).
 * @param {(fields: object) => Promise<object>} props.createProperty — same shape as createPropertyAdmin
 * @param {(property: object) => void} props.onSuccess
 */
export default function AddHousingWizard({ createProperty, onSuccess }) {
  const [phase, setPhase] = useState('property')
  const [roomCursor, setRoomCursor] = useState(0)
  const [saving, setSaving] = useState(false)
  const [roomCount, setRoomCount] = useState(1)

  const [propertyForm, setPropertyForm] = useState({
    name: '',
    address: '',
    utilitiesFee: '',
    securityDeposit: '',
    applicationFee: '',
    propertyNotes: '',
    yearBuilt: '',
    totalBedrooms: '',
    totalBathrooms: '',
    stories: '',
    laundryType: '',
    laundryFeeUsd: '',
    laundryRoomsSharing: '',
    laundryIncluded: '',
    parkingType: '',
    parkingFeeUsd: '',
    parkingNotes: '',
    petPolicy: '',
    wifi: '',
    heating: '',
    commonAreas: '',
    kitchenIncluded: '',
  })

  const [rooms, setRooms] = useState(() => [emptyRoom()])

  const nRooms = useMemo(() => Math.min(40, Math.max(1, Number(roomCount) || 1)), [roomCount])

  useEffect(() => {
    setRooms((prev) => {
      const next = prev.slice(0, nRooms)
      while (next.length < nRooms) next.push(emptyRoom())
      return next
    })
  }, [nRooms])

  const setRoom = useCallback((index, patch) => {
    setRooms((list) => {
      const copy = [...list]
      copy[index] = { ...copy[index], ...patch }
      return copy
    })
  }, [])

  const roomsTable = getAirtableRoomsTableName()

  function buildPropertyPayload() {
    const profile = {
      yearBuilt: String(propertyForm.yearBuilt || '').trim(),
      totalBedrooms: String(propertyForm.totalBedrooms || '').trim(),
      totalBathrooms: String(propertyForm.totalBathrooms || '').trim(),
      stories: String(propertyForm.stories || '').trim(),
      laundryType: String(propertyForm.laundryType || '').trim(),
      laundryTypeLabel: propertyLaundryLabel(propertyForm.laundryType),
      laundryFeeUsd: String(propertyForm.laundryFeeUsd || '').trim(),
      laundryRoomsSharing: String(propertyForm.laundryRoomsSharing || '').trim(),
      laundryIncluded: String(propertyForm.laundryIncluded || '').trim(),
      parkingType: String(propertyForm.parkingType || '').trim(),
      parkingTypeLabel: propertyParkingLabel(propertyForm.parkingType),
      parkingFeeUsd: String(propertyForm.parkingFeeUsd || '').trim(),
      parkingNotes: String(propertyForm.parkingNotes || '').trim(),
      petPolicy: String(propertyForm.petPolicy || '').trim(),
      wifi: String(propertyForm.wifi || '').trim(),
      heating: String(propertyForm.heating || '').trim(),
      commonAreas: String(propertyForm.commonAreas || '').trim(),
      kitchenIncluded: String(propertyForm.kitchenIncluded || '').trim(),
    }
    const hasProfile = Object.values(profile).some(Boolean)
    const notesRaw = String(propertyForm.propertyNotes || '').trim()
    const Notes = hasProfile ? mergeAxisPropertyProfileIntoNotes(notesRaw, profile) : notesRaw

    return {
      Name: propertyForm.name.trim(),
      Address: propertyForm.address.trim(),
      ...(propertyForm.utilitiesFee ? { 'Utilities Fee': Number(propertyForm.utilitiesFee) } : {}),
      ...(propertyForm.securityDeposit ? { 'Security Deposit': Number(propertyForm.securityDeposit) } : {}),
      ...(String(propertyForm.applicationFee ?? '').trim() !== ''
        ? (() => {
            const n = Math.round(Number(propertyForm.applicationFee))
            return Number.isNaN(n)
              ? {}
              : { 'Application Fee': Math.max(0, Math.min(9999, n)) }
          })()
        : {}),
      ...(Notes ? { Notes } : {}),
    }
  }

  function validateProperty() {
    if (!propertyForm.name.trim()) return 'House name is required.'
    return ''
  }

  function validateRoom(i) {
    const r = rooms[i]
    if (!String(r?.roomNumber || '').trim()) return `Room ${i + 1}: add a room number or label (e.g. 4 or Room A).`
    return ''
  }

  async function handleFinalSubmit() {
    const err = validateProperty()
    if (err) {
      toast.error(err)
      return
    }
    for (let i = 0; i < nRooms; i++) {
      const e = validateRoom(i)
      if (e) {
        toast.error(e)
        return
      }
    }

    setSaving(true)
    try {
      const payload = buildPropertyPayload()
      const created = await createProperty(payload)
      let createdRooms = 0
      let lastRoomErr = null
      for (let i = 0; i < nRooms; i++) {
        try {
          await createRoomForProperty(created.id, rooms[i])
          createdRooms += 1
        } catch (e) {
          lastRoomErr = e
        }
      }
      if (createdRooms < nRooms && lastRoomErr) {
        toast.error(
          `House created, but only ${createdRooms} of ${nRooms} rooms saved. Check the "${roomsTable}" table and field names in .env.example.`,
        )
      } else {
        toast.success(`House and ${createdRooms} room${createdRooms === 1 ? '' : 's'} created.`)
      }
      onSuccess?.(created, { roomsCreated: createdRooms, roomsPlanned: nRooms })
      setPhase('property')
      setRoomCursor(0)
      setRoomCount(1)
      setRooms([emptyRoom()])
      setPropertyForm({
        name: '',
        address: '',
        utilitiesFee: '',
        securityDeposit: '',
        applicationFee: '',
        propertyNotes: '',
        yearBuilt: '',
        totalBedrooms: '',
        totalBathrooms: '',
        stories: '',
        laundryType: '',
        laundryFeeUsd: '',
        laundryRoomsSharing: '',
        laundryIncluded: '',
        parkingType: '',
        parkingFeeUsd: '',
        parkingNotes: '',
        petPolicy: '',
        wifi: '',
        heating: '',
        commonAreas: '',
        kitchenIncluded: '',
      })
    } catch (err) {
      toast.error(err.message || 'Could not create house or rooms.')
    } finally {
      setSaving(false)
    }
  }

  const tri = (value, onYes, onNo) => {
    if (value === true) return onYes
    if (value === false) return onNo
    return null
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs leading-relaxed text-slate-600">
        <strong className="text-slate-800">Airtable:</strong> Creates a <strong>Properties</strong> row, then one row per room in
        the <strong>{roomsTable}</strong> table linked to that property. Laundry/parking types, fees, and &quot;who shares&quot; live in
        the property <strong>Notes</strong> JSON block. Per-room laundry/parking summaries can map to <strong>Laundry Access</strong> /{' '}
        <strong>Parking Access</strong> on each room row — see <code className="rounded bg-white px-1">.env.example</code>.
      </div>

      {phase === 'property' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>House name *</label>
              <input
                type="text"
                required
                value={propertyForm.name}
                onChange={(e) => setPropertyForm((c) => ({ ...c, name: e.target.value }))}
                placeholder="4709C 8th Ave NE"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Address</label>
              <input
                type="text"
                value={propertyForm.address}
                onChange={(e) => setPropertyForm((c) => ({ ...c, address: e.target.value }))}
                placeholder="Full street address"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Utilities fee ($/mo)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={propertyForm.utilitiesFee}
                onChange={(e) => setPropertyForm((c) => ({ ...c, utilitiesFee: e.target.value }))}
                placeholder="175"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Security deposit ($)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={propertyForm.securityDeposit}
                onChange={(e) => setPropertyForm((c) => ({ ...c, securityDeposit: e.target.value }))}
                placeholder="500"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Application fee ($)</label>
              <p className="mb-1.5 text-xs text-slate-500">
                Charged on the public Apply flow via Stripe when this property name matches the listing. Use 0 for no fee (applicants submit without paying).
              </p>
              <input
                type="number"
                min="0"
                max="9999"
                step="1"
                value={propertyForm.applicationFee}
                onChange={(e) => setPropertyForm((c) => ({ ...c, applicationFee: e.target.value }))}
                placeholder="50 (default on site if left empty)"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Year built</label>
              <input
                type="text"
                value={propertyForm.yearBuilt}
                onChange={(e) => setPropertyForm((c) => ({ ...c, yearBuilt: e.target.value }))}
                placeholder="2018"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Stories / levels</label>
              <input
                type="text"
                value={propertyForm.stories}
                onChange={(e) => setPropertyForm((c) => ({ ...c, stories: e.target.value }))}
                placeholder="2"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Total bedrooms (whole house)</label>
              <input
                type="text"
                value={propertyForm.totalBedrooms}
                onChange={(e) => setPropertyForm((c) => ({ ...c, totalBedrooms: e.target.value }))}
                placeholder="9"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Total bathrooms (whole house)</label>
              <input
                type="text"
                value={propertyForm.totalBathrooms}
                onChange={(e) => setPropertyForm((c) => ({ ...c, totalBathrooms: e.target.value }))}
                placeholder="3"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Laundry (whole property)</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Laundry type</label>
                  <select
                    value={propertyForm.laundryType}
                    onChange={(e) => setPropertyForm((c) => ({ ...c, laundryType: e.target.value }))}
                    className={inputCls}
                  >
                    {LAUNDRY_PROPERTY_TYPES.map((o) => (
                      <option key={o.value || 'unset'} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Laundry fee ($)</label>
                  <p className="mb-1.5 text-xs text-slate-500">0 if included in rent/utilities; otherwise per month or per load (say which in &quot;what&apos;s included&quot;).</p>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={propertyForm.laundryFeeUsd}
                    onChange={(e) => setPropertyForm((c) => ({ ...c, laundryFeeUsd: e.target.value }))}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Rooms or groups that share laundry</label>
                  <textarea
                    rows={2}
                    value={propertyForm.laundryRoomsSharing}
                    onChange={(e) => setPropertyForm((c) => ({ ...c, laundryRoomsSharing: e.target.value }))}
                    placeholder="e.g. All rooms use basement W/D · Rooms 1–4 share 2nd-floor machines · Room 10 has private W/D"
                    className={inputCls}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Laundry — what&apos;s included</label>
                  <p className="mb-1.5 text-xs text-slate-500">Machines, coins vs free, detergent, hours, etc.</p>
                  <textarea
                    rows={3}
                    value={propertyForm.laundryIncluded}
                    onChange={(e) => setPropertyForm((c) => ({ ...c, laundryIncluded: e.target.value }))}
                    placeholder="e.g. 2 front-load washers, 1 dryer, free to use; laundry pods not provided."
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
            <div className="sm:col-span-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Parking (whole property)</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Parking type</label>
                  <select
                    value={propertyForm.parkingType}
                    onChange={(e) => setPropertyForm((c) => ({ ...c, parkingType: e.target.value }))}
                    className={inputCls}
                  >
                    {PARKING_PROPERTY_TYPES.map((o) => (
                      <option key={o.value || 'unset'} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Parking fee ($)</label>
                  <p className="mb-1.5 text-xs text-slate-500">0 if free / included; otherwise monthly permit, stall rent, etc.</p>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={propertyForm.parkingFeeUsd}
                    onChange={(e) => setPropertyForm((c) => ({ ...c, parkingFeeUsd: e.target.value }))}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Parking notes</label>
                  <textarea
                    rows={2}
                    value={propertyForm.parkingNotes}
                    onChange={(e) => setPropertyForm((c) => ({ ...c, parkingNotes: e.target.value }))}
                    placeholder="e.g. Zone 2 street permit, 2 assigned stalls in rear lot (#3 and #4), EV charger in garage…"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Pet policy</label>
              <input
                type="text"
                value={propertyForm.petPolicy}
                onChange={(e) => setPropertyForm((c) => ({ ...c, petPolicy: e.target.value }))}
                placeholder="No pets / cats only / ESA with documentation"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Wi‑Fi &amp; internet</label>
              <input
                type="text"
                value={propertyForm.wifi}
                onChange={(e) => setPropertyForm((c) => ({ ...c, wifi: e.target.value }))}
                placeholder="Gigabit included in utilities"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Shared kitchen — list what&apos;s included</label>
              <p className="mb-1.5 text-xs text-slate-500">
                Appliances, cookware, dishes, pantry space, dishwasher, etc.
              </p>
              <textarea
                rows={4}
                value={propertyForm.kitchenIncluded}
                onChange={(e) => setPropertyForm((c) => ({ ...c, kitchenIncluded: e.target.value }))}
                placeholder="e.g. Gas range, microwave, dishwasher, 2 fridges, basic pots/pans and dishes, labeled shelf space per resident…"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Heating &amp; cooling (building)</label>
              <input
                type="text"
                value={propertyForm.heating}
                onChange={(e) => setPropertyForm((c) => ({ ...c, heating: e.target.value }))}
                placeholder="Central heat, window AC in each room"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Common areas &amp; amenities</label>
              <textarea
                rows={3}
                value={propertyForm.commonAreas}
                onChange={(e) => setPropertyForm((c) => ({ ...c, commonAreas: e.target.value }))}
                placeholder="Kitchen, living room, backyard deck, bike storage…"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Internal notes (shown in Properties Notes)</label>
              <textarea
                rows={2}
                value={propertyForm.propertyNotes}
                onChange={(e) => setPropertyForm((c) => ({ ...c, propertyNotes: e.target.value }))}
                placeholder="Anything else for staff — merged with the structured profile block"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>How many rooms to add? (1–40)</label>
              <input
                type="number"
                min={1}
                max={40}
                value={roomCount}
                onChange={(e) => setRoomCount(Number(e.target.value))}
                className={inputCls}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const v = validateProperty()
              if (v) {
                toast.error(v)
                return
              }
              setRoomCursor(0)
              setPhase('rooms')
            }}
            className="w-full rounded-2xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(37,99,235,0.22)] transition hover:brightness-105"
          >
            Continue to room-by-room details →
          </button>
        </>
      ) : null}

      {phase === 'rooms' ? (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Room details</div>
              <h4 className="text-lg font-black text-slate-900">
                Room {roomCursor + 1} of {nRooms}
              </h4>
            </div>
            <div className="text-xs text-slate-500">
              Furnished status &amp; layout are saved per room in Airtable.
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Room number or label *</label>
              <input
                type="text"
                value={rooms[roomCursor].roomNumber}
                onChange={(e) => setRoom(roomCursor, { roomNumber: e.target.value })}
                placeholder="e.g. 4, Room A, Basement"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Monthly rent ($)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={rooms[roomCursor].monthlyRent}
                onChange={(e) => setRoom(roomCursor, { monthlyRent: e.target.value })}
                placeholder="800"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Furnished?</label>
              <div className="flex flex-wrap gap-3 text-sm">
                {[
                  ['none', 'Unfurnished'],
                  ['partial', 'Partially furnished'],
                  ['full', 'Fully furnished'],
                ].map(([val, lab]) => (
                  <label key={val} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name={`furnish-${roomCursor}`}
                      checked={rooms[roomCursor].furnishingLevel === val}
                      onChange={() => setRoom(roomCursor, { furnishingLevel: val })}
                    />
                    <span>{lab}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Airtable <strong>Furnished</strong> is checked for partial or full. Use the box below to list exactly what&apos;s included.
              </p>
            </div>
            <div className="sm:col-span-2 rounded-2xl border border-slate-100 bg-slate-50/90 p-4">
              <label className={labelCls}>Furnishings — list everything included in this room</label>
              <p className="mb-2 text-xs text-slate-600">
                {rooms[roomCursor].furnishingLevel === 'none' ? (
                  <>Unfurnished: note &quot;none&quot; or leave blank. For partial/full, itemize each piece (bed size, mattress, desk, chair, dresser, lamps, shelves, rugs, etc.).</>
                ) : rooms[roomCursor].furnishingLevel === 'partial' ? (
                  <>List only what stays in the room (e.g. desk + chair + lamp; tenant brings bed).</>
                ) : (
                  <>List the full inventory (e.g. full XL bed + frame, mattress protector, 3-drawer dresser, desk, ergonomic chair, blackout curtains).</>
                )}
              </p>
              <textarea
                rows={4}
                value={rooms[roomCursor].furnishingDetail}
                onChange={(e) => setRoom(roomCursor, { furnishingDetail: e.target.value })}
                placeholder="One item per line or short sentences — whatever is easiest for your team."
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2 rounded-2xl border border-amber-100 bg-amber-50/40 p-4">
              <label className={labelCls}>Kitchen / kitchenette in this room — list what&apos;s included</label>
              <p className="mb-2 text-xs text-slate-600">
                Optional. Use for mini-fridge, sink, microwave, hot plate, cabinets, etc. Leave blank if the room only uses the shared house kitchen.
              </p>
              <textarea
                rows={3}
                value={rooms[roomCursor].kitchenIncluded}
                onChange={(e) => setRoom(roomCursor, { kitchenIncluded: e.target.value })}
                placeholder="e.g. Mini fridge, microwave, sink; no stove. OR: No in-room kitchen — shared kitchen only."
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2 rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-800/80">Laundry (this room)</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Laundry access</label>
                  <select
                    value={rooms[roomCursor].laundryAccess}
                    onChange={(e) => setRoom(roomCursor, { laundryAccess: e.target.value })}
                    className={inputCls}
                  >
                    {LAUNDRY_ROOM_ACCESS.map((o) => (
                      <option key={o.value || 'unset'} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Rooms or suite that share laundry with this room</label>
                  <p className="mb-1.5 text-xs text-slate-600">
                    Optional. e.g. &quot;Shares basement W/D with Rooms 5–8&quot; or &quot;Private in-room — N/A&quot;.
                  </p>
                  <input
                    type="text"
                    value={rooms[roomCursor].laundrySharesWith}
                    onChange={(e) => setRoom(roomCursor, { laundrySharesWith: e.target.value })}
                    placeholder="e.g. Shares 2nd-floor machines with Rooms 1–4"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
            <div className="sm:col-span-2 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-900/70">Parking (this room)</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Parking for this lease / room</label>
                  <select
                    value={rooms[roomCursor].parkingAccess}
                    onChange={(e) => setRoom(roomCursor, { parkingAccess: e.target.value })}
                    className={inputCls}
                  >
                    {PARKING_ROOM_ACCESS.map((o) => (
                      <option key={o.value || 'unset'} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Parking details</label>
                  <p className="mb-1.5 text-xs text-slate-600">Stall number, permit #, tandem rules, guest policy, etc.</p>
                  <input
                    type="text"
                    value={rooms[roomCursor].parkingDetail}
                    onChange={(e) => setRoom(roomCursor, { parkingDetail: e.target.value })}
                    placeholder="e.g. Rear lot stall B2, one vehicle, no overnight guest cars"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
            <div>
              <label className={labelCls}>Floor / level</label>
              <input
                type="text"
                value={rooms[roomCursor].floor}
                onChange={(e) => setRoom(roomCursor, { floor: e.target.value })}
                placeholder="2nd floor, garden level"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Bathroom</label>
              <select
                value={rooms[roomCursor].bathroomType}
                onChange={(e) => setRoom(roomCursor, { bathroomType: e.target.value })}
                className={inputCls}
              >
                {BATH_OPTIONS.map((o) => (
                  <option key={o || 'unset'} value={o}>
                    {o || 'Select…'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Approx. square feet</label>
              <input
                type="number"
                min="0"
                step="1"
                value={rooms[roomCursor].squareFeet}
                onChange={(e) => setRoom(roomCursor, { squareFeet: e.target.value })}
                placeholder="120"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Bed size (if applicable)</label>
              <input
                type="text"
                value={rooms[roomCursor].bedSize}
                onChange={(e) => setRoom(roomCursor, { bedSize: e.target.value })}
                placeholder="Queen, Twin XL, none"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Desk included?</label>
              <select
                value={tri(rooms[roomCursor].deskIncluded, 'yes', 'no') ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  setRoom(roomCursor, {
                    deskIncluded: v === 'yes' ? true : v === 'no' ? false : null,
                  })
                }}
                className={inputCls}
              >
                <option value="">Not specified</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>AC in room?</label>
              <select
                value={tri(rooms[roomCursor].acIncluded, 'yes', 'no') ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  setRoom(roomCursor, {
                    acIncluded: v === 'yes' ? true : v === 'no' ? false : null,
                  })
                }}
                className={inputCls}
              >
                <option value="">Not specified</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Closet &amp; storage</label>
              <textarea
                rows={2}
                value={rooms[roomCursor].storageNotes}
                onChange={(e) => setRoom(roomCursor, { storageNotes: e.target.value })}
                placeholder="Walk-in closet, under-bed bins, shared hall closet"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Windows &amp; natural light</label>
              <input
                type="text"
                value={rooms[roomCursor].windowsLight}
                onChange={(e) => setRoom(roomCursor, { windowsLight: e.target.value })}
                placeholder="Two windows, south-facing"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Availability / lease notes</label>
              <input
                type="text"
                value={rooms[roomCursor].availability}
                onChange={(e) => setRoom(roomCursor, { availability: e.target.value })}
                placeholder="Available Aug 1 · 12-mo preferred"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Other room notes</label>
              <textarea
                rows={2}
                value={rooms[roomCursor].roomNotes}
                onChange={(e) => setRoom(roomCursor, { roomNotes: e.target.value })}
                placeholder="Adjoins kitchen, quiet side of house, etc."
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (roomCursor <= 0) setPhase('property')
                else setRoomCursor((c) => c - 1)
              }}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              ← Back
            </button>
            {roomCursor < nRooms - 1 ? (
              <button
                type="button"
                onClick={() => {
                  const e = validateRoom(roomCursor)
                  if (e) {
                    toast.error(e)
                    return
                  }
                  setRoomCursor((c) => c + 1)
                }}
                className="rounded-2xl bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white"
              >
                Next room →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const e = validateRoom(roomCursor)
                  if (e) {
                    toast.error(e)
                    return
                  }
                  setPhase('review')
                }}
                className="rounded-2xl bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white"
              >
                Review &amp; create →
              </button>
            )}
          </div>
        </>
      ) : null}

      {phase === 'review' ? (
        <>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Review</div>
          <h4 className="text-lg font-black text-slate-900">{propertyForm.name.trim() || 'New house'}</h4>
          <p className="text-sm text-slate-600">{propertyForm.address.trim() || 'No address'}</p>
          {(propertyForm.laundryType ||
            propertyForm.laundryFeeUsd ||
            propertyForm.laundryRoomsSharing ||
            propertyForm.laundryIncluded.trim() ||
            propertyForm.parkingType ||
            propertyForm.parkingFeeUsd ||
            propertyForm.parkingNotes.trim() ||
            propertyForm.kitchenIncluded.trim()) ? (
            <div className="mt-2 space-y-2 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
              {propertyForm.laundryType ? (
                <p>
                  <span className="font-semibold text-slate-800">Laundry:</span>{' '}
                  {propertyLaundryLabel(propertyForm.laundryType)}
                  {(() => {
                    const lf = String(propertyForm.laundryFeeUsd || '').trim()
                    if (!lf) return ''
                    const n = Number(lf)
                    return Number.isFinite(n) ? ` · Fee $${n.toLocaleString()}` : ` · Fee ${lf}`
                  })()}
                </p>
              ) : null}
              {propertyForm.laundryRoomsSharing.trim() ? (
                <p>
                  <span className="font-semibold text-slate-800">Rooms sharing laundry:</span>{' '}
                  <span className="line-clamp-2">{propertyForm.laundryRoomsSharing.trim()}</span>
                </p>
              ) : null}
              {propertyForm.laundryIncluded.trim() ? (
                <p>
                  <span className="font-semibold text-slate-800">Laundry includes:</span>{' '}
                  <span className="line-clamp-2">{propertyForm.laundryIncluded.trim()}</span>
                </p>
              ) : null}
              {propertyForm.parkingType ? (
                <p>
                  <span className="font-semibold text-slate-800">Parking:</span>{' '}
                  {propertyParkingLabel(propertyForm.parkingType)}
                  {(() => {
                    const pf = String(propertyForm.parkingFeeUsd || '').trim()
                    if (!pf) return ''
                    const n = Number(pf)
                    return Number.isFinite(n) ? ` · Fee $${n.toLocaleString()}` : ` · Fee ${pf}`
                  })()}
                </p>
              ) : null}
              {propertyForm.parkingNotes.trim() ? (
                <p>
                  <span className="font-semibold text-slate-800">Parking notes:</span>{' '}
                  <span className="line-clamp-2">{propertyForm.parkingNotes.trim()}</span>
                </p>
              ) : null}
              {propertyForm.kitchenIncluded.trim() ? (
                <p>
                  <span className="font-semibold text-slate-800">Shared kitchen includes:</span>{' '}
                  <span className="line-clamp-2">{propertyForm.kitchenIncluded.trim()}</span>
                </p>
              ) : null}
            </div>
          ) : null}
          <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
            {rooms.slice(0, nRooms).map((r, i) => (
              <li key={i} className="border-b border-slate-100 pb-2 last:border-0">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-slate-800">{r.roomNumber || `Room ${i + 1}`}</span>
                  <span className="shrink-0 text-slate-500">
                    {r.furnishingLevel === 'full'
                      ? 'Furnished (full)'
                      : r.furnishingLevel === 'partial'
                        ? 'Partial'
                        : 'Unfurnished'}
                    {r.monthlyRent ? ` · $${r.monthlyRent}/mo` : ''}
                  </span>
                </div>
                {r.furnishingDetail.trim() ? (
                  <p className="mt-1 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Furnishings listed:</span>{' '}
                    <span className="line-clamp-2">{r.furnishingDetail.trim()}</span>
                  </p>
                ) : null}
                {r.kitchenIncluded.trim() ? (
                  <p className="mt-0.5 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">In-room kitchen:</span>{' '}
                    <span className="line-clamp-2">{r.kitchenIncluded.trim()}</span>
                  </p>
                ) : null}
                {r.laundryAccess ? (
                  <p className="mt-0.5 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Laundry:</span>{' '}
                    {LAUNDRY_ROOM_ACCESS.find((x) => x.value === r.laundryAccess)?.label || r.laundryAccess}
                    {r.laundrySharesWith.trim() ? ` · ${r.laundrySharesWith.trim()}` : ''}
                  </p>
                ) : null}
                {r.parkingAccess ? (
                  <p className="mt-0.5 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Parking:</span>{' '}
                    {PARKING_ROOM_ACCESS.find((x) => x.value === r.parkingAccess)?.label || r.parkingAccess}
                    {r.parkingDetail.trim() ? ` · ${r.parkingDetail.trim()}` : ''}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            Creates 1 property + {nRooms} row{nRooms === 1 ? '' : 's'} in <strong>{roomsTable}</strong>.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPhase('rooms')}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              ← Edit rooms
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleFinalSubmit()}
              className="rounded-2xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(37,99,235,0.22)] disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create house & rooms'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
