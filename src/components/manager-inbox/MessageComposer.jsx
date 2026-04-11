import React from 'react'

/**
 * Fixed bottom reply area for thread replies.
 */
export default function MessageComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  sending,
  placeholder,
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 border-t border-slate-200 bg-white p-4 md:p-5"
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#2563eb]/15 disabled:opacity-50"
      />
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={disabled || sending || !value.trim()}
          className="rounded-xl bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-45"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}
