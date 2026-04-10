/** Set when an Axis developer session is active (admin portal); used for UI + manager handoff. */
export const AXIS_DEVELOPER_PORTAL_FLAG = 'axis_developer_portal_active'

/** One-shot open /manager from admin in a new tab */
export const AXIS_DEVELOPER_MANAGER_HANDOFF = 'axis_developer_manager_handoff'

/** Management (demo) violet banner when opened from developer console */
export const AXIS_DEV_MANAGEMENT_BANNER = 'axis_developer_management_banner'

/** Synthetic manager record: full property scope via computeManagerScope branch */
export const DEVELOPER_MANAGER_STUB = {
  id: 'rec_AXIS_DEVELOPER',
  email: 'developer@axis.internal',
  managerId: 'MGR-AXISDEV',
  name: 'Axis Developer',
  __axisDeveloper: true,
}

export function markDeveloperPortalActive() {
  try {
    sessionStorage.setItem(AXIS_DEVELOPER_PORTAL_FLAG, '1')
  } catch {
    /* ignore */
  }
}

export function clearDeveloperPortalFlags() {
  try {
    sessionStorage.removeItem(AXIS_DEVELOPER_PORTAL_FLAG)
    localStorage.removeItem(AXIS_DEVELOPER_MANAGER_HANDOFF)
    localStorage.removeItem(AXIS_DEV_MANAGEMENT_BANNER)
  } catch {
    /* ignore */
  }
}

export function isDeveloperPortalMarked() {
  try {
    return sessionStorage.getItem(AXIS_DEVELOPER_PORTAL_FLAG) === '1'
  } catch {
    return false
  }
}

/** Same-tab navigation to /manager */
export function seedDeveloperManagerSession() {
  try {
    sessionStorage.setItem('axis_manager', JSON.stringify(DEVELOPER_MANAGER_STUB))
  } catch {
    /* ignore */
  }
}

/** New-tab open: consumer is Manager.jsx on load */
export function stashDeveloperManagerHandoffForNewTab() {
  try {
    localStorage.setItem(AXIS_DEVELOPER_MANAGER_HANDOFF, JSON.stringify(DEVELOPER_MANAGER_STUB))
  } catch {
    /* ignore */
  }
}

export function markDeveloperOpenedManagementDemo() {
  try {
    localStorage.setItem(AXIS_DEV_MANAGEMENT_BANNER, '1')
  } catch {
    /* ignore */
  }
}
