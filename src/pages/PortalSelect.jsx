import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
        if (result.user.role === 'developer') markDeveloperPortalActive()
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
      <p className="text-sm text-slate-600">
        Internal Axis console for site owners, approved staff, and Sentinel developers. Same credentials as{' '}
        <Link to="/admin" className="font-semibold text-[#2563eb] hover:underline">
          /admin
        </Link>
        .
      </p>
      <PortalField label="Work email or developer username">
        <input
          type="text"
          required
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="you@company.com or prakrit"
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

        <div className="mx-auto mt-8 max-w-md rounded-[24px] border border-slate-200 bg-white/80 px-5 py-4 text-center shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Internal (demo)</div>
          <p className="mt-2 text-sm text-slate-600">
            Partner Management portal uses mock data until fully wired. Admin sign-in above uses the same server and local approval flow as{' '}
            <Link to="/admin" className="font-semibold text-[#2563eb] hover:underline">
              /admin
            </Link>
            .
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              to="/management"
              className="rounded-xl border border-[#2563eb]/30 bg-[#2563eb]/5 px-4 py-2.5 text-sm font-semibold text-[#2563eb] transition hover:bg-[#2563eb]/10"
            >
              Axis Management
            </Link>
          </div>
        </div>
      </PortalAuthPage>
    </>
  )
}
