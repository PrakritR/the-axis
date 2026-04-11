import React from 'react'
import {
  PORTAL_INBOX_SUBJECT_PRESETS,
  PORTAL_INBOX_SUBJECT_OTHER_ID,
  inboxSubjectRequiresCustom,
} from '../../lib/portalInboxSubjects'

export default function InboxSubjectPicker({
  presetId,
  onPresetIdChange,
  customSubject,
  onCustomSubjectChange,
  disabled = false,
  required = false,
  allowEmptyOption = false,
  emptyOptionLabel = '— Same as thread —',
}) {
  const showCustom = inboxSubjectRequiresCustom(presetId)

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Subject{required ? ' (required)' : ''}
        </span>
        <select
          value={presetId}
          onChange={(e) => onPresetIdChange(e.target.value)}
          disabled={disabled}
          required={required && !allowEmptyOption}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15 disabled:opacity-50"
        >
          {allowEmptyOption ? <option value="">{emptyOptionLabel}</option> : null}
          {!allowEmptyOption ? <option value="">Select a subject…</option> : null}
          {PORTAL_INBOX_SUBJECT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {showCustom ? (
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400">Custom subject</span>
          <input
            type="text"
            value={customSubject}
            onChange={(e) => onCustomSubjectChange(e.target.value)}
            disabled={disabled}
            required={required}
            placeholder="Type your subject"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15 disabled:opacity-50"
          />
        </label>
      ) : null}
    </div>
  )
}

export { PORTAL_INBOX_SUBJECT_OTHER_ID }
