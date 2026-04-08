const BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appNBX2inqfJMyqYV'
const API_KEY = import.meta.env.VITE_AIRTABLE_TOKEN
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

const TABLES = {
  workOrders: 'Work Orders',
  messages: 'Messages',
  residents: 'Residents',
  announcements: 'Announcements',
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
      throw new Error(`Airtable token does not have access to base ${BASE_ID}. Go to airtable.com/create/tokens, edit your token, and add your base with data.records:read + data.records:write scopes.`)
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

export async function getAnnouncements() {
  const formula = 'OR({Active} = 1, {Active} = TRUE(), {Active} = "1")'
  const data = await request(buildUrl(TABLES.announcements, {
    filterByFormula: formula,
  }))

  return (data.records || []).map(mapRecord)
}

export async function getWorkOrdersForResident(resident) {
  const residentId = resident.id
  const formula = `FIND("${escapeFormulaValue(residentId)}", ARRAYJOIN({Resident})) > 0`
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

export const airtableReady = Boolean(
  BASE_ID &&
  API_KEY &&
  API_KEY !== 'your_airtable_token'
)
