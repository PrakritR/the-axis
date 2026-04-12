/**
 * Parse a fetch Response as JSON. Fails with a clear message when the body is
 * empty or HTML (e.g. SPA fallback swallowing /api on a bad deploy config).
 * Prefer this over `response.json()` so empty bodies never throw the browser's
 * opaque "Unexpected end of JSON input".
 */
export async function readJsonResponse(res) {
  const text = await res.text()
  const trimmed = text.trim()
  const status = res.status
  if (!trimmed) {
    throw new Error(
      `Empty response from server (HTTP ${status}). For local development, run \`npm run dev:api\` (or \`npm run dev:full\`) so /api requests reach the backend. On Vercel, confirm the \`api/\` folder is deployed and rewrites exclude \`/api/*\`.`
    )
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    const htmlHint = trimmed.startsWith('<')
      ? ' The response looks like HTML (often /api was served the app shell instead of the API).'
      : ''
    throw new Error(`Invalid response from server (HTTP ${status}, not JSON).${htmlHint}`)
  }
}
