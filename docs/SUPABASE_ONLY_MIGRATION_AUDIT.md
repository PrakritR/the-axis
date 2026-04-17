# Supabase-only migration audit (Airtable removal)

This document tracks **removal of Airtable** from the Axis (`the-axis`) codebase. A full cutover is a **multi-sprint** project: the repo still contains extensive Airtable usage until each area is rewired.

## Executive summary

| Item | Status |
|------|--------|
| Postgres schema for apps, users, roles, properties, rooms, payments, files, scheduling | **Exists** (`supabase/migrations/2026041612*.sql`) |
| New tables: `lease_drafts`, `work_orders`, `portal_thread_participants`, `portal_messages`, `announcements` | **Added** in `20260416122000_work_orders_lease_drafts_portal_messages_announcements.sql` |
| Backend handlers still importing Airtable / `applications-airtable-env` / `airtable-write-retry` | **Many remain** — grep `backend/server` for `airtable` |
| Frontend `frontend/src/lib/airtable.js` (~2900 lines, **80+ exports**) | **Still the main data layer** for Manager, Resident, Apply, Admin, inbox, lease, payments |
| **This audit** | Updated with each migration PR |

---

## 1) Airtable files to remove or replace (inventory)

### Must-delete or gut after rewiring consumers

| Path | Role |
|------|------|
| `frontend/src/lib/airtable.js` | Central browser Airtable API — **replace** with `/api/*` + small domain modules |
| `frontend/src/lib/airtablePublicListings.js` | Public listings — use `public-listings` / `internalPublicListings` only |
| `frontend/src/lib/airtablePermissionError.js` | Airtable 403 mapping — replace with API error normalization |
| `frontend/src/lib/adminPortalAirtable.js` | Admin Airtable bridge — replace with `applications`, `payments`, `properties`, etc. |
| `frontend/src/lib/managerPropertyFormAirtableMap.js` | Field map — delete after manager forms post JSON to `/api/properties` |
| `frontend/src/lib/managerAvailabilityAirtable.js` | Replace with `managerAvailabilityInternal` + `/api/manager-availability` |
| `backend/server/lib/airtable-write-retry.js` | Delete after no server caller |
| `backend/server/lib/airtable-scheduling-table.js` | Delete; scheduling uses `scheduled_events` + availability tables |
| `backend/server/lib/applications-airtable-env.js` | Delete; env should be Supabase-only |
| `backend/server/lib/axis-properties.js` | Audit — remove Airtable paths |
| `shared/application-airtable-fields.js` | Rename/replace with `shared/application-fields.js` (neutral names) |
| `shared/lease-version-airtable-uploader-fields.js` | Same |
| `scripts/airtable/*` | Remove or archive outside repo after data migration |
| `docs/AIRTABLE_*.md`, `docs/LEASING_WORKFLOW_AIRTABLE_*.md` | Archive or rewrite for Supabase-only ops |

### Files with Airtable references (non-exhaustive — run `rg -i airtable`)

- **Frontend pages**: `Manager.jsx`, `Resident.jsx`, `Apply.jsx`, `Contact.jsx`, `PropertyPage.jsx`, `PortalSelect.jsx`, `ManagerLeasingTab.jsx`, `SignLease.jsx`
- **Components**: `LeaseWorkspace.jsx`, `LeaseSignPanel.jsx`, `TourPopup.jsx`, `HousingMessageForm.jsx`, `AddPropertyWizard.jsx`, `ManagerApplicationLease.jsx`, `portal-inbox/*`, `ManagerInboxPage.jsx`, …
- **Backend handlers**: `manager-approve-application.js`, `generate-lease-draft.js`, `sign-lease-draft.js`, `notify-message.js`, `stripe-webhook.js`, `tour.js`, and **~40 more** (see repo-wide grep)

---

## 2) Features migrated vs pending

