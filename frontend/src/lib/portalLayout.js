/**
 * Shared layout + control sizing for Manager, Resident, and Admin portals.
 * Import from `PortalShell` consumers when you need the same rhythm outside the shell.
 */

/** Scrollable `<main>` padding — keep in sync with `PortalShellFooter` horizontal padding. */
export const portalMainPaddingClass = 'px-4 py-6 sm:px-6 lg:px-8'

/** Constrains wide dashboards; matches footer `max-w-[1600px]`. */
export const portalContentWidthClass = 'mx-auto w-full max-w-[1600px]'

/** Secondary / sign-out style — used for Sign out and similar compact actions in chrome. */
export const portalChromeSecondaryButtonClass =
  'rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50'

/** Mobile top tab pills (stacked icon + label under the portal title). */
export const portalMobileTabPillBaseClass =
  'inline-flex shrink-0 flex-col items-center gap-1 rounded-2xl px-2.5 py-2.5 text-center text-xs font-semibold transition min-w-[4.75rem]'

/**
 * Rounded tile behind nav glyphs — keep sidebar, mobile bar, and /portal picker visually aligned.
 * @param {{ active: boolean, variant?: 'sidebar' | 'mobile' | 'auth' }} opts
 */
export function portalNavIconBackdropClass({ active, variant = 'sidebar' }) {
  const base =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition [color-scheme:light]'
  if (variant === 'auth') {
    if (active) {
      return `${base} bg-[#eff6ff] text-[#1d4ed8] shadow-sm ring-2 ring-[#2563eb]/40`
    }
    return `${base} bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/80`
  }
  if (variant === 'mobile') {
    if (active) return `${base} bg-white/20 text-white`
    return `${base} bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80`
  }
  if (active) return `${base} bg-white/15 text-white`
  return `${base} bg-slate-100 text-slate-500`
}
