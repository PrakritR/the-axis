# Airtable Schema

Use these tables for the resident announcement system.

## Properties

One record per property.

Fields:
- `Property ID` -> single line text
- `Property Name` -> single line text
- `Full Address` -> single line text
- `Active` -> checkbox
- `Rooms` -> link to `Rooms`

Suggested records:
- `4709A` / `4709A 8th Ave`
- `4709B` / `4709B 8th Ave`
- `5259` / `5259 Brooklyn Ave NE`

## Rooms

One record per room.

Fields:
- `Room Key` -> formula or single line text
- `Property` -> link to `Properties`
- `Room Number` -> number
- `Room Label` -> formula or single line text
- `Active` -> checkbox

Suggested records:
- `4709A-Room 1` through `4709A-Room 10`
- `4709B-Room 1` through `4709B-Room 10`
- `5259-Room 1` through `5259-Room 9`

## Announcements

This is the table the resident portal reads from.

Fields:
- `Announcement ID` -> autonumber or formula
- `Title` -> single line text
- `Slug` -> single line text
- `Message` -> long text
- `Short Summary` -> single line text or long text
- `Announcement Type` -> single select
- `Priority` -> single select
- `Target Scope` -> single select
- `Properties` -> link to `Properties`
- `Rooms` -> link to `Rooms`
- `Show on Website` -> checkbox
- `Status` -> single select
- `Start Date` -> date/time
- `End Date` -> date/time
- `Pinned` -> checkbox
- `CTA Text` -> single line text
- `CTA Link` -> URL
- `Image URL` -> URL
- `Created By` -> collaborator or single line text
- `Created At` -> created time
- `Updated At` -> last modified time
- `Notes` -> long text

Select options:

`Announcement Type`
- `General`
- `Maintenance`
- `Rent`
- `House Rules`
- `Move In / Move Out`
- `Safety`
- `Utility`
- `Event`
- `Emergency`

`Priority`
- `Low`
- `Normal`
- `High`
- `Urgent`

`Target Scope`
- `All Properties`
- `Selected Properties`
- `Selected Rooms`

`Status`
- `Draft`
- `Scheduled`
- `Published`
- `Archived`

## Website Settings

Optional configuration table.

Fields:
- `Setting Name`
- `Value`
- `Description`

Suggested rows:
- `announcements_enabled` -> `true`
- `default_sort` -> `pinned_first`
- `max_items_homepage` -> `5`
- `show_expired` -> `false`

## Recommended Views

### Announcements -> Published - Active
- `Show on Website` is checked
- `Status` is `Published`
- `Start Date` is on or before now
- `End Date` is empty or on/after now

### Announcements -> Scheduled
- `Status` is `Scheduled`

### Announcements -> Drafts
- `Status` is `Draft`

### Announcements -> Archived
- `Status` is `Archived`

### Announcements -> Pinned
- `Pinned` is checked

### Announcements -> Urgent
- `Priority` is `Urgent`
