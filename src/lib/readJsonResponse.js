/**
 * Parse a fetch Response as JSON. Fails with a clear message when the body is
 * empty or HTML (e.g. SPA fallback swallowing /api on a bad deploy config).
 */
export async function readJsonResponse(res) {
  const text = await res.text()
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error(
      'Empty response from server. For local development, run `npm run dev:api` (or `npm run dev:full`) so /api requests reach the backend.'
    )
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    const htmlHint = trimmed.startsWith('<')
      ? ' The response looks like HTML (often /api was served the app shell instead of the API).'
      : ''
    throw new Error(`Invalid response from server (not JSON).${htmlHint}`)
  }
}
