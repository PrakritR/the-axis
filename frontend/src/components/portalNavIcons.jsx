import React from 'react'

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

/** 24×24 outline icons for portal nav + empty states (Heroicons-style). */
export function PortalNavGlyph({ tabId, className = 'h-5 w-5' }) {
  const id = String(tabId || '').toLowerCase().replace(/\s+/g, '')
  const svgProps = { className, viewBox: '0 0 24 24', 'aria-hidden': true, ...stroke }

  switch (id) {
    case 'dashboard':
      return (
        <svg {...svgProps}>
          <path d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25A2.25 2.25 0 0 1 8.25 10.5H6a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75A2.25 2.25 0 0 1 15.75 13.5H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25ZM13.5 6A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25A2.25 2.25 0 0 1 13.5 8.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
        </svg>
      )
    case 'properties':
      return (
        <svg {...svgProps}>
          <path d="M2.25 21h19.5m-18-18v18m2.25-18v18m13.5-13.5V21M6 7.5h.75v.75H6V7.5Zm0 3h.75v.75H6V10.5Zm0 3h.75v.75H6V13.5Zm3-6H12v.75H9V7.5Zm0 3h3v.75H9V10.5Zm0 3h3v.75H9V13.5Zm4.5-6H18v2.25h-2.25V7.5Zm0 4.5H18V15h-2.25v-3Zm0 4.5H18v2.25h-2.25V18Z" />
        </svg>
      )
    case 'accounts':
      return (
        <svg {...svgProps}>
          <path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
        </svg>
      )
    case 'leasing':
    case 'leases':
      return (
        <svg {...svgProps}>
          <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75A3.375 3.375 0 0 0 6.375 7.125v1.5c0 .621-.504 1.125-1.125 1.125H3.375A3.375 3.375 0 0 0 0 13.125v2.25A2.25 2.25 0 0 0 2.25 17.625h19.5a2.25 2.25 0 0 0 2.25-2.25v-1.125m-21 0V9.375m0 0h21M4.5 9.375v8.25m15-8.25v8.25" />
        </svg>
      )
    case 'applications':
      return (
        <svg {...svgProps}>
          <path d="M9 12h6.75M9 15.75h6.75M9 9.75h3.75M16.5 3.75h1.125c.621 0 1.125.504 1.125 1.125v16.5c0 .621-.504 1.125-1.125 1.125H6.375c-.621 0-1.125-.504-1.125-1.125V4.875c0-.621.504-1.125 1.125-1.125H8.25v-.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V3.75h3.75Z" />
        </svg>
      )
    case 'payments':
      return (
        <svg {...svgProps}>
          <path d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
        </svg>
      )
    case 'workorders':
      return (
        <svg {...svgProps}>
          <path d="M11.42 15.17 17.25 21a2.652 2.652 0 0 0 3.75-3.75l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17 6.765 10.487a2.25 2.25 0 0 0-3.18-3.18l-2.335 2.336m7.17 5.514-6.375-6.375a48.355 48.355 0 0 1 3.586-3.586l6.375 6.375m0 0 1.768 1.768a.75.75 0 0 1-.293 1.207L12 21h-4.125a.75.75 0 0 1-.707-.293L5.4 18.939m0 0 3.375-3.375" />
        </svg>
      )
    case 'calendar':
      return (
        <svg {...svgProps}>
          <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5a2.25 2.25 0 0 0 2.25-2.25m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5a2.25 2.25 0 0 1 2.25 2.25v7.5" />
        </svg>
      )
    case 'messages':
    case 'inbox':
      return (
        <svg {...svgProps}>
          <path d="M21.75 9v.75a2.25 2.25 0 0 1-2.25 2.25h-5.379a1.5 1.5 0 0 0-1.06.44L8.25 15.75v-4.5a2.25 2.25 0 0 0-2.25-2.25H4.5A2.25 2.25 0 0 1 2.25 9V9A2.25 2.25 0 0 1 4.5 6.75h15A2.25 2.25 0 0 1 21.75 9Z" />
          <path d="M8.25 19.5v-3.75m0 0h12a2.25 2.25 0 0 0 2.25-2.25V9" />
        </svg>
      )
    case 'profile':
      return (
        <svg {...svgProps}>
          <path d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
      )
    case 'resident':
    case 'hub-resident':
      return (
        <svg {...svgProps}>
          <path d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      )
    case 'manager':
    case 'hub-manager':
      return (
        <svg {...svgProps}>
          <path d="M20.25 7.5v-.867a2.25 2.25 0 0 0-1.006-1.872l-3.012-2.012A2.25 2.25 0 0 0 13.5 2.25h-3a2.25 2.25 0 0 0-2.006 1.248L5.482 5.251A2.25 2.25 0 0 0 4.5 7.368V7.5m15.75 0H3.375c-.621 0-1.125.504-1.125 1.125v10.125c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125V8.625c0-.621-.504-1.125-1.125-1.125H22.5Z" />
        </svg>
      )
    case 'admin':
    case 'hub-admin':
      return (
        <svg {...svgProps}>
          <path d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      )
    case 'signin':
      return (
        <svg {...svgProps}>
          <path d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H9v-1.5l4.043-4.043A3 3 0 0 1 15.75 5.25Zm-6 0A2.25 2.25 0 0 0 7.5 7.5v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-.75" />
        </svg>
      )
    case 'setup':
    case 'activate':
      return (
        <svg {...svgProps}>
          <path d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4.5 19.125a7.125 7.125 0 0 1 14.25 0v.003l-.001.119a.75.75 0 0 1-.363.63l-6.25 3.737a.75.75 0 0 1-.772 0l-6.25-3.737a.75.75 0 0 1-.364-.63Z" />
        </svg>
      )
    default:
      return (
        <svg {...svgProps}>
          <path d="M12 6.75v10.5M6.75 12h10.5" />
        </svg>
      )
  }
}

const emptyWrap = 'mb-3 mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 shadow-sm'

/** Replaces emoji empty states in manager/resident flows. */
export function PortalEmptyVisual({ variant, className = '' }) {
  const v = String(variant || 'default').toLowerCase()
  const wrap = `${emptyWrap} ${className}`.trim()

  const inner = (() => {
    switch (v) {
      case 'house':
        return <PortalNavGlyph tabId="resident" className="h-7 w-7" />
      case 'clipboard':
        return <PortalNavGlyph tabId="applications" className="h-7 w-7" />
      case 'payments':
        return <PortalNavGlyph tabId="payments" className="h-7 w-7" />
      case 'search':
        return (
          <svg className="h-7 w-7" viewBox="0 0 24 24" aria-hidden {...stroke}>
            <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        )
      case 'warning':
        return (
          <svg className="h-7 w-7 text-amber-500" viewBox="0 0 24 24" aria-hidden {...stroke}>
            <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        )
      case 'document':
        return <PortalNavGlyph tabId="leasing" className="h-7 w-7" />
      default:
        return <PortalNavGlyph tabId="dashboard" className="h-7 w-7" />
    }
  })()

  return (
    <div className={wrap} aria-hidden>
      {inner}
    </div>
  )
}
