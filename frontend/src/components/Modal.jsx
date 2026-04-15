import React from 'react'
import { createPortal } from 'react-dom'

export default function Modal({ children, onClose }){
  const root = typeof document !== 'undefined' ? document.getElementById('modal-root') || document.body : null
  if(!root) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose}></div>
      <div className="relative z-10 mx-auto w-full max-w-3xl self-center rounded-[28px] bg-white p-5 shadow-2xl sm:p-6 max-h-[min(92dvh,52rem)] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-5 right-5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        {children}
      </div>
    </div>,
    root
  )
}
