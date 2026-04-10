import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PortalAuthCard,
  PortalAuthPage,
  PortalFooterLink,
  PortalSegmentedControl,
} from '../components/PortalAuthUI'
import { Seo } from '../lib/seo'
import { ManagerAuthForm } from './Manager'
import { ResidentAuthForm } from './Resident'

const RESIDENT_SESSION_KEY = 'axis_resident'
const MANAGER_SESSION_KEY = 'axis_manager'

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
      <PortalAuthPage>
        <PortalAuthCard
          title={isResident ? 'Resident portal' : 'Manager portal'}
          footer={
            isResident ? (
              <PortalFooterLink prefix="Manager?" linkLabel="Sign in at /manager" to="/manager" />
            ) : (
              <PortalFooterLink prefix="Resident?" linkLabel="Sign in at /resident" to="/resident" />
            )
          }
        >
          <PortalSegmentedControl
            tabs={[
              ['resident', 'Resident portal'],
              ['manager', 'Manager portal'],
            ]}
            active={portalType}
            onChange={setPortalType}
          />

          {isResident ? (
            <ResidentAuthForm onLogin={handleResidentLogin} />
          ) : (
            <ManagerAuthForm onLogin={handleManagerLogin} />
          )}
        </PortalAuthCard>
      </PortalAuthPage>
    </>
  )
}
