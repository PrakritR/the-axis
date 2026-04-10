/** Set when an Axis developer session is active (admin portal); used for UI. */
export const AXIS_DEVELOPER_PORTAL_FLAG = 'axis_developer_portal_active'

const LEGACY_MANAGER_HANDOFF_KEY = 'axis_developer_manager_handoff'

const DEVELOPER_MANAGER_STUB = {
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
    localStorage.removeItem(LEGACY_MANAGER_HANDOFF_KEY)
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

/** Same-tab navigation to /manager with full-scope developer preview */
export function seedDeveloperManagerSession() {
  try {
    sessionStorage.setItem('axis_manager', JSON.stringify(DEVELOPER_MANAGER_STUB))
  } catch {
    /* ignore */
  }
}
