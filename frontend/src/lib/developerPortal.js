/** Session flag when admin opened internal manager/resident handoff (env CEO uses stub session below). */
export const AXIS_DEVELOPER_PORTAL_FLAG = 'axis_developer_portal_active'

const LEGACY_MANAGER_HANDOFF_KEY = 'axis_developer_manager_handoff'

/** Full-scope manager preview for env CEO sign-in (not a real Manager Profile row). */
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

/** Same-tab /manager preview for internal staff (CEO/CTO/CFO/SWE from Admin Profile) — not a real Manager Profile row. */
export function seedInternalStaffManagerSession({ email, name, staffRole }) {
  try {
    const stub = {
      id: 'rec_AXIS_INTERNAL_PREVIEW',
      email: String(email || '').trim() || 'staff@axis.internal',
      managerId: 'MGR-AXIS-INTERNAL',
      name: String(name || '').trim() || 'Axis internal',
      __axisDeveloper: false,
      __axisInternalStaff: true,
      axisStaffRole: String(staffRole || '').trim(),
    }
    sessionStorage.setItem('axis_manager', JSON.stringify(stub))
  } catch {
    /* ignore */
  }
}
