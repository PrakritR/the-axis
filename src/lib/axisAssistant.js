/** CustomEvent name — Chatbot listens and opens with optional hint. */
export const AXIS_ASSISTANT_OPEN = 'axis-assistant-open'

/**
 * Open the floating Axis assistant from anywhere (forms, manager, etc.).
 * @param {{ topic?: string, hint?: string }} [detail]
 */
export function openAxisAssistant(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(AXIS_ASSISTANT_OPEN, {
      detail: {
        topic: String(detail.topic || 'general'),
        hint: String(detail.hint || '').trim(),
      },
    }),
  )
}

/**
 * Extra system instructions based on the current route (appended in Chatbot).
 */
export function buildRouteAssistantBlock(pathname) {
  const p = String(pathname || '')
  if (p.startsWith('/apply')) {
    return `## Current page: Housing application (/apply)
The user is on the rental application. Help them complete it step by step: one section or question at a time. Describe what each part of the form is for and what documents they may need.
NEVER ask them to paste a full SSN, bank login, card number, or passwords into chat — only use the secure form fields on the page.
Keep answers short and actionable.`
  }
  if (p.startsWith('/manager')) {
    return `## Current page: Manager portal
You help property managers with: tour calendar & weekly availability, approving tour requests, applications, lease drafts, rent/payments, work orders, properties/houses, and inbox messages.
Give concrete next steps (which area of the portal, what to look for). Remind them saving happens through the portal and Airtable-backed actions they trigger in the UI.`
  }
  if (p.startsWith('/resident')) {
    return `## Current page: Resident portal
Help with rent, maintenance and work orders, packages, documents, messages, and portal navigation. Keep replies brief and practical.`
  }
  if (p.startsWith('/contact')) {
    return `## Current page: Contact / tours
Help them choose the right path (housing tour vs software message), what details to include, and how booking works.`
  }
  if (p.startsWith('/portal')) {
    return `## Current page: Portal hub
Explain Resident vs Manager vs Admin access at a high level and who should use which entry. Do not share internal passwords unless the user clearly matches the Sentinel developer easter-egg rules in your base instructions.`
  }
  if (p.startsWith('/admin')) {
    return `## Current page: Internal admin
Help with approvals, properties, leads, applications, and leases at a workflow level. Do not invent data — remind them to verify in Airtable if unsure.`
  }
  return ''
}
