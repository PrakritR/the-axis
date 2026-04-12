import React from 'react'
import ConversationListItem from './ConversationListItem'

const BASE_TABS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['trash', 'Trash'],
]

/**
 * Left column: search, All / Unread / Trash tabs with counts, conversation list.
 * When `channelTabs` is provided, an extra row of channel-filter pills is rendered
 * (e.g. All / Manager / Admin) so residents can narrow by recipient.
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
  return (
    <div className="flex min-h-0 w-full flex-col border-b border-slate-200 bg-white md:max-w-[420px] md:border-b-0 md:border-r">
      <div className="shrink-0 space-y-3 border-b border-slate-100 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Search</h3>
        </div>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search subject, people, or message text…"
          autoComplete="off"
          className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#2563eb]/15"
        />

        <div className="flex flex-wrap gap-2">
          {BASE_TABS.map(([id, label]) => {
            const count = counts[id] ?? 0
            const active = filter === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => onFilterChange(id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-[#2563eb] text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}{' '}
                <span className={active ? 'text-white/85' : 'text-slate-400'}>({count})</span>
              </button>
            )
          })}
        </div>

        {channelTabs && channelTabs.length > 0 && onChannelFilterChange ? (
          <div className="flex flex-wrap gap-1.5">
            {channelTabs.map(([id, label, count]) => {
              const active = channelFilter === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChannelFilterChange(id)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                    active
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {label}
                  {count != null ? (
                    <span className={`ml-1 ${active ? 'text-white/70' : 'text-slate-400'}`}>({count})</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {errorMessage ? (
          <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
            {errorMessage}
          </div>
        ) : null}
        {loading ? (
          <div className="flex min-h-[14rem] items-center justify-center text-sm text-slate-400" aria-busy="true">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[14rem] flex-col items-center justify-center px-4 text-center text-sm text-slate-500">
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
                  unread={row.unread}
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
