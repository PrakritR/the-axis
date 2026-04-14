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
 *   printMode  - if true, uses a minimal white wrapper suitable for window.print()
 */

const LANDLORD_NAME = 'Prakrit Ramachandran'
const LANDLORD_ADDRESS = '4709 A 8th Ave N, Seattle, WA 98105'
const COMPANY_NAME = 'Axis Seattle Housing'
const LATE_FEE = '$75.00'
const LATE_GRACE_DAYS = 5
const NOTICE_DAYS = 20

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

export default function LeaseHTMLTemplate({ leaseData = {}, signedBy, signedAt, printMode = false }) {
  const d = leaseData

  const termDesc = d.isMonthToMonth
    ? `month-to-month commencing ${d.leaseStartFmt || '___________'}`
    : `fixed term from ${d.leaseStartFmt || '___________'} through ${d.leaseEndFmt || '___________'}`

  const signedDate = signedAt
    ? new Date(signedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : null

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
          <Row label="Utilities Fee" value={d.utilityFeeFmt} />
          <Row label="Monthly Total" value={d.monthlyTotalFmt} />
          <Row label="Security Deposit" value={d.securityDepositFmt} />
          <Row label="Admin Fee" value={d.adminFeeFmt} />
          {d.proratedDays > 0 ? (
            <>
              <Row label={`Prorated Rent (${d.proratedDays} days)`} value={d.proratedRentFmt} />
              <Row label="Prorated Utilities" value={d.proratedUtilityFmt} />
            </>
          ) : null}
          <Row label="Total Move-In" value={d.totalMoveInFmt} />
        </div>
      </div>

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
        </Section>

        {/* 2 */}
        <Section number="2" title="Lease Term">
          <P>
            This Agreement is for a {termDesc}.
            {d.isMonthToMonth
              ? ' Either party may terminate this Agreement by providing at least 20 days\' written notice prior to the end of a rental period, as required by RCW 59.18.200.'
              : ' At the expiration of the fixed term, this Agreement shall automatically convert to a month-to-month tenancy unless either party provides written notice of non-renewal at least 20 days before the end of the term, or a new written agreement is signed.'}
          </P>
        </Section>

        {/* 3 */}
        <Section number="3" title="Rent and Payment Terms">
          <P>
            Resident agrees to pay <strong>{d.monthlyRentFmt || '$0.00'}</strong> per month as base rent, plus a monthly
            utilities fee of <strong>{d.utilityFeeFmt || '$0.00'}</strong>, for a combined monthly total of{' '}
            <strong>{d.monthlyTotalFmt || '$0.00'}</strong>. Rent is due on the 1st day of each calendar month.
          </P>
          <P>
            Rent shall be paid by ACH bank transfer, Zelle, Venmo, or another method approved in writing by Landlord.
            Cash payments are not accepted.
          </P>
          <P>
            If rent is not received by the {LATE_GRACE_DAYS}th day of the month, a late fee of{' '}
            <strong>{LATE_FEE}</strong> shall be assessed. Acceptance of a late payment does not constitute a waiver of
            Landlord's right to assess future late fees or pursue any other remedy under this Agreement or Washington law.
          </P>
          {d.proratedDays > 0 ? (
            <P>
              For the first partial month, Resident shall pay a prorated rent of <strong>{d.proratedRentFmt}</strong> and
              a prorated utilities fee of <strong>{d.proratedUtilityFmt}</strong>, covering {d.proratedDays} days
              ({d.leaseStartFmt} through end of month).
            </P>
          ) : null}
        </Section>

        {/* 4 */}
        <Section number="4" title="Security Deposit">
          <P>
            Resident shall pay a security deposit of <strong>{d.securityDepositFmt || '$0.00'}</strong> prior to or upon move-in.
            The security deposit shall be held in accordance with RCW 59.18.260. Landlord shall provide a written receipt
            and identify the financial institution where the deposit is held.
          </P>
          <P>
            The deposit may be applied to unpaid rent, damages beyond normal wear and tear, cleaning costs, and any other
            amounts owed under this Agreement. Within 21 days of Resident's departure, Landlord shall return the deposit
            or provide a written itemized statement of deductions, as required by RCW 59.18.280.
          </P>
        </Section>

        {/* 5 */}
        <Section number="5" title="Utilities and Services Included">
          <P>
            The monthly utilities fee of <strong>{d.utilityFeeFmt || '$0.00'}</strong> covers the Resident's proportionate
            share of electricity, gas, water, sewer, and garbage collection, as well as high-speed internet (Wi-Fi).
            Landlord shall maintain all utility accounts in Landlord's name. Resident agrees not to add or change any
            utilities without prior written consent of Landlord.
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
          <P>
            The Premises shall be occupied solely by <strong>{d.tenantName || '___________'}</strong> as a private residence.
            Resident shall not permit any other person to occupy the Premises as a primary residence without the prior written
            consent of Landlord. Guests staying more than 7 consecutive nights or more than 14 nights in any 30-day period
            require written approval.
          </P>
          <P>
            The Premises shall be used solely for lawful residential purposes consistent with a shared co-living household.
            Resident shall not use the Premises or common areas for any commercial, business, or income-generating activity
            without Landlord's prior written consent.
          </P>
        </Section>

        {/* 7 */}
        <Section number="7" title="Shared Spaces and House Rules">
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
        </Section>

        {/* 9 */}
        <Section number="9" title="Maintenance and Repairs">
          <P>
            Landlord shall maintain the Premises and common areas in a habitable condition in compliance with applicable
            housing codes and RCW 59.18.060, including maintaining structural components, heating systems, plumbing, and
            weatherproofing.
          </P>
          <P>
            Resident shall keep the private room and any areas under Resident's control in a clean and sanitary condition.
            Resident shall promptly notify Landlord in writing of any damage, defect, or maintenance need. Resident shall
            not perform any repairs or alterations without Landlord's prior written approval. Resident shall be liable for
            damage caused by Resident's negligence or intentional acts.
          </P>
        </Section>

        {/* 10 */}
        <Section number="10" title="Entry by Landlord">
          <P>
            Landlord shall provide at least <strong>{NOTICE_DAYS} days'</strong> written notice before entering the private
            room for inspections, repairs, or showings, except in cases of emergency, as provided by RCW 59.18.150.
            Landlord retains the right to enter common areas at any time for legitimate purposes without prior notice.
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
            If Resident breaks the lease prior to the end of the fixed term without Landlord's written consent, Resident
            shall be liable for a lease-break fee of <strong>{d.breakLeaseFee || '$900.00'}</strong> and any unpaid rent
            through the earlier of the end of the lease term or the date a new qualified tenant takes possession.
          </P>
        </Section>

        {/* 15 */}
        <Section number="15" title="Default and Landlord Remedies">
          <P>
            If Resident fails to pay rent when due or violates any material term of this Agreement, Landlord may serve
            appropriate written notice as required by Washington law (RCW 59.12) and pursue unlawful detainer proceedings
            or other remedies available at law or in equity. Landlord's acceptance of partial rent does not waive Landlord's
            right to pursue collection of the full amount owed.
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
            If any provision of this Agreement is found to be unenforceable, the remaining provisions shall remain in full
            force and effect. Landlord's failure to enforce any provision shall not constitute a waiver of that provision.
            This Agreement may not be amended except by a written instrument signed by both parties.
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
            Landlord-Tenant Act (RCW Chapter 59.18). Any dispute arising out of this Agreement shall be resolved in
            King County, Washington.
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
              <div className="h-10 border-b border-slate-300" />
              <p className="mt-1 text-xs text-slate-500">Signature</p>
              <p className="mt-4 text-sm font-semibold text-slate-800">{d.landlordName || LANDLORD_NAME}</p>
              <p className="text-xs text-slate-500">Printed Name</p>
              <p className="mt-3 text-xs text-slate-500">Date: {d.agreementDate || '___________'}</p>
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
                    Electronically signed — {signedDate}
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
