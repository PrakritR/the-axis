/*
  Airtable Scripting App script
  Tables:
  - Properties
  - Rooms
  - Announcements

  Creates an announcement using the current website schema:
  - Title
  - Slug
  - Message
  - Short Summary
  - Announcement Type
  - Priority
  - Target Scope
  - Properties
  - Rooms
  - Show on Website
  - Status
  - Start Date
  - End Date
  - Pinned
  - CTA Text
  - CTA Link
  - Image URL
  - Created By
  - Notes
*/

const ANNOUNCEMENTS_TABLE = 'Announcements'
const PROPERTIES_TABLE = 'Properties'
const ROOMS_TABLE = 'Rooms'

const ANNOUNCEMENT_TYPES = [
  'General',
  'Maintenance',
  'Rent',
  'House Rules',
  'Move In / Move Out',
  'Safety',
  'Utility',
  'Event',
  'Emergency',
]

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent']
const TARGET_SCOPES = ['All Properties', 'Selected Properties', 'Selected Rooms']
const STATUSES = ['Draft', 'Scheduled', 'Published', 'Archived']

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function requireText(label) {
  while (true) {
    const value = await input.textAsync(label)
    if (value && value.trim()) return value.trim()
    output.markdown(`Please enter a value for **${label}**.`)
  }
}

async function optionalText(label) {
  const value = await input.textAsync(label)
  return value ? value.trim() : ''
}

const announcementsTable = base.getTable(ANNOUNCEMENTS_TABLE)
const propertiesTable = base.getTable(PROPERTIES_TABLE)
const roomsTable = base.getTable(ROOMS_TABLE)

const [propertyQuery, roomQuery] = await Promise.all([
  propertiesTable.selectRecordsAsync({ fields: ['Property Name', 'Property ID'] }),
  roomsTable.selectRecordsAsync({ fields: ['Room Key', 'Room Label', 'Room Number', 'Property'] }),
])

const title = await requireText('Announcement title')
const slug = (await optionalText('Slug (leave blank to auto-generate)')) || slugify(title)
const message = await requireText('Message')
const shortSummary = await optionalText('Short summary')

const announcementType = await input.buttonsAsync(
  'Announcement type',
  ANNOUNCEMENT_TYPES.map((value) => ({ label: value, value }))
)

const priority = await input.buttonsAsync(
  'Priority',
  PRIORITIES.map((value) => ({ label: value, value }))
)

const targetScope = await input.buttonsAsync(
  'Target scope',
  TARGET_SCOPES.map((value) => ({ label: value, value }))
)

let selectedPropertyIds = []
let selectedRoomIds = []

if (targetScope === 'Selected Properties') {
  selectedPropertyIds = await input.recordAsync('Choose property', propertiesTable)
    .then((record) => record ? [record.id] : [])
}

if (targetScope === 'Selected Rooms') {
  const roomOptions = roomQuery.records.map((record) => ({
    label: record.getCellValueAsString('Room Key') || record.name,
    value: record.id,
  }))

  while (true) {
    const nextRoomId = await input.buttonsAsync('Add a room target', [
      ...roomOptions.map((option) => ({ label: option.label, value: option.value })),
      { label: 'Done', value: 'done' },
    ])

    if (nextRoomId === 'done') break
    if (!selectedRoomIds.includes(nextRoomId)) selectedRoomIds.push(nextRoomId)
  }
}

const status = await input.buttonsAsync(
  'Status',
  STATUSES.map((value) => ({ label: value, value }))
)

const showOnWebsite = await input.buttonsAsync('Show on website?', [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
])

const pinned = await input.buttonsAsync('Pin this announcement?', [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
])

const startDateInput = await optionalText('Start date/time (leave blank for now, format YYYY-MM-DD or YYYY-MM-DDTHH:MM)')
const endDateInput = await optionalText('End date/time (optional)')
const ctaText = await optionalText('CTA text (optional)')
const ctaLink = await optionalText('CTA link (optional URL)')
const imageUrl = await optionalText('Image URL (optional)')
const createdBy = await optionalText('Created by')
const notes = await optionalText('Internal notes')

const fields = {
  Title: title,
  Slug: slug,
  Message: message,
  'Short Summary': shortSummary || undefined,
  'Announcement Type': { name: announcementType },
  Priority: { name: priority },
  'Target Scope': { name: targetScope },
  Properties: selectedPropertyIds,
  Rooms: selectedRoomIds,
  'Show on Website': showOnWebsite,
  Status: { name: status },
  'Start Date': startDateInput || new Date().toISOString(),
  'End Date': endDateInput || undefined,
  Pinned: pinned,
  'CTA Text': ctaText || undefined,
  'CTA Link': ctaLink || undefined,
  'Image URL': imageUrl || undefined,
  'Created By': createdBy || undefined,
  Notes: notes || undefined,
}

const cleanedFields = Object.fromEntries(
  Object.entries(fields).filter(([, value]) => value !== undefined && value !== '')
)

const recordId = await announcementsTable.createRecordAsync(cleanedFields)

output.markdown('## Announcement created')
output.markdown(`- Record ID: \`${recordId}\``)
output.markdown(`- Title: **${title}**`)
output.markdown(`- Scope: **${targetScope}**`)
output.markdown(`- Status: **${status}**`)
output.markdown(`- Show on Website: **${showOnWebsite ? 'Yes' : 'No'}**`)
