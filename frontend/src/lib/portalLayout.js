/**
 * Shared layout + control sizing for Manager, Resident, and Admin portals.
 * Import from `PortalShell` consumers when you need the same rhythm outside the shell.
 */

/** Scrollable `<main>` padding — tighter on phones; keep footer horizontal padding aligned. */
export const portalMainPaddingClass = 'px-3 py-3 sm:px-5 sm:py-4 lg:px-8 lg:py-6'

/** Constrains wide dashboards; matches footer `max-w-[1600px]`. */
export const portalContentWidthClass = 'mx-auto w-full min-w-0 max-w-[1600px]'

/** Secondary / sign-out style — used for Sign out and similar compact actions in chrome. */
export const portalChromeSecondaryButtonClass =
  'rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50'

/**
 * Bottom padding so scrollable portal content + footer clear the fixed mobile tab bar
 * (`PortalMobileBottomNav`, lg:hidden). Unused on `lg+`.
 */
export const portalMobileBottomInsetClass =
  'pb-[max(6.75rem,calc(5.5rem+env(safe-area-inset-bottom)))] lg:pb-0'

/** @deprecated Prefer `PortalMobileBottomNav` — kept for any external imports. */
export const portalMobileTabPillBaseClass =
  'inline-flex shrink-0 flex-col items-center gap-1 rounded-2xl px-2.5 py-2.5 text-center text-xs font-semibold transition min-w-[4.75rem]'

/**
 * Rounded tile behind nav glyphs — keep sidebar, mobile bar, and /portal picker visually aligned.
 * @param {{ active: boolean, variant?: 'sidebar' | 'mobile' | 'bottom' | 'auth' }} opts
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
  if (variant === 'bottom') {
    const box =
      'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition [color-scheme:light]'
    if (active) return `${box} bg-white/25 text-white`
    return `${box} bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80`
  }
  if (variant === 'mobile') {
    if (active) return `${base} bg-white/20 text-white`
    return `${base} bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80`
  }
  if (active) return `${base} bg-white/15 text-white`
  return `${base} bg-slate-100 text-slate-500`
}
