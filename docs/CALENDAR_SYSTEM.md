# Calendar system (Axis) — how it works with Airtable

This document explains **only** the calendar feature: what data it reads and writes, how **admin** vs **manager** views differ, and which Airtable tables/fields matter.

Implementation lives mainly in `frontend/src/pages/Manager.jsx` (`CalendarTabPanel`, `AvailabilityCalendar`, scheduling fetch helpers) and `frontend/src/lib/calendarEventModel.js`. Admin portal embeds the same `CalendarTabPanel` with `calendarMode="admin"` from `axis-internal/AdminPortal.jsx`.

---

## What the calendar shows (two layers)

1. **Availability (the grid you edit)**  
   “Free” slots for a **selected owner** — either an **admin profile** (internal meetings) or a **property** (tours / house availability). This is **not** stored in `Scheduling` until someone books; it is stored as **encoded text** on the admin row or property row (see below).

2. **Booked items (dots / list for a day)**  
   Things that already have a date:
   - Rows from the **`Scheduling`** table (tours and meetings created via `/api/tour`, meeting flow, etc.).
   - **Work orders** that carry a schedulable date in **`Management Notes`** metadata (manager view only, scoped to allowed properties).

The UI merges scheduling + work-order-derived events into one `bookedByDate` map for the month/week/day views.

---

## Airtable: `Scheduling` table

**Table name:** `Scheduling` (must exist in `VITE_AIRTABLE_BASE_ID`; URL-encoded in API calls).

**Used for:** persisted **bookings** (tours, meetings). The calendar **reads** these; creating rows is done by server routes (e.g. `POST /api/tour`) and related handlers, not by the calendar “Save availability” button.

**Fields the calendar parser cares about** (see `eventFromSchedulingRow` in `calendarEventModel.js`):

| Field | Role |
|--------|------|
| **Preferred Date** | Date of the event; first 10 chars used as `YYYY-MM-DD`. |
| **Preferred Time** | Should look like a range, e.g. `10:00 AM - 11:00 AM`, so the UI can parse start/end. |
| **Type** | e.g. `Tour`, `Meeting` — drives icon/category normalization. |
| **Name** | Guest / label. |
| **Property** | Property name string (for tours). |
| **Manager Email** | Used to **scope** rows to a manager; also used for meeting-type rows in some paths. |
| **Status** | Shown on cards. |

**How rows get into a manager’s calendar**

`fetchSchedulingForManagerScope` loads **all** `Scheduling` rows (paginated), then **filters in the browser** to rows where:

- `Manager Email` equals the signed-in manager’s email, **or**
- `Property` matches one of the names in `allowedPropertyNames` (assigned properties for that manager, including pending approval after the recent portal change).

**How rows get into the admin calendar**

`fetchAllSchedulingRows` loads **every** `Scheduling` row (paginated) with **no** manager/property filter — org-wide view for internal staff.

---

## Availability storage (the weekly grid)

This is **separate** from `Scheduling`. Saving “availability” **updates a long text field** that encodes weekly free slots (same general idea as public tour parsing on the marketing site).

### Admin portal (`calendarMode="admin"`)

- **Source:** **`Admin Profile`** table (name overridable with `VITE_AIRTABLE_ADMIN_PROFILE_TABLE`).
- **Rows:** One row per internal contact with a valid **Email**; dropdown lists those profiles.
- **Write field:** **`Meeting Availability`** (PATCH from `updateAdminMeetingAvailability` in `adminPortalAirtable.js`).  
  Reads also merge **`Calendar Availability`** and optional **`Notes`** lines for “Meeting Availability”.
- **Who sees what:** Admin calendar loads **all** scheduling rows + can edit **meeting** availability per admin profile.

### Manager portal (`calendarMode="manager"`)

- **Source:** **`Properties`** records linked to that manager.
- **Dropdown:** Properties where the manager is assigned **or** the property name is in the allowed list (assigned names, including not-yet-approved if linked).
- **Write path:** Updates **`Notes`** on the property via `updatePropertyAdmin`, embedding / updating a **`Tour Availability:`** line inside the multiline notes (see `buildTourNotesText` / `extractMultilineNoteValue` patterns in `Manager.jsx`).
- **Scope:** Scheduling fetch + work orders are limited to that manager’s emails and property names.

---

## End-to-end flows

### Public visitor books a tour

1. Marketing **Contact** flow (or API) submits a request.  
2. Server writes a **`Scheduling`** row with **Preferred Date**, **Preferred Time**, **Type** = Tour, **Property**, guest fields, etc.  
3. Manager (and admin) calendars show that row on the correct day if the row passes the filter above.

### Staff sets “when we’re free”

1. Open **Calendar** in **Manager** or **Admin** portal.  
2. Pick **property** or **admin profile** in the dropdown.  
3. Edit the week grid, **Save availability** → PATCH **Properties.Notes** (tour line) or **Admin Profile.Meeting Availability**.  
4. That text is what tour/meeting UIs can use to offer slots (alongside any public parsing on `Contact.jsx`).

---

## Common issues

| Symptom | Likely cause |
|---------|----------------|
| Admin dropdown empty | No **`Admin Profile`** rows with valid **Email**, or token/base can’t read that table. **Meeting Availability** field missing only breaks **save**, not listing. |
| Manager dropdown empty | No **Properties** linked to that manager (email / link fields). |
| Bookings never appear | **`Scheduling`** table missing, wrong base, or **Preferred Date** / **Property** / **Manager Email** don’t match filters. |
| Time blocks look wrong | **Preferred Time** not in a parseable `H:MM AM - H:MM AM` style range. |

---

## Related docs

- **`docs/AIRTABLE_SETUP_PROMPT.md`** — §2.2 `Scheduling`, §2.1 Properties (tour), Manager Profile tour fields.  
- **`docs/AIRTABLE_QUICK_ACTION_PROMPT.md`** — short checklist for Internal Notes + Admin Profile + calendar fields.
