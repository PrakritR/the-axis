# Airtable setup prompt (for Cursor / humans)

Use this document as a **single prompt** when you want an assistant to design or finish your Airtable base for the Axis `the-axis` app. It lists **tables the code expects**, **fields referenced by name**, and **gaps** (tables declared but unused).

---

## 0) Single base and env (read first)

The app uses **one** Airtable base for everything in this repo:

| Variable | Role |
|----------|------|
| `VITE_AIRTABLE_BASE_ID` | **Only** base ID used by the client: residents, managers, work orders, messages, announcements, properties, rooms, **Payments**, **Applications**, **Co-Signers**, **Scheduling**, **Lease Drafts**, **Audit Log**, tour API (`/api/tour`), AI lease draft + SignForge server handlers, etc. |

On the server (Vercel), set **`AIRTABLE_BASE_ID`** to the **same** value if your runtime does not expose `VITE_*` vars.

Token: `VITE_AIRTABLE_TOKEN` (and server `AIRTABLE_TOKEN` where documented in `.env.example`).

**Deprecated (ignored by current code):** `VITE_AIRTABLE_APPLICATIONS_BASE_ID`, `VITE_AIRTABLE_PAYMENTS_BASE_ID` — do not rely on them; keep all tables in the base above.

---

## 1) Tables in `VITE_AIRTABLE_BASE_ID`

Create these tables (names must match unless you change code).

### 1.1 `Resident Profile`

**Used for:** resident portal login, profile, work orders, payments link, lease tab helpers, Supabase link.

**Fields referenced (add as needed):**

- `Name`, `Email`, `Phone` — profile.
- `House`, `Unit Number` — property/room labeling in UI.
- `Password` — legacy/simple resident auth if used.
- `Approved` (or equivalent) — approval gating in UI.
- `Application` — linked record(s) to Applications (optional).
- `Application ID` — numeric/string bridge for work orders.
- `Supabase User ID` — when linking Supabase auth.
- `Security Deposit Amount`, `Security Deposit Paid`, `Security Deposit Paid Date` — deposit tracking in portal.

**Information you need from operations:** how residents are created (manual import, application approval, etc.) and whether auth is Airtable-only or Supabase-backed.

---

### 1.2 `Manager Profile`

**Used for:** `/api/portal?action=manager-auth`, manager activation, profile update, tour availability.

**Fields referenced:**

- `Email`, `Password` — sign-in.
- `Name`, `Phone Number` — display and profile PATCH.
- `Manager ID` — derived as `MGR-{recIdSuffix}` if missing on login.
- `Active` — checkbox; `false` blocks login.
- `tier` / `Tier` — e.g. `free` for free-tier gate vs Stripe.
- `Tour Availability` — long text; manager portal stores weekly grid as text.

**Information needed:** Stripe Price ID / subscription rules (`STRIPE_SECRET_KEY`, `STRIPE_MANAGER_PRICE_ID`) for paid tiers.

---

### 1.3 `Properties`

**Used for:** property scope, tour API (when pointed at this base), resident deposit lookup, work-order/property labels.

**Fields referenced:**

- `Name` or `Property` / `Property Name` — primary label (tour + lookups use `Name` or `Property Name`).
- `Address`
- `Notes` — long text; embeds **Tour Manager**, **Tour Availability**, **Tour Notes**, **Site Manager Email** as `Label: value` lines.
- `Manager Email`, `Site Manager Email`, `Manager`, `Site Manager`, `Property Manager`, `Manager ID` — linking properties to managers (see `propertyAssignedToManager` in `Manager.jsx`).
- `Security Deposit` — number (optional).
- `Utilities Fee` — number (optional).
- `Application Fee` — number; overrides Apply page default when set.
- Approval-style fields used in manager scope: e.g. status in notes or dedicated fields your `isPropertyRecordApproved` expects (inspect `Manager.jsx` for `isPropertyRecordApproved` / `propertyRecordName`).

