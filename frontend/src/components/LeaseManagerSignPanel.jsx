/**
 * Manager / landlord counter-signature for Lease Drafts (typed name + drawn or uploaded image).
 * Writes optional Airtable fields — add columns or set VITE_AIRTABLE_LEASE_MANAGER_SIGNATURE_* env vars.
 */

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import SignaturePad from 'signature_pad'
import {
  leaseManagerSignatureFieldNames,
  pickManagerSignatureFromDraft,
} from '../../../shared/lease-manager-signature-fields.js'

const MAX_IMAGE_CHARS = 95_000

function downscaleDataUrl(dataUrl, maxW = 480, quality = 0.82) {
  return new Promise((resolve) => {
    if (!dataUrl || !String(dataUrl).startsWith('data:image')) {
      resolve(dataUrl)
      return
    }
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      if (!w || !h) {
        resolve(dataUrl)
        return
      }
      const scale = w > maxW ? maxW / w : 1
      const cw = Math.max(1, Math.round(w * scale))
      const ch = Math.max(1, Math.round(h * scale))
      const c = document.createElement('canvas')
      c.width = cw
      c.height = ch
      const ctx = c.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, cw, ch)
      ctx.drawImage(img, 0, 0, cw, ch)
      resolve(c.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export default function LeaseManagerSignPanel({ draft, manager, onSaved }) {
  const names = leaseManagerSignatureFieldNames(import.meta.env)
  const existing = pickManagerSignatureFromDraft(draft, import.meta.env)
  const managerLegalName = String(manager?.name || manager?.email || '').trim()
  const [agreed, setAgreed] = useState(false)
  const [typedName, setTypedName] = useState(managerLegalName)
  const [uploadDataUrl, setUploadDataUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef(null)
  const padRef = useRef(null)

  const nameMatches =
    typedName.trim().toLowerCase() === managerLegalName.toLowerCase() &&
    typedName.trim().split(/\s+/).filter(Boolean).length >= 2

  useEffect(() => {
    setTypedName(managerLegalName)
  }, [managerLegalName])

  useEffect(() => {
    if (existing.text) return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined

    function mountPad() {
      padRef.current?.off?.()
      padRef.current = null
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const rect = canvas.getBoundingClientRect()
      const width = rect.width || canvas.offsetWidth || 520
      const height = rect.height || canvas.offsetHeight || 176
      canvas.width = Math.max(1, Math.floor(width * ratio))
      canvas.height = Math.max(1, Math.floor(height * ratio))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(ratio, ratio)
      padRef.current = new SignaturePad(canvas, {
        backgroundColor: 'rgb(255,255,255)',
        penColor: 'rgb(15,23,42)',
        minWidth: 1,
        maxWidth: 2.2,
      })
    }

    mountPad()
    window.addEventListener('resize', mountPad)
    return () => {
      window.removeEventListener('resize', mountPad)
      padRef.current?.off?.()
      padRef.current = null
    }
  }, [existing.text, draft?.id])

  function clearPad() {
    padRef.current?.clear()
    setUploadDataUrl('')
  }

  function onPickImageFile(ev) {
    const input = ev.target
    const f = input.files?.[0]
    if (!f) return
    if (!/^image\//.test(f.type)) {
      toast.error('Choose a PNG or JPG image.')
      input.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result || '')
      setUploadDataUrl(url)
      padRef.current?.clear()
    }
    reader.onerror = () => toast.error('Could not read that image.')
    reader.readAsDataURL(f)
    input.value = ''
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!draft?.id) return
    if (!managerLegalName) {
      toast.error('Manager name is missing from your session.')
      return
    }
    if (!agreed) {
      toast.error('Confirm you have authority to sign on behalf of the landlord.')
      return
    }
    if (!nameMatches) {
      toast.error('Type your full legal name exactly as shown.')
      return
    }

    let imageDataUrl = ''
    if (uploadDataUrl) {
      imageDataUrl = await downscaleDataUrl(uploadDataUrl)
    } else {
      const pad = padRef.current
      if (!pad || pad.isEmpty()) {
        toast.error('Draw your signature or upload a signature image.')
        return
      }
      imageDataUrl = await downscaleDataUrl(pad.toDataURL('image/png'))
    }

    if (imageDataUrl.length > MAX_IMAGE_CHARS) {
      toast.error('Signature image is too large after compression. Try a simpler image or redraw a smaller signature.')
      return
    }

    const now = new Date().toISOString()
    const fields = {
      [names.text]: typedName.trim(),
      [names.at]: now,
      [names.image]: imageDataUrl,
    }

    setSaving(true)
    try {
      await onSaved(draft.id, fields)
      toast.success('Manager signature saved')
    } catch (err) {
      const msg = String(err?.message || err || '')
      if (msg.includes(names.image) || /unknown field|UNKNOWN_FIELD/i.test(msg)) {
        try {
          const { [names.image]: _img, ...rest } = fields
          await onSaved(draft.id, rest)
          toast.success('Manager signature saved (without image — add a long-text field for the image in Airtable).')
          return
        } catch (err2) {
          toast.error(err2?.message || 'Could not save manager signature.')
        }
      } else {
        toast.error(msg || 'Could not save manager signature.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (existing.text) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-5 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-800">Manager signature on file</p>
        {existing.image ? (
          <img
            src={existing.image}
            alt="Manager signature"
            className="mt-2 max-h-24 max-w-full rounded border border-emerald-200/80 bg-white object-contain p-1"
          />
        ) : (
          <p className="mt-2 font-serif text-xl italic text-slate-900">{existing.text}</p>
        )}
        {existing.at ? (
          <p className="mt-1 text-xs text-emerald-800">{new Date(existing.at).toLocaleString()}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-black text-slate-900">Manager / landlord signature</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        Sign on behalf of the landlord after reviewing the agreement. This is stored on the lease draft and appears in
        the formatted document for residents.
      </p>

      <form onSubmit={handleSave} className="mt-4 space-y-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#2563eb]"
          />
          <span className="text-sm text-slate-700">
            I confirm I am authorized to sign this lease on behalf of the landlord / property manager.
          </span>
        </label>

        <div>
          <label className="block text-sm font-semibold text-slate-800">Type your full legal name</label>
          <p className="mt-0.5 text-xs text-slate-500">
            Must match your manager profile name:{' '}
            <span className="font-semibold text-slate-800">{managerLegalName || '—'}</span>
          </p>
          <input
            type="text"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#2563eb]/15"
            autoComplete="name"
          />
          {typedName.trim().length > 0 && !nameMatches ? (
            <p className="mt-1 text-xs text-red-600">Name must match exactly (first and last).</p>
          ) : null}
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-800">Draw signature</p>
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <canvas ref={canvasRef} className="h-44 w-full touch-none" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={clearPad}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Clear drawing
            </button>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-800">Or upload signature image</p>
          <p className="mt-0.5 text-xs text-slate-500">PNG or JPG. Upload replaces the drawing above.</p>
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            onChange={onPickImageFile}
            className="mt-2 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-800"
          />
          {uploadDataUrl ? (
            <img
              src={uploadDataUrl}
              alt="Upload preview"
              className="mt-2 max-h-28 max-w-full rounded border border-slate-200 bg-white object-contain p-1"
            />
          ) : null}
        </div>

        <button
          type="submit"
          disabled={saving || !agreed || !nameMatches}
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save manager signature'}
        </button>
      </form>
    </div>
  )
}
