/**
 * lease-html-document.js
 * Build HTML documents for lease PDF generation (rendered by Puppeteer).
 *
 * Exports:
 *   buildStructuredLeasePdfHtml(leaseData)  — primary: uses the structured leaseData object
 *   buildLeasePdfHtml({ title, subtitle, bodyText }) — legacy fallback: wraps plain text
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function e(text) { return escapeHtml(text) }

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '$0.00'
  const num = typeof n === 'string' ? parseFloat(n.replace(/[^0-9.-]/g, '')) : Number(n)
  if (isNaN(num)) return '$0.00'
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const LANDLORD_NAME    = 'Prakrit Ramachandran'
const LANDLORD_ADDRESS = '4709 A 8th Ave NE, Seattle, WA 98105'
const COMPANY_NAME     = 'Axis Seattle Housing'
const LATE_FEE                    = '$75.00'
const LATE_GRACE_DAYS             = 5
const TERMINATION_NOTICE_DAYS     = 20
const LANDLORD_ENTRY_NOTICE_HOURS = 24

// ── Shared CSS ────────────────────────────────────────────────────────────────

const PDF_CSS = `
  @page { margin: 0.65in 0.7in 0.65in 0.7in; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #0f172a;
    margin: 0;
    padding: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Title block ── */
  .title-block { text-align: center; margin-bottom: 22px; }
  .company-name {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #64748b;
    margin-bottom: 6px;
  }
  h1 {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 15pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 4px 0;
    color: #0f172a;
  }
  .state-line {
    font-size: 9.5pt;
    color: #64748b;
    font-style: italic;
  }

  /* ── Summary box ── */
  .summary-box {
    border: 1px solid #cbd5e1;
    background-color: #f8fafc;
    padding: 14px 16px;
    margin-bottom: 20px;
    border-radius: 3px;
  }
  .summary-label {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: #94a3b8;
    margin-bottom: 10px;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px 28px;
  }
  .summary-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 1.5px 0;
  }
  .summary-key {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #475569;
    min-width: 130px;
    flex-shrink: 0;
  }
  .summary-val {
    font-size: 10pt;
    font-weight: 600;
    color: #0f172a;
  }

  /* ── Sections ── */
  .sections { border-top: 2px solid #e2e8f0; }
  .section {
    border-bottom: 1px solid #e2e8f0;
    padding: 14px 0;
    page-break-inside: avoid;
  }
  .section:last-child { border-bottom: none; }
  .section-title {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #1e293b;
    margin: 0 0 9px 0;
  }
  p {
    margin: 0 0 7px 0;
    font-size: 10.5pt;
    line-height: 1.55;
  }
  p:last-child { margin-bottom: 0; }
  ul {
    margin: 6px 0 6px 0;
    padding-left: 20px;
  }
  li {
    font-size: 10.5pt;
    line-height: 1.5;
    margin-bottom: 3px;
  }
  strong { font-weight: 700; }
  em { font-style: italic; }

  /* ── Signature section ── */
  .sig-section { padding-top: 16px; page-break-inside: avoid; }
  .sig-title {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #1e293b;
    margin: 0 0 9px 0;
  }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 18px; }
  .sig-box {
    border: 1px solid #cbd5e1;
    padding: 14px 16px;
    background: #f8fafc;
  }
  .sig-box-label {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #94a3b8;
    margin-bottom: 12px;
  }
  .sig-line { border-bottom: 1px solid #94a3b8; height: 34px; margin-bottom: 3px; }
  .sig-signed-name {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: 14pt;
    line-height: 34px;
    color: #0f172a;
  }
  .sig-caption { font-size: 8.5pt; color: #64748b; }
  .sig-name-block { margin-top: 12px; }
  .sig-name { font-size: 10.5pt; font-weight: 600; color: #0f172a; }
  .sig-name-caption { font-size: 8.5pt; color: #64748b; }
  .sig-date { font-size: 9pt; color: #64748b; margin-top: 8px; }
  .sig-cosigner { margin-top: 18px; max-width: 50%; }
  .signed-badge {
    display: inline-block;
    background: #ecfdf5;
    color: #065f46;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8pt;
    font-weight: 700;
    padding: 3px 10px;
    margin-top: 8px;
    letter-spacing: 0.06em;
  }

  /* ── Footer ── */
  .footer {
    text-align: center;
    font-size: 8pt;
    color: #94a3b8;
    margin-top: 28px;
    font-family: Arial, Helvetica, sans-serif;
    letter-spacing: 0.05em;
  }
`

// ── Structured HTML builder ───────────────────────────────────────────────────

/**
 * Build a complete, properly formatted HTML document from the structured
 * leaseData object produced by buildLeaseData() / buildLease().
 *
 * @param {object} leaseData
 * @param {{ signedBy?: string, signedAt?: string }} [opts]
 */
export function buildStructuredLeasePdfHtml(leaseData = {}, opts = {}) {
  const d = leaseData
  const signedBy  = String(opts.signedBy  || '').trim()
  const signedAt  = String(opts.signedAt  || '').trim()
  const signedDate = signedAt
    ? new Date(signedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : ''

  const landlordName    = e(d.landlordName    || LANDLORD_NAME)
  const landlordAddress = e(d.landlordAddress || LANDLORD_ADDRESS)
  const tenantName      = e(d.tenantName      || '___________')
  const cosignerName    = e(d.cosignerName    || '')
  const fullAddress     = e(d.fullAddress     || d.propertyName || '___________')
  const roomLabel       = e(d.roomLabel       || (d.roomNumber ? `Room ${d.roomNumber}` : ''))
  const agreementDate   = e(d.agreementDate   || '___________')

  const termDesc = d.isMonthToMonth
    ? `month-to-month commencing ${e(d.leaseStartFmt || '___________')}`
    : `fixed term from ${e(d.leaseStartFmt || '___________')} through ${e(d.leaseEndFmt || '___________')}`

  const monthlyRentFmt  = e(d.monthlyRentFmt  || fmtMoney(d.monthlyRent))
  const utilityFeeFmt   = e(d.utilityFeeFmt   || fmtMoney(d.utilitiesFee || d.utilityFee))
  const monthlyTotalFmt = e(d.monthlyTotalFmt || fmtMoney((d.monthlyRent || 0) + (d.utilitiesFee || d.utilityFee || 0)))
  const depositFmt      = e(d.securityDepositFmt || fmtMoney(d.securityDeposit))
  const adminFeeFmt     = e(d.adminFeeFmt     || fmtMoney(d.adminFee))
  const utilityFeeNum = Number(d.utilityFee ?? d.utilitiesFee ?? 0) || 0
  const adminFeeNum = Number(d.adminFee ?? 0) || 0
  const proratedUtilNum = Number(d.proratedUtility ?? 0) || 0
  const breakLeaseAmt = Number(d.breakLeaseFeeAmount ?? 0) || 0
  const breakLeaseFeeTxt = breakLeaseAmt > 0 && d.breakLeaseFee ? e(d.breakLeaseFee) : ''

  // ── Summary rows (omit fabricated line items — amounts must come from application / property / overrides)
  const summaryRows = [
    ['Agreement Date', agreementDate],
    ['Landlord',       landlordName],
    ['Tenant',         tenantName],
    ...(cosignerName ? [['Co-Signer', cosignerName]] : []),
    ['Property',       fullAddress],
    ['Room / Unit',    roomLabel || '—'],
    ['Lease Start',    e(d.leaseStartFmt  || '—')],
    ['Lease End',      d.isMonthToMonth ? 'Month-to-Month' : e(d.leaseEndFmt || '—')],
    ['Monthly Rent',   monthlyRentFmt],
    ...(utilityFeeNum > 0 ? [['Utilities Fee', utilityFeeFmt]] : []),
    ['Monthly Total',  monthlyTotalFmt],
    ['Security Deposit', depositFmt],
    [
      "Last Month's Rent (prepaid)",
      (d.lastMonthRent || 0) > 0 ? e(d.lastMonthRentFmt || fmtMoney(d.lastMonthRent)) : 'Not collected at move-in',
    ],
    ...(adminFeeNum > 0 ? [['Admin Fee', adminFeeFmt]] : []),
    ...(d.proratedDays > 0
      ? [
          [`Prorated Rent (${d.proratedDays} days)`, e(d.proratedRentFmt || fmtMoney(d.proratedRent))],
          ...(proratedUtilNum > 0 ? [['Prorated Utilities', e(d.proratedUtilityFmt || fmtMoney(d.proratedUtility))]] : []),
        ]
      : []),
    ['Total Move-In', e(d.totalMoveInFmt || fmtMoney(d.totalMoveIn))],
  ]

  // Build summary grid HTML (two-column)
  let summaryHtml = ''
  for (const [key, val] of summaryRows) {
    summaryHtml += `
      <div class="summary-row">
        <span class="summary-key">${e(key)}</span>
        <span class="summary-val">${val}</span>
      </div>`
  }

  // ── Amenities list
  const amenities = Array.isArray(d.amenities) && d.amenities.length
    ? d.amenities
    : ['High-speed Wi-Fi', 'In-unit laundry', 'Bi-monthly professional cleaning', 'Electricity, gas, water, sewer, garbage']
  const amenitiesHtml = amenities.map(a => `<li>${e(a)}</li>`).join('\n')

  // ── Bathroom note
  const bathroomNoteHtml = d.bathroomNote
    ? `<p><strong>Bathroom arrangement for this room:</strong> ${e(d.bathroomNote)}</p>`
    : ''

  // ── Room utilities note
  const roomUtilitiesHtml = d.roomUtilitiesSummary
    ? `<p><em>Property-specific utilities note:</em> ${e(d.roomUtilitiesSummary)}</p>`
    : ''

  // ── Furnishings
  const furnishingHtml = [
    d.roomFurnished    ? `<p><strong>Furnished status for this room:</strong> ${e(d.roomFurnished)}</p>` : '',
    d.roomFurnitureIncluded ? `<p><strong>Furniture included:</strong> ${e(d.roomFurnitureIncluded)}</p>` : '',
  ].join('')

  // ── Prorated paragraph
  const proratedHtml =
    d.proratedDays > 0
      ? proratedUtilNum > 0
        ? `<p>For the first partial month, Resident shall pay a prorated rent of
    <strong>${e(d.proratedRentFmt || fmtMoney(d.proratedRent))}</strong> and a prorated utilities fee of
    <strong>${e(d.proratedUtilityFmt || fmtMoney(d.proratedUtility))}</strong>, covering
    ${d.proratedDays} days (${e(d.leaseStartFmt)} through end of month).</p>`
        : `<p>For the first partial month, Resident shall pay a prorated rent of
    <strong>${e(d.proratedRentFmt || fmtMoney(d.proratedRent))}</strong>, covering
    ${d.proratedDays} days (${e(d.leaseStartFmt)} through end of month).</p>`
      : ''

  // ── Co-signer line
  const cosignerLine = cosignerName
    ? ` ${cosignerName} is listed as co-signer and is jointly and severally liable for all obligations under this Agreement.`
    : ''

  // ── Signature blocks
  const landlordSigBlock = `
    <div class="sig-box">
      <div class="sig-box-label">Landlord / Manager</div>
      <div class="sig-line"></div>
      <div class="sig-caption">Signature</div>
      <div class="sig-name-block">
        <div class="sig-name">${landlordName}</div>
        <div class="sig-name-caption">Printed Name</div>
      </div>
      <div class="sig-date">Date: ${agreementDate}</div>
    </div>`

  const residentSigBlock = signedBy ? `
    <div class="sig-box">
      <div class="sig-box-label">Resident</div>
      <div class="sig-line">
        <span class="sig-signed-name">${e(signedBy)}</span>
      </div>
      <div class="sig-caption">Electronic Signature</div>
      <div class="sig-name-block">
        <div class="sig-name">${e(signedBy)}</div>
        <div class="sig-name-caption">Printed Name</div>
      </div>
      <div class="sig-date">Date: ${e(signedDate || '___________')}</div>
      <div class="signed-badge">✓ Electronically Signed — ${e(signedDate)}</div>
    </div>` : `
    <div class="sig-box">
      <div class="sig-box-label">Resident</div>
      <div class="sig-line"></div>
      <div class="sig-caption">Signature</div>
      <div class="sig-name-block">
        <div class="sig-name">${tenantName}</div>
        <div class="sig-name-caption">Printed Name</div>
      </div>
      <div class="sig-date">Date: ___________</div>
    </div>`

  const cosignerSigBlock = cosignerName ? `
    <div class="sig-cosigner">
      <div class="sig-box">
        <div class="sig-box-label">Co-Signer</div>
        <div class="sig-line"></div>
        <div class="sig-caption">Signature</div>
        <div class="sig-name-block">
          <div class="sig-name">${cosignerName}</div>
          <div class="sig-name-caption">Printed Name</div>
        </div>
        <div class="sig-date">Date: ___________</div>
      </div>
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Residential Lease Agreement — ${e(d.tenantName || 'Resident')}</title>
  <style>${PDF_CSS}</style>
</head>
<body>

  <!-- Title -->
  <div class="title-block">
    <div class="company-name">${e(COMPANY_NAME)}</div>
    <h1>Residential Lease Agreement</h1>
    <div class="state-line">State of Washington</div>
  </div>

  <!-- Summary -->
  <div class="summary-box">
    <div class="summary-label">Agreement Summary</div>
    <div class="summary-grid">${summaryHtml}</div>
  </div>

  <!-- Sections -->
  <div class="sections">

    <!-- 1 -->
    <div class="section">
      <div class="section-title">1. Parties and Premises</div>
      <p>This Residential Lease Agreement (&ldquo;Agreement&rdquo;) is entered into as of <strong>${agreementDate}</strong> between
      <strong>${landlordName}</strong> (&ldquo;Landlord&rdquo;), with a mailing address of ${landlordAddress},
      and <strong>${tenantName}</strong> (&ldquo;Resident&rdquo;).${cosignerLine}</p>
      <p>Landlord hereby leases to Resident, and Resident hereby leases from Landlord, the private room identified as
      <strong>${roomLabel || '___________'}</strong> located at <strong>${fullAddress}</strong>
      (&ldquo;Premises&rdquo;). Resident shall have access to all common areas of the dwelling as a shared co-tenant.</p>
      <p><strong>1.1 Delivery of possession.</strong> Landlord shall use commercially reasonable efforts to deliver possession
      of the Premises on the lease commencement date. If possession cannot be delivered on that date due to events beyond
      Landlord&rsquo;s reasonable control (including holdover by a prior occupant, casualty, or government order), the lease
      start date shall be postponed until possession is available, rent shall abate until possession is delivered, and
      neither party shall be liable to the other for delay except that Resident may terminate this Agreement by written
      notice if possession is not delivered within fourteen (14) calendar days after the originally scheduled start date,
      in which case any prepaid rent and deposit shall be refunded as required by law.</p>
      <p><strong>1.2 Municipal compliance.</strong> This Agreement shall be interpreted consistently with the Washington
      Residential Landlord-Tenant Act (RCW Chapter 59.18). If the Premises are located within the City of Seattle, the
      parties agree that applicable Seattle rental regulations (including notice, just-cause, relocation, or
      habitability rules) shall apply to the minimum extent required by law.</p>
    </div>

    <!-- 2 -->
    <div class="section">
      <div class="section-title">2. Lease Term</div>
      <p>This Agreement is for a ${termDesc}.
      ${d.isMonthToMonth
        ? `Either party may terminate this Agreement by providing at least ${TERMINATION_NOTICE_DAYS} days&rsquo; written notice prior to the end of a rental period, as required by RCW 59.18.200.`
        : `At the expiration of the fixed term, this Agreement shall automatically convert to a month-to-month tenancy unless either party provides written notice of non-renewal at least ${TERMINATION_NOTICE_DAYS} days before the end of the term, or a new written agreement is signed.`
      }</p>
      <p><strong>2.1 Early termination, mitigation, and lease-break costs.</strong> If Resident vacates before the end of the term without
      Landlord&rsquo;s prior written consent, Resident remains liable for <em>actual damages</em> permitted by Washington law and this Agreement &mdash;
      not for unlawful penalties. Landlord shall make reasonable, good-faith efforts to <strong>mitigate</strong> by re-renting the Premises at fair market terms.
      Resident&rsquo;s liability for unpaid <strong>base rent and utilities charges</strong> continues until the <strong>earlier of</strong> (a) the scheduled lease end date,
      or (b) the date a replacement tenant acceptable to Landlord (same or reasonably similar material terms) begins paying rent,
      <em>minus</em> any rent actually received from a replacement (rent differential after mitigation). Resident shall also pay
      <strong>reasonable, documented re-leasing costs</strong> (advertising, screening, reasonable administrative processing) and
      <strong>reasonable documented turnover repairs</strong> beyond ordinary wear and tear, each itemized where applicable. Any stated lease-break fee
      must represent a reasonable estimate of actual administrative/turnover cost, not a penalty.</p>
    </div>

    <!-- 3 -->
    <div class="section">
      <div class="section-title">3. Rent and Payment Terms</div>
      <p>${
        utilityFeeNum > 0
          ? `Resident agrees to pay <strong>${monthlyRentFmt}</strong> per month as base rent, plus a monthly
      utilities fee of <strong>${utilityFeeFmt}</strong>, for a combined monthly total of
      <strong>${monthlyTotalFmt}</strong>. Rent is due on the 1st day of each calendar month.`
          : `Resident agrees to pay <strong>${monthlyRentFmt}</strong> per month as base rent (utilities included in rent
      unless a separate utilities charge appears in the Agreement Summary). Rent is due on the 1st day of each calendar month.`
      }</p>
      <p>Rent shall be paid by ACH bank transfer, Zelle, Venmo, or another method approved in writing by Landlord.
      Cash payments are not accepted.</p>
      <p>If rent is not received by the ${LATE_GRACE_DAYS}th day of the month, a late fee of
      <strong>${LATE_FEE}</strong> shall be assessed. The late fee is agreed in writing as permitted by RCW 59.18.140 and
      shall not be assessed unless the fee amount and trigger date are stated in this Agreement. Acceptance of a late
      payment does not waive Landlord&rsquo;s right to assess future late fees or pursue other remedies.</p>
      <p><strong>3.1 Application of payments.</strong> Unless otherwise required by law, any payment from Resident shall
      be applied in the following order: (a) amounts owed for damage to the Premises or common areas beyond ordinary wear
      and tear; (b) unpaid allocated utilities, utility fees, or similar charges; (c) late fees, NSF fees, and other lawful
      charges; (d) past-due rent, oldest invoice first; (e) current month&rsquo;s rent.</p>
      <p><strong>3.2 Returned payments and NSF.</strong> If any check, ACH debit, or electronic payment is dishonored,
      reversed, or returned unpaid, Resident shall immediately pay the original amount plus Landlord&rsquo;s actual bank
      or processing fees and a reasonable returned-payment fee not to exceed the maximum allowed under RCW 62A.3-421 or
      other applicable law, whichever is lower. Repeated returned payments may cause Landlord to require certified funds
      or another payment method.</p>
      <p><strong>3.3 Utility billing and allocation.</strong> Where Resident owes a monthly utilities fee or allocated
      utility charges, such amounts are due on the same date as rent unless otherwise stated in writing. Failure to pay
      allocated utilities when due constitutes a monetary default subject to the same notice and cure procedures as rent
      to the extent allowed by Washington law.</p>
      ${proratedHtml}
      <p><strong>Prepaid / last month&rsquo;s rent:</strong> Unless a separate amount for last month&rsquo;s rent or other
      prepaid rent is stated in the Agreement Summary above, none is required at move-in. Any amount collected and
      identified as prepaid rent for the final rental period is not a security deposit under RCW 59.18.260 unless
      expressly designated as such in writing at collection, and shall be applied only to rent for the final month
      of tenancy after proper termination notice, subject to Washington law.</p>
      ${
        adminFeeNum > 0
          ? `<p><strong>3.4 Administrative or screening fees.</strong> If an administrative fee or application-related fee is
      listed in the Agreement Summary, Resident acknowledges it was disclosed before payment and represents Landlord&rsquo;s
      reasonable actual costs to the extent permitted by law; such fees are not part of the security deposit unless
      expressly labeled as deposit.</p>`
          : ''
      }
      <p><strong>3.5 Statutory notices and pass-through costs.</strong> If Washington law permits recovery of specific statutory
      notice preparation, filing, or service costs in connection with a lawful remedy, Resident shall pay only those amounts actually
      incurred and permitted by statute, with documentation upon request. No fee shall be assessed that is prohibited as a penalty
      or unconscionable charge under RCW Chapter 59.18 or related law.</p>
    </div>

    <!-- 4 -->
    <div class="section">
      <div class="section-title">4. Security Deposit</div>
      <p>Resident shall pay a security deposit of <strong>${depositFmt}</strong> prior to or upon move-in.
      The security deposit shall be held in accordance with RCW 59.18.260. Landlord shall provide a written receipt
      and identify the financial institution where the deposit is held.</p>
      <p>The deposit may be applied to unpaid rent, damages beyond normal wear and tear, cleaning costs, and any other
      amounts owed under this Agreement. Within 21 days of Resident&rsquo;s departure, Landlord shall return the deposit
      or provide a written itemized statement of deductions, as required by RCW 59.18.280.</p>
      <p><strong>4.1 Move-in condition and checklist (Property Condition Addendum).</strong> Landlord and Resident shall complete a written
      <strong>move-in inspection checklist</strong> describing the condition of the Premises and any furnishings (the Property Condition Addendum).
      Resident shall return a signed checklist to Landlord within <strong>fourteen (14) calendar days</strong> after obtaining possession (or complete a joint walkthrough on a mutually agreed date within that window).
      The checklist, together with dated photographs or short videos reasonably taken at move-in, establishes the baseline for determining whether deposit deductions at move-out reflect damage or uncleanliness
      <strong>beyond documented move-in condition</strong>, consistent with RCW 59.18.260 and RCW 59.18.280. If Resident fails to return the checklist, Landlord may document condition in good faith and provide a copy;
      failure to document pre-existing conditions does not authorize deductions for conditions Landlord knew or should have known existed at move-in.</p>
      <p><strong>4.2 Forwarding address.</strong> Upon vacating, Resident shall provide Landlord in writing a valid
      forwarding address where deposit accounting and refund may be sent. Failure to provide a forwarding address does
      not relieve Landlord of the obligation to comply with RCW 59.18.280, but Resident bears the risk of misdelivery if
      the address is incomplete or inaccurate.</p>
      <p><strong>4.3 Itemized deductions.</strong> Any deduction from the deposit shall be listed in writing with a
      plain-language description of each charge and supporting documentation where reasonably available. Deductions may
      not include ordinary wear and tear consistent with RCW 59.18.260.</p>
      <p><strong>4.4 Deposit deduction categories and cleaning standards.</strong> Deductions may include only lawful categories, including: unpaid rent or other charges expressly permitted under this Agreement;
      damage to the Premises or Landlord-owned furnishings <strong>beyond ordinary wear and tear</strong>; reasonable cleaning charges to restore the private room to a <strong>rent-ready, professionally clean</strong> standard if left with unreasonable dirt, debris, stains, or odors;
      carpet or upholstery cleaning only for <strong>tenant-caused</strong> staining or damage (not normal traffic wear); lost keys, fobs, or access devices at documented replacement cost; pest remediation attributable to Resident&rsquo;s conduct or neglect after notice.
      Hourly repair labor shall be billed at Landlord&rsquo;s <strong>documented</strong> reasonable internal rate or vendor invoice, not to exceed prevailing market rates for comparable work. For single-line items over <strong>$250</strong>, Landlord shall provide an estimate or invoice where practicable before withholding from deposit when timing allows under RCW 59.18.280.</p>
    </div>

    <!-- 5 -->
    <div class="section">
      <div class="section-title">5. Utilities and Services Included</div>
      ${
        utilityFeeNum > 0
          ? `<p>The monthly utilities fee of <strong>${utilityFeeFmt}</strong> covers Resident&rsquo;s proportionate share of
      the following services provided at the property:</p>`
          : `<p>Base rent includes the household utility arrangement described at move-in and in any property-specific addenda.
      The following services are associated with the property:</p>`
      }
      <ul>
        ${amenitiesHtml}
      </ul>
      <p>Landlord shall maintain all utility accounts in Landlord&rsquo;s name. Resident agrees not to add or change any
      utility services without prior written consent of Landlord.</p>
      <p><strong>5.1 Utility transfer.</strong> If Landlord ever requires a specific utility account to be transferred to
      Resident&rsquo;s name (for example, for a separately metered service), Resident shall establish service within three
      (3) business days of written notice and shall not allow termination for non-payment that affects habitability of
      other residents.</p>
      <p><strong>5.2 Non-payment of allocated utilities.</strong> Allocated charges shown on a written ledger or invoice
      are due by the date stated on the invoice or, if none, with the next rent installment. Continued non-payment after
      written notice may be treated as a material default to the extent permitted by RCW Chapter 59.18.</p>
      <p><strong>5.3 Adjustment of utilities fee or allocation.</strong> If Resident pays a recurring utilities or household-services component, Landlord may change the amount or allocation method with at least
      <strong>thirty (30) days&rsquo; prior written notice</strong>, except where a shorter period is required by law or an emergency tariff increase. If a proposed change is not permitted by law or is rejected by Resident, Resident&rsquo;s exclusive remedy is to terminate the tenancy with notice required by RCW 59.18.200 (where applicable) or as otherwise required by law &mdash; not to withhold rent without a lawful defense.</p>
      <p>Resident is responsible for personal streaming services, phone plans, and any other personal communications
      services not explicitly listed above.</p>
      ${roomUtilitiesHtml}
    </div>

    <!-- 6 -->
    <div class="section">
      <div class="section-title">6. Occupancy and Permitted Use</div>
      <p>The Premises shall be occupied solely by <strong>${tenantName}</strong> as a private residence.
      Resident shall not permit any other person to occupy the Premises as a primary residence without the prior written
      consent of Landlord. Guests staying more than 7 consecutive nights or more than 14 nights in any 30-day period
      require written approval.</p>
      <p><strong>6.1 Guest policy enforcement.</strong> A guest who exceeds the limits above without approval may be
      treated as an unauthorized occupant. Landlord may require removal of the guest or, if the guest remains after written
      notice, pursue remedies for breach consistent with RCW Chapter 59.18.</p>
      <p>The Premises shall be used solely for lawful residential purposes consistent with a shared co-living household.
      Resident shall not use the Premises or common areas for any commercial, business, or income-generating activity
      without Landlord&rsquo;s prior written consent.</p>
    </div>

    <!-- 7 -->
    <div class="section">
      <div class="section-title">7. Shared Spaces and House Rules</div>
      ${bathroomNoteHtml}
      <p>Resident shall share common areas &mdash; including kitchen, living room, bathrooms, laundry, and outdoor spaces &mdash;
      with other residents of the dwelling in a respectful and cooperative manner. Resident agrees to:</p>
      <ul>
        <li>Clean up after themselves in all shared spaces promptly after each use.</li>
        <li>Keep personal items in their private room or designated storage areas only.</li>
        <li>Maintain reasonable quiet hours between 10:00 PM and 8:00 AM on weekdays and midnight to 9:00 AM on weekends.</li>
        <li>Not hold gatherings of more than 4 guests without prior notice to Landlord.</li>
        <li>Dispose of trash and recycling in the designated containers on the scheduled collection days.</li>
        <li>Not leave food unsecured in common areas in a manner that may attract pests.</li>
        <li>Report maintenance issues, leaks, or safety hazards to Landlord promptly.</li>
      </ul>
      <p>Failure to comply with house rules after a written warning constitutes grounds for termination of this Agreement
      pursuant to RCW 59.18.180.</p>
    </div>

    <!-- 8 -->
    <div class="section">
      <div class="section-title">8. Furnishings and Personal Property</div>
      <p>The Premises and common areas may be provided with furniture and furnishings owned by Landlord. Resident shall
      care for all Landlord-owned furnishings in good condition and shall be liable for damage beyond normal wear and tear.
      Resident shall not remove Landlord-owned furnishings from the Premises.</p>
      ${furnishingHtml}
      <p>Landlord is not responsible for the loss, theft, or damage to Resident&rsquo;s personal property. Resident is strongly
      encouraged to obtain renters&rsquo; insurance to protect personal belongings.</p>
      <p><strong>8.1 Limitation of landlord liability.</strong> Except for damages arising from Landlord&rsquo;s gross
      negligence or willful misconduct, or as otherwise required by RCW Chapter 59.18, Landlord&rsquo;s aggregate liability
      for any claim arising from this tenancy shall not exceed the amount of rent actually paid by Resident during the
      twelve (12) months preceding the claim. Landlord shall not be liable for interruption of utilities caused by utility
      companies, weather, or other events outside Landlord&rsquo;s reasonable control after Landlord has made good-faith
      efforts to restore service.</p>
      <p><strong>8.2 Indemnification.</strong> Resident shall indemnify, defend, and hold harmless Landlord and Landlord&rsquo;s
      agents from claims, losses, and reasonable attorneys&rsquo; fees arising from Resident&rsquo;s or Resident&rsquo;s
      guests&rsquo; negligence, intentional misconduct, illegal activity, or breach of this Agreement, except to the extent
      caused by Landlord&rsquo;s negligence or willful misconduct.</p>
      <p><strong>8.3 Personal safety; crime; third parties.</strong> Landlord does not warrant or guarantee the security of persons or property. Resident acknowledges that criminal or harmful conduct may occur without Landlord&rsquo;s knowledge or control.
      Except as required by RCW Chapter 59.18 or other mandatory law, Landlord shall not be liable for injury or loss caused by third parties, other residents, or guests. Resident is encouraged to secure valuables, lock doors, and maintain renters insurance with liability coverage.</p>
    </div>

    <!-- 9 -->
    <div class="section">
      <div class="section-title">9. Maintenance and Repairs</div>
      <p>Landlord shall maintain the Premises and common areas in a habitable condition in compliance with applicable
      housing codes and RCW 59.18.060, including maintaining structural components, heating systems, hot and cold
      running water, plumbing, water supply and drainage, sewer connections, and weatherproofing.</p>
      <p><strong>Plumbing, water, and drains:</strong> Resident shall immediately notify Landlord of any leak, drip,
      standing water, sewage odor, backup, or loss of water pressure. Resident shall not pour grease, oil, paint,
      harsh chemicals, or foreign objects into sinks, toilets, or drains. In a burst pipe or uncontrolled water
      leak, Resident shall shut off the nearest fixture valve if safe to do so and contact Landlord without delay.</p>
      <p>After written notice of a defect that materially and adversely affects health or safety, Landlord shall
      commence remedial efforts within the timeframes and procedures required by RCW 59.18.070 where applicable.
      For emergencies threatening life or major property damage (including fire, gas odor, or major flooding),
      Resident shall call 911 when appropriate and notify Landlord as soon as practicable.</p>
      <p>Resident shall keep the private room and any areas under Resident&rsquo;s control in a clean and sanitary condition.
      Resident shall promptly notify Landlord in writing of any damage, defect, or maintenance need (email or text
      to the management number on file is acceptable for urgent matters, followed by written confirmation if
      requested). Resident shall not perform any repairs or alterations without Landlord&rsquo;s prior written approval.
      Resident shall be liable for damage caused by Resident&rsquo;s negligence or intentional acts.</p>
      <p><strong>9.1 Smoke detection devices (RCW 43.44.110).</strong> Landlord certifies that the dwelling is equipped
      with smoke detection devices as required by RCW 43.44.110. Resident shall not remove or disable smoke alarms.
      Resident shall test devices as directed by the manufacturer, replace batteries or power sources as required, and
      promptly notify Landlord of any malfunction.</p>
      <p><strong>9.2 Carbon monoxide alarms (RCW 19.27.530).</strong> Where required by RCW 19.27.530 and applicable
      building codes for the dwelling type, Landlord shall provide approved carbon monoxide alarms in required locations.
      Resident shall not remove or disable CO alarms, shall test as directed, and shall report malfunctions promptly.</p>
      <p><strong>9.3 Domestic hot water temperature.</strong> Landlord shall maintain the domestic hot water system so
      that water delivered at fixtures is not scalding, consistent with applicable Washington State codes (including
      tempering or limiting settings where required, commonly not to exceed approximately 120&deg;F at the tank or as
      directed by code). Resident shall not alter water heater thermostats, mixing valves, or tempering devices without
      written permission.</p>
      <p><strong>9.4 Fire safety and egress.</strong> Resident shall keep all means of egress clear, shall not disable or prop open self-closing doors on fire-rated paths, shall not use barbecues or open flames indoors or on balconies except as law and Landlord permit, and shall follow building fire-safety notices posted by Landlord or required by code.</p>
    </div>

    <!-- 10 -->
    <div class="section">
      <div class="section-title">10. Entry by Landlord</div>
      <p>For non-emergency entry to the Resident&rsquo;s private room (including inspections, repairs, or showings),
      Landlord shall provide at least <strong>${LANDLORD_ENTRY_NOTICE_HOURS} hours&rsquo;</strong> written notice,
      consistent with RCW 59.18.150. In an emergency (including imminent threat to life, health, safety, or property),
      Landlord may enter the private room without prior notice when reasonably necessary.
      Landlord retains the right to enter common areas at any time for legitimate purposes without prior notice.</p>
      <p><strong>Keys and access devices:</strong> Resident shall safeguard all keys, fobs, and codes. Lost or
      unreturned keys or fobs may be replaced or re-keyed at Resident&rsquo;s expense for Landlord&rsquo;s reasonable actual cost,
      not to exceed the documented invoice from a licensed locksmith or vendor where applicable.</p>
      <p><strong>10.1 Lockouts and self-help prohibited.</strong> Landlord shall not exclude Resident from the Premises,
      change locks, or interrupt utilities for the purpose of evicting Resident without a court order, except as expressly
      permitted for emergency repairs or lawful lock changes that provide Resident immediate replacement keys at no charge
      if Landlord caused the lockout in error. If Resident is locked out due to lost keys, Landlord may charge a reasonable
      after-hours access fee consistent with actual cost.</p>
    </div>

    <!-- 11 -->
    <div class="section">
      <div class="section-title">11. Pets and Smoking Policy</div>
      <p><strong>Pets:</strong> No pets are permitted on the Premises without prior written consent of Landlord.
      Approved pets may require an additional pet deposit. Resident is liable for any damage caused by a pet.</p>
      <p><strong>Smoking:</strong> Smoking, vaping, or use of any tobacco or cannabis products is strictly prohibited
      inside the dwelling, including the private room and all common areas. Smoking is only permitted in designated
      outdoor areas, if any, as designated by Landlord.</p>
    </div>

    <!-- 12 -->
    <div class="section">
      <div class="section-title">12. Subletting and Assignment</div>
      <p>Resident shall not sublet, assign, or transfer any interest in this Agreement or the Premises without the prior
      written consent of Landlord. Any unauthorized subletting shall constitute a material breach of this Agreement.</p>
    </div>

    <!-- 13 -->
    <div class="section">
      <div class="section-title">13. Alterations and Improvements</div>
      <p>Resident shall not make any alterations, installations, or improvements to the Premises &mdash; including painting,
      drilling, or mounting of fixtures &mdash; without the prior written consent of Landlord. Any approved alterations
      shall become part of the Premises and property of Landlord upon Resident&rsquo;s departure, unless Landlord directs
      restoration at Resident&rsquo;s expense.</p>
    </div>

    <!-- 14 -->
    <div class="section">
      <div class="section-title">14. Move-Out and Surrender of Premises</div>
      <p>Upon termination of this Agreement, Resident shall vacate the Premises, remove all personal property, and
      return the Premises in substantially the same condition as received, allowing for normal wear and tear.
      Resident shall return all keys, access fobs, and parking passes to Landlord.</p>
      <p><strong>14.1 Cleaning at move-out.</strong> Resident shall leave the private room broom-clean and free of trash
      and personal property. If professional cleaning of the private room is required due to unreasonable dirt, debris,
      stains, or odors beyond ordinary wear and tear, Landlord may deduct the reasonable cost from the deposit with
      itemization. If the property&rsquo;s standard includes recurring professional cleaning of common areas, Resident remains
      responsible for Resident&rsquo;s proportionate share through the vacate date as stated in the Agreement Summary or house
      rules.</p>
      <p><strong>14.2 Abandoned personal property (RCW 59.18.310).</strong> Personal property left in the Premises after
      vacating may be stored and disposed of in accordance with RCW 59.18.310 and related Washington law, including written
      notice to Resident at the last known address, reasonable storage, sale or donation, and application of proceeds to
      storage and removal costs.</p>
      <p>If Resident breaks the lease prior to the end of the fixed term without Landlord&rsquo;s written consent, Resident
      shall be liable for <em>actual damages</em> and unpaid obligations permitted by Washington law only, including unpaid
      rent through the earlier of the end of the lease term or the date a replacement tenant acceptable to Landlord begins
      paying rent, subject to Landlord&rsquo;s duty to mitigate. Resident shall also pay reasonable, documented re-leasing
      costs to the extent allowed by law${
        breakLeaseFeeTxt
          ? `. In addition, the parties agree to a stated lease-break fee of <strong>${breakLeaseFeeTxt}</strong> only if that fee represents a reasonable estimate of actual administrative and turnover costs and is not an unlawful penalty.`
          : '.'
      } No other &ldquo;penalty&rdquo; for early termination shall apply except as permitted by RCW Chapter 59.18.</p>
    </div>

    <!-- 15 -->
    <div class="section">
      <div class="section-title">15. Default and Landlord Remedies</div>
      <p>If Resident fails to pay rent when due or violates any material term of this Agreement, Landlord may serve
      written notices to pay or comply and vacate using the forms and notice periods required by Washington law, including
      RCW 59.12 and RCW Chapter 59.18 (which may include, for certain rental defaults, a notice period of not less than
      fourteen (14) calendar days where applicable, or other periods for different breaches or tenancy types). Following
      expiration of any required cure period without cure, Landlord may pursue unlawful detainer (eviction) in King County
      District Court or other court of competent jurisdiction consistent with Washington procedure.</p>
      <p><strong>15.1 Non-waiver.</strong> Landlord&rsquo;s acceptance of partial or late rent, or Landlord&rsquo;s failure to object
      to a particular breach, does not waive Landlord&rsquo;s right to insist on strict performance thereafter, to collect all
      sums owing, or to terminate the tenancy as permitted after proper notice. Any waiver must be in writing signed by
      Landlord.</p>
    </div>

    <!-- 16 -->
    <div class="section">
      <div class="section-title">16. Quiet Enjoyment</div>
      <p>Provided Resident complies with all terms of this Agreement, Landlord covenants that Resident shall have quiet
      enjoyment of the private room without interference by Landlord, except as otherwise permitted by this Agreement
      or applicable law.</p>
    </div>

    <!-- 17 -->
    <div class="section">
      <div class="section-title">17. General Provisions</div>
      <p><strong>17.1 Severability.</strong> If any provision of this Agreement is held invalid or unenforceable, the
      remainder shall remain in full force and effect, and the parties request that any court reform the invalid
      provision to the minimum extent necessary to achieve substantially the same lawful effect.</p>
      <p><strong>17.2 Lead-based paint disclosure (pre-1978 housing).</strong> If any residential structure on the property
      was built before January 1, 1978, Landlord has provided Resident with the EPA pamphlet &ldquo;Protect Your Family from
      Lead in Your Home&rdquo; and any disclosure required under 42 U.S.C. &sect;4852d and 40 C.F.R. Part 745 (Residential
      Lead-Based Paint Hazard Reduction Act). Resident acknowledges receipt of the pamphlet and any completed disclosure
      form prior to signing this Agreement. If the dwelling was constructed in 1978 or later, this subsection does not
      apply.</p>
      <p><strong>17.3 Attorney fees.</strong> In any action to interpret or enforce this Agreement, recover possession, or collect sums lawfully owing after default, the <strong>prevailing party</strong> may recover reasonable attorneys&rsquo; fees and court costs
      <strong>only if and to the extent</strong> authorized by RCW 59.18.290, other applicable Washington statutes, or court rule. Nothing herein guarantees fee recovery in any particular dispute.</p>
      <p>Landlord&rsquo;s failure to enforce any provision on a particular occasion shall not waive the right to enforce that
      provision on a later occasion, except as stated in Section 15.1. This Agreement may not be amended except by a
      written instrument signed by both parties.</p>
      <p>All notices required or permitted under this Agreement shall be in writing and delivered by hand, first-class
      mail, or email (with confirmation of receipt) to the addresses of record.</p>
    </div>

    <!-- 18 -->
    <div class="section">
      <div class="section-title">18. Governing Law</div>
      <p>This Agreement shall be governed by the laws of the State of Washington, including the Washington Residential
      Landlord-Tenant Act (RCW Chapter 59.18). Venue for any legal action arising from this Agreement shall lie in the
      courts of King County, Washington, and Resident consents to personal jurisdiction there, unless another venue is
      required by mandatory law based on where the Premises are located.</p>
      <p><strong>18.1 Local ordinances.</strong> If the Premises are within the City of Seattle (or any other jurisdiction
      with rental housing ordinances), any conflicting term of this Agreement shall give way to mandatory local law only
      to the extent required.</p>
    </div>

    <!-- 19 -->
    <div class="section">
      <div class="section-title">19. Entire Agreement</div>
      <p>This Agreement, together with any addenda attached hereto, constitutes the entire agreement between the parties
      with respect to the Premises and supersedes all prior negotiations, representations, or agreements, whether
      written or oral.</p>
    </div>

    <!-- Part II — Addenda -->
    <div class="section">
      <div class="section-title">Part II &mdash; Addenda (Incorporated by Reference)</div>
      <p>The following addenda are <strong>incorporated by reference</strong> into Part I and have the same force and effect as the numbered sections above. If a term in an addendum conflicts with a statutory requirement, the statute controls.</p>
      <p><strong>Addendum A &mdash; Property condition baseline.</strong> Reinforces Section 4.1: the signed checklist and dated media establish the lawful baseline for deposit disputes. Resident shall not alter or damage smoke or CO pathways when hanging d&eacute;cor.</p>
      <p><strong>Addendum B &mdash; Bed bugs and cooperation.</strong> Resident shall report suspected bed-bug activity immediately in writing and shall cooperate with inspection and certified treatment protocols (preparation, bagging laundry, access). If an infestation is reasonably attributable to Resident&rsquo;s conduct, guests, or failure to follow prevention steps after written notice, Resident shall pay <strong>reasonable, documented</strong> treatment costs to the extent permitted by law.</p>
      <p><strong>Addendum C &mdash; Mold, moisture, and ventilation.</strong> Resident shall use bathroom/kitchen ventilation when cooking or showering, wipe standing condensation, keep textiles off damp surfaces, and report leaks or mold within twenty-four (24) hours. Resident shall not paint over or conceal mold. Landlord shall respond to building-system leaks consistent with RCW 59.18.070 where applicable.</p>
      <p><strong>Addendum D &mdash; Extended tenant maintenance.</strong> Resident shall replace HVAC filters on schedule provided by Landlord (or at least every ninety (90) days if disposable 1&quot; filters); keep refrigerator coils reasonably dust-free; run garbage disposals only with cold water; clear hair from accessible drain stoppers; report running toilets promptly; and comply with posted recycling/compost rules.</p>
      <p><strong>Addendum E &mdash; Rules and nuisance enforcement.</strong> Violations of quiet hours, harassment, or repeated unreasonable noise may result in written cure notices and, if not cured, termination procedures permitted by RCW 59.18.180 after proper notice. Other residents&rsquo; breach does not excuse Resident&rsquo;s performance unless Landlord fails to enforce material rules after documented written notice where Landlord has legal authority to cure third-party conduct.</p>
    </div>

    <!-- 20 — Signatures -->
    <div class="sig-section">
      <div class="sig-title">20. Signatures</div>
      <p>By signing below, the parties agree to all terms and conditions of this Residential Lease Agreement.</p>
      <div class="sig-grid">
        ${landlordSigBlock}
        ${residentSigBlock}
      </div>
      ${cosignerSigBlock}
    </div>

  </div><!-- /sections -->

  <div class="footer">${e(COMPANY_NAME)} &nbsp;&bull;&nbsp; ${landlordAddress} &nbsp;&bull;&nbsp; Generated ${agreementDate}</div>

</body>
</html>`
}

// ── Legacy plain-text wrapper (kept for backward compatibility) ───────────────

/** @deprecated Prefer buildStructuredLeasePdfHtml(leaseData) for new code. */
export function buildLeasePdfHtml({ title, subtitle, bodyText }) {
  const safeTitle = escapeHtml(title || 'Residential Lease')
  const safeSub   = subtitle ? escapeHtml(subtitle) : ''
  const body      = escapeHtml(bodyText || '').replace(/\r\n/g, '\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    @page { margin: 0.65in 0.7in; }
    body {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 10.5pt;
      line-height: 1.55;
      color: #0f172a;
      margin: 0;
      padding: 0;
    }
    h1 {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 15pt;
      font-weight: 800;
      text-align: center;
      margin: 0 0 6px 0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .sub { text-align: center; font-size: 9.5pt; color: #64748b; margin-bottom: 24px; font-style: italic; }
    pre.lease {
      white-space: pre-wrap;
      word-wrap: break-word;
      margin: 0;
      font-family: inherit;
      font-size: 10.5pt;
      line-height: 1.55;
    }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  ${safeSub ? `<div class="sub">${safeSub}</div>` : ''}
  <pre class="lease">${body}</pre>
</body>
</html>`
}
