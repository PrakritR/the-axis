import React from 'react'
import InboxSubjectPicker from '../portal-inbox/InboxSubjectPicker'

/**
 * Reply / compose area: To line, subject (preset or text), message body.
 */
export default function MessageComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  sending,
  placeholder,
  subject = '',
  onSubjectChange,
  showSubject = false,
  useSubjectPresets = false,
  subjectPresetId = '',
  onSubjectPresetIdChange,
  subjectCustom = '',
  onSubjectCustomChange,
  allowSubjectEmpty = false,
  subjectRequired = false,
  subjectPlaceholder = 'Optional subject',
  toLabel = null,
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 border-t border-slate-200 bg-white p-4 md:p-5"
    >
      {toLabel ? (
        <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-slate-700">
          <span className="font-semibold text-slate-900">To:</span>{' '}
          <span className="text-slate-600">{toLabel}</span>
        </div>
      ) : null}
      {showSubject ? (
        useSubjectPresets && onSubjectPresetIdChange ? (
          <div className="mb-3">
            <InboxSubjectPicker
              presetId={subjectPresetId}
              onPresetIdChange={onSubjectPresetIdChange}
              customSubject={subjectCustom}
              onCustomSubjectChange={onSubjectCustomChange || (() => {})}
              disabled={disabled}
              required={subjectRequired && !allowSubjectEmpty}
              allowEmptyOption={allowSubjectEmpty}
            />
          </div>
        ) : (
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400">Subject</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => onSubjectChange?.(e.target.value)}
              placeholder={subjectPlaceholder}
              disabled={disabled}
              required={subjectRequired}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#2563eb]/15 disabled:opacity-50"
            />
          </label>
        )
      ) : null}
      <label className="block">
        <span className="sr-only">Message</span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#2563eb]/15 disabled:opacity-50"
        />
      </label>
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
