# Airtable leasing workflow setup prompt

Use the block below as a **single prompt** in Cursor, Claude, or paste it directly into the Airtable "Ask AI" interface to finish configuring the leasing back-and-forth workflow tables.

---

## Prompt (copy from here)

```
You are configuring the Airtable base for the Axis housing web app (base ID: appol57LKtMKaQ75T).
The codebase already has a back-and-forth leasing workflow feature built.
Your job is to set up everything in Airtable so the feature works end-to-end.

────────────────────────────────────────
PART 1 — Extend the existing "Lease Drafts" table
────────────────────────────────────────

1.1  Add these four new fields to the "Lease Drafts" table:

  Name: Manager Edit Notes
  Type: Long text
  Notes: Stores JSON payload. Example:
    {"editNotes":"Please update the rent amount","requestedFields":{"rent":"2000","leaseStart":"2025-09-01"}}

  Name: Admin Response Notes
  Type: Long text
  Notes: Stores JSON payload. Example:
    {"notes":"Updated rent and start date as requested","updatedFields":{"rent":"2000","leaseStart":"2025-09-01"}}

  Name: Current Version
  Type: Number (integer, no decimals)
  Notes: Starts at 1. Increments each time admin uploads a new PDF version of the lease.

  Name: Revision Round
  Type: Number (integer, no decimals)
  Notes: Starts at 0. Increments each time an edit request goes back and forth.

1.2  Add these new options to the "Status" single-select field (do NOT remove existing options):

  Submitted to Admin     — manager has requested edits
  Admin In Review        — admin has acknowledged the request
  Changes Made           — admin updated the lease internally
  Sent Back to Manager   — admin updated and sent back for manager review
  Manager Approved       — manager accepted the admin's changes
  Ready for Signature    — admin finalized, ready to send to resident

Existing options to keep intact:
  Draft Generated, Under Review, Published, Signed

────────────────────────────────────────
PART 2 — Create the "Lease Comments" table
────────────────────────────────────────

Create a new table named exactly: Lease Comments

Fields:
  Lease Draft ID        Single line text    — Airtable record ID of the parent Lease Draft (e.g. recABCDEF)
  Author Name           Single line text    — Display name of whoever wrote the comment
  Author Role           Single select       — Options: manager | admin
  Author Record ID      Single line text    — Airtable record ID of the author
  Message               Long text           — The comment body
  Timestamp             Date and time       — When the comment was posted (include time, ISO format)

Default view: sort by Timestamp ascending.

────────────────────────────────────────
PART 3 — Create the "Lease Versions" table
────────────────────────────────────────

Create a new table named exactly: Lease Versions

Fields:
  Lease Draft ID         Single line text    — Airtable record ID of parent Lease Draft
  Version Number         Number (integer)    — 1, 2, 3 …
  PDF URL                URL                 — Publicly accessible link (Google Drive share link, Dropbox, etc.)
  File Name              Single line text    — Display name e.g. "lease-v2.pdf"
  Notes                  Long text           — What changed in this version
  Uploaded By            Single line text    — Display name of the admin who uploaded
  Uploaded By Record ID  Single line text    — Airtable record ID of the uploading admin
  Is Current             Checkbox            — True on the latest version only; backend sets older versions to false
  Timestamp              Date and time       — When uploaded

Default view: sort by Version Number descending.

────────────────────────────────────────
PART 4 — Create the "Lease Notifications" table
────────────────────────────────────────

Create a new table named exactly: Lease Notifications

Fields:
  Lease Draft ID       Single line text    — Airtable record ID of parent Lease Draft
  Recipient Record ID  Single line text    — Airtable record ID of who should receive the notification
  Recipient Role       Single select       — Options: manager | admin
  Message              Long text           — Notification text shown in the portal
  Is Read              Checkbox            — Defaults to unchecked (false); portal marks it true when user opens the lease
  Timestamp            Date and time       — When the notification was created

Create two filtered views:
  "Admin unread"   — filter: Recipient Role = admin   AND  Is Read is unchecked
  "Manager unread" — filter: Recipient Role = manager AND  Is Read is unchecked

────────────────────────────────────────
PART 5 — Verify environment variables
────────────────────────────────────────

Make sure these are set in both local .env and Vercel project settings:

  AIRTABLE_TOKEN=pat...                           (server-side, write access)
  VITE_AIRTABLE_TOKEN=pat...                      (same token, client-side reads)
  VITE_AIRTABLE_BASE_ID=appol57LKtMKaQ75T

The token needs at minimum: data.records:read, data.records:write, schema.bases:read

────────────────────────────────────────
VERIFICATION CHECKLIST
────────────────────────────────────────

After setup, confirm:
  □ Lease Drafts table has all 4 new fields and all 6 new Status options
  □ "Lease Comments" table exists with 6 fields
  □ "Lease Versions" table exists with 9 fields
  □ "Lease Notifications" table exists with 6 fields and 2 filtered views
  □ Env vars set in Vercel and .env
  □ No "unknown field" errors when a manager submits an edit request from the portal
```

---
