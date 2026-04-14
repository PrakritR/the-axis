/**
 * leaseTemplate.js
 * Builds a structured lease data object from an application record.
 * All 12 sections match the existing signed leases exactly.
 */

import { properties } from '../data/properties'

function fmt(date) {
  if (!date) return '___________'
  const d = new Date(date + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '$0.00'
  const num = typeof n === 'string' ? parseFloat(n.replace(/[^0-9.-]/g, '')) : Number(n)
  if (isNaN(num)) return '$0.00'
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function findPropRecord(propertyName) {
  if (!propertyName) return null
  const q = String(propertyName).trim().toLowerCase()
  return (
    properties.find((p) => String(p.name || '').trim().toLowerCase() === q) ||
    properties.find((p) => {
      const n = String(p.name || '').trim().toLowerCase()
      return n.includes(q) || q.includes(n)
    }) ||
    null
  )
}

function getRoomRent(propertyName, roomNumber) {
  const prop = findPropRecord(propertyName)
  if (!prop) return 0
  const roomLabel = String(roomNumber || '').trim()
  for (const plan of prop.roomPlans || []) {
    for (const room of plan.rooms || []) {
      if (!room?.name) continue
      const nameNorm = String(room.name).trim().toLowerCase()
      const labelNorm = roomLabel.toLowerCase()
      const stripRoom = (s) => s.replace(/^room\s*/i, '').trim()
      if (
        nameNorm === labelNorm ||
        stripRoom(nameNorm) === stripRoom(labelNorm)
      ) {
        if (room.price) return parseFloat(String(room.price).replace(/[^0-9.]/g, '')) || 0
      }
    }
  }
  return 0
}

function parseMoneyStr(s) {
  if (!s) return null
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function getUtilityFee(propertyName) {
  const prop = findPropRecord(propertyName)
  return parseMoneyStr(prop?.utilitiesFee) ?? parseMoneyStr(prop?.utilityFee) ?? 125
}

function getSecDeposit(propertyName, monthlyRent) {
  const prop = findPropRecord(propertyName)
  const explicit = parseMoneyStr(prop?.securityDeposit)
  if (explicit != null) return explicit
  return Math.min(monthlyRent, 500)
}

function getBathroomNote(propertyName, roomNumber) {
  const prop = findPropRecord(propertyName)
  if (!prop || !roomNumber) return ''
  const roomLabel = String(roomNumber).trim()
  const stripRoom = (s) => String(s || '').replace(/^room\s*/i, '').trim().toLowerCase()
  for (const plan of prop.roomPlans || []) {
    for (const room of plan.rooms || []) {
      if (!room?.name) continue
      if (stripRoom(room.name) === stripRoom(roomLabel)) {
        return room.details || ''
      }
    }
  }
  return ''
}

function getAmenities(propertyName) {
  const prop = findPropRecord(propertyName)
  return prop?.communityAmenities || []
}

/**
 * @param {object} app - Application record from the applications backend (mapped fields)
 * @param {object} [overrides] - Admin overrides: { rent, deposit, utilityFee, adminFee, lastMonthRent }
 * @returns {object} Structured lease data object
 */
export function buildLease(app, overrides = {}) {
  const propertyName = app['Property Name'] || ''
  const roomNumber = app['Room Number'] || ''
  const propertyAddress = app['Property Address'] || ''
  const tenantName = app['Signer Full Name'] || ''
  const tenantEmail = app['Signer Email'] || ''
  const tenantPhone = app['Signer Phone Number'] || ''
  const leaseStart = app['Lease Start Date'] || ''
  const leaseEnd = app['Lease End Date'] || ''
  const isMonthToMonth = Boolean(app['Month to Month'])
  const cosignerName = app['cosignerName'] || ''

  const monthlyRent = overrides.rent || getRoomRent(propertyName, roomNumber) || 0
  const utilityFee = overrides.utilityFee ?? getUtilityFee(propertyName)
  const securityDeposit = overrides.deposit ?? getSecDeposit(propertyName, monthlyRent)
  const adminFee = overrides.adminFee ?? 250
  let lastMonthRent = 0
  if (overrides.lastMonthRent != null && String(overrides.lastMonthRent).trim() !== '') {
    const fromOverride = parseMoneyStr(String(overrides.lastMonthRent))
    lastMonthRent =
      fromOverride != null
        ? fromOverride
        : Number(overrides.lastMonthRent) || 0
  } else {
    lastMonthRent = parseMoneyStr(app['Last Month Rent']) ?? 0
  }
  const bathroomNote = getBathroomNote(propertyName, roomNumber)
  const amenities = getAmenities(propertyName)

  // Calculate prorated amounts (days from start to end of first month)
  let proratedRent = 0
  let proratedUtility = 0
  let proratedDays = 0
  if (leaseStart) {
    const start = new Date(leaseStart + 'T12:00:00')
    const endOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0)
    const daysInMonth = endOfMonth.getDate()
    const dayOfMonth = start.getDate()
    if (dayOfMonth > 1) {
      proratedDays = daysInMonth - dayOfMonth + 1
      const dailyRent = Math.round((monthlyRent / daysInMonth) * 100) / 100
      const dailyUtil = Math.round((utilityFee / daysInMonth) * 100) / 100
      proratedRent = Math.round(dailyRent * proratedDays * 100) / 100
      proratedUtility = Math.round(dailyUtil * proratedDays * 100) / 100
    }
  }

  const totalMoveIn =
    proratedRent + proratedUtility + monthlyRent + utilityFee + securityDeposit + adminFee + lastMonthRent

  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })

  return {
    // Meta
    agreementDate: today,
    landlordName: 'Prakrit Ramachandran',
    landlordAddress: '4709 A 8th Ave N, Seattle, WA 98105',

    // Tenant
    tenantName,
    tenantEmail,
    tenantPhone,
    cosignerName,

    // Property
    propertyName,
    propertyAddress,
    roomNumber,
    fullAddress: propertyAddress || `${propertyName} - Room ${roomNumber}`,

    // Term
    leaseStart,
    leaseEnd,
    isMonthToMonth,
    leaseStartFmt: fmt(leaseStart),
    leaseEndFmt: fmt(leaseEnd),

    // Financials
    monthlyRent,
    utilityFee,
    securityDeposit,
    adminFee,
    proratedDays,
    proratedRent,
    proratedUtility,
    totalMoveIn,

    // Formatted
    monthlyRentFmt: fmtMoney(monthlyRent),
    utilityFeeFmt: fmtMoney(utilityFee),
    securityDepositFmt: fmtMoney(securityDeposit),
    lastMonthRentFmt: fmtMoney(lastMonthRent),
    adminFeeFmt: fmtMoney(adminFee),
    proratedRentFmt: fmtMoney(proratedRent),
    proratedUtilityFmt: fmtMoney(proratedUtility),
    totalMoveInFmt: fmtMoney(totalMoveIn),
    monthlyTotalFmt: fmtMoney(monthlyRent + utilityFee),
    breakLeaseFee: fmtMoney(900),
    // Property-specific
    bathroomNote,
    amenities,
  }
}
