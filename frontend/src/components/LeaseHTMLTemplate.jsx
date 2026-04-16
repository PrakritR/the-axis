import {
  buildMoveInFeeScheduleRows,
  buildOtherFeeScheduleRows,
  buildPetFeeScheduleNote,
} from '../../../shared/lease-fee-schedule.js'

/**
 * LeaseHTMLTemplate.jsx
 *
 * Renders the full Axis residential lease agreement as styled HTML
 * from the structured data object produced by buildLease().
 *
 * Props:
 *   leaseData  - object from buildLease() / parsed "Lease JSON" field
 *   signedBy   - optional string: signed name (shown in signature block when signed)
 *   signedAt   - optional ISO string: signing timestamp
 *   managerSignedBy / managerSignedAt / managerSignatureImageUrl — optional landlord counter-signature (Lease Drafts)
 *   printMode  - if true, uses a minimal white wrapper suitable for window.print()
 */

const LANDLORD_NAME = 'Prakrit Ramachandran'
const LANDLORD_ADDRESS = '4709 A 8th Ave N, Seattle, WA 98105'
const COMPANY_NAME = 'Axis Seattle Housing'
const LATE_FEE = '$75.00'
const LATE_GRACE_DAYS = 5
/** RCW 59.18.200 — tenant / month-to-month termination notice (days). */
const TERMINATION_NOTICE_DAYS = 20
/** RCW 59.18.150 — minimum written notice before entering the resident's private room (non-emergency). */
const LANDLORD_ENTRY_NOTICE_HOURS = 24

function Row({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-2 sm:py-0.5">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 sm:w-44">{label}</span>
      <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{value || '—'}</span>
    </div>
  )
}

function Section({ number, title, children }) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-[13px] font-black uppercase tracking-[0.12em] text-slate-800">
        {number}. {title}
      </h3>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </div>
  )
}

function P({ children }) {
  return <p className="text-sm leading-relaxed text-slate-700">{children}</p>
}

