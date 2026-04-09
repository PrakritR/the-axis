/*
  Airtable Scripting App script
  Table: Announcements

  Simple schema supported by the website:
  - Title
  - Message
  - Target
  - Priority
  - Show
  - Pinned

  Recommended Target values:
  - All Properties
  - 4709A
  - 4709B
  - 5259
  - 4709A-Room 2
  - 5259-Room 8
  - comma-separated combinations like: 4709A, 4709B
*/

const TABLE_NAME = 'Announcements'
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent']

const table = base.getTable(TABLE_NAME)

async function requireText(label) {
  while (true) {
    const value = await input.textAsync(label)
    if (value && value.trim()) return value.trim()
    output.markdown(`Please enter a value for **${label}**.`)
  }
}

const title = await requireText('Title')
const message = await requireText('Message')
const target = await input.textAsync('Target (leave blank for All Properties)')

const priority = await input.buttonsAsync(
  'Priority',
  PRIORITIES.map((value) => ({ label: value, value }))
)

const show = await input.buttonsAsync('Show on website?', [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
])

const pinned = await input.buttonsAsync('Pin this announcement?', [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
])

const fields = {
  Title: title,
  Message: message,
  Target: target?.trim() || 'All Properties',
  Priority: { name: priority },
  Show: show,
  Pinned: pinned,
}

const recordId = await table.createRecordAsync(fields)

output.markdown('## Announcement created')
output.markdown(`- Record ID: \`${recordId}\``)
output.markdown(`- Title: **${title}**`)
output.markdown(`- Target: **${fields.Target}**`)
output.markdown(`- Priority: **${priority}**`)
output.markdown(`- Show: **${show ? 'Yes' : 'No'}**`)
output.markdown(`- Pinned: **${pinned ? 'Yes' : 'No'}**`)
