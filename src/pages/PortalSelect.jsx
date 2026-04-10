import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PortalAuthCard,
  PortalAuthPage,
  PortalSegmentedControl,
} from '../components/PortalAuthUI'
import { Seo } from '../lib/seo'
import { ManagerAuthForm, MANAGER_SESSION_KEY } from './Manager'
import { ResidentAuthForm } from './Resident'

const RESIDENT_SESSION_KEY = 'axis_resident'

export default function PortalSelect() {
  const navigate = useNavigate()
  const [portalType, setPortalType] = useState('resident')

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
