import React from 'react'

// Simple amenity icon helper — returns an inline SVG based on amenity keywords
export function getAmenityIcon(label, size = 'md'){
  const l = (label||'').toLowerCase()
  const cls = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7'
  // use stroke/currentColor so color can be applied consistently via CSS
  if (l.includes('walk') || l.includes('campus')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 7v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M12 10l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M12 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M12 12l-2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M12 12l3 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )
  }
  if (l.includes('in-unit') || l.includes('washer') || l.includes('w/d') || l.includes('laundry')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="12" cy="11" r="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 18h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )
  }
  if (l.includes('clean') || l.includes('cleaning')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <path d="M6 19l6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M11 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M15 4l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M3 21l4-1 1-4-4 1-1 4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    )
  }
  if (l.includes('wifi') || l.includes('internet')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <path d="M3 11c6-5 12-5 18 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M6 14c4-3 8-3 12 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="12" cy="19" r="1.5" fill="currentColor"/>
      </svg>
    )
  }
  if (l.includes('public') || l.includes('transport')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <rect x="3" y="5" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="7.5" cy="17.5" r="1.5" fill="currentColor"/>
        <circle cx="16.5" cy="17.5" r="1.5" fill="currentColor"/>
      </svg>
    )
  }
  if (l.includes('package') || l.includes('storage')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M3 11h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )
  }
  if (l.includes('park') || l.includes('street')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <path d="M3 12h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M6 12v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <rect x="14" y="8" width="5" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="16.5" cy="17.5" r="1.2" fill="currentColor"/>
      </svg>
    )
  }
  if (l.includes('refrigerator') || l.includes('fridge')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 7h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )
  }
  if (l.includes('microwave')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="17" cy="12" r="1" fill="currentColor"/>
      </svg>
    )
  }
  if (l.includes('stove') || l.includes('oven') || l.includes('dishwasher') || l.includes('dish')) {
    // stove/oven/dishwasher generic kitchen icon
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <rect x="3" y="4" width="18" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="3" y="12" width="18" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    )
  }
  if (l.includes('desk')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <rect x="3" y="8" width="18" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M6 14v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M18 14v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )
  }
  if (l.includes('bed')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <rect x="3" y="7" width="18" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M3 13v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M21 13v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )
  }
  if (l.includes('heat') || l.includes('heating')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <path d="M12 3s4 3 4 6a4 4 0 0 1-8 0c0-3 4-6 4-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }
  if (l.includes('ac') || l.includes('a/c') || l.includes('air')) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
        <path d="M12 3v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M12 15v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    )
  }
  // fallback small teal dot
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{color:'#18B7B5'}}>
      <circle cx="12" cy="12" r="3" fill="currentColor"/>
    </svg>
  )
}
