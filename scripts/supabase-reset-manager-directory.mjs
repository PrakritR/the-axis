#!/usr/bin/env node
/**
 * Destructive: clears Supabase-backed manager directory data used by the admin Managers tab.
 *
 * Steps (order respects FKs):
 *   1) SET properties.managed_by_app_user_id = NULL for all rows that reference a manager
 *   2) DELETE FROM manager_profiles (all rows)
 *   3) DELETE FROM app_user_roles WHERE role = 'manager'
 *
 * Does NOT delete auth.users, app_users rows, or manager_onboarding (invite/checkout records).
 *
 * Usage (from repo `the-axis/`):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/supabase-reset-manager-directory.mjs --force
 *
 * Optional: also wipe onboarding invites
 *   ... node scripts/supabase-reset-manager-directory.mjs --force --with-onboarding
 */

import { createClient } from '@supabase/supabase-js'
import process from 'node:process'

function env(name, ...fallbacks) {
  for (const k of [name, ...fallbacks]) {
    const v = String(process.env[k] || '').trim()
    if (v) return v
  }
  return ''
}

async function main() {
  if (!process.argv.includes('--force')) {
    console.error('Refusing to run: pass --force to confirm destructive deletes.')
    process.exit(1)
  }

  const url = env('SUPABASE_URL', 'VITE_SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const withOnboarding = process.argv.includes('--with-onboarding')

  console.log('[1/3] Clearing properties.managed_by_app_user_id …')
  const { error: e1 } = await supabase
    .from('properties')
    .update({ managed_by_app_user_id: null })
    .not('managed_by_app_user_id', 'is', null)
  if (e1) {
    console.error(e1.message || e1)
    process.exit(1)
  }

  console.log('[2/3] Deleting manager_profiles …')
  const { error: e2 } = await supabase.from('manager_profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (e2) {
    console.error(e2.message || e2)
    process.exit(1)
  }

  console.log('[3/3] Deleting app_user_roles (manager) …')
  const { error: e3 } = await supabase.from('app_user_roles').delete().eq('role', 'manager')
  if (e3) {
    console.error(e3.message || e3)
    process.exit(1)
  }

  if (withOnboarding) {
    console.log('[extra] Truncating manager_onboarding …')
    const { error: e4 } = await supabase
      .from('manager_onboarding')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
    if (e4) {
      console.error(e4.message || e4)
      process.exit(1)
    }
  }

  console.log('Done. Admin Managers tab will be empty until new manager roles are assigned (e.g. manager-create-account / onboarding).')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
