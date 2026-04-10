import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const SCROLL_TOP_REVEAL_PX = 72
const MOUSE_HOT_ZONE_PX = 56
const IDLE_HIDE_MS = 2400

/**
 * Auto-hide fixed site chrome when scrolled; show again when cursor moves to top edge or user hovers chrome.
 */
export function usePropertyListingAutoChrome(enabled, promoVisible) {
  const [hidden, setHidden] = useState(false)
  const [chromeHeight, setChromeHeight] = useState(0)
  const chromeRef = useRef(null)
  const lastMouseYRef = useRef(0)
  const mouseInChromeRef = useRef(false)
  const idleTimerRef = useRef(null)

  const clearIdle = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  const scheduleHideAfterIdle = useCallback(() => {
    if (!enabled) return
    clearIdle()
    idleTimerRef.current = window.setTimeout(() => {
      if (window.scrollY < SCROLL_TOP_REVEAL_PX) return
      if (lastMouseYRef.current < MOUSE_HOT_ZONE_PX) return
      if (mouseInChromeRef.current) return
      setHidden(true)
    }, IDLE_HIDE_MS)
  }, [enabled, clearIdle])

  useEffect(() => {
    if (!enabled) {
      setHidden(false)
      clearIdle()
      return undefined
    }

    const onMove = (e) => {
      lastMouseYRef.current = e.clientY
      if (e.clientY < MOUSE_HOT_ZONE_PX) {
        setHidden(false)
        clearIdle()
      }
    }

    const onScroll = () => {
      if (window.scrollY < SCROLL_TOP_REVEAL_PX) {
        setHidden(false)
        clearIdle()
        return
      }
      scheduleHideAfterIdle()
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('scroll', onScroll)
      clearIdle()
    }
  }, [enabled, scheduleHideAfterIdle, clearIdle])

  useLayoutEffect(() => {
    if (!enabled) return undefined
    const el = chromeRef.current
    if (!el) return undefined
    const measure = () => {
      setChromeHeight(Math.ceil(el.getBoundingClientRect().height))
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled, promoVisible])

  const onChromeEnter = useCallback(() => {
    mouseInChromeRef.current = true
    setHidden(false)
    clearIdle()
  }, [clearIdle])

  const onChromeLeave = useCallback(() => {
    mouseInChromeRef.current = false
    if (window.scrollY >= SCROLL_TOP_REVEAL_PX) scheduleHideAfterIdle()
  }, [scheduleHideAfterIdle])

  const insetPx = enabled ? (hidden ? 0 : chromeHeight) : null

  return {
    chromeRef,
    hidden,
    insetPx,
    chromeHeight,
    onChromeEnter,
    onChromeLeave,
  }
}
