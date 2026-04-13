import React from 'react'

/**
 * Consistent “no photo yet” surface for listing cards, gallery, and detail sections.
 */
export default function PropertyMediaPlaceholder({
  className = '',
  compact = false,
  label = 'Photos coming soon',
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center bg-gradient-to-br from-slate-200 via-slate-100 to-slate-300 text-slate-500 ${className}`}
      role="img"
      aria-label={label}
    >
      <svg
        className={compact ? 'h-8 w-8 shrink-0 opacity-70' : 'h-14 w-14 shrink-0 opacity-65'}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
        />
      </svg>
      <span
        className={`mt-2 text-center font-semibold uppercase tracking-[0.12em] text-slate-500 ${compact ? 'max-w-[8rem] text-[10px] leading-tight' : 'text-xs'}`}
      >
        {label}
      </span>
    </div>
  )
}