**Manager “Add property” wizard — prefer native columns (default in app):** The portal writes room and leasing numbers/text into typed fields so **Other Info** stays small (labels, bundle JSON, marketing windows, move-in charges until a column exists).

Add columns on `Properties` as needed (up to 20 rooms):

- `Room Count`, `Bathroom Count`, `Kitchen Count`, `Number of Shared Spaces`
- Per slot `n` = 1…20: **`Room n Rent`** (currency/number), **`Room n Availability`** (date), **`Room n Furnished`**, **`Room n Utilities Cost`**; **`Room 1 Utilities`** (long text) for room 1 utilities blurb
- Leasing (optional): **`Full House Price`**, **`Promotional Full House Price`**, **`Lease Length Information`**
- If your base does **not** have these columns, set `VITE_AIRTABLE_WRITE_ROOM_COLUMNS=false` and/or `VITE_AIRTABLE_WRITE_LEASING_COLUMNS=false` in env (see `.env.example`).

**Other Info** still holds a short `---AXIS_LISTING_META_JSON---` block for: room labels + feature notes, **Leasing Packages** (bundled rooms), **listing availability windows**, and similar fields without columns yet.

**Information needed:** canonical property naming (must match Apply/tour strings), and which field marks a property “approved/live” for manager scoping.

---

### 1.4 `Rooms` (optional)

**Used for:** admin portal “rent from” display — reads linked rows and takes the minimum **Monthly Rent** per property (`VITE_AIRTABLE_ROOM_RENT_FIELD`). Table name: `VITE_AIRTABLE_ROOMS_TABLE` (default `Rooms`). Each row should link to **Properties** (typical link field name `Property`).

---

### 1.5 `Work Orders`

**Used for:** resident submissions, manager inbox, messaging thread, manager calendar (scheduled visit).

**Lifecycle (both portals):** **Open** (create uses `Open`, with **fallback to `Submitted`** if Airtable rejects `Open`) → optional **In Progress** → **Scheduled** when a visit date is set → **Completed** with **`Resolved`** checked. Schedule is stored in **`Management Notes`** as lines like `scheduled date: YYYY-MM-DD` and optional `scheduled time: …`, and in **`Scheduled Date`** (date) **if that column exists** (recommended). See also **`docs/AIRTABLE_BASE_SCHEMA_PROMPT.md`** §3.

**Fields referenced:**

- `Title`, `Description`, `Category`, `Priority`, `Status` — single select; include at least **`Open`**, **`Submitted`** (legacy), **`In Progress`**, **`Scheduled`**, **`Completed`**
- **`Scheduled Date`** — date (optional column; app retries PATCH without it if unknown)
- `Preferred Entry Time`
- `Resident profile` — link to Resident Profile (default in code; env `VITE_AIRTABLE_WORK_ORDER_RESIDENT_LINK_FIELD` if your field name differs)
- **Optional:** `Application ID` (number or text) and/or **`Application`** (link to Applications) — the portal copies these from the resident record when creating a work order. If your base **does not** have these columns, the app **omits** them automatically after the first `UNKNOWN_FIELD_NAME` error. To skip the failed attempt and warnings, set `VITE_AIRTABLE_WORK_ORDER_APPLICATION_ID_FIELD=none` and/or `VITE_AIRTABLE_WORK_ORDER_APPLICATION_LINK_FIELD=none`. To use different names, set those env vars to the **exact** Airtable field names.
- `Photo` — attachment (upload API)
- `Date Submitted` / created time — sorting
- `Management Notes`, `Resolution Summary`, `Resolved`, `Last Update` / `Last Updated` / `Date Resolved` — manager updates (see `Manager.jsx` work order panel)
- `Resident Email` — lookup (formula) for formulas that must not use `LOWER()` on non-string fields (see code comments)

---

### 1.6 `Messages`

**Used for:** work-order threads + **portal inbox** (management ↔ admin, site manager ↔ admin).

**Fields referenced:**

