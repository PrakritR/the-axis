import { useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  PortalAuthCard,
  PortalAuthPage,
  PortalField,
  PortalNotice,
  PortalPasswordInput,
  PortalPrimaryButton,
  portalAuthInputCls,
} from '../components/PortalAuthUI'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        setError(authError.message || 'Sign in failed. Check your email and password.')
      } else {
        setSuccess(true)
      }
    } catch (err) {
      setError(err?.message || 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <PortalAuthPage>
        <PortalAuthCard title="Signed in">
          <PortalNotice tone="success">
            You are now signed in. Role-based routing will be wired up next.
          </PortalNotice>
        </PortalAuthCard>
      </PortalAuthPage>
    )
  }

  return (
    <PortalAuthPage>
      <PortalAuthCard title="Sign in">
        <form onSubmit={handleSubmit} className="space-y-4">
          <PortalField label="Email">
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={portalAuthInputCls}
            />
          </PortalField>

          <PortalField label="Password">
            <PortalPasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </PortalField>

          {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}

          <PortalPrimaryButton type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </PortalPrimaryButton>
        </form>
      </PortalAuthCard>
    </PortalAuthPage>
  )
}
