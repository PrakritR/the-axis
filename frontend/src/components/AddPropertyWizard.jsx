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
 *   onCreated(record)   – called after a successful save (Airtable row or synthetic manager row for Postgres)
 *   createPropertyAdmin – optional legacy `async (fields) => record` (Airtable). When omitted, creates via POST /api/properties + rooms.
 */

import React, { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from './Modal'
import {
  isInternalAxisRecordId,
  patchPropertySharedSpaceDetailImageUrls,
  pickLastPropertyPhotoUrlFromUploadResponse,
  uploadPropertyImage,
} from '../lib/airtable'
import { createInternalPropertyAndRooms } from '../lib/internalPropertiesClient.js'
import { uploadRoomImageInternal } from '../lib/internalFileStorage.js'
import {
  serializeManagerAddPropertyToAirtableFields,
  emptyRoomRow,
  emptyBathroomRow,
  emptyKitchenRow,
  emptyLaundryRow,
  emptySharedSpaceRow,
  emptyListingAvailabilityWindow,
  emptyMoveInChargeRow,
  emptyPricingFees,
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
  MOVE_IN_CHARGE_NAME_OPTIONS,
  LEASE_ACCESS_REQUIREMENT,
  nativeRoomColumnValidationMessage,
  PROPERTY_AIR,
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

/** OS/file pickers often omit MIME for AVIF/HEIC/WebP; accept when type or filename looks like an image. */
const IMAGE_FILENAME_EXT_RE = /\.(avif|heic|heif|webp|jpe?g|png|gif|bmp|tif|tiff|jp2|jxl|ico|svg|raw|cr2|cr3|nef|arw|dng|orf|rw2)(\?|$)/i
const VIDEO_FILENAME_EXT_RE = /\.(mp4|mov|webm|mkv|m4v|avi|mpg|mpeg|wmv|3gp|ogv)(\?|$)/i

/** Broad `accept` so native pickers show AVIF/HEIC/etc., not only legacy types. */
const ACCEPT_PROPERTY_IMAGES =
  'image/*,image/avif,image/heic,image/heif,image/webp,image/jxl,image/jp2,.avif,.heif,.heic,.webp,.jxl,.jp2,.png,.jpg,.jpeg,.gif,.bmp,.tif,.tiff,.svg,.ico,.raw,.cr2,.cr3,.nef,.arw,.dng'
const ACCEPT_PROPERTY_IMAGES_AND_VIDEOS = `${ACCEPT_PROPERTY_IMAGES},video/*,.mp4,.mov,.webm,.mkv,.m4v,.avi`

/** Scroll wheel on focused `type="number"` nudges the value — blur so wheel scrolls the page instead. */
function blurNumberInputOnWheel(ev) {
  ev?.currentTarget?.blur?.()
}

function isLikelyImageUpload(file) {
  if (!file || !file.name) return false
  const t = String(file.type || '').toLowerCase()
  if (t.startsWith('image/')) return true
  if (t === '' || t === 'application/octet-stream') return IMAGE_FILENAME_EXT_RE.test(file.name)
  return IMAGE_FILENAME_EXT_RE.test(file.name)
}

function isLikelyVideoUpload(file) {
  if (!file || !file.name) return false
  const t = String(file.type || '').toLowerCase()
  if (t.startsWith('video/')) return true
  if (t === '' || t === 'application/octet-stream') return VIDEO_FILENAME_EXT_RE.test(file.name)
  return VIDEO_FILENAME_EXT_RE.test(file.name)
}

function isLikelyRoomGalleryFile(file) {
  return isLikelyImageUpload(file) || isLikelyVideoUpload(file)
}

// ─── Validation ───────────────────────────────────────────────────────────────
function validateBasics(basics) {
  const e = {}
  const name = String(basics.name || '').trim()
  if (!name) e.name = 'Property name is required'
  else if (name.length < 3) e.name = 'Must be at least 3 characters'

  if (!String(basics.address || '').trim()) e.address = 'Address is required'

  if (!basics.propertyType) e.propertyType = 'Property type is required'
  if (basics.propertyType === 'Other' && !String(basics.propertyTypeOther || '').trim())
    e.propertyTypeOther = 'Describe the property type'

  if (!basics.pets) e.pets = 'Pet policy is required'

  const adminStr = String(basics.administrationFee ?? '').trim()
  if (adminStr !== '' && (!Number.isFinite(Number(adminStr)) || Number(adminStr) < 0))
    e.administrationFee = 'Enter a valid number (0 or more)'

  const mir = Array.isArray(basics.moveInChargeRows) ? basics.moveInChargeRows : []
  mir.forEach((row, i) => {
    const name = String(row?.name || '').trim()
    const amt = String(row?.amount ?? '').trim()
    if (!name && !amt) return
    if (!name) e[`mir${i}_name`] = 'Charge name is required'
    if (amt === '') e[`mir${i}_amt`] = 'Amount is required (enter 0 if none)'
    else if (!Number.isFinite(Number(amt)) || Number(amt) < 0) e[`mir${i}_amt`] = 'Enter a valid number (0 or more)'
  })

  const windows = Array.isArray(basics.listingAvailabilityWindows) ? basics.listingAvailabilityWindows : []
  windows.forEach((w, i) => {
    const start = String(w?.start || '').trim()
    const end = String(w?.end || '').trim()
    const openEnded = Boolean(w?.openEnded)
    const touched = start || end || openEnded
    if (!touched) return
    if (!start) e[`lav${i}_start`] = 'Start date required for this window'
    if (start && !openEnded && !end) e[`lav${i}_end`] = 'Enter an end date or choose “No end date”'
    if (start && end && !openEnded && end < start) e[`lav${i}_end`] = 'End must be on or after start'
  })

  return e
}

function validateRooms(rooms) {
  const e = {}
  if (!rooms.length) {
    e._global = 'At least one room is required'
    return e
  }
  rooms.forEach((room, i) => {
    const rentStr = String(room.rent ?? '')
    if (rentStr === '') e[`r${i}_rent`] = 'Monthly rent is required'
    else if (!Number.isFinite(Number(rentStr)) || Number(rentStr) < 0)
      e[`r${i}_rent`] = 'Enter a valid number (0 or more)'

    if (!room.unavailable && !room.availability) e[`r${i}_avail`] = 'Availability date is required (or mark room unavailable)'
    if (!room.furnished) e[`r${i}_furn`] = 'Furnished status is required'

    if ((room.furnished === 'Yes' || room.furnished === 'Partial') && !String(room.furnitureIncluded || '').trim())
      e[`r${i}_furnInc`] = 'List what furniture is included'
  })
  const nativeMsg = nativeRoomColumnValidationMessage(rooms.length)
  if (nativeMsg) e._global = e._global ? `${e._global}\n\n${nativeMsg}` : nativeMsg
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
  ;(laundry?.rows || []).forEach((row, i) => {
    if (!String(row.type || '').trim()) e[`l${i}_type`] = 'Laundry type is required'
    if (!Array.isArray(row.access) || row.access.length === 0) e[`l${i}_access`] = 'Select at least one room'
  })
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

function validatePricingFees(pricingFees, appFee, basics) {
  const e = {}
  const pf = pricingFees && typeof pricingFees === 'object' ? pricingFees : { ...emptyPricingFees() }

  const mrrStr = String(pf.monthlyRoomRent ?? '')
  if (mrrStr.trim() === '') e.monthlyRoomRent = 'Required'
  else if (!Number.isFinite(Number(mrrStr)) || Number(mrrStr) < 0) e.monthlyRoomRent = 'Enter 0 or more'

  const afStr = String(appFee ?? '')
  if (afStr === '') e.applicationFee = 'Required — enter 0 if no fee'
  else if (!Number.isFinite(Number(afStr)) || Number(afStr) < 0) e.applicationFee = 'Enter a valid number (0 or more)'

  const sdStr = String(basics.securityDeposit ?? '')
  if (sdStr === '') e.securityDeposit = 'Required — enter 0 if none'
  else if (!Number.isFinite(Number(sdStr)) || Number(sdStr) < 0) e.securityDeposit = 'Enter a valid number (0 or more)'

  function checkNonNeg(key) {
    const s = String(pf[key] ?? '').trim()
    if (s === '') return
    if (!Number.isFinite(Number(s)) || Number(s) < 0) e[key] = 'Enter 0 or more'
  }
  checkNonNeg('utilityFee')
  checkNonNeg('holdingDeposit')
  checkNonNeg('moveInFee')
  checkNonNeg('lateRentFee')
  if (pf.petsAllowed) {
    checkNonNeg('petDeposit')
    checkNonNeg('petRent')
  }
  if (pf.conditionalDepositRequired) {
    checkNonNeg('conditionalDeposit')
  }
  return e
}

function getStepErrors(stepIdx, state) {
  const { basics, appFee, rooms, bathrooms, kitchens, sharedSpaces, laundry, parking, leasing, pricingFees } = state
  switch (stepIdx) {
    case 0: return validateBasics(basics)
    case 1: return validateRooms(rooms)
    case 2: return validateBathrooms(bathrooms)
    case 3: return validateKitchens(kitchens)
    case 4: return validateSharedSpaces(sharedSpaces)
    case 5: return validateLaundryParking(laundry, parking)
    case 6: return {}
    case 7: {
      const a = validatePricing(leasing)
      const b = validatePricingFees(pricingFees, appFee, basics)
      return { ...a, ...b }
    }
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
export default function AddPropertyWizard({
  manager,
  onClose,
  onCreated,
  createPropertyAdmin = null,
  initialValues = null,
  mode = 'create',
  onSubmitProperty = null,
}) {
  const initialState = useMemo(() => {
    const payload = initialValues
    const basics = payload?.basics || {}
    return {
      basics: {
        name: String(basics.name || ''),
        address: String(basics.address || ''),
        propertyType: String(basics.propertyType || ''),
        propertyTypeOther: String(basics.propertyTypeOther || ''),
        amenities: Array.isArray(basics.amenities) ? [...basics.amenities] : [],
        amenitiesOther: String(basics.amenitiesOther || ''),
        pets: String(basics.pets || ''),
        securityDeposit: basics.securityDeposit == null || basics.securityDeposit === '' ? '' : String(basics.securityDeposit),
        administrationFee:
          basics.administrationFee == null || basics.administrationFee === '' ? '' : String(basics.administrationFee),
        moveInCharges: String(basics.moveInCharges || ''),
        leaseAccessRequirement: String(
          basics.leaseAccessRequirement || LEASE_ACCESS_REQUIREMENT.SECURITY_AND_FIRST,
        ),
        moveInChargeRows: Array.isArray(basics.moveInChargeRows) && basics.moveInChargeRows.length
          ? basics.moveInChargeRows.map((row) => ({
              ...emptyMoveInChargeRow(),
              name: String(row?.name || '').trim() || 'First Month Rent',
              amount: String(row?.amount ?? '').trim(),
              requiredBeforeSigning: Boolean(row?.requiredBeforeSigning),
            }))
          : [{ ...emptyMoveInChargeRow() }],
        listingAvailabilityWindows: Array.isArray(basics.listingAvailabilityWindows)
          ? basics.listingAvailabilityWindows.map((row) => ({
              ...emptyListingAvailabilityWindow(),
              ...row,
              start: String(row?.start || ''),
              end: row?.openEnded ? '' : String(row?.end || ''),
              openEnded: Boolean(row?.openEnded),
            }))
          : [],
      },
      appFee: payload?.appFee == null || payload.appFee === '' ? '' : String(payload.appFee),
      rooms:
        Array.isArray(payload?.rooms) && payload.rooms.length
          ? payload.rooms.map((row) => {
              const merged = { ...emptyRoomRow(), ...row, media: [] }
              return {
                ...merged,
                rent: merged.rent != null && merged.rent !== '' ? String(merged.rent) : '',
                utilitiesCost:
                  merged.utilitiesCost != null && merged.utilitiesCost !== ''
                    ? String(merged.utilitiesCost)
                    : '',
              }
            })
          : [emptyRoomRow()],
      bathrooms: Array.isArray(payload?.bathrooms)
        ? payload.bathrooms.map((row) => ({
            ...emptyBathroomRow(),
            ...row,
            media: Array.isArray(row.media) ? row.media : [],
          }))
        : [],
      kitchens: Array.isArray(payload?.kitchens)
        ? payload.kitchens.map((row) => ({
            ...emptyKitchenRow(),
            ...row,
            media: Array.isArray(row.media) ? row.media : [],
          }))
        : [],
      sharedSpaces: Array.isArray(payload?.sharedSpaces)
        ? payload.sharedSpaces.map((row) => ({
            ...emptySharedSpaceRow(),
            ...row,
            media: Array.isArray(row.media) ? row.media : [],
            imageUrls: Array.isArray(row.imageUrls) ? [...row.imageUrls] : [],
          }))
        : [],
      laundry: {
        enabled: Boolean(payload?.laundry?.enabled),
        rows: Array.isArray(payload?.laundry?.rows)
          ? payload.laundry.rows.map((row) => ({
              ...emptyLaundryRow(),
              ...row,
              media: Array.isArray(row.media) ? row.media : [],
            }))
          : [],
        generalAccess: Array.isArray(payload?.laundry?.generalAccess) ? [...payload.laundry.generalAccess] : [],
      },
      parking: {
        enabled: Boolean(payload?.parking?.enabled),
        type: String(payload?.parking?.type || ''),
        fee: String(payload?.parking?.fee || ''),
      },
      otherInfo: String(payload?.otherInfo || ''),
      leasing: {
        fullHousePrice: String(payload?.leasing?.fullHousePrice || ''),
        promoPrice: String(payload?.leasing?.promoPrice || ''),
        leaseLengthInfo: String(payload?.leasing?.leaseLengthInfo || DEFAULT_LEASE_INFO),
        guestPolicy: String(payload?.leasing?.guestPolicy || ''),
        additionalLeaseTerms: String(payload?.leasing?.additionalLeaseTerms || ''),
        houseRules: String(payload?.leasing?.houseRules || ''),
        leaseInformation: String(payload?.leasing?.leaseInformation || ''),
        bundles: Array.isArray(payload?.leasing?.bundles)
          ? payload.leasing.bundles.map((row) => ({
              name: String(row?.name || ''),
              price: String(row?.price || ''),
              rooms: Array.isArray(row?.rooms) ? [...row.rooms] : [],
            }))
          : [],
      },
      pricingFees: {
        ...emptyPricingFees(),
        ...(payload?.pricingFees && typeof payload.pricingFees === 'object' ? payload.pricingFees : {}),
      },
    }
  }, [initialValues])

  const wizardMode = mode === 'edit' ? 'edit' : 'create'
  const submitProperty = typeof onSubmitProperty === 'function' ? onSubmitProperty : null
  // ── Step state ───────────────────────────────────────────────────────────────
  const [step, setStep] = useState(0)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const scrollRef = useRef(null)

  // ── Form state ───────────────────────────────────────────────────────────────
  const [basics, setBasics] = useState(initialState.basics)
  const [appFee, setAppFee] = useState(initialState.appFee)
  const [rooms, setRooms] = useState(initialState.rooms)
  const [bathrooms, setBathrooms] = useState(initialState.bathrooms)
  const [kitchens, setKitchens] = useState(initialState.kitchens)
  const [sharedSpaces, setSharedSpaces] = useState(initialState.sharedSpaces)
  const [laundry, setLaundry] = useState(initialState.laundry)
  const [parking, setParking] = useState(initialState.parking)
  const [otherInfo, setOtherInfo] = useState(initialState.otherInfo)
  const [images, setImages] = useState([])
  const [leasing, setLeasing] = useState({
    fullHousePrice: initialState.leasing.fullHousePrice,
    promoPrice: initialState.leasing.promoPrice,
    leaseLengthInfo: initialState.leasing.leaseLengthInfo,
    guestPolicy: initialState.leasing.guestPolicy,
    additionalLeaseTerms: initialState.leasing.additionalLeaseTerms,
    houseRules: initialState.leasing.houseRules,
    leaseInformation: initialState.leasing.leaseInformation,
    bundles: initialState.leasing.bundles,
  })
  const [pricingFees, setPricingFees] = useState(() => ({
    ...emptyPricingFees(),
    ...initialState.pricingFees,
  }))
  const imageInputRef = useRef(null)
  const dropRef = useRef(null)

  // ── Derived ──────────────────────────────────────────────────────────────────
  const rc = clampInt(rooms.length, 1, MAX_ROOM_SLOTS)
  const roomOptions = Array.from({ length: rc }, (_, i) => `Room ${i + 1}`)
  const formState = { basics, appFee, rooms, bathrooms, kitchens, sharedSpaces, laundry, parking, leasing, pricingFees }

  function addMoveInChargeRow() {
    setBasics((b) => ({
      ...b,
      moveInChargeRows: [
        ...(Array.isArray(b.moveInChargeRows) ? b.moveInChargeRows : []),
        { ...emptyMoveInChargeRow() },
      ],
    }))
  }

  function removeMoveInChargeRow(idx) {
    setBasics((b) => {
      const cur = Array.isArray(b.moveInChargeRows) ? b.moveInChargeRows : []
      const next = cur.filter((_, i) => i !== idx)
      return { ...b, moveInChargeRows: next.length ? next : [{ ...emptyMoveInChargeRow() }] }
    })
  }

  function updateMoveInChargeRow(idx, patch) {
    setBasics((b) => {
      const cur = Array.isArray(b.moveInChargeRows) ? [...b.moveInChargeRows] : []
      cur[idx] = { ...cur[idx], ...patch }
      return { ...b, moveInChargeRows: cur }
    })
  }

  const currentErrors = useMemo(
    () => attempted ? getStepErrors(step, formState) : {},
    // deps: all form state + step + attempted flag
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attempted, step, basics, appFee, rooms, bathrooms, kitchens, sharedSpaces, laundry, parking, leasing, pricingFees],
  )
  const stepIsValid = Object.keys(getStepErrors(step, formState)).length === 0

  // ── Reset ─────────────────────────────────────────────────────────────────────
  function resetForm() {
    setStep(0); setAttempted(false); setSaving(false)
    setBasics(initialState.basics)
    setAppFee(initialState.appFee)
    setRooms(initialState.rooms)
    setBathrooms(initialState.bathrooms); setKitchens(initialState.kitchens); setSharedSpaces(initialState.sharedSpaces)
    setLaundry((l) => {
      for (const row of l.rows || []) {
        for (const m of row.media || []) {
          if (m?.preview && m.file) URL.revokeObjectURL(m.preview)
        }
      }
      return initialState.laundry
    })
    setParking(initialState.parking)
    setOtherInfo(initialState.otherInfo)
    setImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.preview))
      return []
    })
    setLeasing(initialState.leasing)
    setPricingFees({ ...emptyPricingFees(), ...initialState.pricingFees })
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
      const bathroomsPayload = bathrooms.map(({ media, ...rest }) => rest)
      const laundryPayload = {
        ...laundry,
        rows: (laundry.rows || []).map(({ media, ...rest }) => rest),
      }
      const sharedPayload = sharedSpaces.map(({ media, ...rest }) => ({
        ...rest,
        imageUrls: Array.isArray(rest.imageUrls) ? [...rest.imageUrls] : [],
      }))
      const fields = serializeManagerAddPropertyToAirtableFields({
        basics,
        roomCount: rc,
        bathroomCount: clampInt(bathrooms.length, 0, MAX_BATHROOM_SLOTS),
        kitchenCount: clampInt(kitchens.length, 0, MAX_KITCHEN_SLOTS),
        laundry: laundryPayload,
        parking,
        rooms: roomsPayload,
        bathrooms: bathroomsPayload,
        kitchens: kitchens.map(({ media, ...rest }) => rest),
        sharedSpaces: sharedPayload,
        applicationFee: appFee,
        otherInfo,
        managerRecordId: manager?.id,
        leasing,
        pricingFees,
      })

      let created
      let effectivePropertyId = ''
      /** Postgres room rows (same order as wizard `rooms`) when using internal create. */
      let createdDbRooms = null

      if (submitProperty) {
        created = await submitProperty(fields)
        effectivePropertyId = String(created?.id || '').trim()
      } else if (typeof createPropertyAdmin === 'function') {
        created = await createPropertyAdmin(fields)
        effectivePropertyId = String(created?.id || '').trim()
      } else {
        const mergedListingNotes = String(fields[PROPERTY_AIR.otherInfo] || '')
          .trim()
          .slice(0, 20_000)
        const notes =
          mergedListingNotes ||
          [
            appFee != null && String(appFee).trim() !== '' ? `Application fee (wizard): ${appFee}` : '',
            String(otherInfo || '').trim(),
          ]
            .filter(Boolean)
            .join('\n\n')
            .slice(0, 20_000)
        const bundle = await createInternalPropertyAndRooms({
          basics,
          rooms,
          manager,
          notes,
        })
        created = bundle.managerRow
        createdDbRooms = bundle.rooms
        effectivePropertyId = String(bundle.property?.id || '').trim()
      }

      const internalProperty = isInternalAxisRecordId(effectivePropertyId)
      const bathroomSlotIds = bathrooms.map(() =>
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tmp-${Date.now()}-${Math.random()}`,
      )
      const sharedSpaceSlotIds = sharedSpaces.map(() =>
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tmp-${Date.now()}-${Math.random()}`,
      )

      // Property gallery images (non-fatal individually)
      let galleryOrder = 0
      for (const img of images) {
        try {
          if (internalProperty) {
            await uploadPropertyImage(effectivePropertyId, img.file, {
              isGallery: galleryOrder > 0,
              isCover: galleryOrder === 0,
              sortOrder: galleryOrder,
            })
            galleryOrder += 1
          } else {
            await uploadPropertyImage(effectivePropertyId, img.file)
          }
        } catch { /* non-fatal */ }
      }
      // Per-room media
      for (let ri = 0; ri < rooms.length; ri++) {
        let roomImgOrder = 0
        for (const item of rooms[ri].media || []) {
          try {
            const f = item.file
            if (!f) continue
            if (internalProperty && Array.isArray(createdDbRooms) && createdDbRooms[ri]?.id) {
              await uploadRoomImageInternal({
                roomId: String(createdDbRooms[ri].id),
                file: f,
                isGallery: roomImgOrder > 0,
                isCover: roomImgOrder === 0,
                sortOrder: roomImgOrder,
              })
              roomImgOrder += 1
            } else {
              const renamed = new File([f], `axis-r${ri + 1}-${f.name}`, { type: f.type || 'application/octet-stream' })
              await uploadPropertyImage(effectivePropertyId, renamed)
            }
          } catch { /* non-fatal */ }
        }
      }
      for (let li = 0; li < (laundry.rows || []).length; li++) {
        for (const item of laundry.rows[li].media || []) {
          try {
            const f = item.file
            if (!f) continue
            const renamed = new File([f], `axis-l${li + 1}-${f.name}`, { type: f.type || 'application/octet-stream' })
            if (internalProperty) {
              await uploadPropertyImage(effectivePropertyId, renamed, {
                isGallery: true,
                isCover: false,
                sortOrder: galleryOrder,
              })
              galleryOrder += 1
            } else {
              await uploadPropertyImage(effectivePropertyId, renamed)
            }
          } catch { /* non-fatal */ }
        }
      }
      for (let bi = 0; bi < bathrooms.length; bi++) {
        for (const item of bathrooms[bi].media || []) {
          try {
            const f = item.file
            if (!f) continue
            const renamed = new File([f], `axis-b${bi + 1}-${f.name}`, { type: f.type || 'application/octet-stream' })
            if (internalProperty) {
              await uploadPropertyImage(effectivePropertyId, renamed, {
                isGallery: true,
                isCover: false,
                sortOrder: galleryOrder,
                bathroomId: bathroomSlotIds[bi],
              })
              galleryOrder += 1
            } else {
              await uploadPropertyImage(effectivePropertyId, renamed)
            }
          } catch { /* non-fatal */ }
        }
      }
      for (let ki = 0; ki < kitchens.length; ki++) {
        for (const item of kitchens[ki].media || []) {
          try {
            const f = item.file
            if (!f) continue
            const renamed = new File([f], `axis-k${ki + 1}-${f.name}`, { type: f.type || 'application/octet-stream' })
            if (internalProperty) {
              await uploadPropertyImage(effectivePropertyId, renamed, {
                isGallery: true,
                isCover: false,
                sortOrder: galleryOrder,
              })
              galleryOrder += 1
            } else {
              await uploadPropertyImage(effectivePropertyId, renamed)
            }
          } catch { /* non-fatal */ }
        }
      }

      const urlsBySlot = {}
      for (let si = 0; si < sharedSpaces.length; si++) {
        const urls = []
        for (const item of sharedSpaces[si].media || []) {
          try {
            const f = item.file
            if (!f) continue
            const renamed = new File([f], `axis-ss${si + 1}-${f.name}`, { type: f.type || 'application/octet-stream' })
            const json = internalProperty
              ? await uploadPropertyImage(effectivePropertyId, renamed, {
                  isGallery: true,
                  isCover: false,
                  sortOrder: galleryOrder,
                  sharedSpaceId: sharedSpaceSlotIds[si],
                })
              : await uploadPropertyImage(effectivePropertyId, renamed)
            if (internalProperty) galleryOrder += 1
            const u = pickLastPropertyPhotoUrlFromUploadResponse(json)
            if (u) urls.push(u)
          } catch {
            /* non-fatal */
          }
        }
        if (urls.length) urlsBySlot[si] = urls
      }
      if (Object.keys(urlsBySlot).length) {
        try {
          await patchPropertySharedSpaceDetailImageUrls(effectivePropertyId, urlsBySlot)
        } catch {
          /* non-fatal — photos still on property; meta merge failed */
        }
      }

      toast.success(wizardMode === 'edit' ? 'Changes submitted — pending admin approval' : 'Submitted — pending admin approval')
      onCreated(created)
      resetForm()
      onClose()
    } catch (err) {
      const raw = err?.message || 'Could not save property'
      const friendly = raw.includes('mailing address on one line')
        ? raw
        : raw.includes('UNKNOWN_FIELD_NAME')
        ? /Room\s+\d+\s+Rent/i.test(raw)
          ? 'Airtable rejected a room rent column (unknown field). Add matching "Room N Rent" columns in Airtable or set VITE_AIRTABLE_PROPERTY_ROOM_NATIVE_COLUMN_LIMIT to the highest N that exists, or set VITE_AIRTABLE_WRITE_ROOM_COLUMNS=false.'
          : 'A field name does not match Airtable — check managerPropertyFormAirtableMap.js and your base.'
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
  function duplicateRoom(idx) {
    setRooms(prev => {
      if (prev.length >= MAX_ROOM_SLOTS) return prev
      const src = prev[idx] || emptyRoomRow()
      return [
        ...prev,
        {
          ...src,
          media: [],
        },
      ]
    })
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
    const valid = Array.from(fileList || []).filter(isLikelyRoomGalleryFile)
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
  function duplicateBath(idx) {
    setBathrooms(prev => {
      if (prev.length >= MAX_BATHROOM_SLOTS) return prev
      const src = prev[idx] || emptyBathroomRow()
      return [
        ...prev,
        {
          ...src,
          access: Array.isArray(src.access) ? [...src.access] : [],
          media: [],
        },
      ]
    })
  }
  function removeBath(idx) {
    setBathrooms((prev) => {
      const row = prev[idx]
      for (const m of row?.media || []) {
        if (m?.preview && m.file) URL.revokeObjectURL(m.preview)
      }
      return prev.filter((_, i) => i !== idx)
    })
  }

  function addBathroomMedia(bathIdx, fileList) {
    const valid = Array.from(fileList || []).filter(isLikelyRoomGalleryFile)
    if (!valid.length) return
    const entries = valid.map((file) => ({ id: `${Date.now()}-${Math.random()}`, file, preview: URL.createObjectURL(file) }))
    setBathrooms((prev) =>
      prev.map((b, i) => (i === bathIdx ? { ...b, media: [...(b.media || []), ...entries] } : b)),
    )
  }
  function removeBathroomMedia(bathIdx, mediaId) {
    setBathrooms((prev) =>
      prev.map((b, i) => {
        if (i !== bathIdx) return b
        const removed = (b.media || []).find((m) => m.id === mediaId)
        if (removed?.preview && removed.file) URL.revokeObjectURL(removed.preview)
        return { ...b, media: (b.media || []).filter((m) => m.id !== mediaId) }
      }),
    )
  }

  // ── Kitchen helpers ───────────────────────────────────────────────────────────
  function updateKitchen(idx, patch) {
    setKitchens(prev => { const next = [...prev]; next[idx] = { ...next[idx], ...patch }; return next })
  }
  function addKitchen() { setKitchens(prev => prev.length < MAX_KITCHEN_SLOTS ? [...prev, emptyKitchenRow()] : prev) }
  function duplicateKitchen(idx) {
    setKitchens(prev => {
      if (prev.length >= MAX_KITCHEN_SLOTS) return prev
      const src = prev[idx] || emptyKitchenRow()
      return [
        ...prev,
        {
          ...src,
          access: Array.isArray(src.access) ? [...src.access] : [],
          media: [],
        },
      ]
    })
  }
  function removeKitchen(idx) {
    setKitchens((prev) => {
      const row = prev[idx]
      for (const m of row?.media || []) {
        if (m?.preview && m?.file) URL.revokeObjectURL(m.preview)
      }
      return prev.filter((_, i) => i !== idx)
    })
  }

  function addKitchenMedia(kitIdx, fileList) {
    const valid = Array.from(fileList || []).filter(isLikelyRoomGalleryFile)
    if (!valid.length) return
    const entries = valid.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
    }))
    setKitchens((prev) =>
      prev.map((k, i) => (i === kitIdx ? { ...k, media: [...(k.media || []), ...entries] } : k)),
    )
  }

  function removeKitchenMedia(kitIdx, mediaId) {
    setKitchens((prev) =>
      prev.map((k, i) => {
        if (i !== kitIdx) return k
        const removed = (k.media || []).find((m) => m.id === mediaId)
        if (removed?.preview && removed.file) URL.revokeObjectURL(removed.preview)
        return { ...k, media: (k.media || []).filter((m) => m.id !== mediaId) }
      }),
    )
  }

  // ── Shared space helpers ──────────────────────────────────────────────────────
  function updateSpace(idx, patch) {
    setSharedSpaces(prev => { const next = [...prev]; next[idx] = { ...next[idx], ...patch }; return next })
  }
  function addSpace() { setSharedSpaces(prev => prev.length < MAX_SHARED_SPACE_SLOTS ? [...prev, emptySharedSpaceRow()] : prev) }
  function duplicateSpace(idx) {
    setSharedSpaces(prev => {
      if (prev.length >= MAX_SHARED_SPACE_SLOTS) return prev
      const src = prev[idx] || emptySharedSpaceRow()
      return [
        ...prev,
        {
          ...src,
          name: '',
          access: Array.isArray(src.access) ? [...src.access] : [],
          media: [],
          imageUrls: Array.isArray(src.imageUrls) ? [...src.imageUrls] : [],
        },
      ]
    })
  }
  function removeSpace(idx) {
    setSharedSpaces((prev) => {
      const row = prev[idx]
      for (const m of row?.media || []) {
        if (m?.preview && m.file) URL.revokeObjectURL(m.preview)
      }
      return prev.filter((_, i) => i !== idx)
    })
  }

  function addSharedSpaceMedia(spaceIdx, fileList) {
    const valid = Array.from(fileList || []).filter(isLikelyImageUpload)
    if (!valid.length) return
    const entries = valid.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
    }))
    setSharedSpaces((prev) =>
      prev.map((s, i) => (i === spaceIdx ? { ...s, media: [...(s.media || []), ...entries] } : s)),
    )
  }
  function removeSharedSpaceMedia(spaceIdx, mediaId) {
    setSharedSpaces((prev) =>
      prev.map((s, i) => {
        if (i !== spaceIdx) return s
        const removed = (s.media || []).find((m) => m.id === mediaId)
        if (removed?.preview && removed.file) URL.revokeObjectURL(removed.preview)
        return { ...s, media: (s.media || []).filter((m) => m.id !== mediaId) }
      }),
    )
  }
  function moveSharedSpaceMedia(spaceIdx, mediaIdx, delta) {
    setSharedSpaces((prev) =>
      prev.map((s, i) => {
        if (i !== spaceIdx) return s
        const list = [...(s.media || [])]
        const j = mediaIdx + delta
        if (j < 0 || j >= list.length) return s
        ;[list[mediaIdx], list[j]] = [list[j], list[mediaIdx]]
        return { ...s, media: list }
      }),
    )
  }

  // ── Laundry helpers ───────────────────────────────────────────────────────────
  function updateLaundryRow(idx, patch) {
    setLaundry(l => { const rows = [...(l.rows || [])]; rows[idx] = { ...rows[idx], ...patch }; return { ...l, rows } })
  }
  function addLaundryRow() { setLaundry(l => ({ ...l, rows: [...(l.rows || []), emptyLaundryRow()] })) }
  function duplicateLaundryRow(idx) {
    setLaundry((l) => {
      const rows = Array.isArray(l.rows) ? l.rows : []
      if (rows.length >= MAX_LAUNDRY_SLOTS) return l
      const src = rows[idx] || emptyLaundryRow()
      return {
        ...l,
        rows: [
          ...rows,
          {
            ...src,
            access: Array.isArray(src.access) ? [...src.access] : [],
            media: [],
          },
        ],
      }
    })
  }
  function removeLaundryRow(idx) {
    setLaundry((l) => {
      const row = (l.rows || [])[idx]
      for (const m of row?.media || []) {
        if (m?.preview && m.file) URL.revokeObjectURL(m.preview)
      }
      return { ...l, rows: (l.rows || []).filter((_, i) => i !== idx) }
    })
  }

  function addLaundryMedia(laundryIdx, fileList) {
    const valid = Array.from(fileList || []).filter(isLikelyImageUpload)
    if (!valid.length) return
    const entries = valid.map((file) => ({ id: `${Date.now()}-${Math.random()}`, file, preview: URL.createObjectURL(file) }))
    setLaundry((l) => ({
      ...l,
      rows: (l.rows || []).map((r, i) => (i === laundryIdx ? { ...r, media: [...(r.media || []), ...entries] } : r)),
    }))
  }
  function removeLaundryMedia(laundryIdx, mediaId) {
    setLaundry((l) => ({
      ...l,
      rows: (l.rows || []).map((r, i) => {
        if (i !== laundryIdx) return r
        const removed = (r.media || []).find((m) => m.id === mediaId)
        if (removed?.preview && removed.file) URL.revokeObjectURL(removed.preview)
        return { ...r, media: (r.media || []).filter((m) => m.id !== mediaId) }
      }),
    }))
  }

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

        {/* Administrative move-in (application & security deposit are on the Pricing & Fees step) */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
          <SectionHeading>Administrative fee</SectionHeading>
          <p className="text-xs text-slate-500">
            Separate from the security deposit. Leave blank or 0 if none; when set, it flows into the lease draft as a
            non-deposit charge. Application fee and security deposit are set in the last step under Pricing &amp; Fees.
          </p>
          <div>
            <label className={LBL}>Administrative fee ($) <span className="font-normal text-slate-400">(optional)</span></label>
            <input
              className={ic('administrationFee')}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={basics.administrationFee}
              onChange={ev => setBasics(b => ({ ...b, administrationFee: ev.target.value }))}
              onWheel={blurNumberInputOnWheel}
              placeholder="0 — not part of security deposit"
            />
            <FieldError msg={e.administrationFee} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
          <SectionHeading>Move-in charges</SectionHeading>
          <p className="text-xs text-slate-500">
            Add one row per move-in line item. Mark charges that must be paid before lease signing.
          </p>
          {(Array.isArray(basics.moveInChargeRows) ? basics.moveInChargeRows : []).map((row, idx) => {
            const nameStr = String(row?.name || '').trim()
            const nameIsPreset =
              nameStr && MOVE_IN_CHARGE_NAME_OPTIONS.filter((o) => o !== 'Other').includes(nameStr)
            const nameSelectVal = nameIsPreset ? nameStr : 'Other'
            const otherNameVal = nameIsPreset ? '' : nameStr
            return (
            <div
              key={`mir-${idx}`}
              className="rounded-xl border border-slate-200 bg-white p-3 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700">Line {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removeMoveInChargeRow(idx)}
                  className="text-[11px] font-bold text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className={LBL}>Charge name <Req /></label>
                  <select
                    className={ic(`mir${idx}_name`)}
                    value={nameSelectVal}
                    onChange={(ev) => {
                      const v = ev.target.value
                      if (v === 'Other') updateMoveInChargeRow(idx, { name: '' })
                      else updateMoveInChargeRow(idx, { name: v })
                    }}
                  >
                    {MOVE_IN_CHARGE_NAME_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  {nameSelectVal === 'Other' ? (
                    <input
                      className={`${OK_INPUT} mt-2`}
                      value={otherNameVal}
                      onChange={(ev) => updateMoveInChargeRow(idx, { name: ev.target.value })}
                      placeholder="Describe this charge"
                    />
                  ) : null}
                  <FieldError msg={e[`mir${idx}_name`]} />
                </div>
                <div>
                  <label className={LBL}>Amount ($) <Req /></label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    className={ic(`mir${idx}_amt`)}
                    value={row.amount}
                    onChange={(ev) => updateMoveInChargeRow(idx, { amount: ev.target.value })}
                    onWheel={blurNumberInputOnWheel}
                    placeholder="0"
                  />
                  <FieldError msg={e[`mir${idx}_amt`]} />
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(row.requiredBeforeSigning)}
                      onChange={(ev) =>
                        updateMoveInChargeRow(idx, { requiredBeforeSigning: ev.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-[#2563eb]"
                    />
                    Required before signing
                  </label>
                </div>
              </div>
            </div>
            )
          })}
          <button
            type="button"
            onClick={addMoveInChargeRow}
            className="text-sm font-semibold text-[#2563eb] hover:underline"
          >
            + Add move-in charge
          </button>
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
        </div>
      </div>
    )
  }

  function renderRooms() {
    const e = currentErrors
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <strong className="font-semibold text-slate-800">Required per room:</strong> monthly rent, furnished status, and either availability date or "Unavailable".
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
              <div className="flex items-center gap-3">
                {rooms.length < MAX_ROOM_SLOTS ? (
                  <button type="button" onClick={() => duplicateRoom(idx)} className="text-[11px] font-bold text-[#2563eb] hover:text-[#1d4ed8]">
                    Duplicate
                  </button>
                ) : null}
                {rooms.length > 1 ? (
                  <button type="button" onClick={() => removeRoom(idx)} className="text-[11px] font-bold text-red-500 hover:text-red-700">
                    Remove
                  </button>
                ) : null}
              </div>
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
                  step="any"
                  inputMode="decimal"
                  value={room.rent}
                  onChange={ev => updateRoom(idx, { rent: ev.target.value })}
                  onWheel={blurNumberInputOnWheel}
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
                  onChange={ev => updateRoom(idx, { availability: ev.target.value, unavailable: false })}
                  disabled={Boolean(room.unavailable)}
                />
                <FieldError msg={e[`r${idx}_avail`]} />
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-300 accent-[#2563eb]"
                    checked={Boolean(room.unavailable)}
                    onChange={(ev) =>
                      updateRoom(idx, {
                        unavailable: ev.target.checked,
                        availability: ev.target.checked ? '' : room.availability,
                      })
                    }
                  />
                  Mark room unavailable
                </label>
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

              <div className="sm:col-span-2">
                <label className={LBL}>
                  Bathroom setup <span className="font-normal text-slate-400">(optional — bathroom / access only)</span>
                </label>
                <input
                  className={OK_INPUT}
                  value={room.bathroomSetup}
                  onChange={(ev) => updateRoom(idx, { bathroomSetup: ev.target.value })}
                  placeholder="e.g. First floor – private bathroom; shared hall bath with Rooms 2–3"
                />
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
                  step="any"
                  inputMode="decimal"
                  value={room.utilitiesCost}
                  onChange={ev => updateRoom(idx, { utilitiesCost: ev.target.value })}
                  onWheel={blurNumberInputOnWheel}
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
                <div className="sm:col-span-2 space-y-3">
                  <div>
                    <label className={LBL}>Utilities included <span className="font-normal text-slate-400">(Room 1 only — optional)</span></label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {['Water', 'Gas', 'Electric', 'Internet', 'Trash', 'Laundry'].map(util => {
                        const checked = Array.isArray(room.utilitiesIncludes) && room.utilitiesIncludes.includes(util)
                        return (
                          <button
                            key={util}
                            type="button"
                            onClick={() => {
                              const current = Array.isArray(room.utilitiesIncludes) ? room.utilitiesIncludes : []
                              updateRoom(idx, {
                                utilitiesIncludes: checked
                                  ? current.filter(u => u !== util)
                                  : [...current, util],
                              })
                            }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                              checked
                                ? 'border-[#2563eb]/40 bg-[#2563eb]/10 text-[#2563eb]'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                            }`}
                          >
                            {checked ? '✓ ' : ''}{util}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div>
                    <label className={LBL}>Utilities details <span className="font-normal text-slate-400">(optional)</span></label>
                    <textarea
                      className={`${OK_INPUT} min-h-[56px] resize-y`}
                      value={room.utilities}
                      onChange={ev => updateRoom(idx, { utilities: ev.target.value })}
                      placeholder="e.g. Flat $175/mo covers water, gas, and trash. Tenant pays electric."
                      rows={2}
                    />
                  </div>
                </div>
              )}

              <div className="sm:col-span-2">
                <label className={LBL}>Room photos / videos <span className="font-normal text-slate-400">(optional)</span></label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center text-xs text-slate-500 transition hover:border-[#2563eb]/50 hover:bg-blue-50/20">
                  <input
                    type="file"
                    accept={ACCEPT_PROPERTY_IMAGES_AND_VIDEOS}
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
              <div className="flex items-center gap-3">
                {bathrooms.length < MAX_BATHROOM_SLOTS ? (
                  <button type="button" onClick={() => duplicateBath(idx)} className="text-[11px] font-bold text-[#2563eb] hover:text-[#1d4ed8]">Duplicate</button>
                ) : null}
                <button type="button" onClick={() => removeBath(idx)} className="text-[11px] font-bold text-red-500 hover:text-red-700">Remove</button>
              </div>
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
              <div className="sm:col-span-2">
                <label className={`${LBL} mb-2`}>Photos / videos for this bathroom</label>
                <p className="mb-2 text-[11px] text-slate-500">
                  Shown on the public listing. Videos upload with the same <code className="rounded bg-slate-100 px-1">axis-b#-</code>{' '}
                  prefix as photos.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(bath.media || []).map((m) => (
                    <div key={m.id} className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                      {m.file?.type?.startsWith('video/') ? (
                        <div className="flex h-full items-center justify-center text-[10px] font-semibold text-slate-500">
                          Video
                        </div>
                      ) : (
                        <img src={m.preview} alt="" className="h-full w-full object-cover" />
                      )}
                      <button
                        type="button"
                        onClick={() => removeBathroomMedia(idx, m.id)}
                        className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] font-bold text-white hover:bg-black/80"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <label className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-3 py-4 text-center text-xs font-semibold text-slate-600 transition hover:border-[#2563eb]/50 hover:bg-slate-50">
                  <input
                    type="file"
                    accept={ACCEPT_PROPERTY_IMAGES_AND_VIDEOS}
                    multiple
                    className="hidden"
                    onChange={(ev) => {
                      addBathroomMedia(idx, ev.target.files)
                      ev.target.value = ''
                    }}
                  />
                  Drag & drop or click to add photos or videos
                </label>
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
              <div className="flex items-center gap-3">
                {kitchens.length < MAX_KITCHEN_SLOTS ? (
                  <button type="button" onClick={() => duplicateKitchen(idx)} className="text-[11px] font-bold text-[#2563eb] hover:text-[#1d4ed8]">Duplicate</button>
                ) : null}
                <button type="button" onClick={() => removeKitchen(idx)} className="text-[11px] font-bold text-red-500 hover:text-red-700">Remove</button>
              </div>
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
                <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                  <label className={`${LBL} mb-0`}>Room access <Req /></label>
                  <button
                    type="button"
                    onClick={() => updateKitchen(idx, { access: [...roomOptions] })}
                    disabled={!roomOptions.length}
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-[#2563eb] transition hover:border-[#2563eb]/40 hover:bg-[#2563eb]/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    All rooms
                  </button>
                </div>
                <RoomChips access={kit.access} onChange={access => updateKitchen(idx, { access })} />
                <FieldError msg={e[`k${idx}_access`]} />
              </div>
              <div className="sm:col-span-2">
                <label className={`${LBL} mb-2`}>Photos / videos for this kitchen</label>
                <p className="mb-2 text-[11px] text-slate-500">
                  Optional — shown on the listing under shared spaces. Files are saved as <code className="rounded bg-slate-100 px-1">axis-k#-filename</code>.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(kit.media || []).map((m) => (
                    <div key={m.id} className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                      {m.file?.type?.startsWith('video/') ? (
                        <div className="flex h-full items-center justify-center text-[10px] font-semibold text-slate-500">
                          Video
                        </div>
                      ) : (
                        <img src={m.preview} alt="" className="h-full w-full object-cover" />
                      )}
                      <button
                        type="button"
                        onClick={() => removeKitchenMedia(idx, m.id)}
                        className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] font-bold text-white hover:bg-black/80"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <label className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-3 py-4 text-center text-xs font-semibold text-slate-600 transition hover:border-[#2563eb]/50 hover:bg-slate-50">
                  <input
                    type="file"
                    accept={ACCEPT_PROPERTY_IMAGES_AND_VIDEOS}
                    multiple
                    className="hidden"
                    onChange={(ev) => {
                      addKitchenMedia(idx, ev.target.files)
                      ev.target.value = ''
                    }}
                  />
                  Drag & drop or click to add photos or videos
                </label>
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
              <div className="flex items-center gap-3">
                {sharedSpaces.length < MAX_SHARED_SPACE_SLOTS ? (
                  <button type="button" onClick={() => duplicateSpace(idx)} className="text-[11px] font-bold text-[#2563eb] hover:text-[#1d4ed8]">Duplicate</button>
                ) : null}
                <button type="button" onClick={() => removeSpace(idx)} className="text-[11px] font-bold text-red-500 hover:text-red-700">Remove</button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
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
                <label className={LBL}>Details <span className="font-normal text-slate-400">(optional, shown on listing)</span></label>
                <textarea
                  className={`${OK_INPUT} min-h-[64px]`}
                  value={space.description}
                  onChange={ev => updateSpace(idx, { description: ev.target.value })}
                  placeholder="e.g. Large dining room next to kitchen; laundry room in basement; backyard with patio seating…"
                  rows={2}
                />
              </div>
              <div className="sm:col-span-2">
                <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                  <label className={`${LBL} mb-0`}>Room access <span className="font-normal text-slate-400">(optional)</span></label>
                  <button
                    type="button"
                    onClick={() => updateSpace(idx, { access: [...roomOptions] })}
                    disabled={!roomOptions.length}
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-[#2563eb] transition hover:border-[#2563eb]/40 hover:bg-[#2563eb]/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    All rooms
                  </button>
                </div>
                <RoomChips access={space.access} onChange={access => updateSpace(idx, { access })} />
              </div>
              <div className="sm:col-span-2">
                <label className={LBL}>
                  Shared space photos <span className="font-normal text-slate-400">(optional, listing)</span>
                </label>
                <p className="mb-2 text-[11px] text-slate-500">
                  Shown on the property page for this space. Use clear filenames; uploads are tagged per space.
                </p>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center text-xs text-slate-500 transition hover:border-[#2563eb]/50 hover:bg-blue-50/20">
                  <input
                    type="file"
                    accept={ACCEPT_PROPERTY_IMAGES}
                    multiple
                    className="hidden"
                    onChange={(ev) => {
                      addSharedSpaceMedia(idx, ev.target.files)
                      ev.target.value = ''
                    }}
                  />
                  Drag & drop or click to add photos for this shared space
                </label>
                {(space.imageUrls || []).length > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Saved on listing</div>
                    <div className="flex flex-wrap gap-2">
                      {(space.imageUrls || []).map((url, ui) => (
                        <div key={`${url}-${ui}`} className="relative h-20 w-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                          <img src={url} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() =>
                              updateSpace(idx, {
                                imageUrls: (space.imageUrls || []).filter((_, j) => j !== ui),
                              })
                            }
                            className="absolute right-0.5 top-0.5 rounded-full bg-white/90 px-1.5 text-[10px] font-bold text-red-600 shadow"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(space.media || []).length > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">New uploads (with submit)</div>
                    <div className="flex flex-wrap gap-2">
                      {(space.media || []).map((m, mi) => (
                        <div key={m.id} className="relative h-20 w-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                          <img src={m.preview} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeSharedSpaceMedia(idx, m.id)}
                            className="absolute right-0.5 top-0.5 rounded-full bg-white/90 px-1.5 text-[10px] font-bold text-red-600 shadow"
                          >
                            ✕
                          </button>
                          <div className="absolute bottom-0.5 left-0.5 flex gap-0.5">
                            <button
                              type="button"
                              disabled={mi <= 0}
                              onClick={() => moveSharedSpaceMedia(idx, mi, -1)}
                              className="rounded bg-white/90 px-1 text-[10px] font-bold text-slate-700 shadow disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={mi >= (space.media || []).length - 1}
                              onClick={() => moveSharedSpaceMedia(idx, mi, 1)}
                              className="rounded bg-white/90 px-1 text-[10px] font-bold text-slate-700 shadow disabled:opacity-30"
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
          <p className="text-xs text-slate-500">
            Add laundry locations, which rooms can use each one, optional details for the listing, and photos (shown on the property page).
          </p>
          {(laundry.rows || []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">
              No laundry locations added. Add one if the property has laundry.
            </div>
          ) : (
            (laundry.rows || []).map((row, idx) => (
              <div key={`ld-${idx}`} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">{idx + 1}</div>
                    <div className="text-sm font-black text-slate-800">Laundry {idx + 1}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {(laundry.rows || []).length < MAX_LAUNDRY_SLOTS ? (
                      <button type="button" onClick={() => duplicateLaundryRow(idx)} className="text-[11px] font-bold text-[#2563eb] hover:text-[#1d4ed8]">Duplicate</button>
                    ) : null}
                    <button type="button" onClick={() => removeLaundryRow(idx)} className="text-[11px] font-bold text-red-500 hover:text-red-700">Remove</button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={LBL}>Laundry type <Req /></label>
                    <input
                      className={ic(`l${idx}_type`)}
                      value={row.type}
                      onChange={(ev) => updateLaundryRow(idx, { type: ev.target.value })}
                      placeholder="e.g. In-unit W/D, Shared washer in basement"
                    />
                    <FieldError msg={e[`l${idx}_type`]} />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                      <label className={`${LBL} mb-0`}>Room access <Req /></label>
                      <button
                        type="button"
                        onClick={() => updateLaundryRow(idx, { access: [...roomOptions] })}
                        disabled={!roomOptions.length}
                        className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-[#2563eb] transition hover:border-[#2563eb]/40 hover:bg-[#2563eb]/5 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        All rooms
                      </button>
                    </div>
                    <RoomChips
                      access={row.access || []}
                      onChange={(access) => updateLaundryRow(idx, { access })}
                    />
                    <FieldError msg={e[`l${idx}_access`]} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LBL}>Details <span className="font-normal text-slate-400">(optional, listing)</span></label>
                    <textarea
                      className={`${OK_INPUT} min-h-[64px]`}
                      value={row.description || ''}
                      onChange={(ev) => updateLaundryRow(idx, { description: ev.target.value })}
                      placeholder="e.g. Coin-op in basement, hours 7am–10pm; detergent shelf; folding table…"
                      rows={2}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LBL}>Laundry photos <span className="font-normal text-slate-400">(optional)</span></label>
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center text-xs text-slate-500 transition hover:border-[#2563eb]/50 hover:bg-blue-50/20">
                      <input
                        type="file"
                        accept={ACCEPT_PROPERTY_IMAGES}
                        multiple
                        className="hidden"
                        onChange={(ev) => {
                          addLaundryMedia(idx, ev.target.files)
                          ev.target.value = ''
                        }}
                      />
                      Drag & drop or click to add photos for this laundry
                    </label>
                    {(row.media || []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(row.media || []).map((m) => (
                          <div key={m.id} className="relative h-20 w-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                            <img src={m.preview} alt="" className="h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => removeLaundryMedia(idx, m.id)}
                              className="absolute right-0.5 top-0.5 rounded-full bg-white/90 px-1.5 text-[10px] font-bold text-red-600 shadow"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          {(laundry.rows || []).length < MAX_LAUNDRY_SLOTS && (
            <button type="button" onClick={addLaundryRow} className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
              + Add laundry
            </button>
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
                  step="any"
                  inputMode="decimal"
                  value={parking.fee}
                  onChange={ev => setParking(p => ({ ...p, fee: ev.target.value }))}
                  onWheel={blurNumberInputOnWheel}
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
            <input
              ref={imageInputRef}
              type="file"
              accept={ACCEPT_PROPERTY_IMAGES}
              multiple
              className="hidden"
              onChange={(ev) => addImageFiles(ev.target.files)}
            />
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
    const pf = pricingFees
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-5">
          <div>
            <SectionHeading>Pricing &amp; Fees</SectionHeading>
            <p className="mt-1 text-xs text-slate-500">
              Core amounts for marketing and lease prep. Optional fields can stay blank.
            </p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">1 · Monthly costs</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LBL}>Monthly room rent ($) <Req /></label>
                <input
                  className={ic('monthlyRoomRent')}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={pf.monthlyRoomRent}
                  onChange={(ev) => setPricingFees((p) => ({ ...p, monthlyRoomRent: ev.target.value }))}
                  onWheel={blurNumberInputOnWheel}
                  placeholder="e.g. 850"
                />
                <FieldError msg={e.monthlyRoomRent} />
              </div>
              <div>
                <label className={LBL}>Utility fee ($/mo) <span className="font-normal text-slate-400">(optional)</span></label>
                <input
                  className={ic('utilityFee')}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={pf.utilityFee}
                  onChange={(ev) => setPricingFees((p) => ({ ...p, utilityFee: ev.target.value }))}
                  onWheel={blurNumberInputOnWheel}
                  placeholder="0"
                />
                <FieldError msg={e.utilityFee} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">2 · Upfront costs</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LBL}>Application fee ($) <Req /></label>
                <input
                  className={ic('applicationFee')}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={appFee}
                  onChange={(ev) => setAppFee(ev.target.value)}
                  onWheel={blurNumberInputOnWheel}
                  placeholder="0"
                />
                <FieldError msg={e.applicationFee} />
              </div>
              <div>
                <label className={LBL}>Holding deposit ($) <span className="font-normal text-slate-400">(optional)</span></label>
                <input
                  className={ic('holdingDeposit')}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={pf.holdingDeposit}
                  onChange={(ev) => setPricingFees((p) => ({ ...p, holdingDeposit: ev.target.value }))}
                  onWheel={blurNumberInputOnWheel}
                  placeholder="0"
                />
                <FieldError msg={e.holdingDeposit} />
              </div>
              <div>
                <label className={LBL}>Move-in fee ($) <span className="font-normal text-slate-400">(optional)</span></label>
                <input
                  className={ic('moveInFee')}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={pf.moveInFee}
                  onChange={(ev) => setPricingFees((p) => ({ ...p, moveInFee: ev.target.value }))}
                  onWheel={blurNumberInputOnWheel}
                  placeholder="0"
                />
                <FieldError msg={e.moveInFee} />
              </div>
              <div>
                <label className={LBL}>Security deposit ($) <Req /></label>
                <input
                  className={ic('securityDeposit')}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={basics.securityDeposit}
                  onChange={(ev) => setBasics((b) => ({ ...b, securityDeposit: ev.target.value }))}
                  onWheel={blurNumberInputOnWheel}
                  placeholder="0"
                />
                <FieldError msg={e.securityDeposit} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">3 · Optional fees</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={LBL}>Late rent fee ($) <span className="font-normal text-slate-400">(optional)</span></label>
                <input
                  className={ic('lateRentFee')}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={pf.lateRentFee}
                  onChange={(ev) => setPricingFees((p) => ({ ...p, lateRentFee: ev.target.value }))}
                  onWheel={blurNumberInputOnWheel}
                  placeholder="0"
                />
                <FieldError msg={e.lateRentFee} />
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#2563eb]"
                  checked={Boolean(pf.petsAllowed)}
                  onChange={(ev) =>
                    setPricingFees((p) => ({
                      ...p,
                      petsAllowed: ev.target.checked,
                      ...(ev.target.checked ? {} : { petDeposit: '', petRent: '' }),
                    }))
                  }
                />
                <span className="text-sm font-semibold text-slate-800">Pets allowed (extra fees below)</span>
              </label>
              {pf.petsAllowed ? (
                <>
                  <div>
                    <label className={LBL}>Pet deposit ($)</label>
                    <input
                      className={ic('petDeposit')}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={pf.petDeposit}
                      onChange={(ev) => setPricingFees((p) => ({ ...p, petDeposit: ev.target.value }))}
                      onWheel={blurNumberInputOnWheel}
                      placeholder="0"
                    />
                    <FieldError msg={e.petDeposit} />
                  </div>
                  <div>
                    <label className={LBL}>Pet rent ($/mo)</label>
                    <input
                      className={ic('petRent')}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={pf.petRent}
                      onChange={(ev) => setPricingFees((p) => ({ ...p, petRent: ev.target.value }))}
                      onWheel={blurNumberInputOnWheel}
                      placeholder="0"
                    />
                    <FieldError msg={e.petRent} />
                  </div>
                </>
              ) : null}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#2563eb]"
                  checked={Boolean(pf.conditionalDepositRequired)}
                  onChange={(ev) =>
                    setPricingFees((p) => ({
                      ...p,
                      conditionalDepositRequired: ev.target.checked,
                      ...(ev.target.checked ? {} : { conditionalDeposit: '', conditionalDepositNote: '' }),
                    }))
                  }
                />
                <span className="text-sm font-semibold text-slate-800">Conditional deposit required</span>
              </label>
              {pf.conditionalDepositRequired ? (
                <>
                  <div>
                    <label className={LBL}>Conditional deposit ($)</label>
                    <input
                      className={ic('conditionalDeposit')}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={pf.conditionalDeposit}
                      onChange={(ev) => setPricingFees((p) => ({ ...p, conditionalDeposit: ev.target.value }))}
                      onWheel={blurNumberInputOnWheel}
                      placeholder="0"
                    />
                    <FieldError msg={e.conditionalDeposit} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LBL}>When it applies <span className="font-normal text-slate-400">(optional)</span></label>
                    <textarea
                      className={`${OK_INPUT} min-h-[72px] resize-y`}
                      rows={2}
                      value={pf.conditionalDepositNote}
                      onChange={(ev) => setPricingFees((p) => ({ ...p, conditionalDepositNote: ev.target.value }))}
                      placeholder="e.g. Credit score under 650 or no rental history"
                    />
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">4 · Listing display</div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#2563eb]"
                checked={Boolean(pf.showFeesOnListing)}
                onChange={(ev) => setPricingFees((p) => ({ ...p, showFeesOnListing: ev.target.checked }))}
              />
              <span className="text-sm font-semibold text-slate-800">Show these fees on the public listing</span>
            </label>
            <div>
              <label className={LBL}>Pricing notes <span className="font-normal text-slate-400">(optional)</span></label>
              <textarea
                className={`${OK_INPUT} min-h-[88px] resize-y`}
                rows={3}
                value={pf.pricingNotes}
                onChange={(ev) => setPricingFees((p) => ({ ...p, pricingNotes: ev.target.value }))}
                placeholder="Short context for applicants (shown on listing when enabled)"
              />
            </div>
          </div>
        </div>

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
                step="any"
                inputMode="decimal"
                value={leasing.fullHousePrice}
                onChange={ev => setLeasing(L => ({ ...L, fullHousePrice: ev.target.value }))}
                onWheel={blurNumberInputOnWheel}
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
                step="any"
                inputMode="decimal"
                value={leasing.promoPrice}
                onChange={ev => setLeasing(L => ({ ...L, promoPrice: ev.target.value }))}
                onWheel={blurNumberInputOnWheel}
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

        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <SectionHeading>Lease draft details</SectionHeading>
          <p className="text-xs text-slate-500">
            Captured on the property record and merged into generated leases when present. Use plain language; you can
            refine wording in the manager lease editor after the draft is created.
          </p>
          <div>
            <label className={LBL}>Guest policy</label>
            <textarea
              className={ic('guestPolicy')}
              value={leasing.guestPolicy}
              onChange={(ev) => setLeasing((L) => ({ ...L, guestPolicy: ev.target.value }))}
              rows={3}
              placeholder="e.g. Overnight guests up to 3 nights/month with house notice; longer stays require written approval."
            />
          </div>
          <div>
            <label className={LBL}>Other lease terms for this property</label>
            <textarea
              className={ic('additionalLeaseTerms')}
              value={leasing.additionalLeaseTerms}
              onChange={(ev) => setLeasing((L) => ({ ...L, additionalLeaseTerms: ev.target.value }))}
              rows={3}
              placeholder="e.g. Smoking policy, quiet hours, subletting, parking for guests — optional."
            />
          </div>
          <div>
            <label className={LBL}>House rules (shared spaces)</label>
            <textarea
              className={ic('houseRules')}
              value={leasing.houseRules}
              onChange={(ev) => setLeasing((L) => ({ ...L, houseRules: ev.target.value }))}
              rows={4}
              placeholder="e.g. Quiet hours, kitchen cleanup, trash days, guest limits — appears in Section 7 of generated leases."
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <SectionHeading>Lease information</SectionHeading>
          <p className="text-xs text-slate-500">
            Long-form clauses and edits for this home. Stored on the property record (Airtable field <strong>lease infomration</strong>
            ) and merged into generated structured leases as Addendum F. You can also edit this text from the lease review screen.
          </p>
          <textarea
            className={ic('leaseInformation')}
            value={leasing.leaseInformation}
            onChange={(ev) => setLeasing((L) => ({ ...L, leaseInformation: ev.target.value }))}
            rows={8}
            placeholder="e.g. Parking rules, storage, rent concessions, or full replacement lease language you want appended to the agreement."
          />
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
                  <input
                    className={ic(`bnd${bidx}_price`)}
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={b.price}
                    onChange={ev => updateBundle(bidx, { price: ev.target.value })}
                    onWheel={blurNumberInputOnWheel}
                    placeholder="e.g. 3100"
                  />
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
            {wizardMode === 'edit' ? 'Edit property' : 'New property'} · Step {step + 1} of {STEPS.length}
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
        <div ref={scrollRef} className="mt-6 pr-1">
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
                ? saving ? 'Submitting…' : wizardMode === 'edit' ? 'Save & submit for review' : 'Submit for review'
                : 'Next →'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
