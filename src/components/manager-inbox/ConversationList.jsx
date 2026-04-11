import React from 'react'
import ConversationListItem from './ConversationListItem'

const FILTER_IDS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['open', 'Open'],
]

/**
 * Left column: search, filters, scrollable conversation list.
 */
export default function ConversationList({
  loading,
  errorMessage,
  searchQuery,
  onSearchChange,
  filter,
  onFilterChange,
  counts,
  trashCount,
  onOpenTrash,
  inTrashMode,
  onLeaveTrash,
  rows,
  selectedId,
  onSelect,
  emptyMessage,
}) {
  return (
    <div className="flex min-h-0 w-full flex-col border-b border-slate-200 bg-white md:max-w-[400px] md:border-b-0 md:border-r">
      <div className="shrink-0 space-y-3 border-b border-slate-100 p-4">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search conversations"
          autoComplete="off"
          className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#2563eb]/15"
        />

        {inTrashMode ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-800">Removed</span>
            <button
              type="button"
              onClick={onLeaveTrash}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Back
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {FILTER_IDS.map(([id, label]) => {
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
                    <span className={active ? 'text-white/80' : 'text-slate-400'}>({count})</span>
                  </button>
                )
              })}
            </div>
            {trashCount > 0 ? (
              <button
                type="button"
                onClick={onOpenTrash}
                className="text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800"
              >
                Removed ({trashCount})
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {errorMessage ? (
          <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
            {errorMessage}
          </div>
        ) : null}
        {loading ? (
          <div className="min-h-[12rem]" aria-busy="true" />
        ) : rows.length === 0 ? (
          <div className="min-h-[12rem]" aria-label={emptyMessage} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.id}>
                <ConversationListItem
                  title={row.title}
                  subtitle={row.subtitle}
                  time={row.time}
                  selected={selectedId === row.id}
                  unread={row.unread}
                  onClick={() => onSelect(row.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
