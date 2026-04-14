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

/** Mobile top tab pills (horizontal nav under the portal title). */
export const portalMobileTabPillBaseClass =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition'
