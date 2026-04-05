const BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const API_KEY = import.meta.env.VITE_AIRTABLE_TOKEN
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

const TABLES = {
  workOrders: 'Work Orders',
  messages: 'Messages',
  residents: 'Residents',
  announcements: 'Announcements',
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
    throw new Error(await response.text())
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
    body: JSON.stringify({ fields }),
  })

  return mapRecord(data)
}

export async function updateResident(recordId, fields) {
  const data = await request(`${tableUrl(TABLES.residents)}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
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
  const supabaseUserId = resident['Supabase User ID'] || ''
  const formula = `OR(FIND("${escapeFormulaValue(residentId)}", ARRAYJOIN({Resident})) > 0, {Supabase User ID} = "${escapeFormulaValue(supabaseUserId)}")`
  const data = await request(buildUrl(TABLES.workOrders, {
    filterByFormula: formula,
  }))

  return (data.records || [])
    .map(mapRecord)
    .sort((a, b) => new Date(b['Date Submitted'] || b.created_at) - new Date(a['Date Submitted'] || a.created_at))
}

export async function createWorkOrder({
  resident,
  title,
  category,
  urgency,
  description,
  preferredEntry,
  photoAttachment = null,
}) {
  const residentId = resident.id
  const supabaseUserId = resident['Supabase User ID'] || ''
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
    'Supabase User ID': supabaseUserId,
  }

  if (photoAttachment?.url) {
    fields.Photo = [{ url: photoAttachment.url, filename: photoAttachment.filename || 'issue-photo' }]
  }

  const data = await request(tableUrl(TABLES.workOrders), {
    method: 'POST',
    body: JSON.stringify({
      fields,
    }),
  })

  return mapRecord(data)
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
    }),
  })

  return mapRecord(data)
}

export const airtableReady = Boolean(
  BASE_ID &&
  API_KEY &&
  API_KEY !== 'your_airtable_token'
)
