import React, { useEffect, useMemo, useState } from 'react'
import GalleryLightbox from './GalleryLightbox'

function ArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 18 9 12l6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function PropertyGallery({ images = [], videos = [] }) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [videoOpen, setVideoOpen] = useState(false)
  const [videoIndex, setVideoIndex] = useState(0)

  const normalizedVideos = videos.map((video, i) =>
    typeof video === 'string'
      ? { src: video, label: `Video ${i + 1}`, placeholder: false }
      : { placeholder: false, ...video }
  )

  const orderedImages = useMemo(() => {
    if (!images.length) return []

    const mapped = images.map((image, imageIndex) => ({ image, imageIndex }))
    return [...mapped.slice(index), ...mapped.slice(0, index)]
  }, [images, index])

  const leadImage = orderedImages[0]
  const supportingImages = orderedImages.slice(1, 3)
  const reelImages = orderedImages.slice(0, Math.min(8, images.length))

  function openAt(i) {
    if (!images.length) return
    setIndex(i)
    setOpen(true)
  }

  function next() {
    if (!images.length) return
    setIndex((value) => (value + 1) % images.length)
  }

  function prev() {
    if (!images.length) return
    setIndex((value) => (value - 1 + images.length) % images.length)
  }

  function openVideoAt(i = 0) {
    if (!normalizedVideos.length) return
    setVideoIndex(i)
    setVideoOpen(true)
  }

  useEffect(() => {
    if (!videoOpen) return undefined

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event) {
      if (event.key === 'Escape') setVideoOpen(false)
      if (event.key === 'ArrowRight') setVideoIndex((value) => (value + 1) % normalizedVideos.length)
      if (event.key === 'ArrowLeft') setVideoIndex((value) => (value - 1 + normalizedVideos.length) % normalizedVideos.length)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [videoOpen, normalizedVideos.length])

  if (!images.length || !leadImage) return null

  return (
    <div className="w-full">
      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8f7f4_100%)] shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:rounded-[30px]">
        <div className="px-4 py-4 sm:px-6 lg:px-8">
          <div className="hidden gap-4 lg:grid lg:grid-cols-12">
            <button
              type="button"
              onClick={() => openAt(leadImage.imageIndex)}
              className="group relative col-span-7 row-span-2 overflow-hidden rounded-[26px] bg-slate-100 text-left"
            >
              <img
                src={leadImage.image}
                alt={`Property image ${leadImage.imageIndex + 1}`}
                className="h-[620px] w-full object-cover transition duration-500 group-hover:scale-[1.015]"
              />
              <div className="pointer-events-none absolute right-4 top-4 rounded-full border border-white/25 bg-black/45 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {leadImage.imageIndex + 1} / {images.length}
              </div>
            </button>

            {supportingImages.map((item, supportingIndex) => (
              <button
                key={`${item.image}-${item.imageIndex}`}
                type="button"
                onClick={() => setIndex(item.imageIndex)}
                className={`group relative col-span-5 overflow-hidden rounded-[26px] text-left ${
                  supportingIndex === 0 ? 'min-h-[302px]' : 'min-h-[302px]'
                }`}
              >
                <img
                  src={item.image}
                  alt={`Property image ${item.imageIndex + 1}`}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
                />
              </button>
            ))}
          </div>

          <div className="hidden items-center justify-between gap-4 border-t border-slate-200 pt-5 lg:flex">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={prev}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              >
                <ArrowLeft />
              </button>
              <button
                type="button"
                onClick={next}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              >
                <ArrowRight />
              </button>
              <div className="ml-2 text-sm text-slate-500">
                Image <span className="font-semibold text-slate-900">{index + 1}</span> of {images.length}
              </div>
            </div>

            <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto scrollbar-none">
              {reelImages.map((item) => (
                <button
                  key={`${item.image}-${item.imageIndex}`}
                  type="button"
                  onClick={() => setIndex(item.imageIndex)}
                  className={`group relative h-24 w-40 shrink-0 overflow-hidden rounded-[18px] border transition ${
                    item.imageIndex === index
                      ? 'border-slate-900 ring-1 ring-slate-900'
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <img src={item.image} alt={`Thumbnail ${item.imageIndex + 1}`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" />
                </button>
              ))}
            </div>
          </div>

          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => openAt(leadImage.imageIndex)}
              className="group relative block w-full overflow-hidden rounded-[24px] bg-slate-100"
            >
              <div className="aspect-[4/5] w-full bg-slate-100 sm:aspect-[16/11]">
                <img
                  src={leadImage.image}
                  alt={`Property image ${leadImage.imageIndex + 1}`}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.015]"
                />
              </div>
              <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-white/25 bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                {leadImage.imageIndex + 1} / {images.length}
              </div>
            </button>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={prev} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700">
                <ArrowLeft />
              </button>
              <button type="button" onClick={next} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700">
                <ArrowRight />
              </button>
              <button type="button" onClick={() => setOpen(true)} className="order-3 w-full rounded-full bg-axis px-4 py-2.5 text-sm font-semibold text-white hover:bg-axis-dark sm:order-none sm:flex-1">
                All images
              </button>
              {normalizedVideos.length > 0 ? (
                <button type="button" onClick={() => openVideoAt(0)} className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">
                  Videos
                </button>
              ) : null}
            </div>

            <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
              {reelImages.map((item) => (
                <button
                  key={`mobile-${item.image}-${item.imageIndex}`}
                  type="button"
                  onClick={() => setIndex(item.imageIndex)}
                  className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-[16px] border transition sm:h-24 sm:w-24 ${
                    item.imageIndex === index
                      ? 'border-slate-900 ring-1 ring-slate-900'
                      : 'border-slate-200'
                  }`}
                >
                  <img src={item.image} alt={`Thumbnail ${item.imageIndex + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <GalleryLightbox images={images} startIndex={index} open={open} onClose={() => setOpen(false)} />

      {videoOpen && normalizedVideos.length > 0 ? (
        <div
          className="fixed inset-0 z-[99998] bg-black/85"
          style={{
            paddingTop: 'max(16px, env(safe-area-inset-top))',
            paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
            paddingLeft: 'max(16px, env(safe-area-inset-left))',
            paddingRight: 'max(16px, env(safe-area-inset-right))',
          }}
          role="dialog" aria-modal="true" aria-label="Videos"
        >
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="Close video modal" onClick={() => setVideoOpen(false)} />
          <div className="relative mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-[20px] bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Videos</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{normalizedVideos[videoIndex]?.label}</div>
              </div>
              <button type="button" onClick={() => setVideoOpen(false)} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700">
                Close
              </button>
            </div>

            <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[1fr_240px]">
              <div className="relative min-h-0 bg-black">
                {normalizedVideos[videoIndex]?.placeholder ? (
                  <div className="flex h-full items-center justify-center bg-slate-900 px-6 text-center">
                    <div className="max-w-md">
                      <div className="text-lg font-semibold text-white">{normalizedVideos[videoIndex]?.label}</div>
                      <div className="mt-3 text-sm leading-6 text-slate-300">
                        {normalizedVideos[videoIndex]?.placeholderText || 'Video coming soon.'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <video key={normalizedVideos[videoIndex]?.src} controls autoPlay playsInline preload="metadata" className="h-full w-full bg-black object-contain">
                    <source src={normalizedVideos[videoIndex]?.src} type="video/quicktime" />
                    <source src={normalizedVideos[videoIndex]?.src} type="video/mp4" />
                  </video>
                )}
              </div>

              <aside className="hidden border-l border-slate-200 bg-slate-50 lg:block">
                <div className="h-full overflow-y-auto p-3">
                  <div className="space-y-2">
                    {normalizedVideos.map((clip, i) => (
                      <button
                        key={clip.src || `${clip.label}-${i}`}
                        type="button"
                        onClick={() => setVideoIndex(i)}
                        className={`w-full rounded-[14px] border px-3 py-3 text-left text-sm transition ${
                          i === videoIndex
                            ? 'border-slate-900 bg-white text-slate-900'
                            : 'border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-white'
                        }`}
                      >
                        {clip.label}
                      </button>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
