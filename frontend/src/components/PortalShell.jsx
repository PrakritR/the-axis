import React from 'react'
import { PortalNavGlyph } from './portalNavIcons.jsx'
import {
  portalChromeSecondaryButtonClass,
  portalContentWidthClass,
  portalMainPaddingClass,
  portalMobileBottomInsetClass,
  portalMobileTabPillBaseClass,
  portalNavIconBackdropClass,
} from '../lib/portalLayout.js'

const portalMobileSignOutClass = `${portalChromeSecondaryButtonClass} inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-4 text-sm font-semibold touch-manipulation active:bg-slate-100 lg:min-h-0 lg:min-w-0 lg:px-3 lg:text-xs`

function PortalShellFooter({ brandTitle, brandSubtitle }) {
  return (
    <footer className="shrink-0 border-t border-slate-200 bg-white/95">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-3 py-4 text-sm text-slate-500 sm:px-6 sm:py-5 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2f76ff]">{brandTitle}</div>
          <div className="mt-0.5 text-sm font-black text-slate-900">{brandSubtitle}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 lg:justify-end">
          <span>© 2026 Axis</span>
          <span>Seattle, WA</span>
        </div>
      </div>
    </footer>
  )
}

/** Fixed bottom tab strip — large tap targets, horizontal scroll, safe-area aware (phones). */
function PortalMobileBottomNav({ navItems, activeId, onNavigate }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200/95 bg-white/[0.97] backdrop-blur-md lg:hidden"
      style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom))' }}
      aria-label="Portal navigation"
    >
      <div className="pt-2">
        <div className="flex touch-pan-x gap-2 overflow-x-auto overscroll-x-contain px-2 pb-1 scrollbar-none snap-x snap-mandatory [-webkit-overflow-scrolling:touch]">
          {navItems.map((item) => {
            const active = activeId === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
                className={`flex snap-center shrink-0 touch-manipulation flex-col items-center justify-center gap-1.5 rounded-2xl px-2.5 py-2.5 transition active:scale-[0.98] min-h-[64px] min-w-[4.75rem] max-w-[6.5rem] ${
                  active
                    ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)]'
                    : 'bg-slate-100 text-slate-800 active:bg-slate-200/90'
                }`}
              >
                <span className={portalNavIconBackdropClass({ active, variant: 'bottom' })}>
                  <PortalNavGlyph tabId={item.id} className="h-[22px] w-[22px] shrink-0 opacity-95" />
                </span>
                <span className="line-clamp-2 w-full px-0.5 text-center text-[11px] font-bold leading-tight">
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

/**
 * Shared chrome for Manager, Resident, and Admin portals.
 *
 * Desktop: sidebar + main column fill the viewport (below the site header).
 * The page footer stays at the bottom of the main column when content is
 * short; only the `<main>` area scrolls when content is tall. Sidebar
 * footer (optional extras + sign-out) stays visible.
 *
 * Mobile: slim header + fixed bottom tab bar (scrollable) so switching sections is thumb-friendly.
 *
 * @param {'left' | 'right'} [sidebarPosition='left']
 * @param {'sidebar' | 'none'} [desktopNav='sidebar']
 */
export default function PortalShell({
  brandTitle,
  brandSubtitle,
  navItems,
  activeId,
  onNavigate,
  onSignOut,
  sidebarPosition = 'left',
  sidebarFooterExtra,
  desktopNav = 'sidebar',
  children,
}) {
  const isRight = sidebarPosition === 'right'
  const showDesktopSidebar = desktopNav === 'sidebar'

  // Height of the portal area = full viewport minus the fixed site header.
  // --portal-inset is set on the parent <main> in App.jsx.
  const shellHeight = 'calc(100dvh - var(--portal-inset, 0px))'

  // ─── No-sidebar variant (admin SWE view etc.) ───────────────────────────────
  if (!showDesktopSidebar) {
    return (
      <div
        className="flex flex-col bg-slate-50 text-slate-900 overflow-hidden"
        style={{ height: shellHeight }}
        dir="ltr"
      >
        {/* Mobile: compact header — tabs live in fixed bottom bar */}
        <header className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-black uppercase tracking-wide text-slate-500 sm:text-sm sm:normal-case sm:tracking-normal">
                {brandSubtitle}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {sidebarFooterExtra ? (
                <div className="min-w-0 max-w-[11rem] shrink sm:max-w-none">{sidebarFooterExtra}</div>
              ) : null}
              <button type="button" onClick={onSignOut} className={portalMobileSignOutClass}>
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* Main scrolls; footer stays at bottom of viewport when content is short */}
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${portalMobileBottomInsetClass}`}>
          <main className={`min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] ${portalMainPaddingClass}`}>
            <div className={portalContentWidthClass}>{children}</div>
          </main>
          <PortalShellFooter brandTitle={brandTitle} brandSubtitle={brandSubtitle} />
        </div>
        <PortalMobileBottomNav navItems={navItems} activeId={activeId} onNavigate={onNavigate} />
      </div>
    )
  }

  // ─── Sidebar variant ────────────────────────────────────────────────────────
  const sidebarBorder = isRight ? 'border-l border-slate-200' : 'border-r border-slate-200'

  return (
    <div
      className="flex overflow-hidden bg-slate-50 text-slate-900"
      style={{ height: shellHeight, flexDirection: isRight ? 'row-reverse' : 'row' }}
      dir="ltr"
    >
      {/* ── Desktop sidebar (hidden on mobile) ── */}
      <aside
        className={`hidden lg:flex h-full w-[16.25rem] shrink-0 flex-col bg-white ${sidebarBorder}`}
      >
        {/* Brand */}
        <div className="shrink-0 border-b border-slate-100 px-4 py-4">
          <div className="text-sm font-black text-slate-900">{brandSubtitle}</div>
        </div>

        {/* Nav — scrolls independently */}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden p-2 [scrollbar-gutter:stable]">
          {navItems.map((item) => {
            const active = activeId === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`flex w-full flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center text-sm font-semibold transition ${
                  active
                    ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_4px_16px_rgba(37,99,235,0.35)]'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className={portalNavIconBackdropClass({ active, variant: 'sidebar' })}>
                  <PortalNavGlyph tabId={item.id} className="h-5 w-5 shrink-0 opacity-95" />
                </span>
                <span className="block w-full truncate px-0.5 text-xs font-semibold leading-tight">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Footer — always visible, never scrolls away */}
        <div className="shrink-0 border-t border-slate-100 p-3">
          {sidebarFooterExtra ? <div className="mb-3">{sidebarFooterExtra}</div> : null}
          <button type="button" onClick={onSignOut} className={`w-full ${portalChromeSecondaryButtonClass}`}>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content column ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile: compact header — section tabs in fixed bottom bar */}
        <header className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-black uppercase tracking-wide text-slate-500 sm:text-sm sm:normal-case sm:tracking-normal">
                {brandSubtitle}
              </div>
            </div>
            <button type="button" onClick={onSignOut} className={portalMobileSignOutClass}>
              Sign out
            </button>
          </div>
        </header>

        {/* Page content scrolls; footer pinned to bottom of column when content is short */}
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${portalMobileBottomInsetClass}`}>
          <main className={`min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] ${portalMainPaddingClass}`}>
            <div className={portalContentWidthClass}>{children}</div>
          </main>
          <PortalShellFooter brandTitle={brandTitle} brandSubtitle={brandSubtitle} />
        </div>
        <PortalMobileBottomNav navItems={navItems} activeId={activeId} onNavigate={onNavigate} />
      </div>
    </div>
  )
}

/** Card grid helper */
export function StatCard({ label, value, hint, onClick }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm ${
        onClick ? 'cursor-pointer transition hover:border-[#2563eb]/30 hover:shadow' : ''
      }`}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-black text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </Comp>
  )
}

