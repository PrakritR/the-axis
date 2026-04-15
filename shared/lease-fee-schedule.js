/**
 * Structured move-in / fee rows for lease HTML (portal preview + PDF).
 * Mirrors common fee-guide layout: move-in vs other recurring/conditional charges.
 */

function n(v) {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/**
 * @param {object} d leaseData
 * @returns {Array<{ title: string, amount: string, lines: string[] }>}
 */
export function buildMoveInFeeScheduleRows(d) {
  const rows = []
  const sd = n(d?.securityDeposit)
  if (sd > 0) {
    rows.push({
      title: 'Security deposit',
      amount: String(d.securityDepositFmt || '').trim() || '—',
      lines: ['Refundable per RCW 59.18.260', 'Due prior to or at move-in'],
    })
  }
  const admin = n(d?.adminFee)
  if (admin > 0) {
    rows.push({
      title: 'Administrative costs',
      amount: String(d.adminFeeFmt || '').trim() || '—',
      lines: ['Non-refundable processing / admin', 'Due prior to or at move-in'],
    })
  }
  const app = n(d?.applicationFee)
  if (app > 0) {
    rows.push({
      title: 'Application fee',
      amount: String(d.applicationFeeFmt || '').trim() || '—',
      lines: ['Per applicant', 'Paid with rental application (before lease)'],
    })
  }
  const lmr = n(d?.lastMonthRent)
  if (lmr > 0) {
    rows.push({
      title: "Last month's rent (prepaid)",
      amount: String(d.lastMonthRentFmt || '').trim() || '—',
      lines: ['Applied to final rental period after notice', 'Due at move-in if listed above'],
    })
  }
  if (n(d?.proratedDays) > 0) {
    const pr = n(d?.proratedRent)
    if (pr > 0) {
      rows.push({
        title: `Prorated rent (${d.proratedDays} days)`,
        amount: String(d.proratedRentFmt || '').trim() || '—',
        lines: ['First partial month', `From ${String(d.leaseStartFmt || '').trim() || 'lease start'} through month-end`],
      })
    }
    const pu = n(d?.proratedUtility)
    if (pu > 0) {
      rows.push({
        title: 'Prorated utilities',
        amount: String(d.proratedUtilityFmt || '').trim() || '—',
        lines: ['First partial month', 'Allocated utilities fee'],
      })
    }
  }
  const mr = n(d?.monthlyRent)
  const uf = n(d?.utilityFee)
  if (mr > 0 || uf > 0) {
    rows.push({
      title: 'First full month',
      amount: String(d.monthlyTotalFmt || '').trim() || '—',
      lines: ['Base rent + monthly utilities fee (if any)', 'Due at move-in for the first full rental period'],
    })
  }
  return rows
}

/**
 * @param {object} d leaseData
 * @param {{ lateFee: string, lateGraceDays: number }} c
 */
export function buildOtherFeeScheduleRows(d, c) {
  const lateFee = String(c?.lateFee || '$75.00')
  const lateGrace = Number(c?.lateGraceDays) || 5
  const rows = [
    {
      title: 'Late rent fee',
      amount: lateFee,
      lines: [`If rent is not received by the ${lateGrace}th of the month`, 'Per Section 3'],
    },
    {
      title: 'Returned payment / NSF',
      amount: 'Actual fees + statutory cap',
      lines: ['Per Section 3.2', 'Conditional on dishonored payment'],
    },
  ]
  const ble = n(d?.breakLeaseFeeAmount)
  if (ble > 0 && String(d?.breakLeaseFee || '').trim()) {
    rows.push({
      title: 'Early termination / lease break',
      amount: String(d.breakLeaseFee || '').trim(),
      lines: ['When agreed in writing', 'Subject to mitigation under Section 2.1'],
    })
  } else {
    rows.push({
      title: 'Early termination',
      amount: 'Actual damages',
      lines: ['Mitigation required — Section 2.1', 'No penalty beyond lawful charges'],
    })
  }
  return rows
}

export function buildPetFeeScheduleNote() {
  return {
    title: 'Pets & add-ons',
    lines: [
      'No pets without prior written consent of Landlord.',
      'Approved pets may require an additional refundable pet deposit and monthly pet rent per written authorization.',
      'Optional charges (parking, storage, package lockers, etc.) apply only if offered in writing or a signed addendum.',
    ],
  }
}
