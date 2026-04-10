import React from 'react'

/**
 * Two-pane inbox: scrollable thread list (left) + reading pane with optional composer (right).
 * Children are responsible for inner scrolling where needed.
 */
export default function GmailStyleInboxLayout({ left, right, className = '' }) {
  return (
    <div
      className={`flex max-h-[min(82vh,760px)] min-h-[380px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex-row ${className}`}
    >
      <div className="flex max-h-[min(42vh,340px)] min-h-0 w-full flex-col overflow-hidden border-b border-slate-200 lg:max-h-none lg:w-[min(100%,380px)] lg:shrink-0 lg:border-b-0 lg:border-r lg:border-slate-200">
        {left}
      </div>
      <div className="flex min-h-[min(50vh,420px)] min-w-0 flex-1 flex-col overflow-hidden bg-slate-50/60 lg:min-h-0">
        {right}
      </div>
    </div>
  )
}

/** Single thread row — Gmail-like snippet row */
export function InboxThreadRow({ title, subtitle, preview, time, selected, onClick, unread = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-0.5 border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50 ${
        selected ? 'bg-blue-50/90 ring-1 ring-inset ring-blue-200/80' : 'bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`min-w-0 truncate text-sm ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
          {title}
        </span>
        {time ? <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{time}</span> : null}
      </div>
      {subtitle ? <span className="truncate text-xs text-slate-500">{subtitle}</span> : null}
      {preview ? (
        <p className={`line-clamp-2 text-xs leading-snug ${unread ? 'text-slate-700' : 'text-slate-500'}`}>{preview}</p>
      ) : null}
    </button>
  )
}
