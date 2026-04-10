import { createContext, useContext } from 'react'

/**
 * On property listing pages, site chrome (promo + SiteHeader) can auto-hide while scrolled;
 * `siteChromeInsetPx` is the layout offset below the viewport top (0 when hidden).
 */
export const PropertyListingChromeContext = createContext(null)

export function usePropertyListingChrome() {
  return useContext(PropertyListingChromeContext)
}
