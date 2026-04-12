/**
 * LeaseSignPanel.jsx
 *
 * E-signing UI shown below the lease when status is "Published".
 * Resident must:
 *   1. Check "I have read and agree…"
 *   2. Type their full legal name (must match tenantName on lease)
 *   3. Click "Sign Lease"
 *
 * Props:
 *   leaseDraftId   - Airtable Lease Drafts record ID
 *   tenantName     - expected signer name (from leaseData)
 *   onSigned       - callback(signatureText) called after successful sign
 */

import { useState } from 'react'
import toast from 'react-hot-toast'

export default function LeaseSignPanel({ leaseDraftId, tenantName = '', onSigned }) {
  const [agreed, setAgreed] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [signing, setSigning] = useState(false)

  const nameMatches =
    typedName.trim().toLowerCase() === tenantName.trim().toLowerCase() &&
    typedName.trim().length > 0

  const canSign = agreed && nameMatches && !signing

  async function handleSign(e) {
    e.preventDefault()
    if (!canSign) return
    setSigning(true)
    try {
      const res = await fetch('/api/sign-lease-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaseDraftId,
          signatureText: typedName.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not sign lease.')
      toast.success('Lease signed successfully!')
      onSigned?.(typedName.trim())
    } catch (err) {
      toast.error(err.message || 'Could not sign lease. Please try again.')
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-[#2563eb]/25 bg-[#2563eb]/[0.04] px-6 py-6">
      <h3 className="text-base font-black text-slate-900">Sign Your Lease</h3>
      <p className="mt-1 text-sm text-slate-600">
        Review the full agreement above, then complete the steps below to apply your electronic signature.
      </p>

      <form onSubmit={handleSign} className="mt-5 space-y-4">
        {/* Step 1 — agree */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#2563eb]"
          />
          <span className="text-sm text-slate-700">
            I have read the entire Residential Lease Agreement above and agree to all of its terms and conditions.
          </span>
        </label>

        {/* Step 2 — type name */}
        <div>
          <label className="block text-sm font-semibold text-slate-800">
            Type your full legal name to sign
          </label>
          <p className="mt-0.5 text-xs text-slate-500">
            Must match exactly: <span className="font-semibold text-slate-700">{tenantName}</span>
          </p>
          <input
            type="text"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={tenantName || 'Your full legal name'}
            autoComplete="name"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15"
          />
          {typedName.trim().length > 0 && !nameMatches ? (
            <p className="mt-1 text-xs text-red-600">Name does not match. Please type your name exactly as shown above.</p>
          ) : null}
          {nameMatches ? (
            <p className="mt-1 text-xs font-semibold text-emerald-600">✓ Name verified</p>
          ) : null}
        </div>

        {/* Signature preview */}
        {nameMatches ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Signature preview</p>
            <p className="font-serif text-xl italic text-slate-800">{typedName.trim()}</p>
          </div>
        ) : null}

        {/* Sign button */}
        <button
          type="submit"
          disabled={!canSign}
          className="w-full rounded-xl bg-[#2563eb] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {signing ? 'Signing…' : 'Sign Lease Agreement'}
        </button>

        <p className="text-center text-[11px] text-slate-400">
          By clicking "Sign Lease Agreement" you are applying a legally binding electronic signature
          under the Electronic Signatures in Global and National Commerce Act (E-SIGN).
        </p>
      </form>
    </div>
  )
}
