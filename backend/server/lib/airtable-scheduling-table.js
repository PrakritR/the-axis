/**
 * Core base table for booked tours, booked meetings, work-order calendar rows,
 * and (legacy) meeting-availability rows. Public site uses handlers that write here.
 */
export function schedulingAirtableTableName() {
  const raw = String(process.env.AIRTABLE_SCHEDULING_TABLE || process.env.VITE_AIRTABLE_SCHEDULING_TABLE || '').trim()
  return raw || 'Scheduling'
}
