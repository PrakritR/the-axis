/*
  Airtable Scripting App script
  Table: Announcements

  Creates a new resident announcement using the fields the resident portal expects:
  - Title
  - Body
  - Priority
  - Date Posted
  - Active

  How to use:
  1. Open your Airtable base
  2. Open Extensions -> Scripting
  3. Paste this file into a new script
  4. Run it whenever you want to publish an announcement
*/

const TABLE_NAME = 'Announcements'
const PRIORITY_OPTIONS = ['Routine', 'Urgent', 'Emergency']

const table = base.getTable(TABLE_NAME)

async function requireText(label) {
  while (true) {
    const value = await input.textAsync(label)
    if (value && value.trim()) return value.trim()
    output.markdown(`Please enter a value for **${label}**.`)
  }
}

const title = await requireText('Announcement title')
const body = await requireText('Announcement message')

const priorityChoice = await input.buttonsAsync(
  'Priority',
  PRIORITY_OPTIONS.map((value) => ({ label: value, value }))
)

const activeChoice = await input.buttonsAsync('Publish now?', [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
])

const datePostedInput = await input.textAsync('Date posted (leave blank for today, format YYYY-MM-DD)')
const datePosted = datePostedInput && datePostedInput.trim()
  ? datePostedInput.trim()
  : new Date().toISOString().slice(0, 10)

const fields = {
  Title: title,
  Body: body,
  Priority: { name: priorityChoice },
  Active: activeChoice,
  'Date Posted': datePosted,
}

const recordId = await table.createRecordAsync(fields)

output.markdown('## Announcement created')
output.markdown(`- Record ID: \`${recordId}\``)
output.markdown(`- Title: **${title}**`)
output.markdown(`- Priority: **${priorityChoice}**`)
output.markdown(`- Active: **${activeChoice ? 'Yes' : 'No'}**`)
output.markdown(`- Date Posted: **${datePosted}**`)
