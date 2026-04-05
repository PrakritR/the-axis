const BASE_ID = 'appol57LKtMKaQ75T'
const API_KEY = import.meta.env.VITE_AIRTABLE_TOKEN
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

const headers = () => ({
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
})

// ─── Work Orders ──────────────────────────────────────────────────────────────

export async function createWorkOrder({ residentEmail, residentId, category, title, description, priority }) {
  const res = await fetch(`${BASE_URL}/Work%20Orders`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      fields: {
        Title: title,
        Description: description,
        Category: category,
        Priority: priority,
        Status: 'open',
        'Resident Email': residentEmail,
        'Resident ID': residentId,
      },
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getWorkOrders(residentId) {
  const formula = encodeURIComponent(`{Resident ID} = "${residentId}"`)
  const res = await fetch(`${BASE_URL}/Work%20Orders?filterByFormula=${formula}`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return (data.records || []).map(r => ({ id: r.id, ...r.fields, created_at: r.createdTime }))
}

export async function updateWorkOrderStatus(recordId, status) {
  const res = await fetch(`${BASE_URL}/Work%20Orders/${recordId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ fields: { Status: status } }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getMessages(workOrderId) {
  const formula = encodeURIComponent(`{Work Order ID} = "${workOrderId}"`)
  const res = await fetch(`${BASE_URL}/Messages?filterByFormula=${formula}`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return (data.records || []).map(r => ({ id: r.id, ...r.fields, created_at: r.createdTime }))
}

export async function sendMessage({ workOrderId, senderEmail, message, isAdmin = false }) {
  const res = await fetch(`${BASE_URL}/Messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      fields: {
        'Work Order ID': workOrderId,
        'Sender Email': senderEmail,
        Message: message,
        'Is Admin': isAdmin,
      },
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export const airtableReady = Boolean(API_KEY && API_KEY !== 'your_airtable_token')
