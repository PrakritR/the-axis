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
  const breakLeaseFee   = e(d.breakLeaseFee   || '$900.00')

  // ── Summary rows
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
    ['Utilities Fee',  utilityFeeFmt],
    ['Monthly Total',  monthlyTotalFmt],
    ['Security Deposit', depositFmt],
    [
      "Last Month's Rent (prepaid)",
      (d.lastMonthRent || 0) > 0 ? e(d.lastMonthRentFmt || fmtMoney(d.lastMonthRent)) : 'Not collected at move-in',
    ],
    ['Admin Fee',      adminFeeFmt],
    ...(d.proratedDays > 0 ? [
      [`Prorated Rent (${d.proratedDays} days)`, e(d.proratedRentFmt || fmtMoney(d.proratedRent))],
      ['Prorated Utilities', e(d.proratedUtilityFmt || fmtMoney(d.proratedUtility))],
    ] : []),
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
  const proratedHtml = d.proratedDays > 0 ? `
    <p>For the first partial month, Resident shall pay a prorated rent of
    <strong>${e(d.proratedRentFmt || fmtMoney(d.proratedRent))}</strong> and a prorated utilities fee of
    <strong>${e(d.proratedUtilityFmt || fmtMoney(d.proratedUtility))}</strong>, covering
    ${d.proratedDays} days (${e(d.leaseStartFmt)} through end of month).</p>` : ''

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
    </div>

    <!-- 2 -->
    <div class="section">
      <div class="section-title">2. Lease Term</div>
      <p>This Agreement is for a ${termDesc}.
      ${d.isMonthToMonth
        ? `Either party may terminate this Agreement by providing at least ${TERMINATION_NOTICE_DAYS} days&rsquo; written notice prior to the end of a rental period, as required by RCW 59.18.200.`
        : `At the expiration of the fixed term, this Agreement shall automatically convert to a month-to-month tenancy unless either party provides written notice of non-renewal at least ${TERMINATION_NOTICE_DAYS} days before the end of the term, or a new written agreement is signed.`
      }</p>
    </div>

    <!-- 3 -->
    <div class="section">
      <div class="section-title">3. Rent and Payment Terms</div>
      <p>Resident agrees to pay <strong>${monthlyRentFmt}</strong> per month as base rent, plus a monthly
      utilities fee of <strong>${utilityFeeFmt}</strong>, for a combined monthly total of
      <strong>${monthlyTotalFmt}</strong>. Rent is due on the 1st day of each calendar month.</p>
      <p>Rent shall be paid by ACH bank transfer, Zelle, Venmo, or another method approved in writing by Landlord.
      Cash payments are not accepted.</p>
      <p>If rent is not received by the ${LATE_GRACE_DAYS}th day of the month, a late fee of
      <strong>${LATE_FEE}</strong> shall be assessed. Acceptance of a late payment does not constitute a waiver of
      Landlord&rsquo;s right to assess future late fees or pursue any other remedy under this Agreement or Washington law.</p>
      ${proratedHtml}
      <p><strong>Prepaid / last month&rsquo;s rent:</strong> Unless a separate amount for last month&rsquo;s rent or other
      prepaid rent is stated in the Agreement Summary above, none is required at move-in. Any amount collected and
      identified as prepaid rent for the final rental period is not a security deposit under RCW 59.18.260 unless
      expressly designated as such in writing at collection, and shall be applied only to rent for the final month
      of tenancy after proper termination notice, subject to Washington law.</p>
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
    </div>

    <!-- 5 -->
    <div class="section">
      <div class="section-title">5. Utilities and Services Included</div>
      <p>The monthly utilities fee of <strong>${utilityFeeFmt}</strong> covers Resident&rsquo;s proportionate share of
      the following services provided at the property:</p>
      <ul>
        ${amenitiesHtml}
      </ul>
      <p>Landlord shall maintain all utility accounts in Landlord&rsquo;s name. Resident agrees not to add or change any
      utility services without prior written consent of Landlord.</p>
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
      unreturned keys or fobs may be replaced or re-keyed at Resident&rsquo;s expense for Landlord&rsquo;s reasonable actual cost.</p>
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
      <p>If Resident breaks the lease prior to the end of the fixed term without Landlord&rsquo;s written consent, Resident
      shall be liable for a lease-break fee of <strong>${breakLeaseFee}</strong> and any unpaid rent
      through the earlier of the end of the lease term or the date a new qualified tenant takes possession.</p>
    </div>

    <!-- 15 -->
    <div class="section">
      <div class="section-title">15. Default and Landlord Remedies</div>
      <p>If Resident fails to pay rent when due or violates any material term of this Agreement, Landlord may serve
      appropriate written notice as required by Washington law (RCW 59.12) and pursue unlawful detainer proceedings
      or other remedies available at law or in equity. Landlord&rsquo;s acceptance of partial rent does not waive Landlord&rsquo;s
      right to pursue collection of the full amount owed.</p>
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
      <p>If any provision of this Agreement is found to be unenforceable, the remaining provisions shall remain in full
      force and effect. Landlord&rsquo;s failure to enforce any provision shall not constitute a waiver of that provision.
      This Agreement may not be amended except by a written instrument signed by both parties.</p>
      <p>All notices required or permitted under this Agreement shall be in writing and delivered by hand, first-class
      mail, or email (with confirmation of receipt) to the addresses of record.</p>
    </div>

    <!-- 18 -->
    <div class="section">
      <div class="section-title">18. Governing Law</div>
      <p>This Agreement shall be governed by the laws of the State of Washington, including the Washington Residential
      Landlord-Tenant Act (RCW Chapter 59.18). Any dispute arising out of this Agreement shall be resolved in
      King County, Washington.</p>
    </div>

    <!-- 19 -->
    <div class="section">
      <div class="section-title">19. Entire Agreement</div>
      <p>This Agreement, together with any addenda attached hereto, constitutes the entire agreement between the parties
      with respect to the Premises and supersedes all prior negotiations, representations, or agreements, whether
      written or oral.</p>
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
