#!/usr/bin/env node
/**
 * Exhaustive Airtable base specification for the Axis portal + manager stack.
 *
 * Usage:
 *   node scripts/airtable/print-full-airtable-base-spec.mjs
 *   node scripts/airtable/print-full-airtable-base-spec.mjs --json > airtable-full-spec.json
 *
 * This script is documentation-only: it does not call the Airtable API.
 *
 * Source of truth: frontend/src/lib/airtable.js, frontend/src/pages/Apply.jsx,
 * frontend/src/lib/managerPropertyFormAirtableMap.js, backend/server/handlers/*lease*,
 * backend/server/lib/applications-airtable-env.js.
 * docs/airtable-portal-schema.txt may differ (legacy names); prefer the code paths above.
 */

const MAX_ROOM_SLOTS = 20
const MAX_BATHROOM_SLOTS = 10
const MAX_BATHROOM_SHARING_SLOTS = 5
const MAX_KITCHEN_SLOTS = 3
const MAX_SHARED_SPACE_SLOTS = 13
const MAX_LAUNDRY_SLOTS = 5

/** @typedef {{ name: string, type: string, required?: boolean, options?: string[], env?: string, notes?: string }} FieldSpec */

/** @param {string} name @param {string} type @param {Partial<FieldSpec>} rest @returns {FieldSpec} */
function f(name, type, rest = {}) {
  return { name, type, ...rest }
}

/** @returns {FieldSpec[]} */
function propertyDynamicRoomFields() {
  const out = []
  for (let n = 1; n <= MAX_ROOM_SLOTS; n++) {
    out.push(f(`Room ${n} Rent`, 'Number', { notes: 'Currency-style number; empty = no rent for slot' }))
    out.push(f(`Room ${n} Availability`, 'Date', { notes: 'Move-in / availability date' }))
    out.push(
      f(`Room ${n} Furnished`, 'Single select', {
        options: ['Yes', 'No', 'Partial'],
        notes: 'Wizard + PROPERTY_AIR mapping',
      }),
    )
    out.push(f(`Room ${n} Utilities Cost`, 'Number', { notes: 'Optional per-room utilities $' }))
    if (n === 1) {
      out.push(
        f('Room 1 Utilities', 'Long text', {
          notes: 'Only Room 1 has this long-text utilities field in Airtable',
        }),
      )
    }
  }
  return out
}

/** @returns {FieldSpec[]} */
function propertyDynamicBathroomFields() {
  const out = []
  for (let n = 1; n <= MAX_BATHROOM_SLOTS; n++) {
    out.push(f(`Bathroom ${n}`, 'Long text', { notes: 'Type + description stored together for manager wizard' }))
    if (n <= MAX_BATHROOM_SHARING_SLOTS) {
      out.push(
        f(`Rooms Sharing Bathroom ${n}`, 'Multiple select', {
          options: Array.from({ length: MAX_ROOM_SLOTS }, (_, i) => `Room ${i + 1}`),
          notes: 'Which rooms share this bathroom',
        }),
      )
    }
  }
  return out
}

/** @returns {FieldSpec[]} */
function propertyDynamicKitchenFields() {
  const out = []
  for (let n = 1; n <= MAX_KITCHEN_SLOTS; n++) {
    out.push(f(`Kitchen ${n}`, 'Long text', {}))
    out.push(
      f(`Rooms Sharing Kitchen ${n}`, 'Multiple select', {
        options: Array.from({ length: MAX_ROOM_SLOTS }, (_, i) => `Room ${i + 1}`),
      }),
    )
  }
  return out
}

/** @returns {FieldSpec[]} */
function propertyDynamicLaundryFields() {
  const out = []
  for (let n = 1; n <= MAX_LAUNDRY_SLOTS; n++) {
    out.push(
      f(`Laundry ${n} Type`, 'Single line text', {
        notes: 'Wizard stores type label; paired with sharing + description in meta',
      }),
    )
    out.push(
      f(`Rooms Sharing Laundry ${n}`, 'Multiple select', {
        options: Array.from({ length: MAX_ROOM_SLOTS }, (_, i) => `Room ${i + 1}`),
      }),
    )
  }
  return out
}

/** @returns {FieldSpec[]} */
function propertyDynamicSharedSpaceFields() {
  const out = []
  for (let n = 1; n <= MAX_SHARED_SPACE_SLOTS; n++) {
    out.push(f(`Shared Space ${n} Name`, 'Single line text', {}))
    out.push(
      f(`Shared Space ${n} Type`, 'Single select', {
        options: [
          'Living Room',
          'Dining Room',
          'Lounge',
          'Study Area',
          'Kitchen',
          'Laundry',
          'Backyard',
          'Patio',
          'Storage',
          'Other',
        ],
      }),
    )
    out.push(
      f(`Access to Shared Space ${n}`, 'Multiple select', {
        options: Array.from({ length: MAX_ROOM_SLOTS }, (_, i) => `Room ${i + 1}`),
      }),
    )
  }
  return out
}

