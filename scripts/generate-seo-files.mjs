import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const siteUrl = (process.env.SITE_URL || process.env.VITE_SITE_URL || process.env.URL || 'https://axis-seattle.netlify.app').replace(/\/+$/, '')
const propertyFile = readFileSync(resolve('src/data/properties.js'), 'utf8')
const propertyRoutes = [...propertyFile.matchAll(/slug:\s*'([^']+)'/g)].map((match) => `/properties/${match[1]}`)
const routes = ['/', '/contact', '/apply', ...propertyRoutes]

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (route) => `  <url>
    <loc>${route === '/' ? `${siteUrl}/` : `${siteUrl}${route}`}</loc>
    <priority>${route === '/' ? '1.0' : '0.8'}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`

const robots = `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`

writeFileSync(resolve('public/sitemap.xml'), sitemap)
writeFileSync(resolve('public/robots.txt'), robots)
