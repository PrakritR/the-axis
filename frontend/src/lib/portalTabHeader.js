/**
 * Shared tab header + toolbar sizing for Manager / Resident / Admin portal main views
 * (matches Applications, Leases, Payments, etc.).
 */

export const PORTAL_TAB_HEADER_ROW_CLS = 'mb-5 flex flex-wrap items-center gap-3'

export const PORTAL_TAB_H2_CLS =
  'mr-auto w-full text-2xl font-black text-slate-900 sm:w-auto'

export const PORTAL_TAB_TOOLBAR_CLS =
  'flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap'

export const PORTAL_TAB_SELECT_WRAP_CLS = 'relative min-w-0 flex-1 sm:min-w-[180px] sm:flex-none'

/** Same height and type scale as Manager MANAGER_PILL_SELECT_CLS */
export const PORTAL_TAB_SELECT_CLS =
  'h-[42px] w-full min-w-0 cursor-pointer appearance-none rounded-full border border-slate-200 bg-white py-2.5 pl-4 pr-10 text-sm font-medium text-slate-800 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'

export const PORTAL_TAB_SELECT_CHEVRON_CLS =
  'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400'

export const PORTAL_TAB_REFRESH_CLS =
  'h-[42px] shrink-0 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50'

export const PORTAL_TAB_PRIMARY_CLS =
  'h-[42px] shrink-0 rounded-full bg-[#2563eb] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-50'
