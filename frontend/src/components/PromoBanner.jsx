import { Link } from 'react-router-dom'

/**
 * Thin top strip — discount / urgency line + apply CTA (matches public marketing header).
 */
export default function PromoBanner() {
  return (
    <div
      className="w-full shrink-0 border-b border-slate-200/60 bg-white"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="container mx-auto flex items-center justify-center gap-4 px-4 py-2 sm:px-6">
        <p className="text-center text-[10px] font-bold uppercase leading-snug tracking-[0.12em] text-slate-600 sm:text-[11px] sm:tracking-[0.14em]">
          Sign up now.{' '}
          <span className="text-slate-900">No application fee</span> for a limited time.
        </p>
        <Link
          to="/apply"
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_8px_24px_rgba(37,99,235,0.25)] transition hover:brightness-105 active:scale-[0.98] sm:px-5 sm:text-[11px]"
        >
          Apply now
        </Link>
      </div>
    </div>
  )
}
