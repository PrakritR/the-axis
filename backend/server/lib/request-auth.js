/**
 * Shared request authentication helper.
 * Combines Supabase JWT verification + internal app_user lookup into one call.
 *
 * Usage:
 *   const { ok, appUser } = await authenticateAndLoadAppUser(req, res)
 *   if (!ok) return  // response already sent
 *
 * @module
 */

import { authenticateSupabaseBearerRequest } from './supabase-bearer-auth.js'
import { getAppUserByAuthUserId } from './app-users-service.js'

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<{ ok: true; appUser: object } | { ok: false }>}
 */
export async function authenticateAndLoadAppUser(req, res) {
  const auth = await authenticateSupabaseBearerRequest(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return { ok: false }
  }

  const appUser = await getAppUserByAuthUserId(auth.user.id)
  if (!appUser?.id) {
    res.status(409).json({
      error: 'No internal app user yet. Call POST /api/sync-app-user with this session first.',
    })
    return { ok: false }
  }

  return { ok: true, appUser }
}
