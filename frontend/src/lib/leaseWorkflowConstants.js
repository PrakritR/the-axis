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
    label: 'Admin Review',
    short: 'Admin Review',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
    adminActionNeeded: true,
    managerActionNeeded: false,
    description: 'Manager requested changes; lease is with admin for review',
  },
  'Admin In Review': {
    label: 'Admin Reviewing',
    short: 'Reviewing',
    bg: 'bg-indigo-50',
    text: 'text-indigo-700',
    border: 'border-indigo-200',
    dot: 'bg-indigo-500',
    adminActionNeeded: true,
    managerActionNeeded: false,
    description: 'Admin is reviewing the lease',
  },
  'Changes Made': {
    label: 'Updated by Admin',
    short: 'Updated',
    bg: 'bg-violet-50',
    text: 'text-violet-700',
    border: 'border-violet-200',
    dot: 'bg-violet-500',
    adminActionNeeded: false,
    managerActionNeeded: true,
    description: 'Admin updated the lease — manager can review, comment, and send another request or publish',
  },
  'Sent Back to Manager': {
    label: 'Back with Manager',
    short: 'Manager Review',
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
    dot: 'bg-orange-500',
    adminActionNeeded: false,
    managerActionNeeded: true,
    description: 'Lease is back with the manager',
  },
  'Manager Approved': {
    label: 'Approved by Manager',
    short: 'Approved',
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    dot: 'bg-green-500',
    adminActionNeeded: true,
    managerActionNeeded: false,
    description: 'Manager approved the lease',
  },
  'Ready for Signature': {
    label: 'Ready to Send',
    short: 'Ready',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
    adminActionNeeded: false,
    managerActionNeeded: false,
    description: 'Lease is ready to send to the resident',
  },
  // ── Legacy / existing statuses preserved ──
  'Draft Generated': {
    label: 'Manager Review',
    short: 'Manager Review',
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
    adminActionNeeded: false,
    managerActionNeeded: true,
    description: 'Lease draft is with the manager for review',
  },
  'Under Review': {
    label: 'Reviewing',
    short: 'Reviewing',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-400',
    adminActionNeeded: false,
    managerActionNeeded: false,
    description: 'Lease is being reviewed',
  },
  'Changes Needed': {
    label: 'Needs Changes',
    short: 'Changes Needed',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-400',
    adminActionNeeded: false,
    managerActionNeeded: true,
    description: 'Lease needs changes before moving forward',
  },
  'Approved': {
    label: 'Ready',
    short: 'Ready',
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    dot: 'bg-green-500',
    adminActionNeeded: false,
    managerActionNeeded: false,
    description: 'Lease is ready',
  },
  'Published': {
    label: 'With Resident',
    short: 'Resident',
    bg: 'bg-teal-50',
    text: 'text-teal-700',
    border: 'border-teal-200',
    dot: 'bg-teal-500',
    adminActionNeeded: false,
    managerActionNeeded: false,
    description: 'Lease has been sent to the resident',
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
    description: 'Lease has been signed',
  },
}

export const WORKFLOW_STATUS_LIST = Object.keys(LEASE_WORKFLOW_STATUS_CONFIG)

/** Statuses where the manager can submit or re-submit an edit request */
export const MANAGER_CAN_SUBMIT_REQUEST = new Set([
  'Draft Generated',
  'Under Review',
  'Changes Needed',
  'Sent Back to Manager',
  /** Admin used "Mark Changes Made" — same as send-back: manager may request further edits */
  'Changes Made',
])

/** Statuses where the manager can approve or request more changes */
export const MANAGER_CAN_REVIEW_ADMIN_UPDATE = new Set([
  'Sent Back to Manager',
  'Changes Made',
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
  { value: 'Sent Back to Manager',  label: 'Send to Manager' },
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
