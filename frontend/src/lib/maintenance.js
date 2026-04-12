function envFlagIsTrue(value) {
  if (value == null || value === '') return false
  const s = String(value).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

/** When true, the client shows only the maintenance screen for every route. Set `VITE_MAINTENANCE_MODE=true` at build time. */
export const MAINTENANCE_MODE = envFlagIsTrue(import.meta.env.VITE_MAINTENANCE_MODE)
