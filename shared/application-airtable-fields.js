/**
 * Default Applications table field names in Airtable.
 * Override with VITE_AIRTABLE_APPLICATION_* (client) or AIRTABLE_APPLICATION_* (server).
 */

export const DEFAULT_AXIS_APPLICATION_ROOM_CHOICE_2 = '2nd choice (optional)'
export const DEFAULT_AXIS_APPLICATION_ROOM_CHOICE_3 = '3rd choice (optional)'
/** Applications column for the manager-assigned unit (override with VITE_/AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD). */
export const DEFAULT_AXIS_APPLICATION_APPROVED_ROOM = 'Approved Unit Room'

/**
 * Manager-assigned approved unit/room only. Does **not** fall back to the applicant’s first choice (`Room Number`).
 *
 * @param {Record<string, unknown>} app - Application row fields
 * @param {string} [approvedRoomField] - Airtable field name for manager-assigned room
 */
export function applicationApprovedUnitNumber(app, approvedRoomField = DEFAULT_AXIS_APPLICATION_APPROVED_ROOM) {
  const key = String(approvedRoomField || DEFAULT_AXIS_APPLICATION_APPROVED_ROOM).trim() || DEFAULT_AXIS_APPLICATION_APPROVED_ROOM
  const primary = String(app?.[key] ?? '').trim()
  if (primary) return primary
  /** Older bases used "Approved Room" before "Approved Unit Room". */
  if (key !== 'Approved Room') {
    const legacy = String(app?.['Approved Room'] ?? '').trim()
    if (legacy) return legacy
  }
  return ''
}

/**
 * Same as {@link applicationApprovedUnitNumber} — lease drafts, move-in math, and resident `Unit Number` must follow
 * the manager’s assignment only, not the application’s first room choice.
 *
 * @param {Record<string, unknown>} app
 * @param {string} [approvedRoomField]
 */
export function applicationLeaseRoomNumber(app, approvedRoomField = DEFAULT_AXIS_APPLICATION_APPROVED_ROOM) {
  return applicationApprovedUnitNumber(app, approvedRoomField)
}

/** True when the manager has set an approved unit/room (lease + resident must not use first choice alone). */
export function applicationHasApprovedUnitAssigned(app, approvedRoomField = DEFAULT_AXIS_APPLICATION_APPROVED_ROOM) {
  return Boolean(String(applicationLeaseRoomNumber(app, approvedRoomField) || '').trim())
}
