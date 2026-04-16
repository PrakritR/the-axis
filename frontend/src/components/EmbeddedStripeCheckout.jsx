import { useEffect, useMemo, useRef, useState } from 'react'
import { readJsonResponse } from '../lib/readJsonResponse'

let stripeScriptPromise = null

function loadStripeJs() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Stripe.js is only available in the browser.'))
  }
  if (window.Stripe) return Promise.resolve(window.Stripe)
  if (!stripeScriptPromise) {
    stripeScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://js.stripe.com/v3/"]')
      if (existing) {
        existing.addEventListener('load', () => resolve(window.Stripe), { once: true })
        existing.addEventListener('error', () => reject(new Error('Failed to load Stripe.js.')), { once: true })
        return
      }
      const script = document.createElement('script')
      script.src = 'https://js.stripe.com/v3/'
      script.async = true
      script.onload = () => resolve(window.Stripe)
      script.onerror = () => reject(new Error('Failed to load Stripe.js.'))
      document.head.appendChild(script)
    })
  }
  return stripeScriptPromise
}

export function EmbeddedStripeCheckout({ open, title, checkoutRequest, apiEndpoint, onClose, onComplete }) {
  const containerRef = useRef(null)
  const embeddedRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const requestKey = useMemo(() => JSON.stringify(checkoutRequest || {}), [checkoutRequest])
  /** Parent callbacks change every render; refs keep Stripe from remounting on each parent paint. */
  const onCompleteRef = useRef(onComplete)
  const onCloseRef = useRef(onClose)
  onCompleteRef.current = onComplete
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined

    let cancelled = false

    async function init() {
      const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
      if (!publishableKey) {
        setError('VITE_STRIPE_PUBLISHABLE_KEY is not configured yet.')
        return
      }

      setLoading(true)
      setError('')
      setReady(false)

      try {
        const StripeCtor = await loadStripeJs()
        if (!StripeCtor) throw new Error('Stripe.js failed to initialize.')

        const stripe = StripeCtor(publishableKey)
        const endpoint = apiEndpoint || '/api/stripe'
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...(checkoutRequest || {}), embedded: true }),
        })
        const data = await readJsonResponse(response)
        if (!response.ok) throw new Error(data.error || 'Unable to start checkout.')
        if (!data.client_secret) throw new Error('Stripe did not return an embedded checkout client secret.')

        const checkoutSessionId = data.id ? String(data.id) : ''
        const amountTotalUsd =
          typeof data.amountTotalUsd === 'number' && Number.isFinite(data.amountTotalUsd) && data.amountTotalUsd > 0
            ? data.amountTotalUsd
            : undefined

        const embedded = await stripe.initEmbeddedCheckout({
          fetchClientSecret: async () => data.client_secret,
          onComplete: () => {
            onCompleteRef.current?.({ sessionId: checkoutSessionId, amountTotalUsd })
          },
        })

        if (cancelled || !containerRef.current) {
          embedded.destroy?.()
          return
        }

        embeddedRef.current = embedded
        embedded.mount(containerRef.current)
        setReady(true)
      } catch (err) {
        setError(err.message || 'Unable to load the payment form.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    init()

    return () => {
      cancelled = true
      setReady(false)
      if (embeddedRef.current) {
        embeddedRef.current.destroy?.()
        embeddedRef.current = null
      }
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [open, requestKey, apiEndpoint])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <div className="flex min-h-[100dvh] justify-center items-start py-2 sm:items-center sm:py-4">
        <div className="my-auto flex w-full max-w-4xl max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Secure Payment</div>
              <h3 className="mt-1 text-xl font-black text-slate-900">{title}</h3>
            </div>
            <button
              type="button"
              onClick={() => onCloseRef.current?.()}
              className="shrink-0 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
            {loading ? <p className="text-sm text-slate-500">Loading secure checkout…</p> : null}
            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            <div ref={containerRef} className={ready ? 'min-h-[min(420px,50dvh)]' : 'min-h-0'} />
          </div>
        </div>
      </div>
    </div>
  )
}
