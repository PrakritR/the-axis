import { useState } from 'react'

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20'

export default function AxisTeam() {
  const [password, setPassword] = useState('')
  const [meetings, setMeetings] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/forms?action=software-team-meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setMeetings(Array.isArray(data.meetings) ? data.meetings : [])
    } catch (err) {
      setMeetings(null)
      setError(err.message || 'Could not load')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#edf2fb_0%,#f6f9fe_100%)] px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Axis software — meetings</h1>
        <p className="mt-1 text-sm text-slate-500">Internal list from Scheduling (Demo + Software Meeting).</p>

        <form onSubmit={load} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-600">Team password</label>
            <input type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="From AXIS_SOFTWARE_TEAM_SECRET" />
          </div>
          <button type="submit" disabled={loading || !password.trim()} className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40">
            {loading ? 'Loading…' : 'Show meetings'}
          </button>
        </form>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        {meetings && (
          <ul className="mt-8 space-y-3">
            {meetings.length === 0 ? (
              <li className="rounded-2xl border border-slate-200 bg-white/90 p-6 text-sm text-slate-500">No rows match.</li>
            ) : (
              meetings.map((m) => (
                <li key={m.id} className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-900">{m.name || '—'}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-[#2563eb]">{m.type}</span>
                  </div>
                  <div className="mt-2 space-y-0.5 text-sm text-slate-600">
                    <div>{m.email}{m.phone ? ` · ${m.phone}` : ''}</div>
                    {m.company ? <div>{m.company}</div> : null}
                    {m.staff ? <div className="text-slate-500">With: {m.staff}</div> : null}
                    {(m.preferredDate || m.preferredTime) ? (
                      <div className="font-medium text-slate-800">{[m.preferredDate, m.preferredTime].filter(Boolean).join(' · ')}</div>
                    ) : null}
                    {m.notes ? <p className="mt-2 whitespace-pre-wrap text-xs text-slate-500">{m.notes}</p> : null}
                    {m.status ? <div className="mt-2 text-xs text-slate-400">Status: {m.status}</div> : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
