import { Link } from 'react-router-dom'
import { HOUSING_CONTACT_SCHEDULE } from '../lib/housingSite'

/**
 * Thin top strip — discount / urgency line + tour CTA (matches public marketing header).
 */
export default function PromoBanner() {
  return (
    <div
      className="w-full shrink-0 border-b border-slate-200/60 bg-white"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="container mx-auto flex flex-col items-stretch gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-2 sm:px-6">
        <p className="text-center text-[10px] font-bold uppercase leading-snug tracking-[0.12em] text-slate-600 sm:text-left sm:text-[11px] sm:tracking-[0.14em]">
          Sign up now.{' '}
          <span className="text-slate-900">No application fee</span> for a limited time.
        </p>
        <div className="flex shrink-0 justify-center sm:justify-end">
          <Link
            to={HOUSING_CONTACT_SCHEDULE}
            className="inline-flex items-center justify-center rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_8px_24px_rgba(37,99,235,0.25)] transition hover:brightness-105 active:scale-[0.98] sm:px-5 sm:py-2 sm:text-[11px]"
          >
            Schedule tour
          </Link>
        </div>
      </div>
    </div>
  )
}
