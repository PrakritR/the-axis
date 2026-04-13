# Leasing workflow — end-to-end test prompt

Use the block below as a prompt in Cursor or Claude when you want to verify the leasing workflow is wired up correctly and walk through the full flow.

---

## Prompt (copy from here)

```
You are a QA engineer testing the back-and-forth leasing workflow in the Axis housing app.
The workflow allows a manager to request changes to a lease, an admin to review and update it,
and the manager to approve or request further changes.

Below is everything you need to test the feature end-to-end. Read the relevant source files,
then follow the test plan.

────────────────────────────────────────
SOURCE FILES TO READ FIRST
────────────────────────────────────────

Backend handlers (the-axis/backend/server/handlers/):
  lease-submit-edit-request.js   — manager submits change request
  lease-admin-respond.js         — admin updates lease + sends back
  lease-manager-review.js        — manager approves or requests more changes
  lease-add-comment.js           — either role posts a comment
  lease-mark-notifications-read.js — marks notifications as read

Frontend:
  frontend/src/lib/leaseWorkflowConstants.js   — status config + helpers
  frontend/src/components/LeaseWorkspace.jsx   — shared workspace UI
  frontend/src/pages/ManagerLeasingTab.jsx     — manager's leasing tab
  frontend/src/axis-internal/AdminLeasingTab.jsx — admin's leasing tab

Portal gateway:
  backend/server/portal-gateway.js    — confirm all 5 actions are registered

────────────────────────────────────────
TEST PLAN — full happy path
────────────────────────────────────────

Step 1 — Setup
  a. Ensure the 3 new Airtable tables exist (Lease Comments, Lease Versions, Lease Notifications)
  b. Ensure Lease Drafts has Manager Edit Notes, Admin Response Notes, Current Version, Revision Round
  c. Ensure Lease Drafts Status field has the new options (Submitted to Admin, Sent Back to Manager, etc.)
  d. Have at least one existing Lease Draft record in Airtable status "Draft Generated" or "Under Review"
  e. Have a manager account and admin account to log in with

Step 2 — Manager submits edit request
  a. Log in as the manager
  b. Open Manager portal → Leasing tab
  c. Find the lease draft → click it to open LeaseWorkspace
  d. Click "Request Changes" button (visible because status allows it)
  e. Fill in the edit notes and at least one field change
  f. Submit
  Expected:
    - Toast "Edit request submitted"
    - Lease status → "Submitted to Admin"
    - New record in Lease Comments with Author Role = manager
    - New record in Lease Notifications with Recipient Role = admin Is Read = false
    - Manager Edit Notes field populated with JSON

Step 3 — Admin sees the request
  a. Log in as admin
  b. Open Admin portal → Leasing tab
  c. Action-needed banner should show count ≥ 1
  d. Status filter "Admin Action Needed" pill should be non-zero
  e. Open the lease → Comments tab shows manager's comment

Step 4 — Admin responds and sends back
  a. In LeaseWorkspace (admin view), click "Respond" / "Update Lease"
  b. Change status to "Sent Back to Manager"
  c. Fill in admin notes + update at least one lease field
  d. Optionally paste a PDF URL to create a new version
  e. Submit
  Expected:
    - Toast "Lease updated"
    - Status → "Sent Back to Manager"
    - Admin Response Notes field updated
    - If PDF URL provided: new record in Lease Versions with Is Current = true, old versions Is Current = false
    - New record in Lease Notifications with Recipient Role = manager Is Read = false

Step 5 — Manager reviews and approves
  a. Log in as manager again
  b. Leasing tab → action-needed indicator visible
  c. Open the lease → click "Review Update"
  d. Select "Approve"
  e. Submit
  Expected:
    - Toast "Changes approved"
    - Status → "Manager Approved"
    - New comment with Author Role = manager + message containing "approved"
    - New notification for admins

Step 6 — Admin finalizes
  a. Log in as admin
  b. Open the lease → click "Respond"
  c. Set status to "Ready for Signature"
  d. Submit
  Expected:
    - Status → "Ready for Signature"
    - Workflow complete; no more action-needed indicators for this lease

Step 7 — Notifications read
  a. When either party opens a lease, unread notification count for that lease should drop to 0
  b. Confirm Lease Notifications records for the opened lease now have Is Read = true

────────────────────────────────────────
TEST PLAN — edge cases
────────────────────────────────────────

Edge 1 — Manager requests changes twice (revision loop)
  a. After admin sends back, manager clicks "Request More Changes" instead of "Approve"
  b. Status returns to "Submitted to Admin"
  c. Revision Round field on Lease Draft should increment
  d. Full loop repeats from Step 3

Edge 2 — Admin uploads multiple PDF versions
  a. Admin responds twice with different PDF URLs
  b. Lease Versions table should have 2 records; only latest Is Current = true

Edge 3 — Comment from both sides
  a. Manager adds a standalone comment (Comments tab → "Add comment" input)
  b. Admin adds a reply
  c. Both appear in the thread in chronological order

Edge 4 — Empty state
  a. Filter manager's Leasing tab by "Action Needed" when no leases need action
  b. Should show empty state UI, not a broken page

────────────────────────────────────────
THINGS TO CHECK IN CODE
────────────────────────────────────────

  □ portal-gateway.js registers: lease-submit-edit-request, lease-admin-respond,
    lease-manager-review, lease-add-comment, lease-mark-notifications-read
  □ LeaseWorkspace receives isAdmin prop and shows correct buttons per role
  □ ManagerLeasingTab filters by manager's ownerId (not all drafts)
  □ AdminLeasingTab has no ownerId filter (sees all drafts)
  □ leaseWorkflowConstants.js MANAGER_CAN_SUBMIT_REQUEST set matches statuses
    where the edit-request button is shown
  □ On status "Sent Back to Manager" — manager sees "Review Update" button, not "Request Changes"
  □ Notifications mark-as-read called when LeaseWorkspace mounts with a leaseDraftId
```

---
