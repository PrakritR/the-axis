# Airtable Announcement Table

Use this simple `Announcements` table structure.

## Fields

- `Title` -> single line text
- `Message` -> long text
- `Target` -> single line text
- `Priority` -> single select
- `Show` -> checkbox
- `Pinned` -> checkbox
- `Created At` -> created time

## Priority options

- `Low`
- `Normal`
- `High`
- `Urgent`

## Target format

Use simple text values:

- `All Properties`
- `4709A`
- `4709B`
- `5259`
- `4709A-Room 2`
- `4709B-Room 7`
- `5259-Room 8`

You can also comma-separate targets:

- `4709A, 4709B`
- `4709A-Room 2, 4709A-Room 3`
- `5259, 4709B-Room 1`

## What the site does

- Blank `Target` -> treated as `All Properties`
- `Show` must be checked for it to appear
- `Pinned` moves it to the top
- `Priority` shows the badge color

## Example rows

### Example 1
- `Title`: Water shutoff on Tuesday
- `Message`: Water will be off from 10am to 1pm.
- `Target`: 4709A, 4709B
- `Priority`: High
- `Show`: checked
- `Pinned`: unchecked

### Example 2
- `Title`: Room inspection this week
- `Message`: Staff will inspect selected rooms on Thursday.
- `Target`: 4709A-Room 2, 4709A-Room 3, 5259-Room 8
- `Priority`: Normal
- `Show`: checked
- `Pinned`: unchecked

### Example 3
- `Title`: New laundry rules
- `Message`: Please remove items promptly after each cycle.
- `Target`: All Properties
- `Priority`: Normal
- `Show`: checked
- `Pinned`: checked
