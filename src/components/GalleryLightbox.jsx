import React, { useEffect, useMemo, useRef, useState } from 'react'

export default function GalleryLightbox({ images = [], startIndex = 0, open, onClose }){
  const safeStart = useMemo(() => {
    if (!images.length) return 0
    return Math.max(0, Math.min(startIndex || 0, images.length - 1))
  }, [images.length, startIndex])

  const [current, setCurrent] = useState(safeStart)
  const touchStartX = useRef(null)

  function prev() {
    setCurrent((prevIndex) => (prevIndex - 1 + images.length) % images.length)
  }

  function next() {
    setCurrent((prevIndex) => (prevIndex + 1) % images.length)
  }

  function onTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }

  function onTouchEnd(e) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) > 40) {
      if (dx < 0) next()
      else prev()
    }
    touchStartX.current = null
  }

  useEffect(() => {
    if (!open) return undefined

    setCurrent(safeStart)

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') prev()
      if (event.key === 'ArrowRight') next()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, safeStart, onClose, images.length])

  if (!open || images.length === 0) return null

  return (
    <div
      className="fixed inset-0 z-[99999] bg-[#050505]/96"
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(12px, env(safe-area-inset-left))',
        paddingRight: 'max(12px, env(safe-area-inset-right))',
      }}
      role="dialog" aria-modal="true" aria-label="Image gallery"
    >
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="Close gallery" onClick={onClose} />

      <div className="relative mx-auto flex h-full w-full max-w-[1400px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0c0c0c] shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 text-white sm:px-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Image gallery</div>
            <div className="mt-1 text-sm font-medium text-white/90">Image {current + 1} of {images.length}</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={prev} aria-label="Previous image" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition hover:bg-white/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M15 18 9 12l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button type="button" onClick={next} aria-label="Next image" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition hover:bg-white/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button type="button" onClick={onClose} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
              Close
            </button>
          </div>
        </div>

        <div
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3 sm:px-5 sm:py-5"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <img
            src={images[current]}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-32 blur-3xl"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%),linear-gradient(180deg,rgba(12,12,12,0.18),rgba(12,12,12,0.52))]" />

          <div className="relative z-10 flex h-full w-full items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] backdrop-blur-[2px]">
            <img
              src={images[current]}
              alt={`Image ${current + 1}`}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          <button
            type="button"
            onClick={prev}
            aria-label="Previous image"
            className="absolute left-4 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/25 text-white backdrop-blur-sm transition hover:bg-black/40 lg:inline-flex"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M15 18 9 12l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next image"
            className="absolute right-4 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/25 text-white backdrop-blur-sm transition hover:bg-black/40 lg:inline-flex"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        <div className="border-t border-white/10 bg-[#101010]/95 px-3 py-3 sm:px-5">
          <div className="flex gap-3 overflow-x-auto scrollbar-none">
            {images.map((image, imageIndex) => (
              <button
                type="button"
                key={`${image}-${imageIndex}`}
                onClick={() => setCurrent(imageIndex)}
                className={`group relative h-20 w-[120px] shrink-0 overflow-hidden rounded-[16px] border transition sm:h-24 sm:w-[148px] ${
                  imageIndex === current
                    ? 'border-white ring-1 ring-white/70'
                    : 'border-white/10 hover:border-white/30'
                }`}
              >
                <img src={image} alt={`Thumbnail ${imageIndex + 1}`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
                <span className="absolute bottom-2 right-2 rounded-full border border-white/15 bg-black/80 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                  {imageIndex + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