- `Message` (long text)
- `Sender Email`
- `Is Admin` (checkbox)
- **`Subject`** — single line text (thread title + email notification subject); default field name `Subject`; env `VITE_AIRTABLE_MESSAGE_SUBJECT_FIELD` (set to `none` to omit if the column does not exist)
- `Work Order` — link (optional for internal threads)
- **`Thread Key`** — text (internal thread id); env `VITE_AIRTABLE_MESSAGE_THREAD_KEY_FIELD`
- **`Channel`** — single select; include option matching `internal_mgmt_admin` (`PORTAL_INBOX_CHANNEL_INTERNAL` in `airtable.js`); env `VITE_AIRTABLE_MESSAGE_CHANNEL_FIELD`
- `Timestamp` / created time — sorting

**Information needed:** Airtable form URL optional: `VITE_AIRTABLE_PORTAL_INBOX_FORM_URL` with prefilled Thread Key + Channel.

---

### 1.6b `Inbox Thread State` (manager inbox: Unopened / Opened / Trash)

**Base:** same as `Messages` (core portal base, `VITE_AIRTABLE_BASE_ID`).

**Purpose:** Per-manager read cursor and trash for portal threads. Without this table, the app falls back to **browser `localStorage`** for the same behavior (not synced across devices).

**Create a table** named `Inbox Thread State` (or set `VITE_AIRTABLE_INBOX_THREAD_STATE_TABLE` to your name). To **disable** Airtable sync and force local-only state, set `VITE_AIRTABLE_INBOX_THREAD_STATE_TABLE=none`.

| Field name (default) | Type | Notes |
|---------------------|------|--------|
| **Thread Key** | Single line text | Stable id for the thread. Must match what the app uses: work orders → `wo:` + Work Order record id (e.g. `wo:recXXXXXXXXXXXXXX`); Axis site-manager thread → same value as **Messages** `Thread Key` (e.g. `internal:site-manager:email@domain.com`). |
| **Participant Email** | Email or Single line text | Manager’s email (lowercase), same as portal sign-in. One row per (participant, thread). |
| **Last Read At** | Date with time | Updated when the manager opens the thread; used with latest message time to decide **Unopened** vs **Opened**. |
| **Trashed** | Checkbox | When checked, the thread appears only under **Trash** until restored. |

**Optional env overrides** if your field names differ:

- `VITE_AIRTABLE_INBOX_STATE_THREAD_KEY_FIELD`
- `VITE_AIRTABLE_INBOX_STATE_PARTICIPANT_FIELD`
- `VITE_AIRTABLE_INBOX_STATE_LAST_READ_FIELD`
- `VITE_AIRTABLE_INBOX_STATE_TRASHED_FIELD`

**Behavior summary**

- **Sent (per viewer):** not trashed, and the **latest message** in the thread has `Sender Email` equal to **this viewer’s** portal email (the person who sent last always sees the thread under **Sent**). This is independent of `Last Read At`.
- **Unopened:** not trashed, you are **not** the latest sender, and (no `Last Read At` yet, or latest message timestamp is newer than `Last Read At`).
- **Opened:** not trashed, you are not the latest sender, and `Last Read At` is at or after the latest message time.
- **Trash:** `Trashed` is checked (thread still loadable; **Restore** clears the checkbox).

The **recipient** (different email than the latest `Sender Email`) uses the same table with their own `Participant Email` row for that `Thread Key`. No extra Airtable fields are required for Sent vs Unopened beyond **Messages** (`Thread Key`, `Sender Email`, timestamp) and these **Inbox Thread State** columns.

---

### 1.7 `Announcements`

**Used for:** resident feed, manager/admin inbox composer.

**Fields referenced:**

- `Title`, `Message` (or `Body` as fallback in mapping)
- `Target` or `Target Scope` — text or multi; comma/newline tokens; may include internal token `__axis_submitter__:email` (do not show to residents)
- `Priority` — single select: **Low, Normal, High, Urgent** (or typecast)
- `Show` — checkbox; residents only see `Show = TRUE`
- `Pinned` — checkbox
- `Short Summary` — optional
- `Start Date` / `Date Posted` / `Created At` — optional display sort
- `CTA Text`, `CTA Link` — optional buttons in resident UI

