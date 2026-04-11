/** Predefined inbox subjects; "other" enables custom text. */
export const PORTAL_INBOX_SUBJECT_PRESETS = [
  { id: 'rent', label: 'Rent Payment' },
  { id: 'maintenance', label: 'Maintenance Request' },
  { id: 'lease', label: 'Lease Question' },
  { id: 'general', label: 'General Inquiry' },
  { id: 'complaint', label: 'Complaint' },
  { id: 'other', label: 'Other (type your own)' },
]

export const PORTAL_INBOX_SUBJECT_OTHER_ID = 'other'

export function inboxSubjectLabelForPreset(presetId) {
  const p = PORTAL_INBOX_SUBJECT_PRESETS.find((x) => x.id === presetId)
  return p ? p.label : ''
}

/**
 * Final subject string for Airtable / thread title.
 * @param {string} presetId
 * @param {string} customSubject — used when preset is "other"
 */
export function resolveInboxSubject(presetId, customSubject) {
  if (presetId === PORTAL_INBOX_SUBJECT_OTHER_ID) {
    return String(customSubject || '').trim()
  }
  return inboxSubjectLabelForPreset(presetId) || String(customSubject || '').trim()
}

export function inboxSubjectRequiresCustom(presetId) {
  return presetId === PORTAL_INBOX_SUBJECT_OTHER_ID
}