/** Core base (VITE_AIRTABLE_BASE_ID) — listings, residents, manager ops */
const CORE_TABLES = [
  {
    id: 'residentProfile',
    tableName: 'Resident Profile',
    envTable: 'VITE_AIRTABLE_RESIDENT_PROFILE_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Name', 'Single line text', { notes: 'syncResidentFromAuth sets Name' }),
      f('Email', 'Email', { required: true }),
      f('Password', 'Single line text', { notes: 'Portal login (loginResident)' }),
      f('Phone', 'Phone number', {}),
      f('Status', 'Single line text', { notes: 'e.g. Active' }),
      f('House', 'Link or single line text', { notes: 'Property link (rec…) or label — work orders try House then Property' }),
      f('Unit Number', 'Single line text', {}),
      f('Lease Term', 'Single line text', {}),
      f('Lease Start Date', 'Date', {}),
      f('Lease End Date', 'Date', {}),
      f('Supabase User ID', 'Single line text', { notes: 'Auth sync' }),
      f('Application ID', 'Number', { notes: 'Optional legacy numeric id' }),
      f('Applications', 'Link to another record', { notes: '→ Applications' }),
      f('Property', 'Link to another record', { notes: '→ Properties (some bases)' }),
      f('Property Name', 'Single line text', { notes: 'Fetched for payments / display' }),
      f('Room Number', 'Single line text', {}),
      f('Rent Amount', 'Number', {}),
      f('Security Deposit', 'Number', {}),
      f('Emergency Contact', 'Long text', { notes: 'Optional extended profile' }),
      f('Notes', 'Long text', {}),
      f('Stripe Customer ID', 'Single line text', { env: 'VITE_AIRTABLE_RESIDENT_STRIPE_CUSTOMER_ID_FIELD' }),
      f('Stripe Default Payment Method ID', 'Single line text', {
        env: 'VITE_AIRTABLE_RESIDENT_STRIPE_DEFAULT_PM_FIELD',
      }),
    ],
  },
  {
    id: 'managerProfile',
    tableName: 'Manager Profile',
    envTable: 'VITE_AIRTABLE_MANAGER_PROFILE_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Manager ID', 'Single line text', { required: true }),
      f('Name', 'Single line text', { notes: 'Some bases use single Name vs First/Last' }),
      f('Email', 'Email', { required: true }),
      f('Password', 'Single line text', { notes: 'If manager portal uses password auth' }),
      f('First Name', 'Single line text', {}),
      f('Last Name', 'Single line text', {}),
      f('Phone', 'Phone number', {}),
      f('Phone Number', 'Phone number', { notes: 'Alternate column label' }),
      f('Company', 'Single line text', {}),
      f('Role', 'Single line text', {}),
      f('Plan Type', 'Single line text', { notes: 'Legacy billing label' }),
      f('Active', 'Checkbox', {}),
      f('Tour Availability', 'Long text', {}),
      f('Tier', 'Single select', {
        options: ['Standard', 'Premium'],
        env: 'VITE_AIRTABLE_MANAGER_TIER_FIELD',
        notes: 'Feature gating',
      }),
      f('Notes', 'Long text', {}),
      f('Stripe Connect Account ID', 'Single line text', {}),
      f('Stripe Customer ID', 'Single line text', { notes: 'Legacy / alternate Stripe id' }),
      f('Stripe Subscription ID', 'Single line text', {}),
      f('Promo Code', 'Single line text', {}),
      f('Stripe Onboarding Complete', 'Checkbox', {}),
      f('Stripe Payouts Enabled', 'Checkbox', {}),
      f('Stripe Charges Enabled', 'Checkbox', {}),
      f('Stripe Details Submitted', 'Checkbox', {}),
    ],
  },
  {
    id: 'properties',
    tableName: 'Properties',
    envTable: 'VITE_AIRTABLE_PROPERTIES_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Property Name', 'Single line text', { required: true }),
      f('Street Address', 'Single line text', {}),
      f('City', 'Single line text', {}),
      f('State', 'Single line text', {}),
      f('ZIP', 'Single line text', {}),
      f('Latitude', 'Number', {}),
      f('Longitude', 'Number', {}),
      f('Property Type', 'Single select', {
        options: ['House', 'Apartment', 'Townhome', 'Studio', 'Condo', 'Other'],
      }),
      f('Bedrooms', 'Number', {}),
      f('Bathrooms', 'Number', {}),
      f('Square Feet', 'Number', {}),
      f('Year Built', 'Number', {}),
      f('Description', 'Long text', {}),
      f('Amenities', 'Multiple select', {
        options: [
          'Wi-Fi',
          'Parking',
          'Laundry',
          'Air Conditioning',
          'Heating',
          'Dishwasher',
          'Gym',
          'Pool',
          'Backyard',
          'Balcony',
          'Elevator',
          'Storage',
          'Bike Storage',
          'EV Charging',
          'Furnished Common Areas',
          'Cleaning Service',
          'Security System',
          'Pet-Friendly',
          'Rooftop',
          'Game Room',
          'Study Room',
        ],
      }),
      f('Pet Policy', 'Single select', {
        options: ['Allowed', 'Not Allowed', 'Case by Case', 'Cats Only', 'Small Dogs OK'],
      }),
      f('Furnished', 'Single select', { options: ['Yes', 'No', 'Partial'] }),
      f('Utilities Included', 'Multiple select', {
        options: ['Water', 'Gas', 'Electric', 'Trash', 'Internet', 'Sewer'],
      }),
      f('Parking', 'Single line text', {}),
      f('Laundry', 'Single line text', {}),
      f('Photos', 'Attachment', {
        env: 'VITE_AIRTABLE_PROPERTY_PHOTOS_FIELD',
        notes: 'Listing photos; room shots may use axis-r{n}-* filenames',
      }),
      f('Listing Status', 'Single select', {
        options: ['Draft', 'Active', 'Leased', 'Archived'],
        env: 'VITE_AIRTABLE_LISTING_STATUS_FIELD',
      }),
      f('Monthly Rent', 'Number', {}),
      f('Security Deposit', 'Number', {}),
      f('Application Fee', 'Number', { notes: 'Per-property override; tour/lease flows read this' }),
      f('Lease Term', 'Single line text', {}),
      f('Available Date', 'Date', {}),
      f('Manager', 'Link to another record', { notes: '→ Manager Profile' }),
      f('Rooms', 'Link to another record', { notes: '→ Rooms (multiple)' }),
      f('Other Info', 'Long text', {
        required: true,
        notes:
          'JSON: axisListingMeta (leasing, financials, roomsDetail, tourSettings, …). See axisListingMeta.js',
      }),
      f('Admin Edit Request', 'Long text', {
        env: 'VITE_AIRTABLE_PROPERTY_EDIT_REQUEST_FIELD',
        notes: 'Manager edit request notes',
      }),
      f('Site Manager Name', 'Single line text', {}),
      f('Site Manager Phone', 'Phone number', {}),
      f('Site Manager Email', 'Email', {}),
      f('Room Count', 'Number', { notes: '1–20; drives which Room N * columns are used' }),
      f('Bathroom Count', 'Number', { notes: '0–10' }),
      f('Kitchen Count', 'Number', { notes: '0–3' }),
      f('Shared Space Count', 'Number', { notes: '0–13' }),
      f('Laundry Count', 'Number', { notes: '0–5' }),
      ...propertyDynamicRoomFields(),
      ...propertyDynamicBathroomFields(),
      ...propertyDynamicKitchenFields(),
      ...propertyDynamicLaundryFields(),
      ...propertyDynamicSharedSpaceFields(),
    ],
  },
  {
    id: 'rooms',
    tableName: 'Rooms',
    envTable: 'VITE_AIRTABLE_ROOMS_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Room Name', 'Single line text', { notes: 'Or use Room Number as primary label' }),
      f('Room Number', 'Single line text', {}),
      f('Property', 'Link to another record', { required: true, notes: '→ Properties' }),
      f('Monthly Rent', 'Number', {}),
      f('Security Deposit', 'Number', {}),
      f('Available', 'Checkbox', {}),
      f('Availability', 'Long text', { notes: 'Legacy bases use long text' }),
      f('Available Date', 'Date', {}),
      f('Furnished', 'Checkbox or single select', { notes: 'Bases differ' }),
      f('Furnishing Detail', 'Long text', {}),
      f('Floor', 'Single line text', {}),
      f('Bathroom Type', 'Single line text', {}),
      f('Square Feet', 'Number', {}),
      f('Bed Size', 'Single line text', {}),
      f('Desk Included', 'Checkbox', {}),
      f('AC', 'Checkbox', {}),
      f('Closet / Storage', 'Long text', {}),
      f('Windows / Natural Light', 'Long text', {}),
      f('Room Notes', 'Long text', {}),
      f('Kitchen Included', 'Single line text', {}),
      f('Laundry Access', 'Long text', {}),
      f('Parking Access', 'Long text', {}),
      f('Private Bathroom', 'Checkbox', {}),
      f('Utilities Included', 'Multiple select', {
        options: ['Water', 'Gas', 'Electric', 'Trash', 'Internet', 'Sewer'],
      }),
      f('Description', 'Long text', {}),
      f('Photos', 'Attachment', {}),
      f('Current Resident', 'Link to another record', { notes: '→ Resident Profile' }),
    ],
  },
  {
    id: 'workOrders',
    tableName: 'Work Orders',
    envTable: 'VITE_AIRTABLE_WORK_ORDERS_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Title', 'Single line text', { required: true }),
      f('Description', 'Long text', { notes: 'May include portal_submitter_email: line when using placeholder resident' }),
      f('Category', 'Single line text or single select', {}),
      f('Priority', 'Single select', { options: ['Low', 'Medium', 'High', 'Urgent', 'Emergency'], notes: 'Portal maps Emergency → Urgent' }),
      f('Status', 'Single select', {
        options: ['Open', 'Submitted', 'In Progress', 'Scheduled', 'Completed', 'Cancelled'],
        notes: 'createWorkOrder defaults Open; retried as Submitted if Open invalid',
      }),
      f('Preferred Entry Time', 'Single line text', {}),
      f('Preferred Time Window', 'Single line text', {}),
      f('Resident Profile', 'Link to another record', {
        env: 'VITE_AIRTABLE_WORK_ORDER_RESIDENT_LINK_FIELD',
        notes: 'Default field name; fallbacks: Resident profile, Resident, Tenant, Resident Link, Resident ID',
      }),
      f('Resident Email', 'Email or single line text', { notes: 'Copied from resident for matching' }),
      f('House', 'Link to another record', { env: 'VITE_AIRTABLE_WORK_ORDER_PROPERTY_LINK_FIELD', notes: 'Default tries House then Property' }),
      f('Property', 'Link to another record', { notes: 'Alternate property link label' }),
      f('Application ID', 'Number', { env: 'VITE_AIRTABLE_WORK_ORDER_APPLICATION_ID_FIELD', notes: 'Set none to skip' }),
      f('Application', 'Link to another record', { env: 'VITE_AIRTABLE_WORK_ORDER_APPLICATION_LINK_FIELD', notes: 'Default name Application' }),
      f('Management Notes', 'Long text', { notes: 'Scheduled date meta lines e.g. scheduled date: YYYY-MM-DD' }),
      f('Manager Notes', 'Long text', { notes: 'Alternate label in some UIs' }),
      f('Update', 'Long text', {}),
      f('Latest Update', 'Long text', {}),
      f('Last Update', 'Date', {}),
      f('Resolution Summary', 'Long text', {}),
      f('Resolved', 'Checkbox', {}),
      f('Date Submitted', 'Created time', { notes: 'Read-only in API' }),
      f('Submitted Date', 'Date', {}),
      f('Scheduled Date', 'Date', { env: 'VITE_AIRTABLE_WORK_ORDER_SCHEDULED_DATE_FIELD' }),
      f('Completed Date', 'Date', {}),
      f('Resident Availability', 'Long text', {}),
      f('Photo', 'Attachment', { notes: 'First tried; see VITE_AIRTABLE_WORK_ORDER_PHOTO_FIELDS' }),
      f('Photos', 'Attachment', {}),
      f('Attachments', 'Attachment', {}),
      f('Images', 'Attachment', {}),
      f('Cost', 'Number', { env: 'VITE_AIRTABLE_WORK_ORDER_COST_FIELD' }),
      f('(your column for real submitter email)', 'Single line text', {
        env: 'VITE_AIRTABLE_WORK_ORDER_SUBMITTER_EMAIL_FIELD',
        notes: 'Required when using VITE_AIRTABLE_WORK_ORDER_RESIDENT_RECORD_ID placeholder resident link',
      }),
    ],
  },
  {
    id: 'messages',
    tableName: 'Messages',
    envTable: 'VITE_AIRTABLE_MESSAGES_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Message', 'Long text', { required: true }),
      f('Sender Email', 'Email', { required: true }),
      f('Is Admin', 'Checkbox', {}),
      f('Work Order', 'Link to another record', { notes: '→ Work Orders (work-order threads)' }),
      f('Thread Key', 'Single line text', { env: 'VITE_AIRTABLE_MESSAGE_THREAD_KEY_FIELD', notes: 'Portal inbox + internal threads' }),
      f('Channel', 'Single line text', { env: 'VITE_AIRTABLE_MESSAGE_CHANNEL_FIELD' }),
      f('Subject', 'Single line text', { env: 'VITE_AIRTABLE_MESSAGE_SUBJECT_FIELD', notes: 'Set to none to skip writes' }),
      f('Timestamp', 'Date', {
        env: 'VITE_AIRTABLE_MESSAGE_TIMESTAMP_FIELD',
        notes: 'Optional writable time; omit or none if using createdTime only',
      }),
    ],
  },
  {
    id: 'inboxThreadState',
    tableName: 'Inbox Thread State',
    envTable: 'VITE_AIRTABLE_INBOX_THREAD_STATE_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Thread Key', 'Single line text', { env: 'VITE_AIRTABLE_INBOX_STATE_THREAD_KEY_FIELD', notes: 'Default Thread Key' }),
      f('Participant Email', 'Email', { env: 'VITE_AIRTABLE_INBOX_STATE_PARTICIPANT_FIELD', notes: 'Default Participant Email' }),
      f('Last Read At', 'Date', { env: 'VITE_AIRTABLE_INBOX_STATE_LAST_READ_FIELD' }),
      f('Trashed', 'Checkbox', { env: 'VITE_AIRTABLE_INBOX_STATE_TRASHED_FIELD' }),
    ],
  },
  {
    id: 'announcements',
    tableName: 'Announcements',
    envTable: 'VITE_AIRTABLE_ANNOUNCEMENTS_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Title', 'Single line text', { required: true }),
      f('Message', 'Long text', { required: true }),
      f('Body', 'Long text', { notes: 'Reader fallback when Message empty' }),
      f('Short Summary', 'Long text', {}),
      f('Target', 'Multiple select or long text', { notes: 'Audience tokens; may embed __axis_submitter__:email' }),
      f('Target Scope', 'Long text', { notes: 'Fallback read in getAnnouncements' }),
      f('Priority', 'Single select', { options: ['Normal', 'High', 'Low'] }),
      f('Show', 'Checkbox', { notes: 'FALSE = pending admin review' }),
      f('Pinned', 'Checkbox', {}),
      f('Start Date', 'Date', {}),
      f('Date Posted', 'Date', {}),
      f('Created At', 'Created time', {}),
    ],
  },
  {
    id: 'payments',
    tableName: 'Payments',
    envTable: 'VITE_AIRTABLE_PAYMENTS_TABLE / AIRTABLE_PAYMENTS_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Resident', 'Link to another record', { required: true, notes: '→ Resident Profile' }),
      f('Property', 'Link to another record', { notes: '→ Properties' }),
      f('Amount', 'Currency', { required: true }),
      f('Type', 'Single line text or single select', {}),
      f('Category', 'Single line text', {}),
      f('Kind', 'Single line text', {}),
      f('Line Item Type', 'Single line text', {}),
      f('Month', 'Single line text', {}),
      f('Status', 'Single select', { options: ['Pending', 'Completed', 'Failed', 'Refunded'] }),
      f('Due Date', 'Date', {}),
      f('Paid Date', 'Date', {}),
      f('Description', 'Long text', {}),
      f('Notes', 'Long text', {}),
      f('Stripe Payment ID', 'Single line text', {}),
      f('Property Name', 'Single line text', {}),
      f('Room Number', 'Single line text', {}),
      f('Balance', 'Number', { notes: 'Ledger / resident balance' }),
      f('Application Fee Paid', 'Number', { notes: 'Some manager UIs read fee columns by this label family' }),
    ],
  },
  {
    id: 'documents',
    tableName: 'Documents',
    envTable: 'VITE_AIRTABLE_DOCUMENTS_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Title', 'Single line text', {}),
      f('Name', 'Single line text', { notes: 'Alternate primary label' }),
      f('Type', 'Single select', {
        options: ['Lease', 'Addendum', 'Notice', 'Receipt', 'Insurance', 'ID', 'Other'],
      }),
      f('Category', 'Single line text', {}),
      f('File', 'Attachment', { required: true }),
      f('Resident', 'Link to another record', { notes: '→ Resident Profile' }),
      f('Visible to Resident', 'Checkbox', {}),
      f('Property', 'Link to another record', { notes: '→ Properties' }),
      f('Uploaded By', 'Link to another record', {}),
      f('Upload Date', 'Date', {}),
      f('Expires', 'Date', {}),
      f('Notes', 'Long text', {}),
    ],
  },
  {
    id: 'packages',
    tableName: 'Packages',
    envTable: 'VITE_AIRTABLE_PACKAGES_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Tracking Number', 'Single line text', {}),
      f('Carrier', 'Single line text', {}),
      f('Resident', 'Link to another record', { required: true, notes: '→ Resident Profile' }),
      f('Property', 'Link to another record', { notes: '→ Properties' }),
      f('Received Date', 'Date', {}),
      f('Status', 'Single select', { options: ['Received', 'Picked Up', 'Returned'] }),
      f('Notes', 'Long text', {}),
      f('Photo', 'Attachment', {}),
    ],
  },
  {
    id: 'leaseDrafts',
    tableName: 'Lease Drafts',
    envTable: 'VITE_AIRTABLE_LEASE_DRAFTS_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Resident Name', 'Single line text', {}),
      f('Resident Email', 'Email', {}),
      f('Resident Record ID', 'Single line text', {}),
      f('Property', 'Single line text', { notes: 'Often property name string; may be link in some bases' }),
      f('Unit', 'Single line text', {}),
      f('Lease Start Date', 'Date', {}),
      f('Lease End Date', 'Date', {}),
      f('Rent Amount', 'Currency', {}),
      f('Deposit Amount', 'Currency', {}),
      f('Utilities Fee', 'Currency', {}),
      f('Lease Term', 'Single line text', {}),
      f('AI Draft Content', 'Long text', {}),
      f('Manager Edited Content', 'Long text', {}),
      f('Lease HTML', 'Long text', { notes: 'Rendered lease HTML path' }),
      f('Lease JSON', 'Long text', { notes: 'Template + wizard payload' }),
      f('Manager Notes', 'Long text', {}),
      f('Status', 'Single select', {
        options: ['Draft', 'Draft Generated', 'Pending Signature', 'Signed', 'Cancelled', '…'],
      }),
      f('Updated At', 'Date and time', {}),
      f('Application Record ID', 'Single line text', {}),
      f('Owner ID', 'Single line text', { notes: 'Manager record id for scoping' }),
      f('Approved By', 'Single line text', {}),
      f('Approved At', 'Date and time', {}),
      f('Published At', 'Date and time', {}),
      f('Allow Sign Without Move-In Pay', 'Checkbox', {}),
      f('SignForge Envelope ID', 'Single line text', {}),
      f('SignForge Sent At', 'Date and time', {}),
      f('Lease Access Requirement Snapshot', 'Single line text', {}),
      f('Lease Access Granted', 'Checkbox', {}),
      f('Lease Access Block Reason', 'Long text', {}),
      f('Lease Access Granted At', 'Date and time', {}),
      f('Lease Token', 'Single line text', { notes: 'Applications / signing flow' }),
      f('Lease Signed', 'Checkbox', {}),
      f('Lease Signed Date', 'Date', {}),
      f('Lease Signature', 'Single line text', {}),
    ],
  },
  {
    id: 'leaseVersions',
    tableName: 'Lease Versions',
    envTable: '(fixed table name in code)',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Lease Draft ID', 'Single line text', { notes: 'Link target id' }),
      f('Version', 'Number', {}),
      f('Is Current', 'Checkbox', {}),
      f('PDF File', 'Attachment', { notes: 'Tried with PDF, Attachment, File' }),
      f('Uploader Name', 'Single line text', { notes: 'Legacy uploader triad' }),
      f('Uploader Role', 'Single line text', {}),
      f('Upload Date', 'Date and time', {}),
      f('Uploaded By', 'Single line text', { notes: 'Doc-schema uploader' }),
      f('Uploaded By Record ID', 'Single line text', {}),
      f('Timestamp', 'Date and time', {}),
    ],
  },
  {
    id: 'leaseComments',
    tableName: 'Lease Comments',
    envTable: '(fixed table name in code)',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Lease Draft ID', 'Single line text', { required: true }),
      f('Author Name', 'Single line text', {}),
      f('Author Role', 'Single line text', {}),
      f('Author Record ID', 'Single line text', {}),
      f('Message', 'Long text', {}),
      f('Timestamp', 'Date and time', {}),
      f('Resolved', 'Checkbox', {}),
    ],
  },
  {
    id: 'leaseNotifications',
    tableName: 'Lease Notifications',
    envTable: '(fixed table name in code)',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Recipient Record ID', 'Single line text', {}),
      f('Recipient Role', 'Single line text', {}),
      f('Lease Draft ID', 'Single line text', {}),
      f('Message', 'Long text', {}),
      f('Action Type', 'Single line text', {}),
      f('Is Read', 'Checkbox', {}),
      f('Created At', 'Date and time', {}),
    ],
  },
  {
    id: 'auditLog',
    tableName: 'Audit Log',
    envTable: 'VITE_AIRTABLE_AUDIT_LOG_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Lease Draft ID', 'Single line text', {}),
      f('Action Type', 'Single line text', { required: true }),
      f('Performed By', 'Single line text', {}),
      f('Performed By Role', 'Single line text', {}),
      f('Timestamp', 'Date and time', { required: true }),
      f('Notes', 'Long text', {}),
      f('Action', 'Single line text', { notes: 'Alternate generic schema' }),
      f('Entity Type', 'Single line text', {}),
      f('Entity ID', 'Single line text', {}),
      f('Details', 'Long text', {}),
      f('IP Address', 'Single line text', {}),
    ],
  },
  {
    id: 'scheduling',
    tableName: 'Scheduling',
    envTable: 'AIRTABLE_SCHEDULING_TABLE / VITE_AIRTABLE_SCHEDULING_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Type', 'Single line text', { notes: 'tour.js expects Type=tour for tour rows' }),
      f('Name', 'Single line text', {}),
      f('Email', 'Email', {}),
      f('Phone', 'Phone number', {}),
      f('Property', 'Single line text', { notes: 'Property name or id string depending on handler' }),
      f('Property ID', 'Single line text', {}),
      f('Property Name', 'Single line text', {}),
      f('Property Address', 'Long text', {}),
      f('Room', 'Single line text', {}),
      f('Preferred Date', 'Date', {}),
      f('Preferred Time', 'Single line text', {}),
      f('Tour Format', 'Single line text', {}),
      f('Tour Manager', 'Single line text', {}),
      f('Tour Availability', 'Long text', {}),
      f('Meeting Format', 'Single line text', {}),
      f('Where to Meet', 'Single line text', {}),
      f('Message', 'Long text', {}),
      f('Manager Email', 'Email', {}),
      f('Manager Approval', 'Single line text', {}),
      f('Status', 'Single line text', {}),
      f('Approval Status', 'Single line text', {}),
      f('Approved', 'Checkbox', {}),
      f('Listed', 'Checkbox', {}),
      f('Notes', 'Long text', { notes: 'May embed Site Manager Email, Tour Manager, Tour Notes lines' }),
    ],
  },
  {
    id: 'blockedTourDates',
    tableName: 'Blocked Tour Dates',
    envTable: 'VITE_AIRTABLE_BLOCKED_TOUR_DATES_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Property', 'Link to another record', { notes: '→ Properties' }),
      f('Manager', 'Link to another record', { notes: '→ Manager Profile' }),
      f('Blocked Date', 'Date', { required: true }),
      f('Reason', 'Long text', {}),
    ],
  },
  {
    id: 'managerAvailability',
    tableName: 'Manager Availability',
    envTable: 'VITE_AIRTABLE_MANAGER_AVAILABILITY_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Manager', 'Link to another record', { required: true, notes: '→ Manager Profile' }),
      f('Property', 'Link to another record', { notes: '→ Properties' }),
      f('Day Of Week', 'Number', { notes: '0–6 or 1–7 depending on scripts; align with tour booking code' }),
      f('Start Time', 'Single line text', {}),
      f('End Time', 'Single line text', {}),
      f('Slot Duration', 'Number', {}),
      f('Timezone', 'Single line text', {}),
      f('Active', 'Checkbox', {}),
    ],
  },
  {
    id: 'adminMeetingAvailability',
    tableName: 'Admin Meeting Availability',
    envTable: 'VITE_AIRTABLE_ADMIN_MEETING_AVAILABILITY_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Admin', 'Link to another record', { notes: '→ Admin Profile' }),
      f('Day Of Week', 'Number', {}),
      f('Start Time', 'Single line text', {}),
      f('End Time', 'Single line text', {}),
      f('Slot Duration', 'Number', {}),
      f('Timezone', 'Single line text', {}),
      f('Active', 'Checkbox', {}),
    ],
  },
  {
    id: 'adminProfile',
    tableName: 'Admin Profile',
    envTable: 'VITE_AIRTABLE_ADMIN_PROFILE_TABLE / AIRTABLE_ADMIN_PROFILE_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Admin ID', 'Single line text', { required: true }),
      f('Email', 'Email', { required: true }),
      f('First Name', 'Single line text', {}),
      f('Last Name', 'Single line text', {}),
      f('Role', 'Single select', { options: ['Super Admin', 'Admin', 'Support'] }),
      f('Active', 'Checkbox', {}),
    ],
  },
  {
    id: 'websiteSettings',
    tableName: 'Website Settings',
    envTable: 'VITE_AIRTABLE_WEBSITE_SETTINGS_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Key', 'Single line text', { required: true }),
      f('Value', 'Long text', {}),
      f('Description', 'Long text', {}),
      f('Last Updated', 'Date', {}),
    ],
  },
  {
    id: 'coApplicants',
    tableName: 'Co-Signers',
    envTable: 'VITE_AIRTABLE_COAPPLICANTS_TABLE',
    baseEnv: 'VITE_AIRTABLE_BASE_ID',
    fields: [
      f('Linked Application', 'Link to another record', { required: true, notes: '→ Applications (Apply.jsx)' }),
      f('Role', 'Single line text', { notes: 'Co-Signer' }),
      f('Full Name', 'Single line text', {}),
      f('Email', 'Email', {}),
      f('Phone Number', 'Phone number', {}),
      f('Date of Birth', 'Date', {}),
      f('SSN No.', 'Single line text', {}),
      f('Driving License No.', 'Single line text', {}),
      f('Current Address', 'Long text', {}),
      f('City', 'Single line text', {}),
      f('State', 'Single line text', {}),
      f('ZIP', 'Single line text', {}),
      f('Employer', 'Single line text', {}),
      f('Employer Address', 'Long text', {}),
      f('Supervisor Name', 'Single line text', {}),
      f('Supervisor Phone', 'Phone number', {}),
      f('Job Title', 'Single line text', {}),
      f('Monthly Income', 'Currency', {}),
      f('Annual Income', 'Currency', {}),
      f('Employment Start Date', 'Date', {}),
      f('Other Income', 'Long text', {}),
      f('Bankruptcy History', 'Single line text', {}),
      f('Criminal History', 'Single line text', {}),
      f('Consent for Credit and Background Check', 'Checkbox', {}),
      f('Signature', 'Long text', { notes: 'Apply writes long text signature payload' }),
      f('Date Signed', 'Date', {}),
      f('Notes', 'Long text', {}),
    ],
  },
]

