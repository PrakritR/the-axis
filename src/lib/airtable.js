const BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPS_BASE_ID = import.meta.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'
const API_KEY = import.meta.env.VITE_AIRTABLE_TOKEN
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`
const APPS_BASE_URL = `https://api.airtable.com/v0/${APPS_BASE_ID}`

const TABLES = {
  workOrders: 'Work Orders',
  messages: 'Messages',
  residents: 'Residents',
  announcements: 'Announcements',
  properties: 'Properties',
  rooms: 'Rooms',
  websiteSettings: 'Website Settings',
  payments: 'Payments',
  documents: 'Documents',
  packages: 'Packages',
}

function headers() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  }
}

function tableUrl(table) {
  return `${BASE_URL}/${encodeURIComponent(table)}`
}

function buildUrl(table, params = {}) {
  const url = new URL(tableUrl(table))
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value)
    }
  })
  return url.toString()
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    if (body.includes('INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND')) {
      throw new Error(`API token does not have access to this database. Edit your personal access token in your provider's developer hub and grant this base data.records:read and data.records:write scopes.`)
    }
    throw new Error(body)
  }

  return response.json()
}

function mapRecord(record) {
  return {
    id: record.id,
    ...record.fields,
    created_at: record.createdTime,
  }
}

function escapeFormulaValue(value) {
  return String(value).replace(/"/g, '\\"')
}

function titleCaseFromEmail(email) {
  const local = String(email || '').split('@')[0]
  return local
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Resident'
}

export async function getResidentById(recordId) {
  const data = await request(`${tableUrl(TABLES.residents)}/${recordId}`)
  return mapRecord(data)
}

export async function loginResident(email, password) {
  const resident = await getResidentByEmail(email)
  if (!resident) return null
  if (resident.Password !== password) return null
  return resident
}

export async function getResidentByEmail(email) {
  const formula = `{Email} = "${escapeFormulaValue(email)}"`
  const data = await request(buildUrl(TABLES.residents, {
    filterByFormula: formula,
    maxRecords: 1,
  }))

  const resident = data.records?.[0]
  return resident ? mapRecord(resident) : null
}

export async function createResident(fields) {
  const data = await request(tableUrl(TABLES.residents), {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })

  return mapRecord(data)
}

export async function updateResident(recordId, fields) {
  const data = await request(`${tableUrl(TABLES.residents)}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })

  return mapRecord(data)
}

export async function syncResidentFromAuth({ user, resident = null, profile = {} }) {
  const email = user?.email
  if (!email) return null

  const fields = {
    Email: email,
    'Supabase User ID': user.id,
    Status: 'Active',
  }

  fields.Name = profile.name || resident?.Name || titleCaseFromEmail(email)

  if (profile.house) fields.House = profile.house
  if (profile.unitNumber) fields['Unit Number'] = profile.unitNumber
  if (profile.phone) fields.Phone = profile.phone

  if (resident) {
    return updateResident(resident.id, fields)
  }

  return createResident(fields)
}

export async function getApplicationById(applicationId) {
  // Accepts APP-recXXX or bare recXXX formats
  const raw = String(applicationId || '').trim()
  const recordId = raw.startsWith('APP-') ? raw.slice(4) : raw
  if (!recordId.startsWith('rec') || recordId.length < 10) return null
  try {
    const data = await request(`${APPS_BASE_URL}/Applications/${recordId}`)
    return mapRecord(data)
  } catch {
    return null
  }
}

export async function getAnnouncements() {
  const data = await request(buildUrl(TABLES.announcements, {
    filterByFormula: '{Show} = TRUE()',
  }))

  const items = (data.records || []).map((record) => {
    const a = mapRecord(record)
    // Target can be an array (multi-select) or a string — normalise to array of lowercase tokens
    const rawTarget = Array.isArray(a.Target) ? a.Target : String(a.Target || a['Target Scope'] || '').split(/[\n,;]+/)
    return {
      ...a,
      Message: a.Message || a.Body || '',
      'Short Summary': a['Short Summary'] || '',
      Target: rawTarget.map((t) => String(t).trim().toLowerCase()).filter(Boolean),
      CreatedAt: a['Created At'] || a.created_at,
    }
  })

  // Pinned first, then newest first
  items.sort((a, b) => {
    const pinnedDiff = Number(Boolean(b.Pinned)) - Number(Boolean(a.Pinned))
    if (pinnedDiff !== 0) return pinnedDiff
    return new Date(b['Start Date'] || b['Date Posted'] || b.CreatedAt || b.created_at) -
           new Date(a['Start Date'] || a['Date Posted'] || a.CreatedAt || a.created_at)
  })

  return items
}

export async function getWorkOrdersForResident(resident) {
  // Work Orders "Resident" is a linked record field storing the Resident record ID.
  // "Resident Email" is a lookup (array) field — avoid LOWER() on it.
  const residentId = escapeFormulaValue(resident.id)
  const residentEmail = escapeFormulaValue(String(resident.Email || '').trim().toLowerCase())

  const formula = residentEmail
    ? `OR(FIND("${residentId}", ARRAYJOIN({Resident})) > 0, FIND("${residentEmail}", LOWER(ARRAYJOIN({Resident Email}))) > 0)`
    : `FIND("${residentId}", ARRAYJOIN({Resident})) > 0`

  const data = await request(buildUrl(TABLES.workOrders, {
    filterByFormula: formula,
  }))

  return (data.records || [])
    .map(mapRecord)
    .sort((a, b) => new Date(b['Date Submitted'] || b.created_at) - new Date(a['Date Submitted'] || a.created_at))
}

async function uploadAttachmentToRecord(table, recordId, fieldName, file) {
  const formData = new FormData()
  formData.append('file', file, file.name)
  formData.append('filename', file.name)
  formData.append('contentType', file.type || 'application/octet-stream')

  const response = await fetch(
    `https://content.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${recordId}/${encodeURIComponent(fieldName)}/uploadAttachment`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: formData,
    }
  )
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

function workOrderApplicationFieldsFromResident(resident) {
  const out = {}
  if (!resident) return out
  const aid = resident['Application ID']
  if (aid != null && String(aid).trim() !== '') {
    const n = Number(aid)
    if (Number.isFinite(n) && String(aid).trim() === String(n)) out['Application ID'] = n
    else out['Application ID'] = String(aid).trim()
  }
  const app = resident.Application
  if (Array.isArray(app) && app.length && String(app[0]).trim().startsWith('rec')) {
    out.Application = [String(app[0]).trim()]
  } else if (typeof app === 'string' && app.trim().startsWith('rec')) {
    out.Application = [app.trim()]
  }
  return out
}

export async function createWorkOrder({
  resident,
  title,
  category,
  urgency,
  description,
  preferredEntry,
  photoFile = null,
}) {
  const residentId = resident.id
  const airtablePriority = urgency === 'Emergency' ? 'Urgent' : urgency
  const normalizedDescription = urgency === 'Emergency'
    ? `Resident marked this request as Emergency.\n\n${description}`
    : description
  const fields = {
    Title: title,
    Description: normalizedDescription,
    Category: category,
    Priority: airtablePriority,
    Status: 'Submitted',
    'Preferred Entry Time': preferredEntry,
    Resident: [residentId],
    ...workOrderApplicationFieldsFromResident(resident),
  }

  const data = await request(tableUrl(TABLES.workOrders), {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })
  const record = mapRecord(data)

  if (photoFile) {
    try {
      await uploadAttachmentToRecord(TABLES.workOrders, record.id, 'Photo', photoFile)
    } catch (err) {
      console.warn('Photo upload failed (work order was still created):', err.message)
    }
  }

  return record
}

export async function getMessages(workOrderId) {
  const formula = `FIND("${escapeFormulaValue(workOrderId)}", ARRAYJOIN({Work Order})) > 0`
  const data = await request(buildUrl(TABLES.messages, {
    filterByFormula: formula,
  }))

  return (data.records || [])
    .map(mapRecord)
    .sort((a, b) => new Date(a.Timestamp || a.created_at) - new Date(b.Timestamp || b.created_at))
}

export async function sendMessage({ workOrderId, senderEmail, message, isAdmin = false }) {
  const data = await request(tableUrl(TABLES.messages), {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        Message: message,
        'Work Order': [workOrderId],
        'Sender Email': senderEmail,
        'Is Admin': isAdmin,
      },
      typecast: true,
    }),
  })

  return mapRecord(data)
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export async function getPaymentsForResident(resident) {
  const formula = `FIND("${escapeFormulaValue(resident.id)}", ARRAYJOIN({Resident})) > 0`
  const data = await request(buildUrl(TABLES.payments, {
    filterByFormula: formula,
    sort: [{ field: 'Due Date', direction: 'desc' }],
  }))
  return (data.records || []).map(mapRecord)
}

