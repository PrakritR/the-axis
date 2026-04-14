/*
  Airtable Scripting extension — Manager Availability

  Lists or deletes rows where "Is Recurring" is checked (weekly templates).
  Use after switching the portal to date-only saves, so old weekly rules
  stop copying availability to every matching weekday.

  Table: Manager Availability (rename TABLE_NAME if your base differs).
  For admin meeting windows in a split table, use admin-availability-clear-recurring.js.
*/

const TABLE_NAME = 'Manager Availability'

const table = base.getTable(TABLE_NAME)

const choice = await input.buttonsAsync('What should this script do?', [
  { label: 'List recurring rows only', value: 'list' },
  { label: 'Delete ALL recurring rows (Is Recurring checked)', value: 'delete_all' },
  { label: 'Delete recurring rows for one Property Name', value: 'delete_property' },
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
    const name = String(r.getCellValue('Property Name') ?? '').trim() || '—'
    const day = String(r.getCellValue('Weekday') ?? '').trim() || '—'
    const start = String(r.getCellValue('Start Time') ?? '').trim()
    const end = String(r.getCellValue('End Time') ?? '').trim()
    const em = String(r.getCellValue('Manager Email') ?? '').trim() || '—'
    output.markdown(`- \`${r.id}\` · **${name}** · ${em} · ${day} · ${start} – ${end}`)
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
  const prop = await input.textAsync('Property Name (must match the field exactly, case-insensitive compare here)')
  const needle = String(prop || '').trim().toLowerCase()
  const toDelete = recurringRecords.filter((r) => {
    const n = String(r.getCellValue('Property Name') ?? '').trim().toLowerCase()
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
