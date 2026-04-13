# Leasing Workflow — Airtable Setup Guide

This document describes all Airtable tables and fields required to run the
back-and-forth leasing workflow between managers and admins.

**Base ID:** `appol57LKtMKaQ75T`

---

## 1  New fields on existing `Lease Drafts` table

Open the `Lease Drafts` table in Airtable and add these four fields:

| Field name | Type | Notes |
|---|---|---|
| `Manager Edit Notes` | Long text | JSON string; stores the manager's change request payload (editNotes + requestedFields). Serialized by backend. |
| `Admin Response Notes` | Long text | JSON string; stores the admin's response payload (notes + updatedFields). Serialized by backend. |
| `Current Version` | Number | Integer; increments each time admin uploads a new PDF version. Starts at 1. |
| `Revision Round` | Number | Integer; increments each time a lease goes back to the manager for review. Informational field. |

### Extended `Status` values

The existing `Status` field (Single Select) needs the following new options added.
Add them in this order so they sort sensibly in views:

1. `Submitted to Admin` — manager has submitted an edit request
2. `Admin In Review` — admin has acknowledged and is working on it
3. `Changes Made` — admin updated the lease but hasn't sent it back yet
4. `Sent Back to Manager` — admin updated + sent back for manager review
5. `Manager Approved` — manager approved the admin's changes
6. `Ready for Signature` — admin finalized; ready to send to resident for signing

Existing statuses to keep: `Draft Generated`, `Under Review`, `Published`, `Signed`.

---

## 2  New table: `Lease Comments`

Create a new table called exactly `Lease Comments` with these fields:

| Field name | Type | Notes |
|---|---|---|
| `Lease Draft ID` | Single line text | Airtable record ID of the parent `Lease Drafts` record (e.g. `recXXXXXX`) |
| `Author Name` | Single line text | Display name of the commenter |
| `Author Role` | Single select | Options: `manager`, `admin` |
| `Author Record ID` | Single line text | Airtable record ID of the author in their respective table |
| `Message` | Long text | The comment body |
| `Timestamp` | Date and Time | When the comment was created; include time |

**Sort comments by `Timestamp` ascending** when creating views.

---

## 3  New table: `Lease Versions`

Create a new table called exactly `Lease Versions` with these fields:

| Field name | Type | Notes |
|---|---|---|
| `Lease Draft ID` | Single line text | Airtable record ID of the parent `Lease Drafts` record |
| `Version Number` | Number | Integer; 1, 2, 3 … |
| `PDF URL` | URL | Publicly accessible link to the lease PDF (Google Drive, Dropbox, etc.) |
| `File Name` | Single line text | Display filename (e.g. `lease-v2.pdf`) |
| `Notes` | Long text | Description of what changed in this version |
| `Uploaded By` | Single line text | Name of the admin who uploaded this version |
| `Uploaded By Record ID` | Single line text | Airtable record ID of the uploading admin |
| `Is Current` | Checkbox | True on the most-recent version; older versions are set to false |
| `Timestamp` | Date and Time | When this version was created |

**Sort versions by `Version Number` descending** when creating views.

---

## 4  New table: `Lease Notifications`

Create a new table called exactly `Lease Notifications` with these fields:

| Field name | Type | Notes |
|---|---|---|
| `Lease Draft ID` | Single line text | Airtable record ID of the parent `Lease Drafts` record |
| `Recipient Record ID` | Single line text | Airtable record ID of the notification recipient |
| `Recipient Role` | Single select | Options: `manager`, `admin` |
| `Message` | Long text | Notification text |
| `Is Read` | Checkbox | False by default; set to true when the recipient opens the workspace |
| `Timestamp` | Date and Time | When the notification was created |

**Add a filter view** per role: Admin unread = `{Recipient Role} = "admin" AND NOT {Is Read}`.

---

## 5  Airtable token / environment variables

Ensure these env vars are set in Vercel (and locally in `.env`):

```
AIRTABLE_TOKEN=pat...          # Server-side (used by backend handlers)
VITE_AIRTABLE_TOKEN=pat...     # Client-side (same token, used for direct reads)
VITE_AIRTABLE_BASE_ID=appol57LKtMKaQ75T
```

Both `AIRTABLE_TOKEN` and `VITE_AIRTABLE_TOKEN` should be the same personal
access token with **read + write** scopes on the base.

---

## 6  Workflow status state machine

```
Draft Generated
    │
    ▼ (manager requests changes)
Submitted to Admin
    │
    ▼ (admin acknowledges)
Admin In Review
    │
    ├──▶ Changes Made          (admin saved changes, not yet sent)
    │         │
    │         ▼
    └──▶ Sent Back to Manager  (admin sends back)
              │
              ├──▶ Manager Approved  (manager accepts)
              │         │
              │         ▼
              │    Ready for Signature  (admin finalizes)
              │         │
              │         ▼
              │       Signed
              │
              └──▶ Submitted to Admin  (manager requests more changes → loop)
```

---

## 7  Optional: Airtable automation for email notifications

The backend creates `Lease Notifications` records for every state change event.
You can add Airtable automations that trigger when a new record is created in
`Lease Notifications` and send an email via SendGrid / Gmail to the recipient.

Alternatively, the backend handlers call `notify-message` (EmailJS) for some
actions if configured. Set `VITE_EMAILJS_SERVICE_ID`, `VITE_EMAILJS_TEMPLATE_ID`,
and `VITE_EMAILJS_PUBLIC_KEY` in your environment to enable.
