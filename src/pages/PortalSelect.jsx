import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  PortalAuthCard,
  PortalAuthPage,
  PortalField,
  PortalNotice,
  PortalPasswordInput,
  PortalPrimaryButton,
  PortalSegmentedControl,
  portalAuthInputCls,
} from '../components/PortalAuthUI'
import { Seo } from '../lib/seo'
import { authenticateAdminPortal } from '../lib/adminPortalSignIn'
import { markDeveloperPortalActive } from '../lib/developerPortal'
import { AXIS_ADMIN_SESSION_KEY } from '../axis-internal/adminSessionConstants'
import { ManagerAuthForm, MANAGER_SESSION_KEY } from './Manager'
import { ResidentAuthForm } from './Resident'

const RESIDENT_SESSION_KEY = 'axis_resident'

function portalTypeFromQuery(searchParams) {
  const p = String(searchParams.get('portal') || searchParams.get('type') || '').toLowerCase()
  if (p === 'manager') return 'manager'
  if (p === 'admin') return 'admin'
  return 'resident'
}

function AdminPortalAuthForm({ onSuccess }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const result = await authenticateAdminPortal(identifier, password)
      if (result.ok) {
        sessionStorage.setItem(AXIS_ADMIN_SESSION_KEY, JSON.stringify(result.user))
        if (
          result.user.role === 'ceo' ||
          result.user.role === 'internal_exec' ||
          result.user.role === 'internal_swe'
        ) {
          markDeveloperPortalActive()
        }
        onSuccess()
        return
      }
      setErr(result.error || 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-0 space-y-4">
      <PortalField label="Email">
        <input
          type="email"
          required
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="you@company.com"
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
      {err ? (
        <PortalNotice tone="error">
          {err}
        </PortalNotice>
      ) : null}
      <PortalPrimaryButton type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in to Admin'}
      </PortalPrimaryButton>
    </form>
  )
}

export default function PortalSelect() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [portalType, setPortalType] = useState(() => portalTypeFromQuery(searchParams))

  useEffect(() => {
    setPortalType(portalTypeFromQuery(searchParams))
  }, [searchParams])

  const isResident = portalType === 'resident'
  const isManager = portalType === 'manager'
  const isAdmin = portalType === 'admin'

  const cardTitle = isResident ? 'Resident portal' : isManager ? 'Manager portal' : 'Admin portal'

  function handleResidentLogin(resident) {
    sessionStorage.setItem(RESIDENT_SESSION_KEY, resident.id)
    navigate('/resident')
  }

  function handleManagerLogin(manager) {
    sessionStorage.setItem(MANAGER_SESSION_KEY, JSON.stringify(manager))
    navigate('/manager')
  }

  function handleAdminLoginSuccess() {
    navigate('/admin')
  }

  return (
    <>
      <Seo
        title="Portal | Axis"
        description="Sign in to the resident, manager, or admin portal."
        pathname="/portal"
      />
      <PortalAuthPage dense>
        <PortalAuthCard title={cardTitle}>
          <PortalSegmentedControl
            tabs={[
              ['resident', 'Resident'],
              ['manager', 'Manager'],
              ['admin', 'Admin'],
            ]}
            active={portalType}
            onChange={setPortalType}
          />

          <div className="mt-6">
            {isResident ? (
              <ResidentAuthForm onLogin={handleResidentLogin} variant="portal-entry" />
            ) : isManager ? (
              <ManagerAuthForm onLogin={handleManagerLogin} variant="portal-entry" />
            ) : (
              <AdminPortalAuthForm onSuccess={handleAdminLoginSuccess} />
            )}
          </div>
        </PortalAuthCard>
      </PortalAuthPage>
    </>
  )
}
