/**
 * Ensures recurring monthly Payments rows exist in Airtable so Manager and Resident portals
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
import {
  buildPaymentPropertyLinkFields,
  buildPaymentResidentLinkFields,
  createPaymentRecord,
  getPropertyByName,
} from './airtable.js'
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

/**
 * @param {{
 *   resident: Record<string, unknown>,
 *   sortedPayments: unknown[],
 *   payPricing: { propertyName?: string, unitNumber?: string, monthlyRent?: number, securityDeposit?: number, utilitiesFee?: number },
 *   firstMonthRentPaid: boolean,
 *   firstMonthUtilitiesPaid: boolean,
 * }} p
 * @returns {Promise<number>} number of Airtable rows created
 */
export async function ensureResidentPaymentLedgerMaterialized(p) {
  const resident = p?.resident
  const sortedPayments = Array.isArray(p?.sortedPayments) ? p.sortedPayments : []
  const payPricing = p?.payPricing || {}
  const firstMonthRentPaid = Boolean(p?.firstMonthRentPaid)
  const firstMonthUtilitiesPaid = Boolean(p?.firstMonthUtilitiesPaid)

  const rid = String(resident?.id || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(rid)) return 0

  let createdCount = 0
  const known = [...sortedPayments]

  const propName = String(payPricing.propertyName || '').trim()
  const unit = String(payPricing.unitNumber || resident?.['Unit Number'] || '').trim()
  const resName = String(resident?.Name || '').trim()
  const resEmail = String(resident?.Email || '').trim().toLowerCase()

  const propertyRec = propName ? await getPropertyByName(propName).catch(() => null) : null
  const propertyLink = buildPaymentPropertyLinkFields(propertyRec?.id)

  const leaseStart = String(resident?.['Lease Start Date'] || '').trim()
  const leaseEnd = String(resident?.['Lease End Date'] || '').trim()

  const monthlyRent = Math.round(Number(payPricing.monthlyRent) * 100) / 100
  const utilitiesFee = Math.round(Number(payPricing.utilitiesFee) * 100) / 100

  const baseFields = () => ({
    ...buildPaymentResidentLinkFields(rid),
    ...propertyLink,
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

      const rentMarker = recurringRentLedgerMarker(rid, ym)
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
        })
        extendKnown(known, row)
        createdCount += 1
      }

      if (utilitiesFee > 0 && firstMonthUtilitiesPaid) {
        const utilMarker = recurringUtilitiesLedgerMarker(rid, ym)
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
          })
          extendKnown(known, row)
          createdCount += 1
        }
      }
    }
  }

  return createdCount
}
