/**
 * Housing navigation uses site-relative paths so localhost, preview, and production
 * all stay on the current origin. Use getHousingSiteOrigin() only for absolute URLs
 * (e.g. share links, mailto bodies).
 */
const PROD_DEFAULT_ORIGIN = 'https://www.axis-seattle-housing.com'

/** Current site origin in the browser; falls back to env or prod default during build/SSR. */
export function getHousingSiteOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '')
  }
  const fromEnv = import.meta.env.VITE_HOUSING_SITE_URL
  if (fromEnv) return String(fromEnv).replace(/\/$/, '')
  return PROD_DEFAULT_ORIGIN.replace(/\/$/, '')
}

/**
 * Path for housing home / listings — use only with <Link to={…}>.
 * React Router treats `to` values starting with `http` as external URLs, which would leave
 * localhost if this were a full URL from env. Optional VITE_HOUSING_EXPLORE_PATH may be a
 * path or URL; we always keep a pathname starting with `/`.
 */
function housingExplorePathForRouter() {
  const raw = import.meta.env.VITE_HOUSING_EXPLORE_PATH
  if (raw == null || String(raw).trim() === '') return '/'
  const s = String(raw).trim()
  if (/^https?:\/\//i.test(s)) {
    try {
      const pathname = new URL(s).pathname
      return pathname && pathname !== '' ? pathname : '/'
    } catch {
      return '/'
    }
  }
  return s.startsWith('/') ? s : `/${s}`
}

export const HOUSING_EXPLORE_PATH = housingExplorePathForRouter()

/** @deprecated Same as HOUSING_EXPLORE_PATH — kept for older imports */
export const HOUSING_HOME_URL = HOUSING_EXPLORE_PATH

/** Primary housing CTA — online application */
export const HOUSING_APPLY_PATH = '/apply'

/** In-app housing contact: tour scheduler + housing messages (secondary; main CTAs use HOUSING_APPLY_PATH) */
export const HOUSING_CONTACT_SCHEDULE = '/contact?section=housing&tab=schedule'

/** Housing “send a message” tab — optional query `&category=<id>` (see {@link HOUSING_MESSAGE_CATEGORIES}) */
export const HOUSING_CONTACT_MESSAGE = '/contact?section=housing&tab=message'

/** Resident / portal message categories (ids are stable for URL query `category=`) */
export const HOUSING_MESSAGE_CATEGORIES = [
  { id: 'forgot-password', label: 'Forgot password or portal access' },
  { id: 'pay-rent', label: "Can't figure out how to pay rent" },
  { id: 'maintenance', label: 'Maintenance or repairs' },
  { id: 'lease', label: 'Lease, renewal, or move-out' },
  { id: 'other', label: 'Other' },
]

const HOUSING_CATEGORY_ID_SET = new Set(HOUSING_MESSAGE_CATEGORIES.map((c) => c.id))

/** Legacy `category=general` in URLs maps to `other`. */
export function normalizeHousingMessageCategoryId(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = value.trim()
  if (v === 'general') return 'other'
  return HOUSING_CATEGORY_ID_SET.has(v) ? v : null
}

export function isHousingMessageCategoryId(value) {
  if (typeof value !== 'string') return false
  return value === 'general' || HOUSING_CATEGORY_ID_SET.has(value)
}

/**
 * @deprecated Prefer HOUSING_APPLY_PATH for marketing CTAs. Kept for chat copy / legacy links.
 */
export const HOUSING_SCHEDULE_TOUR_URL = HOUSING_CONTACT_SCHEDULE
