import React from 'react'

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

const TONE_STYLES = {
  slate: 'border-slate-200 bg-slate-100 text-slate-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  axis: 'border-axis/20 bg-axis/10 text-axis',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

/** Card shell for metrics (border matches tone). */
const TONE_CARD_BORDER = {
  slate: 'border-slate-200',
  blue: 'border-blue-200',
  axis: 'border-axis/25',
  amber: 'border-amber-200',
  red: 'border-red-200',
  emerald: 'border-emerald-200',
}

export function PortalOpsCard({ title, description, action, children, className = '' }) {
  return (
    <section className={classNames('rounded-3xl border border-slate-200 bg-white shadow-soft', className)}>
      {(title || description || action) ? (
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7">
          <div>
            {title ? <h2 className="text-xl font-black text-slate-900 sm:text-2xl">{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className="px-5 py-5 sm:px-7 sm:py-6">{children}</div>
    </section>
  )
}

export function PortalOpsStatusBadge({ tone = 'slate', children, className = '' }) {
  return (
    <span
      className={classNames(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]',
        TONE_STYLES[tone] || TONE_STYLES.slate,
        className,
      )}
    >
      {children}
    </span>
  )
}

export function PortalOpsMetric({ label, value, hint, tone = 'slate' }) {
  const borderCls = TONE_CARD_BORDER[tone] || TONE_CARD_BORDER.slate
  const labelTone =
    tone === 'emerald'
      ? 'text-emerald-800'
      : tone === 'red'
        ? 'text-red-800'
        : tone === 'amber'
          ? 'text-amber-800'
          : tone === 'axis'
            ? 'text-axis'
            : 'text-slate-400'
  return (
    <div className={classNames('rounded-3xl border bg-white p-5 shadow-sm', borderCls)}>
      <div className={classNames('text-[11px] font-bold uppercase tracking-[0.14em]', labelTone)}>{label}</div>
      <div
        className={classNames(
          'mt-3 text-3xl font-black tracking-tight',
          tone === 'emerald'
            ? 'text-emerald-700'
            : tone === 'red'
              ? 'text-red-700'
              : tone === 'amber'
                ? 'text-amber-700'
                : tone === 'axis'
                  ? 'text-axis'
                  : 'text-slate-900',
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-2 text-sm text-slate-500">{hint}</div> : null}
    </div>
  )
}

export function PortalOpsEmptyState({ title, description, action = null, icon = null }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-12 text-center">
      {icon ? (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
          {icon}
        </div>
      ) : null}
      <div>
        <div className="text-base font-bold text-slate-900">{title}</div>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/**
 * Primary portal pattern: summary cards that double as filters (manager payments, work orders, leasing, inbox, etc.).
 * Selected card gets a stronger border + ring; list content below reflects the selection.
 */
export function PortalOpsFilterCards({
  items,
  value,
  onChange,
  className = '',
  columnsClassName = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4',
  variant = 'default',
  'aria-label': ariaLabel = 'Filter by status',
}) {
  const isCompact = variant === 'compact'
  return (
    <div className={classNames(columnsClassName, className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.id === value
        const tone = item.tone || 'slate'
        const valueTone =
          tone === 'emerald'
            ? 'text-emerald-700'
            : tone === 'red'
              ? 'text-red-700'
              : tone === 'amber'
                ? 'text-amber-700'
                : tone === 'axis'
                  ? 'text-axis'
                  : 'text-slate-900'
        const labelTone =
          tone === 'emerald'
            ? active
              ? 'text-emerald-800'
              : 'text-emerald-700/80'
            : tone === 'red'
              ? active
                ? 'text-red-800'
                : 'text-red-700/80'
              : tone === 'amber'
                ? active
                  ? 'text-amber-800'
                  : 'text-amber-700/80'
                : tone === 'axis'
                  ? active
                    ? 'text-axis'
                    : 'text-slate-500'
                  : 'text-slate-500'
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={classNames(
              'rounded-3xl border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/35 focus-visible:ring-offset-2',
              isCompact ? 'px-3 py-3 sm:px-4 sm:py-3.5' : 'p-5',
              active
                ? 'border-[#2563eb]/45 bg-[#2563eb]/[0.07] shadow-[0_0_0_2px_rgba(37,99,235,0.12)]'
                : 'border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:bg-slate-50/90',
            )}
          >
            <div
              className={classNames(
                'font-bold uppercase tracking-[0.14em]',
                isCompact ? 'text-[10px]' : 'text-[11px]',
                labelTone,
              )}
            >
              {item.label}
            </div>
            <div
              className={classNames(
                'mt-2 font-black tracking-tight',
                isCompact ? 'text-lg' : 'text-2xl sm:text-3xl',
                active ? valueTone : 'text-slate-900',
              )}
            >
              {item.value}
            </div>
            {item.hint ? (
              <div className={classNames('mt-1.5 text-slate-500', isCompact ? 'text-[11px] leading-snug' : 'text-sm')}>
                {item.hint}
              </div>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