---

### 1.8 `Payments`

**Used for:** resident payment list, manager rent overview.

**Fields referenced:**

- `Resident` — link
- `Due Date` — sort
- `Property Name`, `Property`, `House`, `Type`, `Category`, `Kind`, `Line Item Type`, `Month`, `Notes`, `Status` — filtering and labels (see `Manager.jsx` payment helpers)

Optional: `Stripe Customer ID` (mentioned in `.env.example`).

---

### 1.9 `Documents`

**Used for:** `getDocumentsForResident` in `airtable.js` (not yet wired in Resident UI in all builds — still create if you plan parity).

**Fields referenced:**

- `Resident` — link
- `Visible to Resident` — checkbox (must be true for query)

**Information needed:** which file fields (attachment) and titles you want in UI when you connect the tab.

---

### 1.10 `Packages`

**Used for:** `getPackagesForResident` / `markPackagePickedUp`.

**Fields referenced:**

- `Resident` — link
- `Arrival Date` — sort
- `Status` — updated to `Picked Up` on pickup

---

### 1.11 `Lease Drafts` (on core base — Manager portal)

**Used when:** `VITE_AIRTABLE_BASE_ID` is the same base that contains drafts the manager edits, **or** you only use manager UI against this base.

**Fields referenced in app:**

- `Resident Name`, `Resident Email`, `Resident Record ID` (text; should match the Resident Profile `record.id` when known — the resident portal also matches drafts by **email** or linked **`Resident`** if this text field is blank)
- `Property`, `Unit`
- `Lease Start Date`, `Lease End Date`, `Rent Amount`, `Deposit Amount`, `Utilities Fee`, `Lease Term`
- `AI Draft Content`, `Manager Edited Content`, `Manager Notes`
- `Status` — includes **Draft Generated**, **Under Review**, **Changes Needed**, **Approved**, **Published**, **Signed**
- `Updated At`
- `Approved By`, `Approved At`, `Published At`
- `Application Record ID`
- **`Allow Sign Without Move-In Pay`** — checkbox (optional). When checked, residents can open/sign the lease before security deposit + first month rent; env `VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD` if your column name differs
- `SignForge Envelope ID`, `SignForge Sent At` — SignForge send handler
- Sort/filter: `Updated At`, `Property`, `Resident Name`

---

### 1.12 `Audit Log` (Manager portal + server lease workflow)

**Fields referenced:**

- `Lease Draft ID` — text, matches draft `record.id`
- `Action Type`, `Performed By`, `Performed By Role`, `Timestamp`, `Notes`

---

### 1.13 `Website Settings`

**Status:** Declared in `airtable.js` (`TABLES.websiteSettings`) but **no read/write paths found** in the repo. Create only if you plan a marketing/feature-flag table; otherwise omit or implement later.

---

## 2) Tour, Apply, and lease tables (**same** base as §1)

Most of this section lives in `VITE_AIRTABLE_BASE_ID` / `AIRTABLE_BASE_ID` alongside Work Orders, Residents, etc.

### 2.0 Scheduling subsystem (how pieces fit together)

| Piece | Role | Independent? |
|-------|------|--------------|
| **`Scheduling`** | Stores **booked** tours (`Type` = Tour), **booked** meetings (`Type` = Meeting), work-order calendar rows, and (legacy) admin **open** slots as `Type` = Meeting Availability when you have not split availability tables. **Public setup:** visitors book tours and admin meetings via **`POST /api/forms?action=tour`** and **`POST /api/forms?action=meeting`** (same logic as `/api/tour` and `/api/meeting`), which **insert rows here**. | Bookings are always here on the main base (override table name with **`AIRTABLE_SCHEDULING_TABLE`** if your base differs). |
| **Manager tour availability table** (§2.7) | Open time **windows** for **property tours** (per manager + property; recurring or one-off). | Yes — only `tour.js` + manager property calendar read/write this table. |
| **Admin meeting availability table** (§2.8) | Open time **windows** for **Contact Axis / admin meetings** (global rows: no property). | Yes — only `meeting.js` + admin calendar read/write this table when env names a **different** table than §2.7. |
| **`Properties` / `Notes`** | Legacy weekly tour text (`Tour Availability:` block) if no structured manager rows exist for that property. | Tour-specific; ignored once structured manager rows exist for that property+manager. |
| **`Admin Profile`** | Legacy weekly **meeting** text (`Meeting Availability` field or Notes) if no structured admin rows exist for that admin email. | Meeting-specific. |
| **`Blocked Tour Dates`** | Dates a manager marks “no tours” for a property (`airtable.js`). | Tour-only; main base. |

