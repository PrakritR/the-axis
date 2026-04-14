import React from 'react'
import { PortalNavGlyph } from './portalNavIcons.jsx'
import {
  portalChromeSecondaryButtonClass,
  portalContentWidthClass,
  portalMainPaddingClass,
  portalMobileTabPillBaseClass,
} from '../lib/portalLayout.js'

function PortalShellFooter({ brandTitle, brandSubtitle }) {
  return (
    <footer className="shrink-0 border-t border-slate-200 bg-white/95">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-5 text-sm text-slate-500 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
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

/**
 * Shared chrome for Manager, Resident, and Admin portals.
 *
 * Desktop: sidebar + main column fill the viewport (below the site header).
 * The page footer stays at the bottom of the main column when content is
 * short; only the `<main>` area scrolls when content is tall. Sidebar
 * footer (optional extras + sign-out) stays visible.
 *
 * Mobile: sticky tab-pill bar at top, content scrolls below it.
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
        {/* Sticky top bar */}
        <header className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-black">{brandSubtitle}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {sidebarFooterExtra ? sidebarFooterExtra : null}
              <button type="button" onClick={onSignOut} className={portalChromeSecondaryButtonClass}>
                Sign out
              </button>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto px-2 pb-2 scrollbar-none">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`${portalMobileTabPillBaseClass} ${
                  activeId === item.id
                    ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_2px_10px_rgba(37,99,235,0.35)]'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                <PortalNavGlyph tabId={item.id} className="h-3.5 w-3.5 opacity-90" />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            ))}
          </div>
        </header>

        {/* Main scrolls; footer stays at bottom of viewport when content is short */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <main className={`min-h-0 flex-1 overflow-y-auto ${portalMainPaddingClass}`}>
            <div className={portalContentWidthClass}>{children}</div>
          </main>
          <PortalShellFooter brandTitle={brandTitle} brandSubtitle={brandSubtitle} />
        </div>
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
        className={`hidden lg:flex h-full w-[15.5rem] shrink-0 flex-col bg-white ${sidebarBorder}`}
      >
        {/* Brand */}
        <div className="shrink-0 border-b border-slate-100 px-4 py-4">
          <div className="text-sm font-black text-slate-900">{brandSubtitle}</div>
        </div>

        {/* Nav — scrolls independently */}
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden p-2 [scrollbar-gutter:stable]">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${
                activeId === item.id
                  ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_4px_16px_rgba(37,99,235,0.35)]'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  activeId === item.id ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                <PortalNavGlyph tabId={item.id} className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
          ))}
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
        {/* Mobile tab bar (hidden on desktop) */}
        <header className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-black">{brandSubtitle}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={onSignOut} className={portalChromeSecondaryButtonClass}>
                Sign out
              </button>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto px-2 pb-2 scrollbar-none">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`${portalMobileTabPillBaseClass} ${
                  activeId === item.id
                    ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_2px_10px_rgba(37,99,235,0.35)]'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                <PortalNavGlyph tabId={item.id} className="h-3.5 w-3.5 opacity-90" />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            ))}
          </div>
        </header>

        {/* Page content scrolls; footer pinned to bottom of column when content is short */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <main className={`min-h-0 flex-1 overflow-y-auto ${portalMainPaddingClass}`}>
            <div className={portalContentWidthClass}>{children}</div>
          </main>
          <PortalShellFooter brandTitle={brandTitle} brandSubtitle={brandSubtitle} />
        </div>
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

const DEFAULT_EMPTY_STATE_ICON = (
  <span
    className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200/90 bg-white text-slate-400 shadow-sm"
    aria-hidden
  >
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 13V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6m16 0v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4m16 0h-2.586a1 1 0 0 0-.707.293l-2.414 2.414a1 1 0 0 1-.707.293h-3.172a1 1 0 0 1-.707-.293l-2.414-2.414A1 1 0 0 0 6.586 13H4"
      />
    </svg>
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
  portalMobileTabPillBaseClass,
} from '../lib/portalLayout.js'
