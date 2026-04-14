import React from 'react'
import ConversationListItem from './ConversationListItem'

/** Inbox folder order (left → right, top → bottom on narrow screens): Unopened → Opened → Sent → Trash. */
const STATUS_TABS = [
  ['unopened', 'Unopened'],
  ['opened', 'Opened'],
  ['sent', 'Sent'],
  ['trash', 'Trash'],
]

/**
 * Left column: search, status pills (Unopened / Opened / Sent / Trash), optional channel
 * filter pills (e.g. Both / Admin / Residents), and the conversation list.
 */
export default function ConversationList({
  loading,
  errorMessage,
  searchQuery,
  onSearchChange,
  filter,
  onFilterChange,
  counts,
  rows,
  selectedId,
  onSelect,
  emptyMessage,
  onTrashThread,
  channelTabs,
  channelFilter,
  onChannelFilterChange,
}) {
  const hasChannelFilter = channelTabs && channelTabs.length > 1 && onChannelFilterChange

  return (
    <div className="flex min-h-0 w-full shrink-0 flex-col border-b border-slate-200 bg-white md:w-[320px] md:max-w-[320px] md:border-b-0 md:border-r">
      <div className="shrink-0 space-y-3 border-b border-slate-100 px-4 py-4">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search..."
          autoComplete="off"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#2563eb]/15"
        />

        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Inbox folders"
        >
          {STATUS_TABS.map(([id, label]) => {
            const count = counts[id] ?? 0
            const active = filter === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onFilterChange(id)}
                className={`inline-flex min-h-[42px] min-w-0 shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                  active
                    ? 'border-[#2563eb] bg-[#2563eb] text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{label}</span>
                <span className={`tabular-nums ${active ? 'text-white/90' : 'text-slate-400'}`}>{count}</span>
              </button>
            )
          })}
        </div>

        {hasChannelFilter ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            {channelTabs.map(([id, label]) => {
              const active = channelFilter === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChannelFilterChange(id)}
                  className={`inline-flex min-h-[40px] items-center whitespace-nowrap rounded-2xl border px-4 py-2 text-sm font-semibold transition ${
                    active
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {errorMessage ? (
          <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
            {errorMessage}
          </div>
        ) : null}
        {loading ? (
          <div className="flex h-full min-h-[6rem] items-center justify-center text-sm text-slate-400" aria-busy="true">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full min-h-[6rem] flex-col items-center justify-center px-4 text-center text-sm text-slate-500">
            {emptyMessage}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.id}>
                <ConversationListItem
                  participantLabel={row.participantLabel}
                  subjectLine={row.subjectLine}
                  preview={row.preview}
                  time={row.time}
                  selected={selectedId === row.id}
                  unopened={row.unopened}
                  onClick={() => onSelect(row.id)}
                  onTrash={
                    onTrashThread && row.stateKey && filter !== 'trash'
                      ? (e) => {
                          e.stopPropagation()
                          onTrashThread(row.stateKey, true)
                        }
                      : undefined
                  }
                  onRestore={
                    onTrashThread && row.stateKey && filter === 'trash'
                      ? (e) => {
                          e.stopPropagation()
                          onTrashThread(row.stateKey, false)
                        }
                      : undefined
                  }
                  inTrash={filter === 'trash'}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