function FeeScheduleBlock({ leaseData: d }) {
  const moveIn = buildMoveInFeeScheduleRows(d)
  const other = buildOtherFeeScheduleRows(d, { lateFee: LATE_FEE, lateGraceDays: LATE_GRACE_DAYS })
  const pet = buildPetFeeScheduleNote()

  return (
    <div className="mb-8 rounded-2xl border border-stone-200 bg-[#faf8f5] px-4 py-5 sm:px-6">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-stone-500">Fee schedule</p>
      <p className="mb-4 text-xs leading-relaxed text-stone-600">
        Categorized overview of typical charges. Exact amounts for this lease appear in the Agreement Summary above.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-stone-200/90 bg-white px-4 py-4 shadow-sm">
          <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Move-in costs</h4>
          <div className="mt-3 space-y-4">
            {moveIn.length ? (
              moveIn.map((r, i) => (
                <div key={i} className="border-b border-stone-100 pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-bold text-stone-900">{r.title}</span>
                    <span className="text-base font-black tabular-nums text-stone-900">{r.amount}</span>
                  </div>
                  <ul className="mt-1.5 list-none space-y-0.5 pl-0">
                    {r.lines.map((line, j) => (
                      <li key={j} className="text-[11px] text-stone-600">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="text-xs text-stone-500">See Agreement Summary for this tenancy&apos;s move-in line items.</p>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-stone-200/90 bg-white px-4 py-4 shadow-sm">
          <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Other fees</h4>
          <div className="mt-3 space-y-4">
            {other.map((r, i) => (
              <div key={i} className="border-b border-stone-100 pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-stone-900">{r.title}</span>
                  <span className="text-sm font-black tabular-nums text-stone-900">{r.amount}</span>
                </div>
                <ul className="mt-1.5 list-none space-y-0.5 pl-0">
                  {r.lines.map((line, j) => (
                    <li key={j} className="text-[11px] text-stone-600">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-stone-200/90 bg-white px-4 py-4 shadow-sm">
          <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">{pet.title}</h4>
          <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-stone-600">
            {pet.lines.map((line, j) => (
              <li key={j}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-4 border-t border-stone-200/80 pt-3 text-center text-xs text-stone-700">
        <span className="font-semibold">Total move-in (this lease):</span>{' '}
        <span className="font-black tabular-nums text-stone-900">{d.totalMoveInFmt || '—'}</span>
      </p>
    </div>
  )
}

export default function LeaseHTMLTemplate({
  leaseData = {},
  signedBy,
  signedAt,
  managerSignedBy,
  managerSignedAt,
  managerSignatureImageUrl,
  printMode = false,
}) {
  const d = leaseData

  const termDesc = d.isMonthToMonth
    ? `month-to-month commencing ${d.leaseStartFmt || '___________'}`
    : `fixed term from ${d.leaseStartFmt || '___________'} through ${d.leaseEndFmt || '___________'}`

  function formatSignatureDate(raw) {
    if (raw == null || raw === '') return null
    const s = Array.isArray(raw) ? String(raw[0] ?? '').trim() : String(raw).trim()
    if (!s) return null
    const dt = new Date(s)
    if (Number.isNaN(dt.getTime())) return s.length <= 32 ? s : `${s.slice(0, 32)}…`
    return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  }

  const signedDate = formatSignatureDate(signedAt)
  const managerSignedDate = formatSignatureDate(managerSignedAt)

  const managerSig = String(managerSignedBy || '').trim()
  const managerImg = String(managerSignatureImageUrl || '').trim()

  return (
    <div
      className={
        printMode
          ? 'bg-white font-sans text-slate-900'
          : 'max-w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-6 shadow-sm sm:px-6 sm:py-8 md:px-10 md:py-10'
      }
      style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
    >
      {/* ── Title ── */}
      <div className="mb-8 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{COMPANY_NAME}</p>
        <h1 className="mt-2 text-xl font-black uppercase tracking-[0.08em] text-slate-900">
          Residential Lease Agreement
        </h1>
        <p className="mt-1 text-sm text-slate-500">State of Washington</p>
      </div>

      {/* ── Key terms summary ── */}
      <div className="mb-8 rounded-2xl border border-slate-200 bg-slate-50/80 px-5 py-5">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Agreement Summary</p>
        <div className="grid gap-x-8 gap-y-0.5 sm:grid-cols-2">
          <Row label="Agreement Date" value={d.agreementDate} />
          <Row label="Landlord" value={d.landlordName || LANDLORD_NAME} />
          <Row label="Tenant" value={d.tenantName} />
          {d.cosignerName ? <Row label="Co-Signer" value={d.cosignerName} /> : null}
          <Row label="Property" value={d.fullAddress} />
          <Row label="Room / Unit" value={d.roomLabel || d.roomNumber} />
          <Row label="Lease Start" value={d.leaseStartFmt} />
          <Row label="Lease End" value={d.isMonthToMonth ? 'Month-to-Month' : d.leaseEndFmt} />
          <Row label="Monthly Rent" value={d.monthlyRentFmt} />
          {(d.utilityFee || 0) > 0 ? <Row label="Utilities Fee" value={d.utilityFeeFmt} /> : null}
          <Row label="Monthly Total" value={d.monthlyTotalFmt} />
          <Row label="Security Deposit" value={d.securityDepositFmt} />
          <Row
            label="Last Month's Rent (prepaid)"
            value={(d.lastMonthRent || 0) > 0 ? d.lastMonthRentFmt : 'Not collected at move-in'}
          />
          {(d.applicationFee || 0) > 0 ? <Row label="Application fee" value={d.applicationFeeFmt} /> : null}
          {(d.moveInFee || 0) > 0 ? <Row label="Move-in fee" value={d.moveInFeeFmt} /> : null}
          {(d.adminFee || 0) > 0 ? <Row label="Administrative fee" value={d.adminFeeFmt} /> : null}
          {d.proratedDays > 0 ? (
            <>
              <Row label={`Prorated Rent (${d.proratedDays} days)`} value={d.proratedRentFmt} />
              {(d.proratedUtility || 0) > 0 ? <Row label="Prorated Utilities" value={d.proratedUtilityFmt} /> : null}
            </>
          ) : null}
          <Row label="Total Move-In" value={d.totalMoveInFmt} />
        </div>
      </div>

      <FeeScheduleBlock leaseData={d} />

      <div className="divide-y divide-slate-100">

        {/* 1 */}
        <Section number="1" title="Parties and Premises">
          <P>
            This Residential Lease Agreement ("Agreement") is entered into as of {d.agreementDate || '___________'} between
            <strong> {d.landlordName || LANDLORD_NAME}</strong> ("Landlord"), with a mailing address of {d.landlordAddress || LANDLORD_ADDRESS},
            and <strong>{d.tenantName || '___________'}</strong> ("Resident").
            {d.cosignerName ? ` ${d.cosignerName} is listed as co-signer and is jointly and severally liable for all obligations under this Agreement.` : ''}
          </P>
          <P>
            Landlord hereby leases to Resident, and Resident hereby leases from Landlord, the private room identified as
            <strong> {d.roomLabel || `Room ${d.roomNumber || '___________'}`}</strong> located at <strong>{d.fullAddress || '___________'}</strong>
            (&quot;Premises&quot;). Resident shall have access to all common areas of the dwelling as a shared co-tenant.
          </P>
          <P>
            <strong>1.1 Delivery of possession.</strong> Landlord shall use commercially reasonable efforts to deliver
            possession of the Premises on the lease commencement date. If possession cannot be delivered on that date due
            to events beyond Landlord&apos;s reasonable control (including holdover by a prior occupant, casualty, or
            government order), the lease start date shall be postponed until possession is available, rent shall abate until
            possession is delivered, and neither party shall be liable to the other for delay except that Resident may
            terminate this Agreement by written notice if possession is not delivered within fourteen (14) calendar days
            after the originally scheduled start date, in which case any prepaid rent and deposit shall be refunded as
            required by law.
          </P>
          <P>
            <strong>1.2 Municipal compliance.</strong> This Agreement shall be interpreted consistently with the Washington
            Residential Landlord-Tenant Act (RCW Chapter 59.18). If the Premises are located within the City of Seattle, the
            parties agree that applicable Seattle rental regulations (including notice, just-cause, relocation, or
            habitability rules) shall apply to the minimum extent required by law.
          </P>
        </Section>

        {/* 2 */}
        <Section number="2" title="Lease Term">
          <P>
            This Agreement is for a {termDesc}.
            {d.isMonthToMonth
              ? ` Either party may terminate this Agreement by providing at least ${TERMINATION_NOTICE_DAYS} days' written notice prior to the end of a rental period, as required by RCW 59.18.200.`
              : ` At the expiration of the fixed term, this Agreement shall automatically convert to a month-to-month tenancy unless either party provides written notice of non-renewal at least ${TERMINATION_NOTICE_DAYS} days before the end of the term, or a new written agreement is signed.`}
          </P>
          <P>
            <strong>2.1 Early termination, mitigation, and lease-break costs.</strong> If Resident vacates before the end of the term without
            Landlord&apos;s prior written consent, Resident remains liable for <em>actual damages</em> permitted by Washington law and
            this Agreement — not for unlawful penalties. Landlord shall make reasonable, good-faith efforts to <strong>mitigate</strong> by
            re-renting the Premises at fair market terms. Resident&apos;s liability for unpaid <strong>base rent and utilities charges</strong>{' '}
            continues until the <strong>earlier of</strong> (a) the scheduled lease end date, or (b) the date a replacement tenant acceptable to
            Landlord (same or reasonably similar material terms) begins paying rent, <em>minus</em> any rent actually received from a
            replacement (rent differential after mitigation). Resident shall also pay <strong>reasonable, documented re-leasing costs</strong>{' '}
            (advertising, tenant screening, reasonable administrative processing) and <strong>reasonable documented turnover repairs</strong> beyond
            ordinary wear and tear, each itemized under RCW 59.18.280 principles where applicable to deposit accounting or as unpaid charges.
            Any stated lease-break fee must represent a reasonable estimate of actual administrative/turnover cost, not a penalty.
          </P>
        </Section>

        {/* 3 */}
        <Section number="3" title="Rent and Payment Terms">
          <P>
            {(d.utilityFee || 0) > 0 ? (
              <>
                Resident agrees to pay <strong>{d.monthlyRentFmt || '$0.00'}</strong> per month as base rent, plus a
                monthly utilities fee of <strong>{d.utilityFeeFmt || '$0.00'}</strong>, for a combined monthly total of{' '}
                <strong>{d.monthlyTotalFmt || '$0.00'}</strong>. Rent is due on the 1st day of each calendar month.
              </>
            ) : (
              <>
                Resident agrees to pay <strong>{d.monthlyRentFmt || '$0.00'}</strong> per month as base rent (utilities
                included in rent unless a separate utilities charge is listed in the Agreement Summary). Rent is due on
                the 1st day of each calendar month.
              </>
            )}
          </P>
          <P>
            Rent shall be paid by ACH bank transfer, Zelle, Venmo, or another method approved in writing by Landlord.
            Cash payments are not accepted.
          </P>
          <P>
            If rent is not received by the {LATE_GRACE_DAYS}th day of the month, a late fee of{' '}
            <strong>{LATE_FEE}</strong> shall be assessed. The late fee is agreed in writing as permitted by RCW 59.18.140
            and shall not be assessed unless the fee amount and trigger date are stated in this Agreement. Acceptance of a
            late payment does not waive Landlord&apos;s right to assess future late fees or pursue other remedies.
          </P>
          <P>
            <strong>3.1 Application of payments.</strong> Unless otherwise required by law, any payment from Resident shall
            be applied in the following order: (a) amounts owed for damage to the Premises or common areas beyond ordinary
            wear and tear; (b) unpaid allocated utilities, utility fees, or similar charges; (c) late fees, NSF fees, and
            other lawful charges; (d) past-due rent, oldest invoice first; (e) current month&apos;s rent.
          </P>
          <P>
            <strong>3.2 Returned payments and NSF.</strong> If any check, ACH debit, or electronic payment is dishonored,
            reversed, or returned unpaid, Resident shall immediately pay the original amount plus Landlord&apos;s actual bank or
            processing fees and a reasonable returned-payment fee not to exceed the maximum allowed under RCW 62A.3-421 or
            other applicable law, whichever is lower. Repeated returned payments may cause Landlord to require certified funds
            or another payment method.
          </P>
          <P>
            <strong>3.3 Utility billing and allocation.</strong> Where Resident owes a monthly utilities fee or allocated
            utility charges, such amounts are due on the same date as rent unless otherwise stated in writing. Failure to pay
            allocated utilities when due constitutes a monetary default subject to the same notice and cure procedures as
            rent to the extent allowed by Washington law.
          </P>
          {d.proratedDays > 0 ? (
            <P>
              {(d.proratedUtility || 0) > 0 ? (
                <>
                  For the first partial month, Resident shall pay a prorated rent of <strong>{d.proratedRentFmt}</strong>{' '}
                  and a prorated utilities fee of <strong>{d.proratedUtilityFmt}</strong>, covering {d.proratedDays} days
                  ({d.leaseStartFmt} through end of month).
                </>
              ) : (
                <>
                  For the first partial month, Resident shall pay a prorated rent of <strong>{d.proratedRentFmt}</strong>,
                  covering {d.proratedDays} days ({d.leaseStartFmt} through end of month).
                </>
              )}
            </P>
          ) : null}
          <P>
            <strong>Prepaid / last month&apos;s rent:</strong> Unless a separate amount for last month&apos;s rent or other
            prepaid rent is stated in the Agreement Summary above, none is required at move-in. Any amount collected and
            identified as prepaid rent for the final rental period is not a security deposit under RCW 59.18.260 unless
            expressly designated as such in writing at collection, and shall be applied only to rent for the final month
            of tenancy after proper termination notice, subject to Washington law.
          </P>
          {(d.adminFee || 0) > 0 ? (
            <P>
              <strong>3.4 Administrative or screening fees.</strong> If an administrative fee or application-related fee is
              listed in the Agreement Summary, Resident acknowledges it was disclosed before payment and represents
              Landlord&apos;s reasonable actual costs to the extent permitted by law; such fees are not part of the security
              deposit unless expressly labeled as deposit.
            </P>
          ) : null}
          <P>
            <strong>3.5 Statutory notices and pass-through costs.</strong> If Washington law permits recovery of specific statutory
            notice preparation, filing, or service costs in connection with a lawful remedy, Resident shall pay only those
            amounts actually incurred and permitted by statute, with documentation upon request. No fee shall be assessed that
            is prohibited as a penalty or unconscionable charge under RCW Chapter 59.18 or related law.
          </P>
        </Section>

        {/* 4 */}
        <Section number="4" title="Security Deposit">
          <P>
            Resident shall pay a security deposit of <strong>{d.securityDepositFmt || '$0.00'}</strong> prior to or upon move-in.
            {(d.adminFee || 0) > 0 ? (
              <>
                {' '}
                Separately, an administrative fee of <strong>{d.adminFeeFmt || '$0.00'}</strong> is due prior to or upon move-in; it
                is not part of the security deposit and is not held as a deposit under RCW 59.18.260.
              </>
            ) : null}{' '}
            The security deposit shall be held in accordance with RCW 59.18.260. Landlord shall provide a written receipt
            and identify the financial institution where the deposit is held.
          </P>
          <P>
            The deposit may be applied to unpaid rent, damages beyond normal wear and tear, cleaning costs, and any other
            amounts owed under this Agreement. Within 21 days of Resident's departure, Landlord shall return the deposit
            or provide a written itemized statement of deductions, as required by RCW 59.18.280.
          </P>
          <P>
            <strong>4.1 Move-in condition and checklist (Property Condition Addendum).</strong> Landlord and Resident shall complete a
            written <strong>move-in inspection checklist</strong> describing the condition of the Premises and any furnishings (the
            Property Condition Addendum). Resident shall return a signed checklist to Landlord within <strong>fourteen (14) calendar days</strong>{' '}
            after obtaining possession (or complete a joint walkthrough on a mutually agreed date within that window). The
            checklist, together with dated photographs or short videos reasonably taken at move-in, establishes the baseline for
            determining whether deposit deductions at move-out reflect damage or uncleanliness <strong>beyond documented move-in
            condition</strong>, consistent with RCW 59.18.260 and RCW 59.18.280. If Resident fails to return the checklist, Landlord may
            document condition in good faith and provide a copy; failure to document pre-existing conditions does not authorize
            deductions for conditions Landlord knew or should have known existed at move-in.
          </P>
          <P>
            <strong>4.2 Forwarding address.</strong> Upon vacating, Resident shall provide Landlord in writing a valid
            forwarding address where deposit accounting and refund may be sent. Failure to provide a forwarding address does
            not relieve Landlord of the obligation to comply with RCW 59.18.280, but Resident bears the risk of misdelivery if
            the address is incomplete or inaccurate.
          </P>
          <P>
            <strong>4.3 Itemized deductions.</strong> Any deduction from the deposit shall be listed in writing with a
            plain-language description of each charge and supporting documentation where reasonably available. Deductions may
            not include ordinary wear and tear consistent with RCW 59.18.260.
          </P>
          <P>
            <strong>4.4 Deposit deduction categories and cleaning standards.</strong> Deductions may include only lawful categories,
            including: unpaid rent or other charges expressly permitted under this Agreement; damage to the Premises or
            Landlord-owned furnishings <strong>beyond ordinary wear and tear</strong>; reasonable cleaning charges to restore the private
            room to a <strong>rent-ready, professionally clean</strong> standard if left with unreasonable dirt, debris, stains, or odors;
            carpet or upholstery cleaning only for <strong>tenant-caused</strong> staining or damage (not normal traffic wear); lost keys,
            fobs, or access devices at documented replacement cost; pest remediation attributable to Resident&apos;s conduct or
            neglect after notice. Hourly repair labor shall be billed at Landlord&apos;s <strong>documented</strong> reasonable internal rate or
            vendor invoice, not to exceed prevailing market rates for comparable work. For single-line items over{' '}
            <strong>$250</strong>, Landlord shall provide an estimate or invoice where practicable before withholding from deposit when timing
            allows under RCW 59.18.280.
          </P>
        </Section>

        {/* 5 */}
        <Section number="5" title="Utilities and Services Included">
          {(d.utilityFee || 0) > 0 ? (
            <P>
              The monthly utilities fee of <strong>{d.utilityFeeFmt || '$0.00'}</strong> covers the Resident&apos;s
              proportionate share of electricity, gas, water, sewer, and garbage collection, as well as high-speed
              internet (Wi-Fi). Landlord shall maintain all utility accounts in Landlord&apos;s name. Resident agrees not
              to add or change any utilities without prior written consent of Landlord.
            </P>
          ) : (
            <P>
              Base rent includes the household utility arrangement described at move-in and in any property-specific
              addenda. Landlord shall maintain shared utility accounts unless otherwise agreed in writing. Resident agrees
              not to add or change any utilities without prior written consent of Landlord.
            </P>
          )}
          <P>
            <strong>5.1 Utility transfer.</strong> If Landlord ever requires a specific utility account to be transferred to
            Resident&apos;s name (for example, for a separately metered service), Resident shall establish service within three
            (3) business days of written notice and shall not allow termination for non-payment that affects habitability of
            other residents.
          </P>
          <P>
            <strong>5.2 Non-payment of allocated utilities.</strong> Allocated charges shown on a written ledger or invoice
            are due by the date stated on the invoice or, if none, with the next rent installment. Continued non-payment after
            written notice may be treated as a material default to the extent permitted by RCW Chapter 59.18.
          </P>
          <P>
            <strong>5.3 Adjustment of utilities fee or allocation.</strong> If Resident pays a recurring utilities or household-services
            component, Landlord may change the amount or allocation method with at least <strong>thirty (30) days&apos; prior written notice</strong>,
            except where a shorter period is required by law or an emergency tariff increase. If a proposed change is not
            permitted by law or is rejected by Resident, Resident&apos;s exclusive remedy is to terminate the tenancy with notice
            required by RCW 59.18.200 (where applicable) or as otherwise required by law — not to withhold rent without a lawful
            defense.
          </P>
          <P>
            Resident is responsible for personal streaming services, phone plans, and any other personal communications
            services not explicitly listed above.
          </P>
          {d.roomUtilitiesSummary ? (
            <P>
              Property-specific utilities note: <strong>{d.roomUtilitiesSummary}</strong>
            </P>
          ) : null}
          {Array.isArray(d.amenities) && d.amenities.length > 0 ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 mt-3 mb-1">Community Amenities Included</p>
              <ul className="list-disc space-y-0.5 pl-6 text-sm text-slate-700">
                {d.amenities.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </>
          ) : null}
        </Section>

        {/* 6 */}
        <Section number="6" title="Occupancy and Permitted Use">
          {String(d.guestPolicy || '').trim() ? (
            <P>
              <strong>Property-specific guest policy.</strong> {String(d.guestPolicy).trim()}
            </P>
          ) : null}
          {String(d.additionalLeaseTerms || '').trim() ? (
            <P>
              <strong>Additional property-specific terms.</strong> {String(d.additionalLeaseTerms).trim()}
            </P>
          ) : null}
          <P>
            The Premises shall be occupied solely by <strong>{d.tenantName || '___________'}</strong> as a private residence.
            Resident shall not permit any other person to occupy the Premises as a primary residence without the prior written
            consent of Landlord. Guests staying more than 7 consecutive nights or more than 14 nights in any 30-day period
            require written approval.
          </P>
          <P>
            <strong>6.1 Guest policy enforcement.</strong> A guest who exceeds the limits above without approval may be
            treated as an unauthorized occupant. Landlord may require removal of the guest or, if the guest remains after
            written notice, pursue remedies for breach consistent with RCW Chapter 59.18.
          </P>
          <P>
            The Premises shall be used solely for lawful residential purposes consistent with a shared co-living household.
            Resident shall not use the Premises or common areas for any commercial, business, or income-generating activity
            without Landlord's prior written consent.
          </P>
        </Section>

        {/* 7 */}
        <Section number="7" title="Shared Spaces and House Rules">
          {String(d.houseRules || '').trim() ? (
            <P>
              <strong>Property-specific house rules.</strong> {String(d.houseRules).trim()}
            </P>
          ) : null}
          {d.bathroomNote ? (
            <P>
              <strong>Bathroom Assignment:</strong> {d.bathroomNote}
            </P>
          ) : null}
          <P>
            Resident shall share common areas — including kitchen, living room, bathrooms, laundry, and outdoor spaces —
            with other residents of the dwelling in a respectful and cooperative manner. Resident agrees to:
          </P>
          <ul className="list-disc space-y-1 pl-6 text-sm text-slate-700">
            <li>Clean up after themselves in all shared spaces promptly after each use.</li>
            <li>Keep personal items in their private room or designated storage areas only.</li>
            <li>Maintain reasonable quiet hours between 10:00 PM and 8:00 AM on weekdays and midnight to 9:00 AM on weekends.</li>
            <li>Not hold gatherings of more than 4 guests without prior notice to Landlord.</li>
            <li>Dispose of trash and recycling in the designated containers on the scheduled collection days.</li>
            <li>Not leave food unsecured in common areas in a manner that may attract pests.</li>
            <li>Report maintenance issues, leaks, or safety hazards to Landlord promptly.</li>
          </ul>
          <P>
            Failure to comply with house rules after a written warning constitutes grounds for termination of this Agreement
            pursuant to RCW 59.18.180.
          </P>
        </Section>

        {/* 8 */}
        <Section number="8" title="Furnishings and Personal Property">
          <P>
            The Premises and common areas may be provided with furniture and furnishings owned by Landlord. Resident shall
            care for all Landlord-owned furnishings in good condition and shall be liable for damage beyond normal wear and
            tear. Resident shall not remove Landlord-owned furnishings from the Premises.
          </P>
          {d.roomFurnished ? (
            <P>
              Furnished status for this room: <strong>{d.roomFurnished}</strong>
            </P>
          ) : null}
          {d.roomFurnitureIncluded ? (
            <P>
              Furniture included for this room: <strong>{d.roomFurnitureIncluded}</strong>
            </P>
          ) : null}
          <P>
            Landlord is not responsible for the loss, theft, or damage to Resident's personal property. Resident is strongly
            encouraged to obtain renters' insurance to protect personal belongings.
          </P>
          <P>
            <strong>8.1 Limitation of landlord liability.</strong> Except for damages arising from Landlord&apos;s gross negligence
            or willful misconduct, or as otherwise required by RCW Chapter 59.18, Landlord&apos;s aggregate liability for any
            claim arising from this tenancy shall not exceed the amount of rent actually paid by Resident during the twelve
            (12) months preceding the claim. Landlord shall not be liable for interruption of utilities caused by utility
            companies, weather, or other events outside Landlord&apos;s reasonable control after Landlord has made good-faith
            efforts to restore service.
          </P>
          <P>
            <strong>8.2 Indemnification.</strong> Resident shall indemnify, defend, and hold harmless Landlord and Landlord&apos;s
            agents from claims, losses, and reasonable attorneys&apos; fees arising from Resident&apos;s or Resident&apos;s guests&apos;
            negligence, intentional misconduct, illegal activity, or breach of this Agreement, except to the extent caused by
            Landlord&apos;s negligence or willful misconduct.
          </P>
          <P>
            <strong>8.3 Personal safety; crime; third parties.</strong> Landlord does not warrant or guarantee the security of persons or
            property. Resident acknowledges that criminal or harmful conduct may occur without Landlord&apos;s knowledge or control.
            Except as required by RCW Chapter 59.18 or other mandatory law, Landlord shall not be liable for injury or loss caused
            by third parties, other residents, or guests. Resident is encouraged to secure valuables, lock doors, and maintain
            renters insurance with liability coverage.
          </P>
        </Section>

        {/* 9 */}
        <Section number="9" title="Maintenance and Repairs">
          <P>
            Landlord shall maintain the Premises and common areas in a habitable condition in compliance with applicable
            housing codes and RCW 59.18.060, including maintaining structural components, heating systems, hot and cold
            running water, plumbing, water supply and drainage, sewer connections, and weatherproofing.
          </P>
          <P>
            <strong>Plumbing, water, and drains:</strong> Resident shall immediately notify Landlord of any leak, drip,
            standing water, sewage odor, backup, or loss of water pressure. Resident shall not pour grease, oil, paint,
            harsh chemicals, or foreign objects into sinks, toilets, or drains. In a burst pipe or uncontrolled water
            leak, Resident shall shut off the nearest fixture valve if safe to do so and contact Landlord without delay.
          </P>
          <P>
            After written notice of a defect that materially and adversely affects health or safety, Landlord shall
            commence remedial efforts within the timeframes and procedures required by RCW 59.18.070 where applicable.
            For emergencies threatening life or major property damage (including fire, gas odor, or major flooding),
            Resident shall call 911 when appropriate and notify Landlord as soon as practicable.
          </P>
          <P>
            Resident shall keep the private room and any areas under Resident's control in a clean and sanitary condition.
            Resident shall promptly notify Landlord in writing of any damage, defect, or maintenance need (email or text
            to the management number on file is acceptable for urgent matters, followed by written confirmation if
            requested). Resident shall not perform any repairs or alterations without Landlord's prior written approval.
            Resident shall be liable for damage caused by Resident's negligence or intentional acts.
          </P>
          <P>
            <strong>9.1 Smoke detection devices (RCW 43.44.110).</strong> Landlord certifies that the dwelling is equipped
            with smoke detection devices as required by RCW 43.44.110. Resident shall not remove or disable smoke alarms.
            Resident shall test devices as directed by the manufacturer, replace batteries or power sources as required, and
            promptly notify Landlord of any malfunction.
          </P>
          <P>
            <strong>9.2 Carbon monoxide alarms (RCW 19.27.530).</strong> Where required by RCW 19.27.530 and applicable
            building codes for the dwelling type, Landlord shall provide approved carbon monoxide alarms in required
            locations. Resident shall not remove or disable CO alarms, shall test as directed, and shall report malfunctions
            promptly.
          </P>
          <P>
            <strong>9.3 Domestic hot water temperature.</strong> Landlord shall maintain the domestic hot water system so that
            water delivered at fixtures is not scalding, consistent with applicable Washington State codes (including
            tempering or limiting settings where required, commonly not to exceed approximately 120°F at the tank or as
            directed by code). Resident shall not alter water heater thermostats, mixing valves, or tempering devices without
            written permission.
          </P>
          <P>
            <strong>9.4 Fire safety and egress.</strong> Resident shall keep all means of egress clear, shall not disable or prop open
            self-closing doors on fire-rated paths, shall not use barbecues or open flames indoors or on balconies except as
            law and Landlord permit, and shall follow building fire-safety notices posted by Landlord or required by code.
          </P>
        </Section>

        {/* 10 */}
        <Section number="10" title="Entry by Landlord">
          <P>
            For non-emergency entry to the Resident&apos;s private room (including inspections, repairs, or showings),
            Landlord shall provide at least <strong>{LANDLORD_ENTRY_NOTICE_HOURS} hours&apos;</strong> written notice,
            consistent with RCW 59.18.150. In an emergency (including imminent threat to life, health, safety, or
            property), Landlord may enter the private room without prior notice when reasonably necessary.
            Landlord retains the right to enter common areas at any time for legitimate purposes without prior notice.
          </P>
          <P>
            <strong>Keys and access devices:</strong> Resident shall safeguard all keys, fobs, and codes. Lost or
            unreturned keys or fobs may be replaced or re-keyed at Resident&apos;s expense for Landlord&apos;s reasonable
            actual cost, not to exceed the documented invoice from a licensed locksmith or vendor where applicable.
          </P>
          <P>
            <strong>10.1 Lockouts and self-help prohibited.</strong> Landlord shall not exclude Resident from the Premises,
            change locks, or interrupt utilities for the purpose of evicting Resident without a court order, except as
            expressly permitted for emergency repairs or lawful lock changes that provide Resident immediate replacement keys
            at no charge if Landlord caused the lockout in error. If Resident is locked out due to lost keys, Landlord may
            charge a reasonable after-hours access fee consistent with actual cost.
          </P>
        </Section>

        {/* 11 */}
        <Section number="11" title="Pets and Smoking Policy">
          <P>
            <strong>Pets:</strong> No pets are permitted on the Premises without prior written consent of Landlord.
            Approved pets may require an additional pet deposit. Resident is liable for any damage caused by a pet.
          </P>
          <P>
            <strong>Smoking:</strong> Smoking, vaping, or use of any tobacco or cannabis products is strictly prohibited
            inside the dwelling, including the private room and all common areas. Smoking is only permitted in designated
            outdoor areas, if any, as designated by Landlord.
          </P>
        </Section>

        {/* 12 */}
        <Section number="12" title="Subletting and Assignment">
          <P>
            Resident shall not sublet, assign, or transfer any interest in this Agreement or the Premises without the prior
            written consent of Landlord. Any unauthorized subletting shall constitute a material breach of this Agreement.
          </P>
        </Section>

        {/* 13 */}
        <Section number="13" title="Alterations and Improvements">
          <P>
            Resident shall not make any alterations, installations, or improvements to the Premises — including painting,
            drilling, or mounting of fixtures — without the prior written consent of Landlord. Any approved alterations
            shall become part of the Premises and property of Landlord upon Resident's departure, unless Landlord directs
            restoration at Resident's expense.
          </P>
        </Section>

        {/* 14 */}
        <Section number="14" title="Move-Out and Surrender of Premises">
          <P>
            Upon termination of this Agreement, Resident shall vacate the Premises, remove all personal property, and
            return the Premises in substantially the same condition as received, allowing for normal wear and tear.
            Resident shall return all keys, access fobs, and parking passes to Landlord.
          </P>
          <P>
            <strong>14.1 Cleaning at move-out.</strong> Resident shall leave the private room broom-clean and free of trash
            and personal property. If professional cleaning of the private room is required due to unreasonable dirt,
            debris, stains, or odors beyond ordinary wear and tear, Landlord may deduct the reasonable cost from the deposit
            with itemization. If the property&apos;s standard includes recurring professional cleaning of common areas, Resident
            remains responsible for Resident&apos;s proportionate share through the vacate date as stated in the Agreement
            Summary or house rules.
          </P>
          <P>
            <strong>14.2 Abandoned personal property (RCW 59.18.310).</strong> Personal property left in the Premises after
            vacating may be stored and disposed of in accordance with RCW 59.18.310 and related Washington law, including
            written notice to Resident at the last known address, reasonable storage, sale or donation, and application of
            proceeds to storage and removal costs.
          </P>
          <P>
            If Resident breaks the lease prior to the end of the fixed term without Landlord&apos;s written consent, Resident
            shall be liable for <em>actual damages</em> and unpaid obligations permitted by Washington law only, including
            unpaid rent through the earlier of the end of the lease term or the date a replacement tenant acceptable to
            Landlord begins paying rent, subject to Landlord&apos;s duty to mitigate. Resident shall also pay reasonable,
            documented re-leasing costs to the extent allowed by law
            {(d.breakLeaseFeeAmount || 0) > 0 && d.breakLeaseFee ? (
              <>
                . In addition, the parties agree to a stated lease-break fee of <strong>{d.breakLeaseFee}</strong> only if that
                fee represents a reasonable estimate of actual administrative and turnover costs and is not an unlawful penalty.
              </>
            ) : (
              <>.</>
            )}{' '}
            No other &quot;penalty&quot; for early termination shall apply except as permitted by RCW Chapter 59.18.
          </P>
        </Section>

        {/* 15 */}
        <Section number="15" title="Default and Landlord Remedies">
          <P>
            If Resident fails to pay rent when due or violates any material term of this Agreement, Landlord may serve
            written notices to pay or comply and vacate using the forms and notice periods required by Washington law,
            including RCW 59.12 and RCW Chapter 59.18 (which may include, for certain rental defaults, a notice period of
            not less than fourteen (14) calendar days where applicable, or other periods for different breaches or tenancy
            types). Following expiration of any required cure period without cure, Landlord may pursue unlawful detainer
            (eviction) in King County District Court or other court of competent jurisdiction consistent with Washington
            procedure.
          </P>
          <P>
            <strong>15.1 Non-waiver.</strong> Landlord&apos;s acceptance of partial or late rent, or Landlord&apos;s failure to object
            to a particular breach, does not waive Landlord&apos;s right to insist on strict performance thereafter, to collect all
            sums owing, or to terminate the tenancy as permitted after proper notice. Any waiver must be in writing signed by
            Landlord.
          </P>
        </Section>

        {/* 16 */}
        <Section number="16" title="Quiet Enjoyment">
          <P>
            Provided Resident complies with all terms of this Agreement, Landlord covenants that Resident shall have quiet
            enjoyment of the private room without interference by Landlord, except as otherwise permitted by this Agreement
            or applicable law.
          </P>
        </Section>

        {/* 17 */}
        <Section number="17" title="General Provisions">
          <P>
            <strong>17.1 Severability.</strong> If any provision of this Agreement is held invalid or unenforceable, the
            remainder shall remain in full force and effect, and the parties request that any court reform the invalid
            provision to the minimum extent necessary to achieve substantially the same lawful effect.
          </P>
          <P>
            <strong>17.2 Lead-based paint disclosure (pre-1978 housing).</strong> If any residential structure on the property
            was built before January 1, 1978, Landlord has provided Resident with the EPA pamphlet &quot;Protect Your Family from
            Lead in Your Home&quot; and any disclosure required under 42 U.S.C. 4852d and 40 C.F.R. Part 745 (Residential Lead-Based
            Paint Hazard Reduction Act). Resident acknowledges receipt of the pamphlet and any completed disclosure form prior
            to signing this Agreement. If the dwelling was constructed in 1978 or later, this subsection does not apply.
          </P>
          <P>
            <strong>17.3 Attorney fees.</strong> In any action to interpret or enforce this Agreement, recover possession, or
            collect sums lawfully owing after default, the <strong>prevailing party</strong> may recover reasonable attorneys&apos; fees and court
            costs <strong>only if and to the extent</strong> authorized by RCW 59.18.290, other applicable Washington statutes, or court rule.
            Nothing herein guarantees fee recovery in any particular dispute.
          </P>
          <P>
            Landlord&apos;s failure to enforce any provision on a particular occasion shall not waive the right to enforce that
            provision on a later occasion, except as stated in Section 15.1. This Agreement may not be amended except by a
            written instrument signed by both parties.
          </P>
          <P>
            All notices required or permitted under this Agreement shall be in writing and delivered by hand, first-class
            mail, or email (with confirmation of receipt) to the addresses of record.
          </P>
        </Section>

        {/* 18 */}
        <Section number="18" title="Governing Law">
          <P>
            This Agreement shall be governed by the laws of the State of Washington, including the Washington Residential
            Landlord-Tenant Act (RCW Chapter 59.18). Venue for any legal action arising from this Agreement shall lie in the
            courts of King County, Washington, and Resident consents to personal jurisdiction there, unless another venue is
            required by mandatory law based on where the Premises are located.
          </P>
          <P>
            <strong>18.1 Local ordinances.</strong> If the Premises are within the City of Seattle (or any other jurisdiction
            with rental housing ordinances), any conflicting term of this Agreement shall give way to mandatory local law only
            to the extent required.
          </P>
        </Section>

        {/* 19 */}
        <Section number="19" title="Entire Agreement">
          <P>
            This Agreement, together with any addenda attached hereto, constitutes the entire agreement between the parties
            with respect to the Premises and supersedes all prior negotiations, representations, or agreements, whether
            written or oral.
          </P>
        </Section>

        {/* Part II — Addenda (incorporated) */}
        <div className="mb-8 mt-10 border-t-2 border-slate-800 pt-8">
          <h2 className="mb-1 text-center text-[13px] font-black uppercase tracking-[0.14em] text-slate-900">
            Part II — Addenda
          </h2>
          <P>
            The following addenda are <strong>incorporated by reference</strong> into Part I and have the same force and effect as the
            numbered sections above. If a term in an addendum conflicts with a statutory requirement, the statute controls.
          </P>

          <h3 className="mb-2 mt-6 text-[12px] font-black uppercase tracking-[0.1em] text-slate-800">Addendum A — Property condition baseline</h3>
          <P>
            Reinforces Section 4.1: the signed checklist and dated media establish the lawful baseline for deposit disputes. Resident
            shall not alter or damage smoke or CO pathways when hanging décor.
          </P>

          <h3 className="mb-2 mt-5 text-[12px] font-black uppercase tracking-[0.1em] text-slate-800">Addendum B — Bed bugs and cooperation</h3>
          <P>
            Resident shall report suspected bed-bug activity immediately in writing. Resident shall cooperate with inspection and
            certified treatment protocols (including preparation steps, bagging laundry, and access). If an infestation is
            reasonably attributable to Resident&apos;s conduct, guests, or failure to follow prevention steps after written notice,
            Resident shall pay <strong>reasonable, documented</strong> treatment costs to the extent permitted by law, in addition to other
            remedies.
          </P>

          <h3 className="mb-2 mt-5 text-[12px] font-black uppercase tracking-[0.1em] text-slate-800">Addendum C — Mold, moisture, and ventilation</h3>
          <P>
            Resident shall use bathroom/kitchen ventilation when cooking or showering, wipe standing condensation, keep textiles and
            furniture off damp surfaces, and report leaks or mold conditions within twenty-four (24) hours. Resident shall not paint
            over or conceal mold. Landlord shall respond to building-system leaks and concealed moisture in a manner consistent with
            RCW 59.18.070 where applicable.
          </P>

          <h3 className="mb-2 mt-5 text-[12px] font-black uppercase tracking-[0.1em] text-slate-800">Addendum D — Extended tenant maintenance</h3>
          <P>
            Resident shall replace HVAC filters on schedule provided by Landlord (or at least every ninety (90) days if disposable
            1&quot; filters); keep refrigerator coils reasonably dust-free; run garbage disposals only with cold water and avoid fibrous
            or starchy bulk; clear hair from accessible drain stoppers; report running toilets promptly; and comply with recycling
            and compost rules posted for the household.
          </P>

          <h3 className="mb-2 mt-5 text-[12px] font-black uppercase tracking-[0.1em] text-slate-800">Addendum E — Rules and nuisance enforcement</h3>
          <P>
            Violations of quiet hours, harassment, illegal substances where prohibited, or repeated unreasonable noise may result in
            written cure notices and, if not cured, termination procedures permitted by RCW 59.18.180 after proper notice. Other
            residents&apos; breach does not excuse Resident&apos;s performance unless Landlord fails to enforce material rules after
            documented written notice where Landlord has legal authority to cure the third-party conduct.
          </P>

          {String(d.propertyLeaseInformation || '').trim() ? (
            <>
              <h3 className="mb-2 mt-5 text-[12px] font-black uppercase tracking-[0.1em] text-slate-800">
                Addendum F — Property-specific lease information
              </h3>
              <P>
                <span className="whitespace-pre-wrap">{String(d.propertyLeaseInformation).trim()}</span>
              </P>
            </>
          ) : null}
        </div>

        {/* 20 — Signatures */}
        <div className="pt-6">
          <h3 className="mb-4 text-[13px] font-black uppercase tracking-[0.12em] text-slate-800">20. Signatures</h3>
          <P>
            By signing below, the parties agree to all terms and conditions of this Residential Lease Agreement.
          </P>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {/* Landlord */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-5 py-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Landlord / Manager</p>
              {managerSig || managerImg ? (
                <>
                  {managerImg ? (
                    <div className="flex min-h-10 items-end border-b border-emerald-300 pb-1">
                      <img
                        src={managerImg}
                        alt=""
                        className="max-h-20 max-w-full object-contain object-left-bottom"
                      />
                    </div>
                  ) : (
                    <div className="flex h-10 items-end border-b border-emerald-300 pb-1">
                      <span className="font-serif text-lg italic text-slate-900">{managerSig}</span>
                    </div>
                  )}
                  <p className="mt-1 text-xs text-slate-500">Signature</p>
                  <p className="mt-4 text-sm font-semibold text-slate-800">{d.landlordName || LANDLORD_NAME}</p>
                  <p className="text-xs text-slate-500">Printed Name</p>
                  <p className="mt-3 text-xs text-slate-500">Date: {managerSignedDate || d.agreementDate || '___________'}</p>
                  <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-800">
                    Manager signed{managerSignedDate ? ` — ${managerSignedDate}` : ''}
                  </p>
                </>
              ) : (
                <>
                  <div className="h-10 border-b border-slate-300" />
                  <p className="mt-1 text-xs text-slate-500">Signature</p>
                  <p className="mt-4 text-sm font-semibold text-slate-800">{d.landlordName || LANDLORD_NAME}</p>
                  <p className="text-xs text-slate-500">Printed Name</p>
                  <p className="mt-3 text-xs text-slate-500">Date: {d.agreementDate || '___________'}</p>
                </>
              )}
            </div>

            {/* Resident */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-5 py-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Resident</p>
              {signedBy ? (
                <>
                  <div className="flex h-10 items-end border-b border-emerald-300 pb-1">
                    <span className="font-serif text-lg italic text-slate-900">{signedBy}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Electronic Signature</p>
                  <p className="mt-4 text-sm font-semibold text-slate-800">{signedBy}</p>
                  <p className="text-xs text-slate-500">Printed Name</p>
                  <p className="mt-3 text-xs text-slate-500">Date: {signedDate || '___________'}</p>
                  <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
                    Electronically signed{signedDate ? ` — ${signedDate}` : ''}
                  </p>
                </>
              ) : (
                <>
                  <div className="h-10 border-b border-slate-300" />
                  <p className="mt-1 text-xs text-slate-500">Signature</p>
                  <p className="mt-4 text-sm font-semibold text-slate-800">
                    {d.tenantName || '___________'}
                  </p>
                  <p className="text-xs text-slate-500">Printed Name</p>
                  <p className="mt-3 text-xs text-slate-500">Date: ___________</p>
                </>
              )}
            </div>
          </div>

          {d.cosignerName ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 px-5 py-4 sm:w-1/2">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Co-Signer</p>
              <div className="h-10 border-b border-slate-300" />
              <p className="mt-1 text-xs text-slate-500">Signature</p>
              <p className="mt-4 text-sm font-semibold text-slate-800">{d.cosignerName}</p>
              <p className="text-xs text-slate-500">Printed Name</p>
              <p className="mt-3 text-xs text-slate-500">Date: ___________</p>
            </div>
          ) : null}
        </div>

      </div>

      <p className="mt-8 text-center text-[10px] text-slate-400">
        {COMPANY_NAME} · {d.landlordAddress || LANDLORD_ADDRESS} · Generated {d.agreementDate}
      </p>
    </div>
  )
}
