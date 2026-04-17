/**
 * Ensures recurring monthly payment rows exist in Supabase so Manager and Resident portals
 * share the same schedule (replaces synthetic month rows that managers could not see).
 *
 * Move-in lines (deposit, first rent, first utilities) are created by application approval
 * or Stripe finalize — not duplicated here.
 */
import {
  notesContainLedgerMarker,
  recurringRentLedgerMarker,
  recurringUtilitiesLedgerMarker,
} from '../../../shared/payments-ledger-markers.js'
import { buildPaymentResidentLinkFields, createPaymentRecord, getResidentById } from './airtable.js'
import { isInternalUuid, isAirtableRecordId } from './recordIdentity.js'
import {
  dueDateStringForMonth,
  findRentPaymentForBillingMonth,
  findUtilitiesPaymentForBillingMonth,
  iterRecurringBillingMonthKeys,
  longMonthLabel,
  rentDueDayFromResident,
} from './residentPaymentsShared.js'

function extendKnown(known, created) {
  if (created && typeof created === 'object' && created.id) {
    known.push(created)
  }
}

async function resolveLedgerAppUserId(resident) {
  const rid = String(resident?.id || '').trim()
  if (!rid) return ''
  if (isInternalUuid(rid)) return rid
  const su = String(resident?.['Supabase User ID'] || '').trim()
  if (isInternalUuid(su)) return su
  if (isAirtableRecordId(rid)) {
    try {
      const full = await getResidentById(rid)
      const x = String(full?.['Supabase User ID'] || '').trim()
      if (isInternalUuid(x)) return x
    } catch {
      /* ignore */
    }
  }
  return ''
}

/**
 * @param {{
 *   resident: Record<string, unknown>,
 *   sortedPayments: unknown[],
 *   payPricing: { propertyName?: string, unitNumber?: string, monthlyRent?: number, securityDeposit?: number, utilitiesFee?: number },
 *   firstMonthRentPaid: boolean,
 *   firstMonthUtilitiesPaid: boolean,
 * }} p
 * @returns {Promise<number>} number of new ledger rows created
 */
export async function ensureResidentPaymentLedgerMaterialized(p) {
  const resident = p?.resident
  const sortedPayments = Array.isArray(p?.sortedPayments) ? p.sortedPayments : []
  const payPricing = p?.payPricing || {}
  const firstMonthRentPaid = Boolean(p?.firstMonthRentPaid)
  const firstMonthUtilitiesPaid = Boolean(p?.firstMonthUtilitiesPaid)

  const residentPrimaryId = String(resident?.id || '').trim()
  const appUserId = await resolveLedgerAppUserId(resident)
  if (!appUserId) return 0

  let createdCount = 0
  const known = [...sortedPayments]

  const propName = String(payPricing.propertyName || '').trim()
  const unit = String(payPricing.unitNumber || resident?.['Unit Number'] || '').trim()
  const resName = String(resident?.Name || '').trim()
  const resEmail = String(resident?.Email || '').trim().toLowerCase()

  const leaseStart = String(resident?.['Lease Start Date'] || '').trim()
  const leaseEnd = String(resident?.['Lease End Date'] || '').trim()

  const monthlyRent = Math.round(Number(payPricing.monthlyRent) * 100) / 100
  const utilitiesFee = Math.round(Number(payPricing.utilitiesFee) * 100) / 100

  const internalProp = String(resident?.__internal_property_id || '').trim()
  const internalApp = String(resident?.__internal_application_id || resident?.['Application ID'] || '').trim()

  const markerKey = isAirtableRecordId(residentPrimaryId) ? residentPrimaryId : appUserId

  const baseFields = () => ({
    ...buildPaymentResidentLinkFields(appUserId),
    ...(internalProp && isInternalUuid(internalProp) ? { _internal_property_id: internalProp } : {}),
    ...(internalApp && isInternalUuid(internalApp) ? { _internal_application_id: internalApp } : {}),
    'Resident Name': resName || undefined,
    'Resident Email': resEmail || undefined,
    'Property Name': propName || undefined,
    'Room Number': unit || undefined,
  })

  /** Skip if any row already carries this marker (covers stale classification). */
  const markerTaken = (m) => known.some((row) => notesContainLedgerMarker(row?.Notes, m))

  if (leaseStart && firstMonthRentPaid && monthlyRent > 0) {
    const horizon = Number(import.meta.env.VITE_PAYMENT_SCHEDULE_HORIZON_MONTHS || 12) || 12
    const yms = iterRecurringBillingMonthKeys(leaseStart, leaseEnd, horizon)
    const rd = rentDueDayFromResident(resident)
    for (const ym of yms) {
      const dueStr = dueDateStringForMonth(ym, rd)
      if (!dueStr) continue

      const rentMarker = recurringRentLedgerMarker(markerKey, ym)
      if (!findRentPaymentForBillingMonth(known, ym) && !markerTaken(rentMarker)) {
        const row = await createPaymentRecord({
          ...baseFields(),
          Amount: monthlyRent,
          Balance: monthlyRent,
          Status: 'Unpaid',
          'Due Date': dueStr,
          Type: 'Monthly rent',
          Category: 'Rent',
          Kind: 'Monthly rent',
          'Line Item Type': 'Recurring',
          Month: `${longMonthLabel(ym)} rent`,
          Notes: `Scheduled monthly rent (portal ledger). ${rentMarker}`,
          _axis_payment_key: rentMarker,
        })
        extendKnown(known, row)
        createdCount += 1
      }

      if (utilitiesFee > 0 && firstMonthUtilitiesPaid) {
        const utilMarker = recurringUtilitiesLedgerMarker(markerKey, ym)
        if (!findUtilitiesPaymentForBillingMonth(known, ym) && !markerTaken(utilMarker)) {
          const row = await createPaymentRecord({
            ...baseFields(),
            Amount: utilitiesFee,
            Balance: utilitiesFee,
            Status: 'Unpaid',
            'Due Date': dueStr,
            Type: 'Monthly utilities',
            Category: 'Rent',
            Kind: 'Monthly utilities',
            'Line Item Type': 'Recurring',
            Month: `${longMonthLabel(ym)} utilities`,
            Notes: `Scheduled monthly utilities (portal ledger). ${utilMarker}`,
            _axis_payment_key: utilMarker,
          })
          extendKnown(known, row)
          createdCount += 1
        }
      }
    }
  }

  return createdCount
}