/** Applications base (AIRTABLE_APPLICATIONS_BASE_ID) — can match core base id */
const APPLICATIONS_TABLES = [
  {
    id: 'applications',
    tableName: 'Applications',
    envTable: 'VITE_AIRTABLE_APPLICATIONS_TABLE / AIRTABLE_APPLICATIONS_TABLE',
    baseEnv:
      'AIRTABLE_APPLICATIONS_BASE_ID or VITE_AIRTABLE_APPLICATIONS_BASE_ID (else VITE_AIRTABLE_BASE_ID)',
    fields: [
      f('Application ID', 'Autonumber or formula', { notes: 'Display id; API uses Airtable record id rec…' }),
      f('Signer Full Name', 'Single line text', { required: true }),
      f('Signer Email', 'Email', { required: true }),
      f('Signer Phone Number', 'Phone number', {}),
      f('Signer Date of Birth', 'Date', {}),
      f('Signer SSN No.', 'Single line text', {}),
      f('Signer Driving License No.', 'Single line text', {}),
      f('Property Name', 'Single line text', {}),
      f('Property Address', 'Long text', {}),
      f('Room Number', 'Single line text', {}),
      f('Lease Term', 'Single line text', {}),
      f('Month to Month', 'Checkbox', {}),
      f('Lease Start Date', 'Date', {}),
      f('Lease End Date', 'Date', {}),
      f('Signer Current Address', 'Long text', {}),
      f('Signer City', 'Single line text', {}),
      f('Signer State', 'Single line text', {}),
      f('Signer ZIP', 'Single line text', {}),
      f('Current Landlord Name', 'Single line text', {}),
      f('Current Landlord Phone', 'Phone number', {}),
      f('Current Move-In Date', 'Date', {}),
      f('Current Move-Out Date', 'Date', {}),
      f('Current Reason for Leaving', 'Long text', {}),
      f('Previous Address', 'Long text', {}),
      f('Previous City', 'Single line text', {}),
      f('Previous State', 'Single line text', {}),
      f('Previous ZIP', 'Single line text', {}),
      f('Previous Landlord Name', 'Single line text', {}),
      f('Previous Landlord Phone', 'Phone number', {}),
      f('Previous Move-In Date', 'Date', {}),
      f('Previous Move-Out Date', 'Date', {}),
      f('Previous Reason for Leaving', 'Long text', {}),
      f('Signer Employer', 'Single line text', {}),
      f('Signer Employer Address', 'Long text', {}),
      f('Signer Supervisor Name', 'Single line text', {}),
      f('Signer Supervisor Phone', 'Phone number', {}),
      f('Signer Job Title', 'Single line text', {}),
      f('Signer Monthly Income', 'Currency', {}),
      f('Signer Annual Income', 'Currency', {}),
      f('Signer Employment Start Date', 'Date', {}),
      f('Signer Other Income', 'Long text', {}),
      f('Reference 1 Name', 'Single line text', {}),
      f('Reference 1 Relationship', 'Single line text', {}),
      f('Reference 1 Phone', 'Phone number', {}),
      f('Reference 2 Name', 'Single line text', {}),
      f('Reference 2 Relationship', 'Single line text', {}),
      f('Reference 2 Phone', 'Phone number', {}),
      f('Number of Occupants', 'Number', {}),
      f('Pets', 'Long text', {}),
      f('Eviction History', 'Single line text', {}),
      f('Signer Bankruptcy History', 'Single line text', {}),
      f('Signer Criminal History', 'Single line text', {}),
      f('Has Co-Signer', 'Checkbox', {}),
      f('Signer Consent for Credit and Background Check', 'Checkbox', {}),
      f('Signer Signature', 'Long text', {
        env: 'AIRTABLE_APPLICATION_SIGNER_SIGNATURE_FIELD / VITE_AIRTABLE_APPLICATION_SIGNER_SIGNATURE_FIELD',
      }),
      f('Signer Date Signed', 'Date', {}),
      f('Additional Notes', 'Long text', { notes: 'Includes Axis meta blocks from buildAxisApplicationMetaNotes' }),
      f('Approved', 'Checkbox', {}),
      f('Rejected', 'Checkbox', {
        env: 'AIRTABLE_APPLICATION_REJECTED_FIELD / VITE_AIRTABLE_APPLICATION_REJECTED_FIELD',
        notes: 'Required on many bases so PATCH can clear rejection',
      }),
      f('Approved At', 'Date and time', {}),
      f('Application Status', 'Single line text', { notes: 'Manager approve may set Approved' }),
      f('Approval Status', 'Single line text', {}),
      f('Approved Unit Room', 'Single line text', {
        env: 'AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD / VITE_AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD',
        notes: 'Also try legacy column Approved Room',
      }),
      f('Owner ID', 'Single line text', { notes: 'Manager Airtable record id; tenant guard' }),
      f('Lease Token', 'Single line text', {}),
      f('Lease JSON', 'Long text', {}),
      f('Lease Status', 'Single select', {}),
      f('Lease Signed', 'Checkbox', {}),
      f('Lease Signed Date', 'Date', {}),
      f('Lease Signature', 'Single line text', {}),
      f('Application Paid', 'Checkbox', {
        env: 'AIRTABLE_APPLICATION_PAID_FIELD',
        notes: 'Default Application Paid',
      }),
      f('Stripe Checkout Session', 'Single line text', {
        env: 'AIRTABLE_STRIPE_CHECKOUT_SESSION_FIELD',
        notes: 'Default Stripe Checkout Session',
      }),
      f('Application Fee Due (USD)', 'Number', {
        env: 'AIRTABLE_APPLICATION_FEE_DUE_USD_FIELD',
        notes: 'Optional column; when unset server skips writes',
      }),
      f('(group apply checkbox)', 'Checkbox', {
        env: 'VITE_AIRTABLE_APPLICATION_GROUP_CHECKBOX_FIELD',
        notes: 'Exact column name from your base when using optionalApplicationsTableSignerExtras',
      }),
      f('(group size)', 'Number', { env: 'VITE_AIRTABLE_APPLICATION_GROUP_SIZE_FIELD' }),
      f('(axis group id)', 'Single line text', { env: 'VITE_AIRTABLE_APPLICATION_AXIS_GROUP_ID_FIELD' }),
      f('2nd choice (optional)', 'Single line text', {
        env: 'VITE_AIRTABLE_APPLICATION_ROOM_CHOICE_2_FIELD',
        notes: 'Default from shared/application-airtable-fields.js',
      }),
      f('3rd choice (optional)', 'Single line text', {
        env: 'VITE_AIRTABLE_APPLICATION_ROOM_CHOICE_3_FIELD',
      }),
    ],
  },
]

