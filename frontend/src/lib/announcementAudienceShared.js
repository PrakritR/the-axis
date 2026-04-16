/**
 * Audience / targeting helpers for announcements (shared by Supabase mapper + legacy call sites).
 */

/** Embedded in audience text to attribute pending rows; stripped for resident matching. */
export const ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX = '__axis_submitter__:'

export function splitAnnouncementTargetSegments(raw) {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) {
    return raw.flatMap((x) => splitAnnouncementTargetSegments(x))
  }
  return String(raw)
    .split(/[\n,;|]+/)
    .map((t) => String(t).trim())
    .filter(Boolean)
}

/** Human-readable audience string (hides internal submitter token). */
export function announcementAudienceDisplayText(record) {
  const pre = ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX.toLowerCase()
  const parts = splitAnnouncementTargetSegments(record?.Target ?? record?.['Target Scope'] ?? record?.audience ?? '')
  const vis = parts.filter((s) => !String(s).trim().toLowerCase().startsWith(pre))
  return vis.length ? vis.join(', ') : 'All Properties'
}

/** Tokens used for resident targeting (excludes internal submitter marker). */
export function announcementResidentTargetTokens(recordOrTarget) {
  const raw =
    typeof recordOrTarget === 'string' || Array.isArray(recordOrTarget)
      ? recordOrTarget
      : recordOrTarget?.Target ?? recordOrTarget?.['Target Scope'] ?? recordOrTarget?.audience ?? ''
  const pre = ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX.toLowerCase()
  return splitAnnouncementTargetSegments(raw)
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t && !t.startsWith(pre))
}

export function parseAnnouncementSubmitterEmail(record) {
  const raw = record?.Target ?? record?.['Target Scope'] ?? record?.audience ?? ''
  const pre = ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX
  for (const seg of splitAnnouncementTargetSegments(raw)) {
    const s = String(seg).trim()
    if (s.toLowerCase().startsWith(pre.toLowerCase())) {
      return s.slice(pre.length).trim().toLowerCase()
    }
  }
  return ''
}

export function buildAnnouncementTargetField({ audienceText, submitterEmail, embedSubmitter }) {
  const base = String(audienceText || '').trim() || 'All Properties'
  if (!embedSubmitter) return base
  const em = String(submitterEmail || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, '_')
  if (!em.includes('@')) return base
  const tok = `${ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX}${em}`
  if (base.toLowerCase().includes(tok.toLowerCase())) return base
  return `${base}, ${tok}`
}

export function isAnnouncementPending(record) {
  if (!record) return false
  if (record.status === 'draft' || record.status === 'archived') return true
  const s = record.Show
  return s !== true && s !== 1 && s !== '1'
}

/**
 * Whether an announcement (legacy-shaped after mapper) applies to this resident profile.
 */
export function announcementMatchesResident(record, resident) {
  const tokens = announcementResidentTargetTokens(record)
  if (!tokens.length) return true
  const norm = (v) =>
    String(v || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  if (tokens.some((t) => t === 'all properties' || t === 'all' || t === 'all_residents')) return true

  const house = norm(resident?.House)
  const propName = norm(resident?.['Property Name'])
  const propField = norm(resident?.Property)
  const unit = norm(resident?.['Unit Number'])
  const hay = new Set()
  for (const x of [house, propName, propField].filter(Boolean)) hay.add(x)
  if (house && unit) {
    hay.add(`${house} ${unit}`.trim())
    hay.add(`${house}-${unit}`.replace(/\s+/g, ' ').trim())
    hay.add(`${house.replace(/\s+/g, '')}-${unit.replace(/\s+/g, '')}`)
  }

  for (const t of tokens) {
    if (!t) continue
    for (const h of hay) {
      if (!h) continue
      if (h === t || h.includes(t) || t.includes(h)) return true
    }
  }
  return false
}
