import React, { useState } from 'react'
import { Link } from 'react-router-dom'

function cx(...values) {
  return values.filter(Boolean).join(' ')
}

export const portalAuthInputCls =
  'w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20'

export function PortalAuthPage({ children, dense = false }) {
  return (
    <div
      className={cx(
        'flex min-h-dvh items-start justify-center bg-[linear-gradient(180deg,#f7fbff_0%,#eef5ff_48%,#f9fcff_100%)] px-4 pb-12 font-sans',
        dense ? 'pt-4 sm:pt-5 lg:pt-7' : 'pt-8 sm:pt-12 lg:pt-16'
      )}
    >
      <div className="w-full max-w-lg">{children}</div>
    </div>
  )
}

export function PortalAuthCard({ title, children, footer }) {
  return (
    <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-soft sm:p-10">
      <div className="mb-6 text-center">
        <h1 className="text-4xl font-black tracking-tight text-slate-900">{title}</h1>
      </div>
      {children}
      {footer ? <div className="mt-8 text-center text-sm text-slate-400">{footer}</div> : null}
    </section>
  )
}

export function PortalSegmentedControl({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 rounded-[24px] border border-slate-100 bg-slate-50 p-1.5">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cx(
            'flex-1 rounded-[18px] px-4 py-3 text-base font-semibold transition',
            active === id ? 'bg-white text-slate-900 shadow-sm ring-2 ring-[#2563eb]' : 'text-slate-500 hover:text-slate-900'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function PortalField({ label, required = false, children }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-slate-700">
        {label}
        {required ? <span className="text-red-400"> *</span> : null}
      </label>
      {children}
    </div>
  )
}

export function PortalNotice({ tone = 'neutral', children }) {
  const toneCls = {
    neutral: 'border-slate-200 bg-slate-50 text-slate-600',
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }

  return (
    <div className={cx('rounded-2xl border px-4 py-3 text-sm', toneCls[tone] || toneCls.neutral)}>
      {children}
    </div>
  )
}

export function PortalPrimaryButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={cx(
        'w-full rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-4 text-base font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {children}
    </button>
  )
}

export function PortalPasswordInput({ value, onChange, placeholder, autoComplete }) {
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        required
        value={value}
        onChange={onChange}
        placeholder={placeholder || '••••••••'}
        autoComplete={autoComplete || 'current-password'}
        className={`${portalAuthInputCls} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShow((current) => !current)}
        tabIndex={-1}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
      >
        {show ? (
          <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
          </svg>
        ) : (
          <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>
    </div>
  )
}

export function PortalFooterLink({ prefix, linkLabel, to }) {
  return (
    <>
      {prefix}{' '}
      <Link to={to} className="font-semibold text-slate-600 hover:text-slate-900">
        {linkLabel}
      </Link>
    </>
  )
}
