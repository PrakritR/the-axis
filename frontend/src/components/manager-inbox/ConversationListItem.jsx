import React from 'react'

/**
 * Inbox row: participant, bold subject, one-line preview, time, unopened marker; optional trash/restore.
 */
export default function ConversationListItem({
  participantLabel,
  subjectLine,
  preview,
  selected,
  unopened,
  time,
  onClick,
  onTrash,
  onRestore,
  inTrash = false,
}) {
  return (
    <div
      className={`group relative border-b border-slate-100 transition ${
        selected ? 'bg-[#2563eb]/[0.07] ring-1 ring-inset ring-[#2563eb]/20' : 'bg-white hover:bg-slate-50'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex w-full min-w-0 flex-col gap-1.5 px-4 py-3.5 pr-14 text-left leading-normal"
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-sm leading-snug ${
              unopened ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'
            }`}
          >
            {participantLabel || 'Conversation'}
          </span>
          <div className="flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-1.5">
            {unopened ? (
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#2563eb]" title="Unopened" aria-hidden />
            ) : null}
            {time ? (
              <span className="max-w-[7.5rem] text-right text-[11px] tabular-nums leading-snug text-slate-400 sm:max-w-none">
                {time}
              </span>
            ) : null}
          </div>
        </div>
        {subjectLine ? (
          <span
            className={`block min-w-0 truncate text-sm leading-snug ${
              unopened ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'
            }`}
          >
            {subjectLine}
          </span>
        ) : null}
        {preview ? (
          <span className="line-clamp-1 min-w-0 text-xs leading-snug text-slate-500">{preview}</span>
        ) : null}
      </button>
      {onTrash || onRestore ? (
        <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100">
          {inTrash && onRestore ? (
            <button
              type="button"
              onClick={onRestore}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm hover:bg-slate-50"
            >
              Restore
            </button>
          ) : null}
          {!inTrash && onTrash ? (
            <button
              type="button"
              onClick={onTrash}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-600 shadow-sm hover:bg-red-50"
              title="Move to trash"
            >
              Trash
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
