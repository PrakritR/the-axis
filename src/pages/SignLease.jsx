import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import SignaturePad from 'signature_pad'
import { getLeaseByToken, updateLeaseRecord } from '../lib/airtable'

function formatDate(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value || '—')
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildPrintableHtml({ lease, leaseData, signatureName, signedAt, signatureImage }) {
  const sections = [
    ['Tenant', leaseData?.tenantName || lease['Signer Full Name'] || lease['Resident Name'] || '—'],
    ['Email', leaseData?.tenantEmail || lease['Signer Email'] || lease['Resident Email'] || '—'],
    ['Property', leaseData?.propertyName || lease.Property || lease['Property Name'] || '—'],
    ['Unit', leaseData?.roomNumber || lease.Unit || lease['Room Number'] || '—'],
    ['Address', leaseData?.propertyAddress || lease.fullAddress || lease['Property Address'] || '—'],
    ['Lease Start', leaseData?.leaseStartFmt || formatDate(leaseData?.leaseStart || lease['Lease Start Date'])],
    ['Lease End', leaseData?.leaseEndFmt || formatDate(leaseData?.leaseEnd || lease['Lease End Date'])],
    ['Monthly Rent', leaseData?.monthlyRentFmt || formatMoney(leaseData?.monthlyRent || lease['Rent Amount'])],
    ['Utilities', leaseData?.utilityFeeFmt || formatMoney(leaseData?.utilityFee || lease['Utilities Fee'])],
    ['Security Deposit', leaseData?.securityDepositFmt || formatMoney(leaseData?.securityDeposit || lease['Deposit Amount'])],
  ]

  const prose = typeof leaseData?.leaseText === 'string' && leaseData.leaseText.trim()
    ? leaseData.leaseText.trim()
    : typeof lease['Lease JSON'] === 'string' && lease['Lease JSON'].includes('RESIDENTIAL LEASE AGREEMENT')
      ? lease['Lease JSON']
      : ''

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Signed Lease</title>
    <style>
      body { font-family: Helvetica, Arial, sans-serif; color: #0f172a; margin: 40px; }
      h1 { font-size: 26px; margin-bottom: 8px; }
      h2 { font-size: 16px; margin-top: 28px; margin-bottom: 10px; }
      .meta { color: #475569; font-size: 14px; margin-bottom: 24px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; margin-top: 18px; }
      .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px 14px; }
      .label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
      .value { font-weight: 700; font-size: 14px; margin-top: 6px; }
      .signature { margin-top: 36px; padding-top: 18px; border-top: 1px solid #cbd5e1; }
      .signature img { width: 280px; max-width: 100%; border-bottom: 1px solid #0f172a; margin-top: 8px; }
      pre { white-space: pre-wrap; font-family: "Courier New", monospace; font-size: 12px; line-height: 1.6; border: 1px solid #cbd5e1; border-radius: 12px; padding: 18px; background: #f8fafc; }
    </style>
  </head>
  <body>
    <h1>Signed Lease Confirmation</h1>
    <div class="meta">Signed on ${escapeHtml(formatDate(signedAt))}</div>
    <div class="grid">
      ${sections.map(([label, value]) => `
        <div class="card">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
        </div>
      `).join('')}
    </div>
    ${prose ? `<h2>Lease Text</h2><pre>${escapeHtml(prose)}</pre>` : ''}
    <div class="signature">
      <div class="label">Resident Signature</div>
      <div class="value">${escapeHtml(signatureName)}</div>
      ${signatureImage ? `<img src="${signatureImage}" alt="Resident signature" />` : '<div style="margin-top:8px;padding-top:16px;border-bottom:1px solid #0f172a;width:280px;max-width:100%;height:34px;"></div>'}
    </div>
    <script>window.onload = () => window.print()</script>
  </body>
</html>`
}

function SummaryRow({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-1.5 text-sm font-semibold text-slate-900">{value || '—'}</div>
    </div>
  )
}

export default function SignLease() {
  const { token = '' } = useParams()
  const canvasRef = useRef(null)
  const signaturePadRef = useRef(null)

  const [lease, setLease] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [signatureName, setSignatureName] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [saving, setSaving] = useState(false)
  const [signedAt, setSignedAt] = useState('')
  const [signatureImage, setSignatureImage] = useState('')

  const leaseData = useMemo(() => {
    if (lease?._leaseData && typeof lease._leaseData === 'object') return lease._leaseData
    return null
  }, [lease])

  const alreadySigned = Boolean(lease?.['Lease Signed'] || lease?.['Lease Status'] === 'Signed')

  useEffect(() => {
    let cancelled = false

    async function loadLease() {
      setLoading(true)
      setLoadError('')
      try {
        const record = await getLeaseByToken(token)
        if (!record) throw new Error('This signing link is invalid or has expired.')
        if (!cancelled) {
          setLease(record)
          setSignatureName(record['Lease Signature'] || record['Signer Full Name'] || record['Resident Name'] || '')
          setSignedAt(record['Lease Signed Date'] || '')
        }
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Unable to load this lease.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadLease()
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (loading || !canvasRef.current || alreadySigned) return undefined

    const canvas = canvasRef.current

    function resizeCanvas() {
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const width = canvas.offsetWidth || 600
      const height = canvas.offsetHeight || 220
      canvas.width = width * ratio
      canvas.height = height * ratio
      const ctx = canvas.getContext('2d')
      ctx.scale(ratio, ratio)

      const pad = new SignaturePad(canvas, {
        backgroundColor: 'rgb(255,255,255)',
        penColor: 'rgb(15,23,42)',
        minWidth: 1.1,
        maxWidth: 2.4,
      })

      signaturePadRef.current = pad
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => {
      window.removeEventListener('resize', resizeCanvas)
      signaturePadRef.current?.off()
      signaturePadRef.current = null
    }
  }, [alreadySigned, loading])

  function handleClearSignature() {
    signaturePadRef.current?.clear()
    setSubmitError('')
  }

  function handlePrintPdf() {
    if (!lease || !signatureName) return
    const printable = window.open('', '_blank', 'noopener,noreferrer')
    if (!printable) return
    printable.document.open()
    printable.document.write(buildPrintableHtml({ lease, leaseData, signatureName, signedAt, signatureImage }))
    printable.document.close()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError('')

    const trimmedName = signatureName.trim()
    if (trimmedName.split(/\s+/).length < 2) {
      setSubmitError('Enter your full legal name before signing.')
      return
    }

    const pad = signaturePadRef.current
    if (!pad || pad.isEmpty()) {
      setSubmitError('Draw your signature in the signature box before submitting.')
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    setSaving(true)

    try {
      await updateLeaseRecord(lease.id, {
        'Lease Signed': true,
        'Lease Signed Date': today,
        'Lease Signature': trimmedName,
        'Lease Status': 'Signed',
      })

      setSignedAt(today)
      setSignatureImage(pad.toDataURL('image/png'))
      setLease((current) => current ? ({
        ...current,
        'Lease Signed': true,
        'Lease Signed Date': today,
        'Lease Signature': trimmedName,
        'Lease Status': 'Signed',
      }) : current)
    } catch (err) {
      setSubmitError(err.message || 'Unable to save your lease signature. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
        <div className="text-sm font-semibold text-slate-500">Loading lease…</div>
      </div>
    )
  }

  if (loadError || !lease) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
        <div className="w-full max-w-lg rounded-[28px] border border-red-200 bg-white p-8 text-center shadow-soft">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-500">Lease Signing</div>
          <h1 className="mt-2 text-2xl font-black text-slate-900">Link unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">{loadError || 'This signing link could not be loaded.'}</p>
        </div>
      </div>
    )
  }

  const residentName = leaseData?.tenantName || lease['Signer Full Name'] || lease['Resident Name'] || 'Resident'
  const propertyName = leaseData?.propertyName || lease.Property || lease['Property Name'] || 'Axis Property'
  const roomNumber = leaseData?.roomNumber || lease.Unit || lease['Room Number'] || ''
  const statusLabel = alreadySigned ? 'Signed' : (lease['Lease Status'] || 'Pending')
  const prose = typeof leaseData?.leaseText === 'string' && leaseData.leaseText.trim()
    ? leaseData.leaseText.trim()
    : ''

  return (
    <div className="min-h-screen bg-[linear-gradient(160deg,#edf2fb_0%,#f8fafc_35%,#ffffff_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Axis Lease Signing</div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Review and sign your lease</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Confirm the lease summary below, add your legal signature, and save a PDF copy for your records.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${alreadySigned ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            {statusLabel}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft">
              <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Summary</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryRow label="Resident" value={residentName} />
                <SummaryRow label="Property" value={propertyName} />
                <SummaryRow label="Unit" value={roomNumber || '—'} />
                <SummaryRow label="Address" value={leaseData?.propertyAddress || lease.fullAddress || lease['Property Address'] || '—'} />
                <SummaryRow label="Lease Start" value={leaseData?.leaseStartFmt || formatDate(leaseData?.leaseStart || lease['Lease Start Date'])} />
                <SummaryRow label="Lease End" value={leaseData?.leaseEndFmt || formatDate(leaseData?.leaseEnd || lease['Lease End Date'])} />
                <SummaryRow label="Monthly Rent" value={leaseData?.monthlyRentFmt || formatMoney(leaseData?.monthlyRent || lease['Rent Amount'])} />
                <SummaryRow label="Utilities" value={leaseData?.utilityFeeFmt || formatMoney(leaseData?.utilityFee || lease['Utilities Fee'])} />
                <SummaryRow label="Deposit" value={leaseData?.securityDepositFmt || formatMoney(leaseData?.securityDeposit || lease['Deposit Amount'])} />
                <SummaryRow label="Move-In Total" value={leaseData?.totalMoveInFmt || '—'} />
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Agreement</div>
              <h2 className="text-xl font-black text-slate-900">Lease terms</h2>
              {prose ? (
                <div className="mt-4 max-h-[480px] overflow-y-auto rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-700">{prose}</pre>
                </div>
              ) : (
                <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-600">
                  This lease invite includes the signed property, rent, and date summary above. If you need the full long-form agreement attached to this invite, contact Axis management before signing.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Signature</div>
              <h2 className="mt-2 text-xl font-black text-slate-900">{alreadySigned ? 'Lease signed' : 'Add your legal signature'}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                {alreadySigned
                  ? `Signed on ${formatDate(signedAt)}. You can still open a print-friendly version and save it as a PDF.`
                  : 'Type your full legal name, then sign in the box below. This signature is stored with your lease record in Airtable.'}
              </p>

              <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">Full legal name</label>
                  <input
                    type="text"
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    disabled={alreadySigned}
                    placeholder="First and last name"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                {!alreadySigned ? (
                  <>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <label className="block text-sm font-semibold text-slate-700">Draw signature</label>
                        <button
                          type="button"
                          onClick={handleClearSignature}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                        <canvas ref={canvasRef} className="block h-56 w-full touch-none bg-white" />
                      </div>
                    </div>

                    {submitError ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {submitError}
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      disabled={saving}
                      className="w-full rounded-2xl bg-slate-900 px-5 py-3.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                    >
                      {saving ? 'Saving signature…' : 'Sign lease'}
                    </button>
                  </>
                ) : null}
              </form>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-6">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Records</div>
              <h2 className="mt-2 text-xl font-black text-slate-900">Save your copy</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                After signing, open the print-friendly version and choose “Save as PDF” in your browser’s print dialog.
              </p>
              <button
                type="button"
                onClick={handlePrintPdf}
                disabled={!alreadySigned}
                className="mt-4 w-full rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Open print-friendly PDF view
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
