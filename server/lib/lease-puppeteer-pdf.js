/**
 * Render HTML to PDF using Puppeteer ([PuppeteerNode](https://pptr.dev/api/puppeteer.puppeteernode)).
 * - On Vercel: puppeteer-core + @sparticuz/chromium
 * - Locally: set PUPPETEER_EXECUTABLE_PATH, or install `puppeteer` (dev) for bundled Chromium
 */
import puppeteer from 'puppeteer-core'

export async function launchLeaseBrowser() {
  const onVercel = process.env.VERCEL === '1' || String(process.env.VERCEL || '').toLowerCase() === 'true'

  if (onVercel) {
    const chromium = (await import('@sparticuz/chromium')).default
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })
  }

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
  }

  try {
    const full = await import('puppeteer')
    return full.default.launch({ headless: true })
  } catch {
    throw new Error(
      'PDF rendering needs Chromium. Set PUPPETEER_EXECUTABLE_PATH to a Chrome/Chromium binary, ' +
        'or install the devDependency `puppeteer` for local development.'
    )
  }
}

/**
 * @param {string} html
 * @param {{ format?: string }} [options]
 * @returns {Promise<Buffer>}
 */
export async function renderHtmlToPdfBuffer(html, options = {}) {
  const browser = await launchLeaseBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const buf = await page.pdf({
      format: options.format || 'Letter',
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
    })
    return Buffer.from(buf)
  } finally {
    await browser.close()
  }
}