export async function getPropertyByName(propertyName) {
  if (!propertyName) return null
  const formula = `{Name} = "${escapeFormulaValue(propertyName)}"`
  const data = await request(buildUrl(TABLES.properties, {
    filterByFormula: formula,
    maxRecords: 1,
  }))
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export async function getDocumentsForResident(resident) {
  const formula = `AND(FIND("${escapeFormulaValue(resident.id)}", ARRAYJOIN({Resident})) > 0, {Visible to Resident} = 1)`
  const data = await request(buildUrl(TABLES.documents, { filterByFormula: formula }))
  return (data.records || []).map(mapRecord)
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------
export async function getPackagesForResident(resident) {
  const formula = `FIND("${escapeFormulaValue(resident.id)}", ARRAYJOIN({Resident})) > 0`
  const data = await request(buildUrl(TABLES.packages, {
    filterByFormula: formula,
    sort: [{ field: 'Arrival Date', direction: 'desc' }],
  }))
  return (data.records || []).map(mapRecord)
}

export async function markPackagePickedUp(recordId) {
  const data = await request(`${tableUrl(TABLES.packages)}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { Status: 'Picked Up' }, typecast: true }),
  })
  return mapRecord(data)
}

// ---------------------------------------------------------------------------
// Lease signing
// ---------------------------------------------------------------------------
export async function signLease(applicationRecordId, signatureText) {
  const today = new Date().toISOString().slice(0, 10)
  const data = await request(`${APPS_BASE_URL}/Applications/${applicationRecordId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        'Lease Signed': true,
        'Lease Signed Date': today,
        'Lease Signature': signatureText,
      },
      typecast: true,
    }),
  })
  return mapRecord(data)
}

