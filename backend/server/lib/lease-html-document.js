/**
 * Build a minimal print/PDF-friendly HTML document from plain-text lease content.
 * Content is escaped; line breaks preserved (pre-wrap).
 */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildLeasePdfHtml({ title, subtitle, bodyText }) {
  const safeTitle = escapeHtml(title || 'Residential lease')
  const safeSub = subtitle ? escapeHtml(subtitle) : ''
  const body = escapeHtml(bodyText || '').replace(/\r\n/g, '\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    @page { margin: 0.5in; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #0f172a;
      margin: 0;
      padding: 0;
    }
    h1 {
      font-size: 16pt;
      font-weight: 800;
      text-align: center;
      margin: 0 0 8px 0;
      letter-spacing: -0.02em;
    }
    .sub {
      text-align: center;
      font-size: 10pt;
      color: #64748b;
      margin-bottom: 24px;
    }
    pre.lease {
      white-space: pre-wrap;
      word-wrap: break-word;
      margin: 0;
      font-family: inherit;
      font-size: 10.5pt;
    }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  ${safeSub ? `<div class="sub">${safeSub}</div>` : ''}
  <pre class="lease">${body}</pre>
</body>
</html>`
}
