# Lease Workflow Setup

This document covers the manager lease generation flow, resident lease publishing flow, and the token-based signing flow that now exist in this repo.

## Environment Variables

Local `.env` and Vercel project settings should include:

```bash
VITE_AIRTABLE_TOKEN=...
VITE_AIRTABLE_APPLICATIONS_BASE_ID=appNBX2inqfJMyqYV
ANTHROPIC_API_KEY=...

# Optional, only if you want emailed signing links
VITE_EMAILJS_SERVICE_ID=...
VITE_EMAILJS_PUBLIC_KEY=...
VITE_EMAILJS_TEMPLATE_ID=...
VITE_EMAILJS_LEASE_TEMPLATE=...

# SignForge + Puppeteer (optional e-sign for Lease Drafts)
SIGNFORGE_API_KEY=sf_live_...   # or sf_test_... from https://signforge.io/dashboard/developers
SIGNFORGE_WEBHOOK_TOKEN=...     # random secret; use same value in webhook URL query (see below)

# Local PDF rendering without Vercel: path to Chrome/Chromium (optional if `puppeteer` devDependency is installed)
# PUPPETEER_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

Notes:

- `ANTHROPIC_API_KEY` must stay server-side only. Do not prefix it with `VITE_`.
- `VITE_AIRTABLE_TOKEN` is currently shared by both client and server code in this repo, so the Airtable token must have access to the AXIS Applications base.
- If you deploy on Vercel, add the same values in Project Settings -> Environment Variables.

## Airtable Tables

### Managers

Used by `/api/manager-auth`.

Required fields:

- `Name`
- `Email`
- `Password`
- `Role`
- `Active`

### Lease Drafts

Used by `/api/generate-lease-draft`, `src/pages/Manager.jsx`, and the resident leasing panel.

Recommended fields:

- `Resident Name`
- `Resident Email`
- `Resident Record ID`
- `Application Record ID`
- `Property`
- `Unit`
- `Lease Start Date`
- `Lease End Date`
- `Lease Term`
- `Rent Amount`
- `Deposit Amount`
- `Utilities Fee`
- `AI Draft Content`
- `Manager Edited Content`
- `Manager Notes`
- `Status`
- `Approved By`
- `Approved At`
- `Published At`
- `Updated At`
- `SignForge Envelope ID` (optional, single line text — set when using SignForge)
- `SignForge Sent At` (optional, date)

Status values used in the UI:

- `Draft Generated`
- `Under Review`
- `Changes Needed`
- `Approved`
- `Published`
- `Signed`

### Audit Log

Used by the manager editor audit trail.

Required fields:

- `Lease Draft ID`
- `Action Type`
- `Performed By`
- `Performed By Role`
- `Timestamp`
- `Notes`

### Applications

Used by the older token-based signing flow (`/api/send-lease-invite` and `/sign/:token`).

Required fields:

- `Lease Token`
- `Lease JSON`
- `Lease Status`
- `Lease Signed`
- `Lease Signed Date`
- `Lease Signature`

## End-to-End Flow

### Manager Portal

1. Visit `/manager`.
2. Sign in with a record from the Airtable `Managers` table.
3. Click `Generate draft` to call `/api/generate-lease-draft`.
4. Review and edit the AI-generated lease.
5. Move the draft through:
   - `Draft Generated`
   - `Under Review`
   - `Changes Needed` or `Approved`
   - `Published`

### Resident Portal

After a lease draft is `Published`, `src/pages/Resident.jsx` will show the most recent published or signed draft returned by `getApprovedLeaseForResident()`.

Residents only see:

- `Manager Edited Content`, if present
- otherwise `AI Draft Content`

Drafts that are still under review stay hidden.

### Signing Link Flow

This repo also includes an older signing-link flow that stores lease data on the `Applications` table:

1. `POST /api/send-lease-invite`
2. Save `Lease Token`, `Lease JSON`, and `Lease Status`
3. Resident opens `/sign/:token`
4. Resident signs on the canvas and confirms their legal name
5. The application record is updated to `Lease Status = Signed`

The signing page provides a print-friendly browser flow so residents can save a PDF copy after signing.

### SignForge + Puppeteer (Lease Drafts)

This stack adds a third path: **PDF via [Puppeteer](https://pptr.dev/api/puppeteer.puppeteernode)** on the server, then **[SignForge quick-sign](https://signforge.io/developers)** so the resident gets an email with a signing link.

1. Manager publishes the draft (`Status = Published`) as usual.
2. Manager clicks **Send for e-sign (SignForge)** in the lease editor.
3. `POST /api/portal?action=signforge-send-lease` loads the draft from Airtable, renders **Manager Edited Content** (or AI draft) to PDF, and calls SignForge `POST /api/v1/quick-sign` with `pdf_base64`.
4. Airtable is updated with `SignForge Envelope ID` and `SignForge Sent At` (add these fields to **Lease Drafts** if missing).

**Webhook (auto-mark Signed):** In [SignForge → Webhooks](https://signforge.io/dashboard), register:

`https://<your-production-domain>/api/signforge-webhook?token=<SIGNFORGE_WEBHOOK_TOKEN>`

Subscribe to `envelope.completed`. The handler sets the matching lease draft to `Status = Signed` (matched by `SignForge Envelope ID`). Vercel delivers a parsed JSON body, so HMAC verification from SignForge’s docs is not used here; protect the endpoint with the `token` query secret instead.

**Refresh status:** **Refresh SignForge status** calls `POST /api/portal?action=signforge-envelope-status` and reloads the draft from Airtable (e.g. after the webhook runs).

**Deploy notes:** Production uses `puppeteer-core` + `@sparticuz/chromium` (see `server/lib/lease-puppeteer-pdf.js`). `vercel.json` sets `maxDuration` / `memory` for `api/[route].js` to allow PDF generation. Locally, install the `puppeteer` devDependency or set `PUPPETEER_EXECUTABLE_PATH`.

## Implementation Notes

- `src/pages/Manager.jsx` is the internal lease queue/editor UI.
- `src/pages/Resident.jsx` shows only published/signed leases to residents.
- `src/pages/SignLease.jsx` handles token-based signatures with `signature_pad`.
- `api/generate-lease-draft.js` uses Anthropic to create the initial lease text.
- `api/manager-auth.js` validates manager credentials against Airtable.
- `api/send-lease-invite.js` supports emailed signing links for the older application-based lease flow.
- `server/handlers/signforge-send-lease.js`, `signforge-envelope-status.js`, `signforge-webhook.js` integrate SignForge + Puppeteer PDFs.

## Current Limitation

There are two lease flows in the repo right now:

- the newer `Lease Drafts` manager review/publish flow
- the older `Applications` token-signing flow

They are both operational, but they are not yet fully unified into a single record model. If you want one canonical lease pipeline, the next step is to decide whether signing should live on `Lease Drafts` or stay attached to `Applications`, then merge the remaining fields and routes around that choice.