// Returns currently active signed leases — used to overlay dynamic room unavailability
export async function getSignedLeases() {
  const formula = `AND({Lease Signed} = TRUE(), IS_AFTER({Lease End Date}, TODAY()))`
  const url = new URL(`${APPS_BASE_URL}/Applications`)
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('fields[]', 'Property Name')
  url.searchParams.set('fields[]', 'Room Number')
  url.searchParams.set('fields[]', 'Lease End Date')
  const data = await request(url.toString())
  return (data.records || []).map((r) => ({
    propertyName: r.fields['Property Name'] || '',
    roomNumber: r.fields['Room Number'] || '',
    leaseEndDate: r.fields['Lease End Date'] || '',
  }))
}

export const airtableReady = Boolean(
  BASE_ID &&
  API_KEY &&
  API_KEY !== 'your_airtable_token'
)

// ---------------------------------------------------------------------------
// Manager auth
// ---------------------------------------------------------------------------
export async function loginManager(email, password) {
  const formula = `AND({Email} = "${escapeFormulaValue(email)}", {Password} = "${escapeFormulaValue(password)}")`
  const data = await request(buildUrl('Managers', { filterByFormula: formula, maxRecords: 1 }))
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

export async function getManagerByEmail(email) {
  const formula = `{Email} = "${escapeFormulaValue(email)}"`
  const data = await request(buildUrl('Managers', { filterByFormula: formula, maxRecords: 1 }))
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

export async function updateManager(recordId, fields) {
  const data = await request(`${tableUrl('Managers')}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

// ---------------------------------------------------------------------------
// Manager — all work orders (across all properties)
// ---------------------------------------------------------------------------
export async function getAllWorkOrders() {
  const allRecords = []
  let offset = null
  do {
    const params = { sort: [{ field: 'Date Submitted', direction: 'desc' }] }
    if (offset) params.offset = offset
    const data = await request(buildUrl(TABLES.workOrders, params))
    ;(data.records || []).forEach((r) => allRecords.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)
  return allRecords
}

export async function getWorkOrderById(recordId) {
  const id = String(recordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) {
    throw new Error('Enter a valid Airtable record ID (e.g. recXXXXXXXXXXXXXX).')
  }
  const data = await request(`${tableUrl(TABLES.workOrders)}/${id}`)
  return mapRecord(data)
}

/** PATCH any Work Orders fields. Omits undefined entries. */
export async function updateWorkOrder(recordId, fields) {
  const id = String(recordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) {
    throw new Error('Invalid work order record ID.')
  }
  const cleaned = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  )
  if (Object.keys(cleaned).length === 0) {
    throw new Error('No fields to update.')
  }
  const data = await request(`${tableUrl(TABLES.workOrders)}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: cleaned, typecast: true }),
  })
  return mapRecord(data)
}

/** Append to Work Orders "Update" and set "Last Update" (date) when a resident sends a message. */
export async function appendWorkOrderUpdateFromResident(workOrderId, residentEmail, message) {
  const lineEmail = String(residentEmail || 'Resident').trim() || 'Resident'
  const current = await getWorkOrderById(workOrderId)
  const prev = String(current.Update || '').trim()
  const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const line = `[${stamp}] ${lineEmail}: ${message}`
  const next = prev ? `${prev}\n\n${line}` : line
  const today = new Date().toISOString().slice(0, 10)
  return updateWorkOrder(workOrderId, {
    Update: next,
    'Last Update': today,
  })
}