**Optional separate base for availability only:** set `AIRTABLE_AVAILABILITY_BASE_ID` (and `VITE_…` for the browser) so both structured availability tables live in another base while `Scheduling` and `Properties` stay on the primary base. The token must have access to both bases.

**Copy-paste Airtable Scripting extension prompts** (create tables, clear recurring rows, lease/inbox field reminders): `scripts/airtable/AIRTABLE_EXTENSION_SCRIPTS.md`.

### 2.1 `Properties` (tour handler)

**Used by:** `server/handlers/tour.js` GET (lists properties for contact/tour UI).

**Fields used in mapping:**

- `Name` or `Property`
- `Address`
- `Notes` — same tour line conventions as core Properties
- `Site Manager Email` or `Notes` line `Site Manager Email`
- `Application Fee` — number optional

**Room list:** handler falls back to hardcoded room lists if Airtable shape differs — you may extend later.

---

### 2.2 `Scheduling`

**Used by:**

- **`POST /api/forms?action=tour`** — public property tour requests (Contact page, property marketing, tour popup, Apply prefetch). Handler: `server/handlers/tour.js`.
- **`POST /api/forms?action=meeting`** — public “Contact Axis” admin meeting requests. Handler: `server/handlers/meeting.js`.
- Same handlers answer **`POST /api/tour`** and **`POST /api/meeting`** if you call those routes directly.

**Fields written:**

- `Name`, `Email`, `Phone`
- `Type` — `Tour` or `Meeting`
- `Status` — e.g. `New`
- `Property`, `Room`
- `Tour Format`, `Tour Manager`, `Tour Availability`
- `Preferred Date`, `Preferred Time`
- Guest / requester text: **`Message`** (long text) — used by `/api/tour` and `/api/meeting`. Older bases may use `Notes` instead; set server env **`AIRTABLE_SCHEDULING_NOTES_FIELD`** to that column name if needed. Writes retry without unknown fields so minimal tables still accept bookings.

**Portal calendar UI:** Manager and admin portals read `Scheduling` for **booked** items. **Open** tour windows use §2.7 (and legacy property text); **open** admin meeting windows use §2.8 when split, else `Scheduling` rows with `Type` = Meeting Availability and/or `Admin Profile.Meeting Availability`. See **`docs/CALENDAR_SYSTEM.md`**.

---

### 2.3 `Applications`

**Used by:** Apply page (large PATCH/create field set), `getSignedLeases`, lease signing on application record, links from residents/work orders.

**You need:** Full Apply form field list from `Apply.jsx` (dozens of fields: signer identity, housing history, employment, references, occupants, pets, disclosures, consent, signature, dates, `Property Name`, `Room Number`, lease term/dates, `Linked Application` for co-signers, `Lease Signed`, `Lease Signed Date`, `Lease Signature`, etc.). Co-signer rows use a linked table.

**Information needed:** exact single-select options for enums in the form, and which fields are required vs optional for your compliance process.

---

### 2.4 `Co-Signers` (or `VITE_AIRTABLE_COAPPLICANTS_TABLE`)

**Used by:** Apply flow for co-signer records linked to primary application.

**Fields:** see `Apply.jsx` co-signer payload (name, email, phone, DOB, SSN, license, address, employer, income, bankruptcy/criminal, consent, signature, `Linked Application`, `Role` = Co-Signer, etc.).

