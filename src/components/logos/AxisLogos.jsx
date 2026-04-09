import React from 'react'

export function AxisWordmark({ className = '', tone = 'light', subtitle = 'Axis' }) {
  const isLight = tone === 'light'
  const wordColor = isLight ? '#1f2a44' : '#0f172a'
  const subColor = isLight ? '#64748b' : '#64748b'

  return (
    <svg
      width="164"
      height="40"
      viewBox="0 0 164 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Axis"
      className={className}
    >
      <defs>
        <linearGradient id="axis-wordmark-bg" x1="4" y1="4" x2="40" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#eff6ff" />
          <stop offset="100%" stopColor="#dbeafe" />
        </linearGradient>
        <linearGradient id="axis-wordmark-accent" x1="11" y1="10" x2="32" y2="31" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>

      <rect x="2" y="2" width="36" height="36" rx="12" fill="url(#axis-wordmark-bg)" />
      <rect x="2.75" y="2.75" width="34.5" height="34.5" rx="11.25" stroke="rgba(37,99,235,0.14)" strokeWidth="1.5" />
      <path d="M11.2 27.4 L16.8 11.6 L22.4 27.4" stroke="#1f2a44" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="13.3" y1="22.1" x2="20.3" y2="22.1" stroke="#1f2a44" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="24.6" y1="12" x2="32.2" y2="27.4" stroke="#1f2a44" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="32.2" y1="12" x2="24.6" y2="27.4" stroke="url(#axis-wordmark-accent)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="28.2" cy="19.7" r="1.7" fill="#2563eb" />

      <text x="49" y="18" fill={wordColor} fontFamily="Manrope, ui-sans-serif, system-ui, -apple-system" fontWeight="800" fontSize="15" letterSpacing="3.2">
        AXIS
      </text>
      <text x="49" y="31" fill={subColor} fontFamily="Manrope, ui-sans-serif, system-ui, -apple-system" fontWeight="700" fontSize="9.4" letterSpacing="2.2">
        {subtitle.toUpperCase()}
      </text>
    </svg>
  )
}

export function AxisLogoCrosshair({ className = '' }) {
  return (
    <svg width="90" height="36" viewBox="0 0 90 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Axis" className={className}>
      <defs>
        <radialGradient id="axis-crosshair-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M2 28 L10 8 L18 28" stroke="#0f172a" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="5.2" y1="22" x2="14.8" y2="22" stroke="#0f172a" strokeWidth="2.8" strokeLinecap="round" />
      <line x1="24" y1="8" x2="36" y2="28" stroke="#0f172a" strokeWidth="2.8" strokeLinecap="round" />
      <line x1="36" y1="8" x2="24" y2="28" stroke="#0f172a" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="30" cy="18" r="5" fill="url(#axis-crosshair-glow)" />
      <circle cx="30" cy="18" r="2" fill="#14b8a6" />
      <line x1="43" y1="8" x2="43" y2="28" stroke="#0f172a" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M52 12 C52 9.8 53.8 8 56 8 L60 8 C62.2 8 64 9.8 64 12 C64 14.2 62.2 16 60 16 L56 16 C53.8 16 52 17.8 52 20 C52 22.2 53.8 24 56 24 L60 24 C62.2 24 64 22.2 64 20" stroke="#0f172a" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AxisLogoOrbit({ className = '' }) {
  return (
    <svg width="186" height="40" viewBox="0 0 220 46" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Axis" className={className}>
      <text x="50" y="29" fill="#1f2a44" fontFamily="ui-sans-serif, system-ui, -apple-system" fontWeight="900" fontSize="34" letterSpacing="2.2">AXIS</text>
      <path d="M30 33 C 57 41, 100 43, 145 40 C 172 38, 192 34, 204 29" stroke="#0f8ea1" strokeWidth="4.6" strokeLinecap="round" />
      <path d="M34 37 C 67 44, 114 45, 159 42 C 183 40, 199 36, 208 32" stroke="#2fb8ad" strokeWidth="3.8" strokeLinecap="round" />
    </svg>
  )
}

export function AxisLogoFrame({ className = '' }) {
  return (
    <svg width="98" height="36" viewBox="0 0 98 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Axis" className={className}>
      <defs>
        <linearGradient id="axis-frame-bg" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      <rect x="0.8" y="0.8" width="34.4" height="34.4" rx="10" fill="url(#axis-frame-bg)" />
      <rect x="0.8" y="0.8" width="34.4" height="34.4" rx="10" stroke="white" strokeOpacity="0.14" strokeWidth="1.6" />
      <path d="M8.5 25.8 L13.5 10.2 L18.5 25.8" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="10.4" y1="20.8" x2="16.6" y2="20.8" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="20.8" y1="10.2" x2="28" y2="25.8" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="28" y1="10.2" x2="20.8" y2="25.8" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="24.4" cy="18" r="1.7" fill="#14b8a6" />
      <text x="43" y="15" fill="#0f172a" fontFamily="ui-sans-serif, system-ui, -apple-system" fontWeight="800" fontSize="11" letterSpacing="2.2">AXIS</text>
      <text x="43" y="27" fill="#64748b" fontFamily="ui-sans-serif, system-ui, -apple-system" fontWeight="700" fontSize="8" letterSpacing="1.5">MODERN HOUSING</text>
    </svg>
  )
}

export function AxisLogoFusion({ className = '' }) {
  return (
    <svg width="106" height="40" viewBox="0 0 106 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Axis" className={className}>
      <defs>
        <linearGradient id="axis-fusion-navy" x1="4" y1="4" x2="40" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1e3a5f" />
          <stop offset="100%" stopColor="#0f2f4e" />
        </linearGradient>
        <linearGradient id="axis-fusion-teal" x1="10" y1="10" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#14b8a6" />
        </linearGradient>
      </defs>

      <g transform="translate(0 0)">
        <path d="M4 22.5 L22 4 L40 22.5" stroke="url(#axis-fusion-navy)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.5 22.5 V35 H16" stroke="url(#axis-fusion-navy)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M35.5 22.5 V35 H28" stroke="url(#axis-fusion-navy)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

        <path d="M13 29.5 L19.6 14.3 L26.2 29.5" stroke="url(#axis-fusion-navy)" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="15.5" y1="24.2" x2="23.7" y2="24.2" stroke="url(#axis-fusion-navy)" strokeWidth="3.1" strokeLinecap="round" />
        <line x1="19.2" y1="15" x2="31.5" y2="31" stroke="url(#axis-fusion-teal)" strokeWidth="3.1" strokeLinecap="round" />
        <line x1="31.5" y1="15" x2="19.2" y2="31" stroke="url(#axis-fusion-navy)" strokeWidth="3.1" strokeLinecap="round" />

        <path d="M9.5 27 C12 14.8 21 9.3 33 12.8" stroke="#14b8a6" strokeOpacity="0.75" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M11.3 30 C16.5 13.5 28 10.8 37 18" stroke="#0ea5e9" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="31.4" cy="18.5" r="1.9" fill="#14b8a6" />
      </g>

      <g transform="translate(49 0)">
        <text x="0" y="17" fill="#0f172a" fontFamily="ui-sans-serif, system-ui, -apple-system" fontWeight="900" fontSize="12" letterSpacing="2.1">AXIS</text>
        <text x="0" y="30" fill="#64748b" fontFamily="ui-sans-serif, system-ui, -apple-system" fontWeight="700" fontSize="8.2" letterSpacing="1.4">MODERN HOUSING</text>
      </g>
    </svg>
  )
}