export function StatusPill({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    blue: 'bg-blue-50 text-blue-800 border-blue-200',
    amber: 'bg-amber-50 text-amber-900 border-amber-200',
    green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    red: 'bg-red-50 text-red-800 border-red-200',
    violet: 'bg-violet-50 text-violet-800 border-violet-200',
    axis: 'bg-[#2563eb]/10 text-[#2563eb] border-[#2563eb]/25',
  }
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  )
}

/** Generic table empty state — grid, not inbox (inbox looked like “messages” on property screens). */
const DEFAULT_EMPTY_STATE_ICON = (
  <span
    className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200/90 bg-white text-slate-400 shadow-sm"
    aria-hidden
  >
    <PortalNavGlyph tabId="dashboard" className="h-6 w-6" />
  </span>
)

export function DataTable({ columns, rows, empty, emptyIcon = true }) {
  if (!rows.length) {
    const visual =
      emptyIcon === false
        ? null
        : emptyIcon === true
          ? DEFAULT_EMPTY_STATE_ICON
          : emptyIcon
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-16 text-center text-sm text-slate-500">
        {visual}
        {empty}
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 ${c.headerClassName || ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={row.key ?? i} className="transition-colors hover:bg-slate-50/80">
              {columns.map((c) => (
                <td key={c.key} className={`px-5 py-4 text-slate-700 ${c.cellClassName || ''}`}>
                  {c.render ? c.render(row.data) : row.data[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export {
  portalChromeSecondaryButtonClass,
  portalContentWidthClass,
  portalMainPaddingClass,
  portalMobileBottomInsetClass,
  portalMobileTabPillBaseClass,
  portalNavIconBackdropClass,
} from '../lib/portalLayout.js'
