/**
 * Bright blue “Portal” pill used in nav, portal hub, footer, and manager login.
 * `bg-axis-portal` is defined in tailwind.config (vivid gradient).
 */
export const PORTAL_BUBBLE_SURFACE =
  'inline-flex shrink-0 items-center justify-center rounded-full border-0 bg-axis-portal px-3.5 py-2 text-xs font-bold !text-white no-underline shadow-[0_10px_36px_rgba(56,189,248,0.45),0_6px_20px_rgba(37,99,235,0.35)] ring-2 ring-sky-200/70 transition [transition-property:filter,box-shadow] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] visited:!text-white sm:px-5 sm:text-sm'

export default function PortalBubble({ as: Component = 'span', className = '', children = 'Portal', ...props }) {
  return (
    <Component className={`${PORTAL_BUBBLE_SURFACE} ${className}`.trim()} {...props}>
      {children}
    </Component>
  )
}