function flattenForJson() {
  return {
    generatedConstants: {
      MAX_ROOM_SLOTS,
      MAX_BATHROOM_SLOTS,
      MAX_BATHROOM_SHARING_SLOTS,
      MAX_KITCHEN_SLOTS,
      MAX_SHARED_SPACE_SLOTS,
      MAX_LAUNDRY_SLOTS,
    },
    coreBase: {
      env: 'VITE_AIRTABLE_BASE_ID',
      tables: CORE_TABLES.map((t) => ({
        id: t.id,
        tableName: t.tableName,
        tableEnv: t.envTable,
        baseEnv: t.baseEnv,
        fieldCount: t.fields.length,
        fields: t.fields,
      })),
    },
    applicationsBase: {
      env: 'AIRTABLE_APPLICATIONS_BASE_ID',
      note: 'When unset, Applications may live in the same base as VITE_AIRTABLE_BASE_ID.',
      tables: APPLICATIONS_TABLES.map((t) => ({
        id: t.id,
        tableName: t.tableName,
        tableEnv: t.envTable,
        baseEnv: t.baseEnv,
        fieldCount: t.fields.length,
        fields: t.fields,
      })),
    },
  }
}

function pad(s, w) {
  const str = String(s)
  return str.length >= w ? str.slice(0, w) : str + ' '.repeat(w - str.length)
}

