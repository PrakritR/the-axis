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

/** In-app housing contact: tour scheduler + housing messages */
export const HOUSING_CONTACT_SCHEDULE = '/contact?section=housing&tab=schedule'

/**
 * Path only (same-origin). Prefer this or HOUSING_CONTACT_SCHEDULE in the SPA.
 * For a full URL string, use `${getHousingSiteOrigin()}${HOUSING_CONTACT_SCHEDULE}`.
 */
export const HOUSING_SCHEDULE_TOUR_URL = HOUSING_CONTACT_SCHEDULE
