import { useEffect } from 'react'

const DEFAULT_TITLE = 'Axis Seattle | Housing in Seattle'
const DEFAULT_DESCRIPTION =
  'Browse available housing in Seattle with posted pricing, current availability, and online applications.'
const DEFAULT_SHARE_IMAGE = '/axis-share.png'
const DEFAULT_LOGO = '/favicon.svg'

function upsertMeta(selector, attributes) {
  let element = document.head.querySelector(selector)

  if (!element) {
    element = document.createElement('meta')
    document.head.appendChild(element)
  }

  Object.entries(attributes).forEach(([key, value]) => {
    if (value) {
      element.setAttribute(key, value)
    }
  })
}

function upsertLink(selector, attributes) {
  let element = document.head.querySelector(selector)

  if (!element) {
    element = document.createElement('link')
    document.head.appendChild(element)
  }

  Object.entries(attributes).forEach(([key, value]) => {
    if (value) {
      element.setAttribute(key, value)
    }
  })
}

function upsertScript(selector, content) {
  let element = document.head.querySelector(selector)

  if (!element) {
    element = document.createElement('script')
    element.type = 'application/ld+json'
    element.setAttribute('data-seo', 'structured-data')
    document.head.appendChild(element)
  }

  element.textContent = content
}

function normalizeUrl(pathname = '/') {
  const origin = (import.meta.env.VITE_SITE_URL || window.location.origin).replace(/\/+$/, '')
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return path === '/' ? `${origin}/` : `${origin}${path}`
}

export function Seo({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  pathname = '/',
  image,
  structuredData,
}) {
  useEffect(() => {
    const url = normalizeUrl(pathname)
    const imageUrl = image
      ? new URL(image, window.location.origin).toString()
      : normalizeUrl(DEFAULT_SHARE_IMAGE)

    document.title = title
    upsertMeta('meta[name="description"]', { name: 'description', content: description })
    upsertMeta('meta[name="robots"]', { name: 'robots', content: 'index, follow' })
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' })
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title })
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description })
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: url })
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'Axis Seattle Housing' })
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: imageUrl })
    upsertMeta('meta[property="og:image:alt"]', { property: 'og:image:alt', content: 'Axis Seattle Housing logo and Seattle housing branding' })
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' })
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title })
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description })
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: imageUrl })
    upsertMeta('meta[name="twitter:image:alt"]', { name: 'twitter:image:alt', content: 'Axis Seattle Housing logo and Seattle housing branding' })
    upsertLink('link[rel="canonical"]', { rel: 'canonical', href: url })

    if (structuredData) {
      upsertScript(
        'script[data-seo="structured-data"]',
        JSON.stringify(structuredData)
      )
    }

    return () => {
      if (!structuredData) return
      const script = document.head.querySelector('script[data-seo="structured-data"]')
      if (script) {
        script.remove()
      }
    }
  }, [description, image, pathname, structuredData, title])

  return null
}

export function buildWebsiteSchema() {
  const siteUrl = normalizeUrl('/')
  const logoUrl = normalizeUrl(DEFAULT_LOGO)
  const navigation = [
    {
      '@type': 'SiteNavigationElement',
      name: 'Homes & Availability',
      url: `${siteUrl}#properties`,
    },
    {
      '@type': 'SiteNavigationElement',
      name: 'Apply',
      url: normalizeUrl('/apply'),
    },
    {
      '@type': 'SiteNavigationElement',
      name: 'Contact',
      url: normalizeUrl('/contact'),
    },
  ]

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Axis Seattle Housing',
      url: siteUrl,
      logo: logoUrl,
      image: normalizeUrl(DEFAULT_SHARE_IMAGE),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Axis Seattle Housing',
      url: siteUrl,
      description: DEFAULT_DESCRIPTION,
      publisher: {
        '@type': 'Organization',
        name: 'Axis Seattle Housing',
        logo: {
          '@type': 'ImageObject',
          url: logoUrl,
        },
      },
      potentialAction: {
        '@type': 'SearchAction',
        target: `${siteUrl}?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
    ...navigation.map((item) => ({
      '@context': 'https://schema.org',
      ...item,
    })),
  ]
}

export function buildPropertySchema(property) {
  const url = normalizeUrl(`/properties/${property.slug}`)

  return {
    '@context': 'https://schema.org',
    '@type': 'Residence',
    name: property.name,
    description: property.summary,
    url,
    image: property.images?.[0] || normalizeUrl(DEFAULT_SHARE_IMAGE),
    provider: {
      '@type': 'Organization',
      name: 'Axis Seattle Housing',
      logo: normalizeUrl(DEFAULT_LOGO),
    },
    address: {
      '@type': 'PostalAddress',
      streetAddress: property.address.split(',')[0]?.trim(),
      addressLocality: 'Seattle',
      addressRegion: 'WA',
      addressCountry: 'US',
    },
    numberOfRooms: property.beds,
    amenityFeature: [...(property.communityAmenities || []), ...(property.unitAmenities || [])].map((name) => ({
      '@type': 'LocationFeatureSpecification',
      name,
      value: true,
    })),
  }
}
