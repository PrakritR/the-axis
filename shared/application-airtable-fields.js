/**
 * Default Applications table field names in Airtable.
 * Override with VITE_AIRTABLE_APPLICATION_* (client) or AIRTABLE_APPLICATION_* (server).
 */

export const DEFAULT_AXIS_APPLICATION_ROOM_CHOICE_2 = '2nd choice (optional)'
export const DEFAULT_AXIS_APPLICATION_ROOM_CHOICE_3 = '3rd choice (optional)'
export const DEFAULT_AXIS_APPLICATION_APPROVED_ROOM = 'Approved Room'

/**
 * Room used for lease generation / pricing after manager approval.
 * Prefer {@link DEFAULT_AXIS_APPLICATION_APPROVED_ROOM} when set; otherwise first choice ({Room Number}).
 *
 * @param {Record<string, unknown>} app - Application row fields
 * @param {string} [approvedRoomField] - Airtable field name for manager-assigned room
 */
export function applicationLeaseRoomNumber(app, approvedRoomField = DEFAULT_AXIS_APPLICATION_APPROVED_ROOM) {
  const key = String(approvedRoomField || DEFAULT_AXIS_APPLICATION_APPROVED_ROOM).trim() || DEFAULT_AXIS_APPLICATION_APPROVED_ROOM
  const ar = String(app?.[key] ?? '').trim()
  if (ar) return ar
  return String(app?.['Room Number'] ?? '').trim()
}
