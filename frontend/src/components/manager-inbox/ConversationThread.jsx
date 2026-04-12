import React, { useEffect, useRef } from 'react'

function cn(...v) {
  return v.filter(Boolean).join(' ')
}

/**
 * Scrollable message bubbles for the active conversation.
 */
export default function ConversationThread({
  messages,
  loading,
  selectedThreadId,
  isAxisThread,
  formatTime,
  messageSubjectKey = '',
  hideInlineSubject = false,
  mapMessageBody = null,
}) {
  const bottomRef = useRef(null)

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages.length])

  if (!selectedThreadId) {
    return <div className="flex-1" aria-hidden />
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400" aria-busy="true">
        Loading…
      </div>
    )
  }

  if (!messages.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        No messages yet
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
        const subj =
          !hideInlineSubject &&
          messageSubjectKey &&
          m[messageSubjectKey] != null &&
          String(m[messageSubjectKey]).trim()
            ? String(m[messageSubjectKey]).trim()
            : ''
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
            {subj ? (
              <p className="mt-2 text-xs font-semibold text-slate-700">
                <span className="text-slate-400">Subject:</span> {subj}
              </p>
            ) : null}
            <p className={cn('whitespace-pre-wrap leading-relaxed', subj ? 'mt-1' : 'mt-2')}>
              {mapMessageBody ? mapMessageBody(m) : m.Message}
            </p>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
