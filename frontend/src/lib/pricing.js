function parseMonthlyRentValue(value) {
  if (!value) return null
  const match = String(value).match(/\$([\d,]+)/)
  if (!match) return null
  const amount = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(amount) ? amount : null
}

/** Strip /mo and keep string only if it still looks like a dollar amount (avoids “View listing” on cards). */
function rentStringForCardOverlay(raw) {
  const s = String(raw || '')
    .replace(/\/mo(?:nth)?/gi, '')
    .trim()
  if (!s) return ''
  return /\$[\d,]+/.test(s) ? s : ''
}

// Returns plain dollar range with no unit suffix, e.g. "$725" or "$725–$850"
// Callers are responsible for appending "/mo" or "/month" as needed.
export function getPropertyRentRange(property) {
  const roomPrices = (property?.roomPlans || [])
    .flatMap((plan) => plan.rooms || [])
    .map((room) => parseMonthlyRentValue(room.price))
    .filter((value) => Number.isFinite(value))

  if (roomPrices.length === 0) {
    return rentStringForCardOverlay(property?.rent)
  }

  const min = Math.min(...roomPrices)
  const max = Math.max(...roomPrices)
  if (min === max) return `$${min}`
  return `$${min}–$${max}`
}

// Returns plain starting dollar amount with no unit suffix, e.g. "$725"
export function getStartingRent(property) {
  const roomPrices = (property?.roomPlans || [])
    .flatMap((plan) => plan.rooms || [])
    .map((room) => parseMonthlyRentValue(room.price))
    .filter((value) => Number.isFinite(value))

  if (roomPrices.length === 0) {
    return rentStringForCardOverlay(property?.rent)
  }
  return `$${Math.min(...roomPrices)}`
}
