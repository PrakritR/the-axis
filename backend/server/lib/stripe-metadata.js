/**
 * Centralized Stripe metadata standard for all internal payment objects.
 *
 * Stripe limits: 50 keys, key ≤ 40 chars, value ≤ 500 chars.
 * All values must be strings. We truncate long values defensively.
 *
 * axis_payment_key convention:
 *   application_fee → "app_fee_<application_id>"
 *   rent            → "rent_<room_id>_<YYYY-MM>"
 *   security_deposit → "sec_dep_<application_id>"
 *
 * @module
 */

/** Truncate a string value to Stripe's 500-char metadata value limit. */
function s(value, maxLen = 490) {
  if (value == null) return ''
  return String(value).trim().slice(0, maxLen)
}

/**
 * Build standard metadata for an application fee payment.
 *
 * @param {{
 *   application: { id: string, property_id?: string | null, room_id?: string | null }
 *   appUserId: string
 *   propertyName?: string | null
 *   roomNumber?: string | null
 * }} params
 * @returns {Record<string, string>}
 */
export function buildApplicationFeeMetadata({ application, appUserId, propertyName, roomNumber }) {
  return {
    payment_type: 'application_fee',
    application_id: s(application.id),
    app_user_id: s(appUserId),
    property_id: s(application.property_id),
    room_id: s(application.room_id),
    axis_payment_key: `app_fee_${s(application.id)}`,
    property_name: s(propertyName, 200),
    room_number: s(roomNumber, 100),
    environment: s(process.env.NODE_ENV || 'production'),
  }
}

/**
 * Build standard metadata for a generic payment.
 *
 * @param {{
 *   paymentType: string
 *   axisPaymentKey: string
 *   appUserId?: string | null
 *   applicationId?: string | null
 *   propertyId?: string | null
 *   roomId?: string | null
 *   propertyName?: string | null
 *   roomNumber?: string | null
 * }} params
 * @returns {Record<string, string>}
 */
export function buildPaymentMetadata({
  paymentType,
  axisPaymentKey,
  appUserId,
  applicationId,
  propertyId,
  roomId,
  propertyName,
  roomNumber,
}) {
  return {
    payment_type: s(paymentType),
    axis_payment_key: s(axisPaymentKey),
    app_user_id: s(appUserId),
    application_id: s(applicationId),
    property_id: s(propertyId),
    room_id: s(roomId),
    property_name: s(propertyName, 200),
    room_number: s(roomNumber, 100),
    environment: s(process.env.NODE_ENV || 'production'),
  }
}

/**
 * Append all metadata key-value pairs to a URLSearchParams form body.
 * Skips empty-string values.
 *
 * @param {URLSearchParams} form
 * @param {Record<string, string>} metadata
 */
export function appendMetadataToForm(form, metadata) {
  for (const [key, value] of Object.entries(metadata)) {
    if (value) form.append(`metadata[${key}]`, value)
  }
}
