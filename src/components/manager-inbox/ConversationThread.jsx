import React from 'react'

function cn(...v) {
  return v.filter(Boolean).join(' ')
}

/**
 * Scrollable message bubbles for the active conversation.
 */
export default function ConversationThread({
  messages,
  loading,
  emptyHint,
  selectedThreadId,
  isAxisThread,
  formatTime,
}) {
  if (!selectedThreadId) {
    return (
      <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="max-w-sm text-sm text-slate-500">Select a conversation to view messages</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-slate-500">
        Loading messages…
      </div>
    )
  }

  if (!messages.length) {
    return (
      <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium text-slate-700">No messages yet</p>
        <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-500">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 px-4 py-5 md:px-6">
      {messages.map((m) => {
        const admin = m['Is Admin'] === true || m['Is Admin'] === 1
        const you = isAxisThread ? !admin : admin
        const who = isAxisThread
          ? admin
            ? 'Axis'
            : 'You'
          : admin
            ? 'You'
            : m['Sender Email'] || 'Resident'
        return (
          <div
            key={m.id}
            className={cn(
              'max-w-[min(100%,36rem)] rounded-2xl border px-4 py-3 text-sm shadow-sm',
              you
                ? 'ml-auto border-[#2563eb]/25 bg-[#2563eb]/[0.08] text-slate-900'
                : 'mr-auto border-slate-200 bg-white text-slate-900',
            )}
          >
            <div className="text-[11px] font-medium text-slate-400">
              {who} · {formatTime(m.Timestamp || m.created_at)}
            </div>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{m.Message}</p>
          </div>
        )
      })}
    </div>
  )
}
