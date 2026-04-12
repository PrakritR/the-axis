import React from 'react'

/**
 * Shared chrome: vertical sidebar + main content for Manager, Resident, and Admin portals.
 * Desktop layout uses CSS Grid (not flex + order) so the sidebar column stays physically left
 * even with `dir="ltr"` fixes, hidden `aside` on small breakpoints, or RTL document settings.
 *
 * @param {'left' | 'right'} [sidebarPosition='left'] — desktop sidebar edge (when desktopNav is 'sidebar')
 * @param {'sidebar' | 'none'} [desktopNav='sidebar'] — 'none' hides the desktop aside
 */
export default function PortalShell({
  brandTitle,
  brandSubtitle,
  navItems,
  activeId,
  onNavigate,
  userLabel,
  userMeta,
  onSignOut,
  sidebarPosition = 'left',
  sidebarFooterExtra,
  desktopNav = 'sidebar',
  children,
}) {
  const isRight = sidebarPosition === 'right'
  const asideBorder = isRight ? 'border-l border-slate-200' : 'border-r border-slate-200'
  const showDesktopSidebar = desktopNav === 'sidebar'

  const asideGrid = isRight ? 'lg:col-start-2 lg:row-start-1' : 'lg:col-start-1 lg:row-start-1'
  const mainGrid = isRight ? 'lg:col-start-1 lg:row-start-1' : 'lg:col-start-2 lg:row-start-1'

  if (!showDesktopSidebar) {
    return (
      <div className="flex min-h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900" dir="ltr">
        <header className="z-20 shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#2f76ff]">{brandTitle}</div>
              <div className="text-sm font-black">{brandSubtitle}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {sidebarFooterExtra ? sidebarFooterExtra : null}
              <button
                type="button"
                onClick={onSignOut}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
              >
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
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  activeId === item.id
                    ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_2px_10px_rgba(37,99,235,0.35)]'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain">
          {children}
        </main>
      </div>
    )
  }

  return (
    <div
      className={`grid min-h-dvh w-full max-w-full grid-cols-1 overflow-hidden bg-slate-50 text-slate-900 ${
        isRight ? 'lg:grid-cols-[minmax(0,1fr)_14rem]' : 'lg:grid-cols-[14rem_minmax(0,1fr)]'
      }`}
      dir="ltr"
    >
      <aside
        className={`hidden min-h-dvh w-full shrink-0 flex-col overflow-hidden bg-white lg:flex ${asideBorder} ${asideGrid}`}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 py-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2f76ff]">{brandTitle}</div>
          <div className="mt-1 text-sm font-black text-slate-900">{brandSubtitle}</div>
        </div>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden p-2 [scrollbar-gutter:stable]">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                activeId === item.id
                  ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_4px_16px_rgba(37,99,235,0.35)]'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="shrink-0 border-t border-slate-100 p-3">
          <div className="text-xs font-semibold text-slate-800">{userLabel}</div>
          {userMeta ? <div className="mt-0.5 text-[11px] text-slate-500">{userMeta}</div> : null}
          {sidebarFooterExtra ? <div className="mt-3">{sidebarFooterExtra}</div> : null}
          <button
            type="button"
            onClick={onSignOut}
            className="mt-2 w-full rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className={`flex min-h-dvh min-w-0 flex-col overflow-hidden ${mainGrid}`}>
        <header className="z-20 shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#2f76ff]">{brandTitle}</div>
              <div className="text-sm font-black">{brandSubtitle}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onSignOut}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
              >
                Out
              </button>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto px-2 pb-2 scrollbar-none lg:hidden">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  activeId === item.id
                    ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_2px_10px_rgba(37,99,235,0.35)]'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
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
      className={`rounded-[20px] border border-slate-200 bg-white p-5 text-left shadow-sm ${
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

export function DataTable({ columns, rows, empty }) {
  if (!rows.length) {
    return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 py-12 text-center text-sm text-slate-500">{empty}</div>
  }
  return (
    <div className="overflow-x-auto rounded-[20px] border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={row.key ?? i} className="hover:bg-slate-50/80">
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-3 text-slate-700">
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
