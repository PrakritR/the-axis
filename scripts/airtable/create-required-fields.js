#!/usr/bin/env node
/**
 * Reference checklist for Airtable base setup (manual — Airtable Metadata API not required).
 * Run: node scripts/airtable/create-required-fields.js
 *
 * Prints every field the Axis app expects for lease access, move-in charges, payments, and tour slots.
 */

const TABLES = [
  {
    name: 'Properties',
    fields: [
      { name: 'Lease Access Requirement', type: 'singleSelect', choices: [
        'Security Deposit Paid',
        'Security Deposit and First Month Rent Paid',
        'No Requirement',
      ]},
      { name: 'Required Before Signing Summary', type: 'multilineText' },
      { name: 'Move In Charges JSON', type: 'multilineText' },
      { name: 'Fees Required Before Signing', type: 'multilineText' },
    ],
  },
  {
    name: 'Lease Drafts',
    fields: [
      { name: 'Lease Access Requirement Snapshot', type: 'singleLineText' },
      { name: 'Lease Access Granted', type: 'checkbox' },
      { name: 'Lease Access Granted At', type: 'dateTime' },
      { name: 'Lease Access Block Reason', type: 'multilineText' },
    ],
  },
  {
    name: 'Payments',
    fields: [
      {
        name: 'Payment Type',
        type: 'singleSelect',
        choices: [
          'Rent',
          'Security Deposit',
          'First Month Rent',
          'Last Month Rent',
          'Application Fee',
          'Cleaning Fee',
          'Admin Fee',
          'Key Fee',
          'Prorated Rent',
          'Fee Waive',
          'Other',
        ],
      },
      { name: 'Required Before Signing', type: 'checkbox' },
      { name: 'Waiver Reason', type: 'multilineText' },
      { name: 'Application', type: 'link', linkedTable: 'Applications' },
    ],
  },
]

console.log('Axis — required Airtable fields (add manually in UI)\n')
for (const t of TABLES) {
  console.log(`## ${t.name}`)
  for (const f of t.fields) {
    const extra = f.choices ? ` choices: ${f.choices.join(' | ')}` : f.linkedTable ? ` → ${f.linkedTable}` : ''
    console.log(`  - ${f.name} (${f.type})${extra}`)
  }
  console.log('')
}

console.log('Tour slots: 30-minute increments are computed in code from Manager Availability blocks; no extra Airtable fields required.\n')
