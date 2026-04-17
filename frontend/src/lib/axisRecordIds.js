/** Postgres-backed entity id (properties, rooms, applications, …) — not an Airtable `rec…` record. */
const INTERNAL_AXIS_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isInternalAxisRecordId(id) {
  return INTERNAL_AXIS_UUID_RE.test(String(id || '').trim())
}
