/** Public student housing site (listings, apply, schedule). Override with VITE_HOUSING_SITE_URL if needed. */
export const HOUSING_SITE_ORIGIN = (import.meta.env.VITE_HOUSING_SITE_URL || 'https://www.axis-seattle-housing.com').replace(/\/$/, '')

export const HOUSING_HOME_URL = `${HOUSING_SITE_ORIGIN}/`
export const HOUSING_SCHEDULE_TOUR_URL = `${HOUSING_SITE_ORIGIN}/contact?section=housing&tab=schedule`
