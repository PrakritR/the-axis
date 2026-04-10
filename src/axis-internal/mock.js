/**
 * Mock data for Axis Management + Axis Admin internal portals.
 * Replace fetch* calls later with Airtable/API — keep the same object shapes where possible.
 */

export const MOCK_MANAGEMENT_USER = {
  id: 'mgmt_demo_1',
  name: 'Jordan Lee',
  email: 'jordan@example.com',
  businessName: 'Lee Housing Partners',
  verificationStatus: 'verified',
  agreementSigned: true,
  onboardingSteps: [
    { id: 'profile', label: 'Complete profile', done: true },
    { id: 'agreement', label: 'Partner agreement', done: true },
    { id: 'first_property', label: 'Submit first property', done: true },
    { id: 'admin_review', label: 'Axis admin review', done: false },
  ],
}

/** Management-submitted properties */
export const MOCK_PROPERTIES = [
  {
    id: 'prop_1',
    ownerId: 'mgmt_demo_1',
    name: '4709A 8th Ave NE',
    address: '4709A 8th Ave NE, Seattle, WA',
    description: 'Coliving near UW — shared kitchen and living.',
    rooms: 6,
    bathrooms: 3,
    rentFrom: 950,
    deposit: 500,
    utilitiesIncluded: 'WiFi, water, trash',
    amenities: ['Furnished', 'Laundry', 'Parking'],
    photos: 4,
    availableDate: '2026-09-01',
    contactPhone: '2065550100',
    notesFromOwner: 'Prefer graduate students.',
    adminNotesInternal: 'Zoning check completed.',
    adminNotesVisible: 'Please add fire extinguisher photo.',
    status: 'live',
    submittedAt: '2026-03-01T12:00:00Z',
    occupancy: 4,
  },
  {
    id: 'prop_2',
    ownerId: 'mgmt_demo_1',
    name: '5259 Brooklyn Ave NE',
    address: '5259 Brooklyn Ave NE, Seattle, WA',
    description: 'Townhouse-style shared housing.',
    rooms: 5,
    bathrooms: 2,
    rentFrom: 1100,
    deposit: 600,
    utilitiesIncluded: 'WiFi, water',
    amenities: ['Deck', 'Yard'],
    photos: 2,
    availableDate: '2026-08-15',
    contactPhone: '2065550101',
    notesFromOwner: '',
    adminNotesInternal: '',
    adminNotesVisible: '',
    status: 'pending',
    submittedAt: '2026-04-02T10:00:00Z',
    occupancy: 0,
  },
  {
    id: 'prop_3',
    ownerId: 'mgmt_demo_1',
    name: 'Cap Hill Studio Row',
    address: '1200 E Pine St, Seattle, WA',
    description: 'New listing — awaiting photos.',
    rooms: 4,
    bathrooms: 2,
    rentFrom: 1200,
    deposit: 700,
    utilitiesIncluded: 'All utilities',
    amenities: [],
    photos: 0,
    availableDate: '2026-07-01',
    contactPhone: '2065550199',
    notesFromOwner: 'Draft listing',
    adminNotesInternal: 'Need insurance cert.',
    adminNotesVisible: 'We requested edits on pricing.',
    status: 'changes_requested',
    submittedAt: '2026-04-05T14:00:00Z',
    occupancy: 0,
  },
]

export const MOCK_APPLICATIONS = [
  {
    id: 'app_1',
    propertyId: 'prop_1',
    ownerId: 'mgmt_demo_1',
    applicantName: 'Alex Rivera',
    applicantEmail: 'alex@university.edu',
    propertyName: '4709A 8th Ave NE',
    status: 'under_review',
    submittedAt: '2026-04-08T09:00:00Z',
    notes: 'Requested ground floor.',
    managementReviewed: false,
    finalApprovalBy: 'axis_admin',
    roomPreference: 'Room B',
  },
  {
    id: 'app_2',
    propertyId: 'prop_1',
    ownerId: 'mgmt_demo_1',
    applicantName: 'Sam Chen',
    applicantEmail: 'sam.chen@email.com',
    propertyName: '4709A 8th Ave NE',
    status: 'approved',
    submittedAt: '2026-03-20T11:00:00Z',
    notes: '',
    managementReviewed: true,
    finalApprovalBy: 'axis_admin',
    roomPreference: 'Room D',
  },
  {
    id: 'app_3',
    propertyId: 'prop_2',
    ownerId: 'mgmt_demo_1',
    applicantName: 'Taylor Kim',
    applicantEmail: 'tkim@email.com',
    propertyName: '5259 Brooklyn Ave NE',
    status: 'submitted',
    submittedAt: '2026-04-09T16:00:00Z',
    notes: '',
    managementReviewed: false,
    finalApprovalBy: 'axis_admin',
    roomPreference: '—',
  },
]