| Feature | DB / API | UI wired off Airtable? |
|---------|----------|-------------------------|
| Auth / `app_users` / roles | Yes | Partial (Supabase session used in places; Manager/Resident still mix legacy) |
| Properties / rooms | Yes (`/api/properties`, `/api/rooms`) | Partial (`Manager.jsx` still calls airtable.js) |
| Applications CRUD + approve/reject | Yes (`/api/applications`) | Partial (Admin/Manager panels still Airtable) |
| Payments | Yes (`/api/payments`, portal actions) | Partial |
| File storage (lease/application/work order) | Yes (`/api/file-storage`) | Partial |
| Scheduled events / tours (internal) | Yes | Partial (`tour.js` still references Airtable in places) |
| **Lease drafts / lease workflow** | **New `lease_drafts` table** | **No** — handlers still Airtable |
| **Work orders** | **New `work_orders` table** | **No** |
| **Inbox / messages** | **New `portal_messages` + `portal_thread_participants`** | **No** — manager read RLS still needs service/API path |
| **Announcements** | **New `announcements`** | **No** |
| Residents “profile” | `app_users` + `resident_profiles` | Partial |

---

## 3) Vercel / environment variables (Supabase-only target)

**Remove entirely (when cutover is complete):**

- `VITE_AIRTABLE_*`, `AIRTABLE_*` (all)
- Any duplicate `VITE_` / server-only pairs that existed only for Airtable

**Required (minimum for current internal stack):**

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server only; never `VITE_`)
- `SUPABASE_ANON_KEY` (server validates JWTs; can match public anon)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (browser)
- `DATABASE_URL` (if using direct Postgres migrations / scripts outside Supabase CLI)

**Stripe (payments):**

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY` (as today)

**Optional product keys:** email, Gemini, etc. — unchanged.

---

## 4) One-time SQL / seed (order)

1. Apply **all** `supabase/migrations/*.sql` on the target database (Supabase SQL editor, `supabase db push`, or your CI migration runner).
2. Run existing role/profile seeds if any (`npm run seed:admin-role`, etc. — see `package.json`).
3. **Data migration** (not automated in this repo snapshot): export Airtable → import into Postgres for historical rows (applications, payments, messages). Script per table or use CSV + SQL.
4. **Storage migration:** copy Airtable attachments to Supabase Storage; update `lease_files` / `application_files` / `work_order_files` paths.
5. **Cutover:** deploy backend + frontend with Airtable code removed; remove Airtable env vars from Vercel.

---

## 5) Manual setup (exact order after code is Supabase-only)

1. Create / confirm **Supabase project** (Auth + Postgres + Storage buckets already assumed by migrations).
2. Run migrations (section 4).
3. Configure **Auth** providers you use (email magic link, Google, etc.).
4. Set **Vercel** env vars (section 3); redeploy.
5. Configure **Stripe** webhooks to hit `/api/stripe-webhook` (or your canonical path).
6. Create **Storage buckets** matching migration expectations (`leases`, `application documents`, `work-order-images`, property images — verify `file-storage` handler names).
7. **Smoke test** per role: applicant apply → manager approve → payments → resident portal → work order → message thread.
8. Decommission **Airtable base** (after backup).

---

## Blockers / gaps (honest)

- **~100+ files** still reference Airtable strings or import `airtable.js`.
- **Lease + SignForge + PDF pipeline** is deeply coupled to Airtable record IDs in handlers under `backend/server/handlers/lease-*.js` and `sign-lease-draft.js`.
- **Manager.jsx** is very large; migrating it requires systematic replacement of each `getXFromAirtable` with `/api/*` calls.
- **RLS:** `portal_messages` manager visibility may require **service-role-only reads** in API until thread participants are populated for managers on every thread.

---

## Next coding priority (single line)

Implement **`/api/work-orders`** + **`/api/portal-messages`** (or extend `portal-gateway`) using **service role** + explicit role checks, then delete the corresponding exports from `airtable.js` and rewire **Resident** + **Manager** work order and inbox panels to those APIs only.
