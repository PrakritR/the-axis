import React from 'react'

/**
 * Single row in the manager inbox conversation list.
 */
export default function ConversationListItem({
  title,
  subtitle,
  selected,
  unread,
  time,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-0.5 border-b border-slate-100 px-4 py-3.5 text-left transition ${
        selected
          ? 'border-l-[3px] border-l-[#2563eb] bg-[#2563eb]/[0.06]'
          : 'border-l-[3px] border-l-transparent bg-white hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'
          }`}
        >
          {title}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {unread ? (
            <span
              className="h-2 w-2 rounded-full bg-[#2563eb]"
              title="Unread"
              aria-hidden
            />
          ) : null}
          {time ? (
            <span className="text-[11px] tabular-nums text-slate-400">{time}</span>
          ) : null}
        </div>
      </div>
      {subtitle ? (
        <span className="truncate text-xs text-slate-500">{subtitle}</span>
      ) : null}
    </button>
  )
}
