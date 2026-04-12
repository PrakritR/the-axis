import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { readJsonResponse } from '../lib/readJsonResponse'

/**
 * Manager-profile-themed admin account view with view / edit modes.
 */
export default function AdminProfilePanel({ user, onUserUpdate, onSignOut }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const canSaveToAirtable = Boolean(user?.airtableRecordId && String(user.airtableRecordId).startsWith('rec'))

  useEffect(() => {
    setForm({
      name: user?.name || '',
      phone: user?.phone || '',
    })
  }, [user?.name, user?.phone, user?.email])

  function handleCancel() {
    setForm({
      name: user?.name || '',
      phone: user?.phone || '',
    })
    setSaveError('')
    setEditing(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaveError('')
    if (!canSaveToAirtable) {
      toast.error('This sign-in method does not support saving profile to the database.')
      return
    }
    if (!form.name.trim() && !form.phone.trim()) {
      setSaveError('Enter at least a name or phone.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/portal?action=admin-update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          airtableRecordId: user.airtableRecordId,
          email: user.email,
          name: form.name.trim(),
          phone: form.phone.trim(),
        }),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'Could not save profile.')
      toast.success('Profile saved')
      onUserUpdate?.({
        name: data.name || form.name.trim(),
        phone: data.phone ?? form.phone.trim(),
      })
      setEditing(false)
    } catch (err) {
      setSaveError(err.message || 'Could not save profile.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'
  const readonlyCls = `${inputCls} cursor-default bg-slate-100 text-slate-600`

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="mt-2 text-2xl font-black text-slate-900">Profile</h2>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="shrink-0 rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-[#2563eb]/40 hover:bg-slate-50"
            >
              Edit info
            </button>
          ) : null}
        </div>

        {!editing ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Full name</p>
              <div className={readonlyCls}>{user?.name || '—'}</div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Email</p>
              <div className={readonlyCls}>{user?.email || '—'}</div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Phone</p>
              <div className={readonlyCls}>{user?.phone || '—'}</div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Admin ID</p>
              <div className={`${readonlyCls} font-mono`}>{user?.id || '—'}</div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSave} className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Full name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Your name"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
              <div className={readonlyCls}>{user?.email || '—'}</div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+1 (206) 555-0100"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Admin ID</label>
              <div className={`${readonlyCls} font-mono`}>{user?.id || '—'}</div>
            </div>
            {!canSaveToAirtable ? (
              <div className="sm:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                Profiles for server-configured admin accounts cannot be edited here. Add an Admin Profile row in Airtable and
                sign in with that email to update name and phone in the database.
              </div>
            ) : null}
            {saveError ? (
              <div className="sm:col-span-2">
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <button
                type="submit"
                disabled={saving || !canSaveToAirtable}
                className="rounded-2xl bg-[#2563eb] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-6">
        <h2 className="mt-2 text-xl font-black text-slate-900">Session</h2>
        <p className="mt-2 text-sm text-slate-600">Sign out of the admin portal on this device.</p>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-100"
        >
          Sign out
        </button>
      </section>
    </div>
  )
}
