/** Cross-tab / same-browser hint to refetch Scheduling rows (tours, work orders, admin blocks). */
export const AXIS_SCHEDULING_CHANGED_EVENT = 'axis:scheduling-changed'

export function dispatchAxisSchedulingChanged(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent(AXIS_SCHEDULING_CHANGED_EVENT, { detail }))
  } catch {
    /* ignore */
  }
}
