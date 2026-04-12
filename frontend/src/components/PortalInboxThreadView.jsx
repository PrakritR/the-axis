import React from 'react'
import { RESIDENT_SCOPE_PREFIX } from '../lib/portalInboxConstants.js'

export { RESIDENT_SCOPE_PREFIX }

export function formatResidentLeasingScopeLine(resident) {
  const house = String(resident?.House || resident?.['Property Name'] || '').trim()
  const unit = String(resident?.['Unit Number'] || resident?.Unit || '').trim()
  const parts = [house, unit].filter(Boolean)
  return parts.length ? `${RESIDENT_SCOPE_PREFIX} ${parts.join(' · ')}]` : `${RESIDENT_SCOPE_PREFIX} Resident]`
}

/** Body stored in Airtable: scope + blank line + user text. */
export function buildResidentLeasingMessageBody(userText, resident) {
  const t = String(userText || '').trim()
  const scope = formatResidentLeasingScopeLine(resident)
  return `${scope}\n\n${t}`
}

/** Strip scope line for resident-facing display only. */
export function displayMessageForResidentPortal(raw) {
  const s = String(raw || '')
  if (!s.startsWith(RESIDENT_SCOPE_PREFIX)) return s
  const idx = s.indexOf(']\n\n')
  if (idx === -1) return s
  return s.slice(idx + 3).trim() || s
}

export function formatPortalInboxTimestamp(v) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Shared message list + composer chrome for portal inboxes (resident / internal / manager can reuse styling).
 */
export default function PortalInboxThreadView({
  title,
  subtitle,
  messages,
  bubbleMeLabel,
  bubbleOtherLabel = 'Axis',
  getIsOtherAdmin = (m) => Boolean(m['Is Admin']),
  mapMessageBody = (m) => m.Message,
  emptyHint = 'No messages yet',
  children,
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
        <h2 className="truncate text-base font-black text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 lg:px-5">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-500">{emptyHint}</p>
        ) : (
          messages.map((m) => {
            const admin = getIsOtherAdmin(m)
            const body = mapMessageBody(m)
            const label = admin ? bubbleOtherLabel : bubbleMeLabel
            return (
              <div
                key={m.id}
                className={`rounded-xl border px-3 py-2 text-sm ${
                  admin ? 'ml-2 border-violet-200 bg-violet-50 md:ml-6' : 'mr-2 border-slate-200 bg-white md:mr-6'
                }`}
              >
                <div className="text-[11px] font-semibold text-slate-400">
                  {label} · {formatPortalInboxTimestamp(m.Timestamp || m.created_at)}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-slate-800">{body}</p>
              </div>
            )
          })
        )}
      </div>
      {children}
    </div>
  )
}
