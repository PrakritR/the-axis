import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Measures a fixed/sticky site chrome block (promo + header) so main content can use padding-top
 * and stay visible under the chrome while scrolling.
 */
export function useSiteChromeInset(enabled) {
  const chromeRef = useRef(null)
  const [insetPx, setInsetPx] = useState(0)

  useLayoutEffect(() => {
    if (!enabled) {
      setInsetPx(0)
      return undefined
    }
    const el = chromeRef.current
    if (!el) return undefined
    const measure = () => {
      setInsetPx(Math.ceil(el.getBoundingClientRect().height))
    }
    measure()
    const id = requestAnimationFrame(() => measure())
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => {
      cancelAnimationFrame(id)
      ro.disconnect()
      setInsetPx(0)
    }
  }, [enabled])

  return { chromeRef, insetPx }
}
