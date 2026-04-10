import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
      </PortalAuthPage>
    </>
  )
}
