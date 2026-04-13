/**
 * leaseWorkflowConstants.js
 *
 * Shared constants for the lease editing back-and-forth workflow.
 * Used by both ManagerLeasingTab and AdminLeasingTab.
 */

// ─── Status Configuration ─────────────────────────────────────────────────────
// Each entry defines display label, color classes, and which party can act next.
export const LEASE_WORKFLOW_STATUS_CONFIG = {
  // ── New workflow statuses ──
  'Submitted to Admin': {
    label: 'Submitted to Admin',
    short: 'Submitted',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
    adminActionNeeded: true,
    managerActionNeeded: false,
    description: 'Manager submitted edit request — awaiting admin review',
  },
  'Admin In Review': {
    label: 'Admin In Review',
    short: 'In Review',
    bg: 'bg-indigo-50',
    text: 'text-indigo-700',
    border: 'border-indigo-200',
    dot: 'bg-indigo-500',
    adminActionNeeded: true,
    managerActionNeeded: false,
    description: 'Admin is currently reviewing the lease',
  },
  'Changes Made': {
    label: 'Changes Made',
    short: 'Changes Made',
    bg: 'bg-violet-50',
    text: 'text-violet-700',
    border: 'border-violet-200',
    dot: 'bg-violet-500',
    adminActionNeeded: true,
    managerActionNeeded: false,
    description: 'Admin has made changes — ready to send back to manager',
  },
  'Sent Back to Manager': {
    label: 'Sent Back — Review',
    short: 'Review Needed',
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
    dot: 'bg-orange-500',
    adminActionNeeded: false,
    managerActionNeeded: true,
    description: 'Admin sent updated lease — manager must approve or request more changes',
  },
  'Manager Approved': {
    label: 'Manager Approved',
    short: 'Approved',
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    dot: 'bg-green-500',
    adminActionNeeded: true,
    managerActionNeeded: false,
    description: 'Manager approved — admin can finalize and send for signature',
  },
  'Ready for Signature': {
    label: 'Ready for Signature',
    short: 'Sign Ready',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
    adminActionNeeded: false,
    managerActionNeeded: false,
    description: 'Lease finalized — ready to send to resident for signature',
  },
  // ── Legacy / existing statuses preserved ──
  'Draft Generated': {
    label: 'Draft Generated',
    short: 'Draft',
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
    adminActionNeeded: false,
    managerActionNeeded: true,
    description: 'AI or template draft created — manager should review',
  },
  'Under Review': {
    label: 'Under Review',
    short: 'Under Review',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-400',
    adminActionNeeded: false,
    managerActionNeeded: false,
    description: 'Lease is under review',
  },
  'Changes Needed': {
    label: 'Changes Needed',
    short: 'Changes Needed',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-400',
    adminActionNeeded: false,
    managerActionNeeded: true,
    description: 'Changes needed before proceeding',
  },
  'Approved': {
    label: 'Approved',
    short: 'Approved',
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    dot: 'bg-green-500',
    adminActionNeeded: false,
    managerActionNeeded: false,
    description: 'Lease approved',
  },
  'Published': {
    label: 'Sent to Resident',
    short: 'Sent',
    bg: 'bg-teal-50',
    text: 'text-teal-700',
    border: 'border-teal-200',
    dot: 'bg-teal-500',
    adminActionNeeded: false,
    managerActionNeeded: false,
    description: 'Lease sent to resident for review/signature',
  },
  'Signed': {
    label: 'Signed',
    short: 'Signed',
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
    dot: 'bg-purple-500',
    adminActionNeeded: false,
    managerActionNeeded: false,
    description: 'Lease fully executed',
  },
}

export const WORKFLOW_STATUS_LIST = Object.keys(LEASE_WORKFLOW_STATUS_CONFIG)

/** Statuses where the manager can submit or re-submit an edit request */
export const MANAGER_CAN_SUBMIT_REQUEST = new Set([
  'Draft Generated',
  'Under Review',
  'Changes Needed',
  'Sent Back to Manager',
])

/** Statuses where the manager can approve or request more changes */
export const MANAGER_CAN_REVIEW_ADMIN_UPDATE = new Set([
  'Sent Back to Manager',
])

/** Statuses that are "active" in the back-and-forth workflow tab */
export const WORKFLOW_ACTIVE_STATUSES = new Set([
  'Submitted to Admin',
  'Admin In Review',
  'Changes Made',
  'Sent Back to Manager',
  'Manager Approved',
  'Ready for Signature',
])

/** Statuses the admin can set when responding to a lease */
export const ADMIN_RESPONSE_STATUSES = [
  { value: 'Admin In Review',       label: 'Set to In Review' },
  { value: 'Changes Made',          label: 'Mark Changes Made' },
  { value: 'Sent Back to Manager',  label: 'Send Back to Manager' },
  { value: 'Manager Approved',      label: 'Mark Manager Approved' },
  { value: 'Ready for Signature',   label: 'Mark Ready for Signature' },
]

/** Get config for a status, falling back to a generic style */
export function getStatusConfig(status) {
  return LEASE_WORKFLOW_STATUS_CONFIG[status] ?? {
    label: status || 'Unknown',
    short: status || 'Unknown',
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
    adminActionNeeded: false,
    managerActionNeeded: false,
    description: '',
  }
}

/** Format an ISO timestamp to human-readable "Jan 15, 2026, 2:04 PM" */
export function fmtTs(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
  } catch {
    return iso
  }
}

/** Format a dollar amount */
export function fmtDollar(value) {
  if (!value) return '—'
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 0 })}`
}

/** Parse Manager Edit Notes JSON safely */
export function parseManagerEditNotes(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) return parsed
    return { freeText: raw }
  } catch {
    return { freeText: raw }
  }
}

/** Parse Admin Response Notes JSON safely */
export function parseAdminResponseNotes(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) return parsed
    return { freeText: raw }
  } catch {
    return { freeText: raw }
  }
}
