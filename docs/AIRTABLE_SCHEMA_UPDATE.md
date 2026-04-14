# Airtable schema — Axis manager portal (2026)

Add these fields manually in the Airtable UI, or use the checklist in `scripts/airtable/create-required-fields.js`.

## Properties

| Field name | Type | Options / notes |
|------------|------|-----------------|
| Lease Access Requirement | Single select | `Security Deposit Paid`, `Security Deposit and First Month Rent Paid`, `No Requirement` |
| Required Before Signing Summary | Long text | Auto-filled from portal when saving a property |
| Move In Charges JSON | Long text | JSON array of `{ name, amount, requiredBeforeSigning }` |
| Fees Required Before Signing | Long text | Short auto summary for records |

Existing `Other Info` JSON may also store `leaseAccessRequirement` and `financials.moveInChargeList` for backward compatibility.

## Lease Drafts

| Field name | Type | Options / notes |
|------------|------|-----------------|
| Lease Access Requirement Snapshot | Single line text (or Single select with same options as Properties) | Set when draft is generated |
| Lease Access Granted | Checkbox | |
| Lease Access Granted At | Date (with time) or Last modified time | Set when requirements are met / on sign |
| Lease Access Block Reason | Long text | Why the resident cannot access/sign yet |

## Payments

| Field name | Type | Options / notes |
|------------|------|-----------------|
| Payment Type | Single select | Include: `Rent`, `Security Deposit`, `First Month Rent`, `Last Month Rent`, `Application Fee`, `Cleaning Fee`, `Admin Fee`, `Key Fee`, `Prorated Rent`, `Fee Waive`, `Other` |
| Required Before Signing | Checkbox | Optional; for fee lines tied to lease signing |
| Waiver Reason | Long text | Optional; mirrors Notes for fee waives |
| Application | Link to Applications | Optional |

**Fee waive rows:** `Type` = `Fee Waive`, amount as entered, `Notes` / `Waiver Reason` for reason. Not treated as rent/deposit payment for lease access.

## Optional: Move In Charges table

If you prefer a linked table instead of `Move In Charges JSON` on Properties:

| Field | Type |
|-------|------|
| Property | Link → Properties |
| Charge Name | Single line text |
| Amount | Currency or Number |
| Required Before Signing | Checkbox |
| Sort Order | Number |
| Notes | Long text |

The current codebase stores structured move-in charges as JSON on **Properties** (`Move In Charges JSON`).
