import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  PortalAuthCard,
  PortalAuthPage,
  PortalSegmentedControl,
} from '../components/PortalAuthUI'
import { Seo } from '../lib/seo'
import { ManagerAuthForm, MANAGER_SESSION_KEY } from './Manager'
import { ResidentAuthForm } from './Resident'

const RESIDENT_SESSION_KEY = 'axis_resident'

function isManagerPortalQuery(searchParams) {
  const p = String(searchParams.get('portal') || searchParams.get('type') || '').toLowerCase()
  return p === 'manager'
}

export default function PortalSelect() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [portalType, setPortalType] = useState(() => (isManagerPortalQuery(searchParams) ? 'manager' : 'resident'))

  useEffect(() => {
    if (isManagerPortalQuery(searchParams)) setPortalType('manager')
  }, [searchParams])

  const isResident = portalType === 'resident'

  function handleResidentLogin(resident) {
    sessionStorage.setItem(RESIDENT_SESSION_KEY, resident.id)
    navigate('/resident')
  }

  function handleManagerLogin(manager) {
    sessionStorage.setItem(MANAGER_SESSION_KEY, JSON.stringify(manager))
    navigate('/manager')
  }

  return (
    <>
      <Seo
        title="Portal | Axis"
        description="Sign in to the resident or manager portal."
        pathname="/portal"
      />
      <PortalAuthPage dense>
        <PortalAuthCard title={isResident ? 'Resident portal' : 'Manager portal'}>
          <PortalSegmentedControl
            tabs={[
              ['resident', 'Resident portal'],
              ['manager', 'Manager portal'],
            ]}
            active={portalType}
            onChange={setPortalType}
          />

          <div className="mt-6">
            {isResident ? (
              <ResidentAuthForm onLogin={handleResidentLogin} variant="portal-entry" />
            ) : (
              <ManagerAuthForm onLogin={handleManagerLogin} variant="portal-entry" />
            )}
          </div>
        </PortalAuthCard>

        <div className="mx-auto mt-8 max-w-md rounded-[24px] border border-slate-200 bg-white/80 px-5 py-4 text-center shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Internal (demo)</div>
          <p className="mt-2 text-sm text-slate-600">
            New partner portal and Axis admin console — mock data until Airtable is wired.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              to="/management"
              className="rounded-xl border border-[#2563eb]/30 bg-[#2563eb]/5 px-4 py-2.5 text-sm font-semibold text-[#2563eb] transition hover:bg-[#2563eb]/10"
            >
              Axis Management
            </Link>
            <Link
              to="/admin"
              className="rounded-xl border border-slate-300 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Axis Admin
            </Link>
          </div>
        </div>
      </PortalAuthPage>
    </>
  )
}