---

### 2.5 `Lease Drafts` (server AI + SignForge + manager browser)

Same **field model** as section 1.11. **Created** by `server/handlers/generate-lease-draft.js` with the listed fields.

**Resident portal (recent):** ensure `Status` includes options the app uses when sending/signing (**Published**, **Ready for Signature**, **Signed**). Checkbox **`Allow Sign Without Move-In Pay`** (or env `VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD`) lets residents open the lease before deposit + first rent are paid.

---

### 2.6 `Audit Log`

Same as section 1.12; used by `generate-lease-draft`, SignForge webhook, and the manager portal.

---

### 2.7 Manager tour availability table (optional — per-property windows + weekly recurrence)

**Used by:** Manager portal **property** calendar (when `VITE_USE_MANAGER_AVAILABILITY_TABLE` is not disabled) and `server/handlers/tour.js` GET (open tour slots). **Not** used by `/api/meeting` when §2.8 is configured with a **different** table name.

**Default table name:** `Manager Availability`. Override with **`MANAGER_AVAILABILITY_TABLE`**, **`AIRTABLE_MANAGER_AVAILABILITY_TABLE`**, or **`VITE_AIRTABLE_MANAGER_AVAILABILITY_TABLE`**.

**Suggested fields** (same column names should exist on §2.8 if you split):

| Field | Purpose |
|-------|--------|
| **Property Name** | Exact property display name (must match `Properties` name for filtering). |
| **Property Record ID** | Optional; Airtable record id of the property row for stricter matching. |
| **Manager Email** | Manager email owning this availability. |
| **Manager Record ID** | Optional linked record id from Manager Profile. |
| **Date** | For one-time blocks: `YYYY-MM-DD` (date only). Empty when row is recurring weekly. |
| **Weekday** | For recurring rows: `Sun`–`Sat` (or full name; app normalizes). |
| **Start Time** / **End Time** | Same-day local times, e.g. `8:30 AM` and `11:30 AM`, or `08:30` / `11:30`. |
| **Is Recurring** | Checkbox: true = weekly rule for **Weekday** from **Recurrence Start** onward. |
| **Recurrence Start** | Optional date; weekly rule applies only on/after this calendar date. |
| **Active** | Checkbox; inactive rows are ignored. |
| **Timezone** | IANA zone, e.g. `America/New_York`. |
| **Source** | Optional tag, e.g. `manager_portal`. |
| **Notes** | Optional. |
| **Created At** / **Updated At** | Optional; not required for slot math. |

**Merge rules (tours):** For a given property + date, **date-specific** active rows override **recurring** rows for that weekday. Tour booking subtracts **`Scheduling`** tour rows for that property+day. If **any** active row exists for that property+manager, **legacy** `Tour Availability` text on the property is not used for that scope. Clear mistaken weekly rules with `scripts/airtable/manager-availability-clear-recurring.js`.

**Env field renames:** `MANAGER_AVAIL_FIELD_*` / `VITE_MANAGER_AVAIL_FIELD_*` in `.env.example`.

---

### 2.8 Admin meeting availability table (optional — separate from manager tours)

**Used by:** `server/handlers/meeting.js` GET/POST (Contact Axis open slots + validation) and the **admin** calendar in `Manager.jsx` when **`AIRTABLE_ADMIN_MEETING_AVAILABILITY_TABLE`** (or `VITE_…`) is set to a name **different** from the §2.7 table. When unset or same name as §2.7, behavior matches the legacy **single** table (global rows with empty Property lived alongside property rows).

**Default:** if you do not set the admin env, the app keeps one table for both (backward compatible).

**Field schema:** identical to §2.7. Rows for meetings must be **global**: leave **Property Name** and **Property Record ID** empty; set **Manager Email** to the admin’s email (matches `Admin Profile.Email`).

**Admin calendar saves:** With a split table, the portal writes **date-specific** intervals here instead of creating `Scheduling` rows with `Type` = Meeting Availability.