/** Lease pipeline — extended statuses for dual approval */
export const MOCK_LEASES = [
  {
    id: 'lease_1',
    propertyId: 'prop_1',
    applicationId: 'app_2',
    ownerId: 'mgmt_demo_1',
    residentName: 'Sam Chen',
    propertyName: '4709A 8th Ave NE',
    status: 'signed',
    managerApprovedAt: '2026-03-22T10:00:00Z',
    adminApprovedAt: '2026-03-23T10:00:00Z',
    sentToResidentAt: '2026-03-24T10:00:00Z',
    signedAt: '2026-03-26T10:00:00Z',
    updatedAt: '2026-03-26T10:00:00Z',
  },
  {
    id: 'lease_2',
    propertyId: 'prop_1',
    applicationId: 'app_1',
    ownerId: 'mgmt_demo_1',
    residentName: 'Alex Rivera',
    propertyName: '4709A 8th Ave NE',
    status: 'admin_review',
    managerApprovedAt: '2026-04-09T12:00:00Z',
    adminApprovedAt: null,
    sentToResidentAt: null,
    signedAt: null,
    updatedAt: '2026-04-09T12:00:00Z',
  },
]

/** management ↔ admin threads (propertyId optional for context) */
export const MOCK_THREADS = [
  {
    id: 'th_1',
    participantRole: 'admin',
    managementUserId: 'mgmt_demo_1',
    propertyId: 'prop_2',
    subject: '5259 Brooklyn — pending review',
    preview: 'We will review your submission within 2 business days.',
    unreadForManagement: true,
    updatedAt: '2026-04-06T15:00:00Z',
  },
  {
    id: 'th_2',
    participantRole: 'admin',
    managementUserId: 'mgmt_demo_1',
    propertyId: null,
    subject: 'Onboarding checklist',
    preview: 'Please upload your W-9 when ready.',
    unreadForManagement: false,
    updatedAt: '2026-03-28T09:00:00Z',
  },
]

export const MOCK_THREAD_MESSAGES = {
  th_1: [
    { id: 'm1', from: 'admin', body: 'Thanks for submitting 5259 Brooklyn. Our team is reviewing photos.', at: '2026-04-05T10:00:00Z' },
    { id: 'm2', from: 'management', body: 'Happy to add more exterior shots if needed.', at: '2026-04-05T18:00:00Z' },
    { id: 'm3', from: 'admin', body: 'We will review your submission within 2 business days.', at: '2026-04-06T15:00:00Z' },
  ],
  th_2: [
    { id: 'm4', from: 'admin', body: 'Welcome to Axis Management. Next step: W-9.', at: '2026-03-28T09:00:00Z' },
  ],
}

export const MOCK_LEADS = [
  {
    id: 'lead_1',
    name: 'Priya Shah',
    email: 'priya@email.com',
    phone: '4255550142',
    source: 'Partner With Axis form',
    status: 'new',
    notes: 'Owns 3 units near campus.',
    lastContactAt: null,
    createdAt: '2026-04-08T08:00:00Z',
  },
  {
    id: 'lead_2',
    name: 'Marcus Johnson',
    email: 'marcus.j@email.com',
    phone: '2065550177',
    source: 'Owners pricing page',
    status: 'contacted',
    notes: 'Callback scheduled Thursday.',
    lastContactAt: '2026-04-07T14:00:00Z',
    createdAt: '2026-04-01T11:00:00Z',
  },
  {
    id: 'lead_3',
    name: 'Elena Vogt',
    email: 'elena.v@email.com',
    phone: '',
    source: 'Referral',
    status: 'qualified',
    notes: 'Interested in full-service management.',
    lastContactAt: '2026-04-05T10:00:00Z',
    createdAt: '2026-03-15T09:00:00Z',
  },
]

export const MOCK_MANAGEMENT_ACCOUNTS = [
  { ...MOCK_MANAGEMENT_USER, propertyCount: 3, leadSource: 'Direct', enabled: true, createdAt: '2026-01-10T12:00:00Z' },
  {
    id: 'mgmt_demo_2',
    name: 'North End LLC',
    email: 'contact@northend.example',
    businessName: 'North End LLC',
    verificationStatus: 'pending',
    agreementSigned: false,
    propertyCount: 0,
    leadSource: 'Partner form',
    enabled: true,
    createdAt: '2026-04-07T16:00:00Z',
  },
]

// --- Labels for UI ---
export const PROPERTY_STATUS_LABEL = {
  pending: 'Pending approval',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  live: 'Live',
  inactive: 'Inactive',
}

export const LEASE_PIPELINE_LABEL = {
  draft: 'Draft generated',
  under_review: 'Under review',
  manager_ok: 'Approved by manager',
  admin_review: 'Awaiting Axis admin',
  admin_ok: 'Approved by admin',
  sent_resident: 'Sent to resident',
  signed: 'Signed',
  archived: 'Archived',
}

export const LEAD_STATUS_LABEL = {
  new: 'New lead',
  contacted: 'Contacted',
  follow_up: 'Follow-up needed',
  qualified: 'Qualified',
  onboarded: 'Onboarded',
  closed: 'Closed',
}

export function propertiesForOwner(ownerId, extra = []) {
  return [...MOCK_PROPERTIES.filter((p) => p.ownerId === ownerId), ...extra]
}

export function applicationsForOwner(ownerId) {
  return MOCK_APPLICATIONS.filter((a) => a.ownerId === ownerId)
}

export function leasesForOwner(ownerId) {
  return MOCK_LEASES.filter((l) => l.ownerId === ownerId)
}

export function threadsForManagement(userId) {
  return MOCK_THREADS.filter((t) => t.managementUserId === userId)
}
