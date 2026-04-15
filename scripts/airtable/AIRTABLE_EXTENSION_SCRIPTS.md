# Airtable Scripting extension — copy/paste prompts

Use **Extensions → Scripting** in the base where the table should live (main portal base, or `AIRTABLE_AVAILABILITY_BASE_ID` if you split availability).

---

## 1) Create **Manager Tour Availability** table (§2.7)

Paste into ChatGPT / Cursor with your base open, or create manually from `docs/AIRTABLE_SETUP_PROMPT.md` §2.7 field list.

```text
In Airtable, create a table named "Manager Availability" (or "Manager Tour Availability") with these fields:
- Property Name (single line text)
- Property Record ID (single line text)
- Manager Email (email)
- Manager Record ID (single line text)
- Date (date, date only)
- Weekday (single line text)
- Start Time (single line text) — e.g. 09:00 AM
- End Time (single line text)
- Is Recurring (checkbox)
- Recurrence Start (date)
- Active (checkbox, default checked)
- Timezone (single line text, default America/Los_Angeles)
- Source (single line text)
- Notes (long text, optional)
```

---

## 2) Create **Admin Meeting Availability** table (§2.8)

Same columns as §1. Rows for meetings use **empty** Property Name and Property Record ID; set **Manager Email** to the admin’s `Admin Profile` email.

```text
Duplicate the field schema from the Manager Availability table into a new table "Admin Meeting Availability".
Do not link Properties. Global rows only: Property Name and Property Record ID stay blank; Manager Email identifies the admin.
```

Set env (server + Vite):

- `AIRTABLE_ADMIN_MEETING_AVAILABILITY_TABLE=Admin Meeting Availability`
- `VITE_AIRTABLE_ADMIN_MEETING_AVAILABILITY_TABLE=Admin Meeting Availability`

Keep manager table name on `MANAGER_AVAILABILITY_TABLE` / default `Manager Availability`.

---

## 3) Optional: availability in a **separate base**

1. Create §1 and §2 tables in the new base (same field names).
2. Grant the same PAT access to that base.
3. Set `AIRTABLE_AVAILABILITY_BASE_ID` and `VITE_AIRTABLE_AVAILABILITY_BASE_ID` to that base id.
4. Leave `VITE_AIRTABLE_BASE_ID` on the main base (Scheduling, Properties, etc.).

---

## 4) Clear mistaken **recurring** rules

- Manager / property table: open `scripts/airtable/manager-availability-clear-recurring.js` in Scripting (set `TABLE_NAME` if needed).
- Admin meeting table: open `scripts/airtable/admin-availability-clear-recurring.js`.

---

## 5) **Scheduling** — guest notes column

If your table uses `Notes` instead of `Message` for visitor text:

```text
No script — set env on server:
AIRTABLE_SCHEDULING_NOTES_FIELD=Notes
```

---

## 6) **Lease Drafts** (resident access + sign-before-pay)

Ensure single select **Status** includes at least: Draft Generated, Ready for Signature, Published, Signed (plus your workflow states).

Add checkbox:

```text
Add checkbox field "Allow Sign Without Move-In Pay" to Lease Drafts.
When checked, residents may **sign** a **Published** (or Ready for Signature) lease before security deposit + first month rent are paid; they do not see the full lease body while the draft is still in manager/admin review (see leaseMoveInOverride.js).
```

Resident view/sign rules also accept **Ready for Signature** alongside **Published** (`residentLeaseAccess.js`, `sign-lease-draft.js`).

---

## 7) **Messages** (inbox threading)

Minimum fields used by portal inbox (see `docs/AIRTABLE_SETUP_PROMPT.md` §1 and `.env.example`):

- `Thread Key` (text) — stable conversation id
- `Channel` (text) — e.g. resident_manager
- `Subject` (single line text) — optional; set `VITE_AIRTABLE_MESSAGE_SUBJECT_FIELD=none` if absent
- Writable sort field optional: `Timestamp` / `VITE_AIRTABLE_MESSAGE_TIMESTAMP_FIELD`

---

## 8) **Blocked Tour Dates**

Table `Blocked Tour Dates` with at least: `Property ID`, `Property Name`, `Date` (YYYY-MM-DD text), `Manager ID`, `Manager Name`, `Reason`, `Created At` — see `frontend/src/lib/airtable.js` comments.

---

## 9) **Room cleaning / work orders** ($10 fee marker)

`frontend/src/lib/roomCleaningWorkOrder.js` defines fee amount and markers. **Current flow:** resident chooses **Cleaning** under **Create new work order**; when the manager sets **Scheduled Date**, the manager portal creates an **Unpaid** Payments row (tag `AXIS_ROOM_CLEANING_PAYMENT_FOR_WO:` + work order id in Notes). Legacy prepaid rows may still use `AXIS_ROOM_CLEANING_PREPAID` / `AXIS_ROOM_CLEANING_WO_FOR_PAYMENT:` — those are not double-billed on schedule. Ensure **Work Orders** `Category` single select includes **Cleaning** (typecast may add it).
