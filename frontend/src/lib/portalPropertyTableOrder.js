/**
 * Shared property-first table ordering for manager / admin / resident portals.
 * Replaces alphabetical "Property A–Z" toggles with:
 * - optional property filter (normalized key)
 * - default list: group by property, groups ordered by most recent activity, rows by updated desc
 */

/** @type {string} */
export const ALL_PROPERTIES_FILTER = ''

export function normalizePropertyFilterKey(displayName) {
  return String(displayName ?? '').trim().toLowerCase()
}

const UNKNOWN_PROPERTY_KEY = ''

/**
 * Dropdown options: { value: normalizedKey, label: display }.
 * Order: property with newest row first (max getUpdatedMs), then label tiebreaker.
 * @template T
 * @param {T[]} rows
 * @param {{ getPropertyDisplay: (row: T) => string, getUpdatedMs: (row: T) => number }} opts
 */
export function buildPropertyFilterOptionsFromRows(rows, { getPropertyDisplay, getUpdatedMs }) {
  const labelByKey = new Map()
  const maxTs = new Map()
  for (const row of rows || []) {
    const display = String(getPropertyDisplay(row) || '').trim()
    const key = normalizePropertyFilterKey(display)
    if (!key) continue
    if (!labelByKey.has(key)) labelByKey.set(key, display)
    const t = Number(getUpdatedMs(row)) || 0
    maxTs.set(key, Math.max(maxTs.get(key) || 0, t))
  }
  return [...labelByKey.entries()]
    .sort((a, b) => {
      const dt = (maxTs.get(b[0]) || 0) - (maxTs.get(a[0]) || 0)
      if (dt !== 0) return dt
      return String(a[1]).localeCompare(String(b[1]), undefined, { sensitivity: 'base' })
    })
    .map(([value, label]) => ({ value, label }))
}

/**
 * @template T
 * @param {T[]} rows
 * @param {{ getPropertyKey: (row: T) => string, getUpdatedMs: (row: T) => number, tieBreaker?: (a: T, b: T) => number }} opts
 */
export function sortRowsByPropertyGroupThenUpdatedDesc(rows, { getPropertyKey, getUpdatedMs, tieBreaker }) {
  const list = [...(rows || [])]
  const byKey = new Map()
  for (const row of list) {
    const k = getPropertyKey(row) || UNKNOWN_PROPERTY_KEY
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(row)
  }
  const groups = [...byKey.entries()].map(([key, items]) => {
    const sortedItems = [...items].sort((a, b) => {
      const d = getUpdatedMs(b) - getUpdatedMs(a)
      if (d !== 0) return d
      return tieBreaker ? tieBreaker(a, b) : 0
    })
    const maxT = sortedItems.length ? Math.max(...sortedItems.map((r) => getUpdatedMs(r) || 0)) : 0
    return { key, items: sortedItems, maxT }
  })
  groups.sort((a, b) => {
    if (b.maxT !== a.maxT) return b.maxT - a.maxT
    if (a.key === UNKNOWN_PROPERTY_KEY) return 1
    if (b.key === UNKNOWN_PROPERTY_KEY) return -1
    return String(a.key).localeCompare(String(b.key), undefined, { sensitivity: 'base' })
  })
  return groups.flatMap((g) => g.items)
}

/**
 * @template T
 * @param {T[]} rows
 * @param {string} selectedKey normalized key or ALL_PROPERTIES_FILTER
 * @param {(row: T) => string} getPropertyKey
 */
export function filterRowsByPropertyKey(rows, selectedKey, getPropertyKey) {
  const sk = String(selectedKey || '').trim().toLowerCase()
  if (!sk) return [...(rows || [])]
  return (rows || []).filter((row) => (getPropertyKey(row) || UNKNOWN_PROPERTY_KEY) === sk)
}
