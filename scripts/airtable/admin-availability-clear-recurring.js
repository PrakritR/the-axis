/*
  Airtable Scripting extension — Admin Meeting Availability

  Same behavior as manager-availability-clear-recurring.js, for the table that
  holds global admin meeting windows (empty Property Name / Property Record ID).

  Rename TABLE_NAME if your base uses a different label (must match
  AIRTABLE_ADMIN_MEETING_AVAILABILITY_TABLE / VITE_AIRTABLE_ADMIN_MEETING_AVAILABILITY_TABLE).
*/

const TABLE_NAME = 'Admin Meeting Availability'

const table = base.getTable(TABLE_NAME)

const choice = await input.buttonsAsync('What should this script do?', [
  { label: 'List recurring rows only', value: 'list' },
  { label: 'Delete ALL recurring rows (Is Recurring checked)', value: 'delete_all' },
  { label: 'Delete recurring rows for one Manager Email', value: 'delete_email' },
])

function isRecurringRecord(record) {
  const v = record.getCellValue('Is Recurring')
  if (v === true || v === 1) return true
  const s = String(v == null ? '' : v).trim().toLowerCase()
  return s === 'true' || s === 'yes'
}

const query = await table.selectRecordsAsync()
const recurringRecords = query.records.filter(isRecurringRecord)

if (choice === 'list') {
  output.markdown(`## Recurring rows (${recurringRecords.length})`)
  for (const r of recurringRecords) {
    const day = String(r.getCellValue('Weekday') ?? '').trim() || '—'
    const start = String(r.getCellValue('Start Time') ?? '').trim()
    const end = String(r.getCellValue('End Time') ?? '').trim()
    const em = String(r.getCellValue('Manager Email') ?? '').trim() || '—'
    output.markdown(`- \`${r.id}\` · **${em}** · ${day} · ${start} – ${end}`)
  }
  output.markdown('_Run again and pick a delete option to remove them._')
} else if (choice === 'delete_all') {
  const ok = await input.buttonsAsync(`Delete ${recurringRecords.length} recurring rows?`, [
    { label: 'Cancel', value: false },
    { label: 'Delete', value: true },
  ])
  if (!ok) {
    output.markdown('Cancelled.')
  } else {
    let remaining = [...recurringRecords]
    while (remaining.length) {
      const batch = remaining.slice(0, 50)
      remaining = remaining.slice(50)
      await table.deleteRecordsAsync(batch)
    }
    output.markdown('Done. Recurring rows removed. Date-specific rows are unchanged.')
  }
} else {
  const em = await input.textAsync('Manager Email (exact field match, case-insensitive here)')
  const needle = String(em || '').trim().toLowerCase()
  const toDelete = recurringRecords.filter((r) => {
    const n = String(r.getCellValue('Manager Email') ?? '').trim().toLowerCase()
    return n === needle
  })
  output.markdown(`## Matching recurring rows: ${toDelete.length}`)
  if (!toDelete.length) {
    output.markdown('Nothing to delete.')
  } else {
    const ok = await input.buttonsAsync('Delete these rows?', [
      { label: 'Cancel', value: false },
      { label: 'Delete', value: true },
    ])
    if (!ok) output.markdown('Cancelled.')
    else {
      let remaining = [...toDelete]
      while (remaining.length) {
        const batch = remaining.slice(0, 50)
        remaining = remaining.slice(50)
        await table.deleteRecordsAsync(batch)
      }
      output.markdown('Deleted.')
    }
  }
}
