import { Link } from 'react-router-dom'
import { PORTAL_BUBBLE_SURFACE } from './PortalBubble'

/**
 * Bright blue Portal bubble for main + owners headers.
 */
export default function PortalNavLink({ onClick, isActive }) {
  return (
    <Link
      to="/portal"
      onClick={onClick}
      className={`${PORTAL_BUBBLE_SURFACE}${isActive ? ' !ring-white/95 !ring-offset-2 !ring-offset-[#2563eb]' : ''}`}
    >
      Portal
    </Link>
  )
}