function printHuman() {
  const data = flattenForJson()
  console.log('Axis — full Airtable field specification (generated)\n')
  console.log('Constants:', JSON.stringify(data.generatedConstants))
  for (const section of [
    { title: 'CORE BASE', key: 'coreBase' },
    { title: 'APPLICATIONS BASE (may overlap core)', key: 'applicationsBase' },
  ]) {
    const block = data[section.key]
    console.log('\n' + '='.repeat(88))
    console.log(section.title)
    console.log(`Primary env: ${block.env}`)
    if (block.note) console.log(block.note)
    console.log('='.repeat(88))
    for (const t of block.tables) {
      console.log(`\n--- ${t.tableName} (${t.fieldCount} fields) ---`)
      console.log(`  Table env: ${t.tableEnv}`)
      console.log(`  Base env:  ${t.baseEnv}`)
      const wName = 44
      const wType = 22
      console.log(`  ${pad('Field', wName)} ${pad('Type', wType)} Req  Env / notes`)
      console.log(`  ${'-'.repeat(wName + wType + 30)}`)
      for (const field of t.fields) {
        const req = field.required ? 'Y' : ''
        const envNote = [field.env, field.notes].filter(Boolean).join(' — ')
        console.log(
          `  ${pad(field.name, wName)} ${pad(field.type, wType)} ${pad(req, 3)}  ${envNote || ''}`.trimEnd(),
        )
        if (field.options?.length) {
          console.log(`      options: ${field.options.join(', ')}`)
        }
      }
    }
  }
  console.log('\n' + '='.repeat(88))
  console.log('Other Info JSON keys (Properties → Other Info) — see frontend/src/lib/axisListingMeta.js')
  console.log('='.repeat(88))
  console.log(`
  Top-level: leasing, financials, roomsDetail, tourSettings, media, compliance, ...
  leasing: monthlyRent, securityDeposit, applicationFee, adminFee, petFee, parkingFee,
           utilitiesIncluded[], utilitiesPaidByResident[], leaseTerm, availableDate,
           guestPolicy, additionalLeaseTerms, houseRules, ...
  financials: monthlyRent, securityDeposit, applicationFee, adminFee, petFee, parkingFee,
             proratedRent, totalMoveIn, moveInFee, lastMonthRent, ...
`)
}

function main() {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(flattenForJson(), null, 2))
  } else {
    printHuman()
  }
}

main()