export async function updateWorkOrderStatus(recordId, status) {
  return updateWorkOrder(recordId, { Status: status })
}

// ---------------------------------------------------------------------------
// Manager — all messages (across all work orders)
// ---------------------------------------------------------------------------
export async function getAllMessages() {
  const allRecords = []
  let offset = null
  do {
    const params = { sort: [{ field: 'Timestamp', direction: 'desc' }] }
    if (offset) params.offset = offset
    const data = await request(buildUrl(TABLES.messages, params))
    ;(data.records || []).forEach((r) => allRecords.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)
  return allRecords
}

export async function sendManagerMessage({ workOrderId, message }) {
  const data = await request(tableUrl(TABLES.messages), {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        Message: message,
        'Work Order': [workOrderId],
        'Is Admin': true,
      },
      typecast: true,
    }),
  })
  return mapRecord(data)
}

// ---------------------------------------------------------------------------
// Manager — all applications
// ---------------------------------------------------------------------------
export async function getAllApplications() {
  const allRecords = []
  let offset = null
  do {
    const url = new URL(`${APPS_BASE_URL}/Applications`)
    url.searchParams.set('sort[0][field]', 'Created')
    url.searchParams.set('sort[0][direction]', 'desc')
    if (offset) url.searchParams.set('offset', offset)
    const data = await request(url.toString())
    ;(data.records || []).forEach((r) => allRecords.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)
  return allRecords
}

export async function getFullApplicationById(recordId) {
  const app = await request(`${APPS_BASE_URL}/Applications/${recordId}`)
  return mapRecord(app)
}

// ---------------------------------------------------------------------------
// Manager — lease management
// ---------------------------------------------------------------------------
export async function saveLease(recordId, { token, leaseJson, status = 'Pending' }) {
  const data = await request(`${APPS_BASE_URL}/Applications/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        'Lease Token': token,
        'Lease JSON': JSON.stringify(leaseJson),
        'Lease Status': status,
      },
      typecast: true,
    }),
  })
  return mapRecord(data)
}

export async function getLeaseByToken(token) {
  const formula = `{Lease Token} = "${escapeFormulaValue(token)}"`
  const url = new URL(`${APPS_BASE_URL}/Applications`)
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('maxRecords', '1')
  const data = await request(url.toString())
  const record = data.records?.[0]
  if (!record) return null
  const mapped = mapRecord(record)
  try {
    mapped._leaseData = mapped['Lease JSON'] ? JSON.parse(mapped['Lease JSON']) : null
  } catch {
    mapped._leaseData = null
  }
  return mapped
}

export async function updateLeaseRecord(recordId, fields) {
  const data = await request(`${APPS_BASE_URL}/Applications/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

// ---------------------------------------------------------------------------
// Manager — announcements management
// ---------------------------------------------------------------------------
export async function getAllAnnouncementsAdmin() {
  const data = await request(buildUrl(TABLES.announcements, {
    sort: [{ field: 'Created At', direction: 'desc' }],
  }))
  return (data.records || []).map(mapRecord)
}

export async function createAnnouncement(fields) {
  const data = await request(tableUrl(TABLES.announcements), {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

export async function updateAnnouncement(recordId, fields) {
  const data = await request(`${tableUrl(TABLES.announcements)}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

export async function deleteAnnouncement(recordId) {
  await request(`${tableUrl(TABLES.announcements)}/${recordId}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Lease Drafts — resident-facing read
// ---------------------------------------------------------------------------

// Returns the most recent approved-and-published (or signed) lease draft for a
// given resident record ID. This is what the resident portal shows in the
// Leasing tab. Drafts, "Under Review", and "Changes Needed" records are never
// returned here — residents must not see un-approved content.
export async function getApprovedLeaseForResident(residentRecordId) {
  if (!residentRecordId) return null
  const escaped = escapeFormulaValue(residentRecordId)
  const formula = `AND(
    {Resident Record ID} = "${escaped}",
    OR({Status} = "Published", {Status} = "Signed")
  )`
  const url = new URL(`${APPS_BASE_URL}/Lease%20Drafts`)
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('sort[0][field]', 'Published At')
  url.searchParams.set('sort[0][direction]', 'desc')
  url.searchParams.set('maxRecords', '1')
  const data = await request(url.toString())
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}
