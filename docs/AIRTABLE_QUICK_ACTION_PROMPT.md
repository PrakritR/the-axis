# Airtable quick-action prompt (copy-paste)

Use the block below as a **single instruction** for yourself, a teammate, or an AI when configuring the Axis `the-axis` base in Airtable. It covers admin internal notes, admin + manager calendars, and related property fields.

---

## Prompt (copy from here)

```
You are configuring an Airtable base for the Axis housing web app (one base ID in VITE_AIRTABLE_BASE_ID). Do the following in Airtable:

### A) Properties table
1. Add a long text field named exactly: Internal Notes
   - Used by the CEO/admin portal to save staff-only notes (not shown to managers or residents).
   - If you already use a different column name (e.g. "Admin Notes"), keep it and set frontend env: VITE_AIRTABLE_PROPERTY_INTERNAL_NOTES_FIELD=<exact field name>

2. Ensure these fields exist for approvals and public listing (names matter):
   - Approved — checkbox (or as already used in your workflow)
   - Approval Status — single select with values the app understands, including at least: Pending, Approved, Rejected, Changes Requested, Unlisted (match existing Axis docs if any)
   - Listed — checkbox (required for unlist/relist in admin portal; error messages reference this)

3. Optional but common: long text field Notes — used for embedded lines like "Tour Availability: …" for property tour slots on the manager side.

4. Link properties to managers using one or more of: Manager Email, Site Manager Email, linked record fields Manager / Site Manager / Property Manager, or Manager ID — as already in your base.

### B) Admin Profile table (default name: Admin Profile; override with VITE_AIRTABLE_ADMIN_PROFILE_TABLE if renamed)
1. Create one row per internal admin who should appear in the admin portal Calendar tab.
2. Required per row:
   - Email — valid email (the app filters out rows without @)
   - Name — display name (recommended)

3. Add a long text field for meeting availability (the app PATCHes this name):
   - Meeting Availability
   - Optional duplicate/read alias used in code: Calendar Availability (read-only merge in app; writes go to Meeting Availability)

4. Enabled — optional checkbox. The calendar lists all profiles with valid Email regardless of Enabled; use Enabled for other flows (e.g. inbox admin picker) if you add it.

5. Notes — optional; can hold a line parsed as Meeting Availability if you use that pattern.

### C) Manager Profile table
1. Tour Availability — long text (optional) for manager-level tour text if you use it.
2. Active — checkbox; false blocks manager login.
3. Email, Password, Name as required for manager auth.

### D) Scheduling table
1. Table name should match what the app expects (default: Scheduling) — see repo docs AIRTABLE_SETUP_PROMPT.md if you use a custom name.
2. Used for tour / visit requests on calendars; ensure fields such as Preferred Date, Preferred Time, Property, Name exist per your existing schema doc.

### E) Environment (developer)
- VITE_AIRTABLE_BASE_ID and VITE_AIRTABLE_TOKEN must point at this base with a token that can read/write these tables and fields.
- After adding or renaming fields, redeploy or restart the dev server so env overrides apply.

Verify after setup:
- Admin portal → Properties → internal notes save without "unknown field" errors.
- Admin portal → Calendar → dropdown lists Admin Profile rows by name (not empty if rows exist with Email).
- Manager portal → Calendar → dropdown lists properties assigned to that manager (including pending approval if linked).
```

---

## Shorter checklist (no prose)

| Table | Field | Type | Purpose |
|-------|--------|------|---------|
| Properties | Internal Notes | Long text | Admin-only notes (portal) |
| Properties | Listed | Checkbox | Listing / unlist |
| Properties | Approval Status | Single select | Workflow |
| Properties | Approved | Checkbox | Approval |
| Properties | Notes | Long text | Tour lines + misc |
| Admin Profile | Email | Email | Required for calendar row |
| Admin Profile | Name | Text | Display |
| Admin Profile | Meeting Availability | Long text | Admin meeting slots |
| Manager Profile | Active | Checkbox | Login gate |
| Scheduling | (see full schema doc) | — | Tour bookings on calendar |

For the complete base schema, use `docs/AIRTABLE_SETUP_PROMPT.md` in this repo.