**Merge rules (meetings):** Same date vs recurring precedence as §2.7. Confirmed meetings still subtract **`Scheduling`** rows where `Type` = Meeting. Legacy **`Admin Profile.Meeting Availability`** text is used only when there are no active structured rows for that admin (same pattern as tours).

**Cleanup script:** `scripts/airtable/admin-availability-clear-recurring.js` (same logic as manager script; change `TABLE_NAME` if needed).

---

### 2.9 `Blocked Tour Dates` (optional)

Per-property calendar block list used by `fetchBlockedTourDates` / manager portal. See comments in `frontend/src/lib/airtable.js` near `Blocked Tour Dates` for required fields (`Property ID`, `Property Name`, `Date`, etc.).

---

## 3) Optional / “not Airtable”

- **Axis internal Management/Admin mock portals:** mock data; no tables.

Admin sign-in for most roles uses the **Admin Profile** table in Airtable (see server `admin-profile-login`); env CEO and site owner use server environment variables only.

### 3.1 Internal admin / CEO (manual row for your ops base)

The app does **not** read this table — add a row only for your own contact directory / team records.

| Suggested field | Value |
|-----------------|--------|
| **Name** | Prakrit |
| **Email** | prakritramachandran@gmail.com |
| **Role** | CEO |
| **Notes** | Full `/admin` access via server env `AXIS_CEO_EMAIL`, `AXIS_CEO_PASSWORD`, `AXIS_CEO_NAME` — **do not** store portal passwords in Airtable. |

---

## 4) Checklist prompt (copy-paste)

Paste the block below into Cursor when you want a schema design:

```text
Using the repo the-axis, implement or verify Airtable:

1) Use a single base ID: VITE_AIRTABLE_BASE_ID (and AIRTABLE_BASE_ID on the server with the same value).

2) In that base, create/verify: Resident Profile, Manager Profile, Properties, Rooms, Work Orders (Status + optional Scheduled Date; see docs/AIRTABLE_BASE_SCHEMA_PROMPT.md), Messages (Thread Key + Channel + internal_mgmt_admin), Announcements, Payments, Documents, Packages, Inbox Thread State (optional), Scheduling (§2.2), optional manager tour availability (§2.7), optional admin meeting availability (§2.8) when split from tours, optional Blocked Tour Dates (§2.9), Applications, Co-Signers, Lease Drafts, Audit Log — fields per docs/AIRTABLE_SETUP_PROMPT.md sections 1–2. If you use a separate availability base, set AIRTABLE_AVAILABILITY_BASE_ID and create §2.7/§2.8 tables there (§2.0).

3) List any table in TABLES that still has no API usage (Website Settings) and either add usage or remove from roadmap.

4) Output: per-table field list with Airtable field type, required/optional, and any single-select option sets.
```

---

## 5) File references (for maintainers)

- **Schema layout prompt (tables, links, Work Order lifecycle):** `docs/AIRTABLE_BASE_SCHEMA_PROMPT.md`
- Core tables and helpers: `src/lib/airtable.js`
- Manager + lease/audit/properties: `src/pages/Manager.jsx`
- Work order schedule meta (shared): `src/lib/workOrderShared.js`
- Apply payloads: `src/pages/Apply.jsx`
- Tour POST/GET: `backend/server/handlers/tour.js` (public entry: `backend/server/forms-gateway.js` → `?action=tour`)
- Meeting POST/GET: `backend/server/handlers/meeting.js` (public entry: `backend/server/forms-gateway.js` → `?action=meeting`)
- Availability merge + slots: `shared/manager-availability-merge.js`, `server/handlers/tour.js`, `server/handlers/meeting.js`, `frontend/src/lib/managerAvailabilityAirtable.js`
- Airtable Scripting prompts: `scripts/airtable/AIRTABLE_EXTENSION_SCRIPTS.md`
- AI lease create: `server/handlers/generate-lease-draft.js`
- SignForge: `server/handlers/signforge-send-lease.js`, `signforge-webhook.js`
- Env template: `.env.example`
- Announcements script sample: `scripts/airtable/create-announcement.js`
