import React, { useEffect, useRef, useState } from 'react'

export default function Carousel({
  images = [],
  height = '420px',
  className = '',
  children,
  altPrefix = 'Image',
  onOpen,
}) {
  const [idx, setIdx] = useState(0)
  const touchStart = useRef(null)
  const wrap = images.length

  useEffect(() => {
    if (idx >= wrap && wrap > 0) setIdx(0)
  }, [idx, wrap])

  function next() {
    if (wrap > 0) setIdx((value) => (value + 1) % wrap)
  }

  function prev() {
    if (wrap > 0) setIdx((value) => (value - 1 + wrap) % wrap)
  }

  function onTouchStart(event) {
    touchStart.current = event.touches[0].clientX
  }

  function onTouchEnd(event) {
    if (!touchStart.current) return
    const dx = event.changedTouches[0].clientX - touchStart.current
    if (Math.abs(dx) > 40) {
      if (dx < 0) next()
      else prev()
    }
    touchStart.current = null
  }

  const currentImage = images[idx]

  return (
    <div
      className={`relative overflow-hidden rounded-md ${className}`}
      style={{ height }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {currentImage ? (
        <button
          type="button"
          onClick={() => onOpen && onOpen(idx)}
          className="absolute inset-0 block h-full w-full"
          aria-label={`Open ${altPrefix} ${idx + 1}`}
        >
          <img
            key={`${currentImage}-${idx}`}
            src={currentImage}
            alt={`${altPrefix} ${idx + 1}`}
            className="h-full w-full object-cover"
          />
        </button>
      ) : null}

      {children ? <div className="absolute inset-0 pointer-events-none">{children}</div> : null}

      {wrap > 1 ? (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Previous"
            className="absolute left-2 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow pointer-events-auto"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 16l-6-6 6-6"/></svg>
          </button>

          <button
            type="button"
            onClick={next}
            aria-label="Next"
            className="absolute right-2 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow pointer-events-auto"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4l6 6-6 6"/></svg>
          </button>

          <div className="pointer-events-auto absolute bottom-3 left-0 right-0 z-20 flex justify-center gap-2">
            {images.map((_, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setIdx(i)}
                className={`h-3 w-3 rounded-full shadow ${i === idx ? 'bg-white' : 'bg-white/60'}`}
                aria-label={`Go to ${i + 1}`}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
