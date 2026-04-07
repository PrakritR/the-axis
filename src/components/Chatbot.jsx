import React, { useState, useRef, useEffect, useCallback } from 'react'
import { properties } from '../data/properties'

function buildSystemPrompt() {
  const propDetails = properties.map(p => {
    const rooms = (p.roomPlans || []).flatMap(plan => plan.rooms || [])
    const roomDesc = rooms.map(r =>
      `    - ${r.name}: ${r.price} — ${r.available || 'check availability'}${r.details ? ` (${r.details})` : ''}`
    ).join('\n')

    const leaseDesc = (p.leaseTerms || []).map(t =>
      `    - ${t.type}: ${t.startingAt}, move-in ${t.moveInLabel || t.moveIn} → move-out ${t.moveOutLabel || t.moveOut}${t.fixedDates ? ' [fixed dates]' : t.flexibleMoveIn ? ' [flexible start — Sep 15 recommended]' : ''}`
    ).join('\n')

    const pkgDesc = (p.leasingPackages || []).map(pkg =>
      `    - ${pkg.title}: ${pkg.totalRent} — ${pkg.details}`
    ).join('\n')

    return `### ${p.name} (${p.address})
- Type: ${p.type} | ${p.beds} bedrooms, ${p.baths} baths
- Rent range: ${p.rent}
- Application fee: ${p.applicationFee || '$50'}
- Utilities: ${p.utilitiesFee || '$175'}/mo — covers bi-monthly cleaning, WiFi, water & trash${p.securityDeposit ? `\n- Security deposit: ${p.securityDeposit}` : ''}
- Policies: ${p.policies || 'Contact leasing for details'}

Rooms:
${roomDesc || '    Contact leasing for room details'}

Lease Terms:
${leaseDesc || '    Contact leasing for lease details'}

Group Packages:
${pkgDesc || '    N/A'}`
  }).join('\n\n---\n\n')

  return `You are an Axis Housing leasing assistant. Axis is a student-focused shared housing company in Seattle's University District. Be helpful, warm, and concise.

IMPORTANT: The property data below is your live source of truth. Always use it. Never guess pricing or availability.

## Current Properties

${propDetails}

## Leasing Rules
- All three properties offer 3-Month Summer, 9-Month Academic, and 12-Month lease options.
- Summer (Jun 16) and Academic (Sep 15) start dates are fixed.
- 12-Month start date is flexible — September 15 recommended for students.
- Any non-standard start date carries a +$25/month surcharge.
- Custom date ranges (e.g. May–August) are possible with the +$25/month flexible date surcharge. Suggest contacting leasing to confirm.
- Rooms come fully furnished (desk, bed, heating, AC). No separate furnishing fee.

## Group Leasing
- Multiple rooms can be rented together. Friend groups and roommates are welcome.
- Floor packages available at grouped rates (see packages above).
- Each occupant pays their own room's rent + $175/mo utilities.
- 5259 Brooklyn is popular for friend groups due to grouped room packages.

## All Properties Include
- Walk to University of Washington campus
- In-unit washer/dryer
- Bi-monthly professional cleaning (included in $175/mo utilities)
- WiFi, full kitchen, public transportation access
- Furnished rooms: desk, bed, heating, AC

## Application
- Apply at theaxishousing.com/apply · $50 application fee
- Tours & contact: theaxishousing.com/contact or call 510-309-8345

Keep answers short and direct. For custom date arrangements, suggest contacting leasing.`
}

const SYSTEM_PROMPT = buildSystemPrompt()

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-2.0-flash-lite'

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december']

function getLocalFallbackReply(question) {
  const text = question.toLowerCase()

  const hasMonth = MONTHS.some(m => text.includes(m))
  const isMoveInQ = text.includes('move in') || text.includes('move-in') || text.includes('start') || text.includes('begin') || text.includes('from') || hasMonth
  const isAvailQ = text.includes('avail') || text.includes('when') || isMoveInQ

  if (isAvailQ) {
    return 'Here\'s what\'s currently available:\n\n**4709B 8th Ave NE** — all 9 rooms available now ($775–$800/mo)\n\n**5259 Brooklyn Ave NE** — all rooms available after April 14, 2026 ($800–$865/mo)\n\n**4709A 8th Ave NE** — select rooms from Aug–Sep 2026 ($750–$875/mo)\n\nNeed a specific date? Custom move-in dates are possible with a +$25/month flexible date surcharge. Contact us to confirm: **theaxishousing.com/contact** or **510-309-8345**.'
  }

  if (text.includes('room') || text.includes('bedroom') || text.includes('floor')) {
    return 'All three properties are shared housing near UW:\n- **4709A** — 10 bedrooms, 3.5 baths ($750–$875/mo)\n- **4709B** — 9 bedrooms, 2.5 baths ($775–$800/mo)\n- **5259 Brooklyn** — 9 bedrooms, 3 baths ($800–$865/mo)\n\nAll rooms are furnished (desk, bed, heating, AC). No extra furnishing fee.'
  }

  if (text.includes('rent') || text.includes('price') || text.includes('pric') || text.includes('cost') || text.includes('how much') || text.includes('fee') || text.includes('pay')) {
    return 'Room prices by property:\n- **4709A** 8th Ave: $750–$875/mo\n- **4709B** 8th Ave: $775–$800/mo\n- **5259 Brooklyn**: $800–$865/mo\n\nUtilities: flat **$175/mo** (covers bi-monthly cleaning, WiFi, water & trash). Application fee: $50. Rooms come furnished — no furnishing fee.'
  }

  if (text.includes('apply') || text.includes('application') || text.includes('sign') || text.includes('process')) {
    return 'Apply directly from the **Apply page** on this site at theaxishousing.com/apply. The application fee is $50. We typically respond within 2 business days.'
  }

  if (text.includes('tour') || text.includes('visit') || text.includes('schedule') || text.includes('view') || text.includes('show')) {
    return 'To schedule a tour, visit the **Contact page** or call/text us at **510-309-8345**. Both in-person and virtual tours are available.'
  }

  if (text.includes('includ') || text.includes('ameniti') || text.includes('util') || text.includes('wifi') || text.includes('internet') || text.includes('clean') || text.includes('laundry')) {
    return 'All properties include:\n- Walk to UW campus\n- In-unit washer/dryer\n- Bi-monthly professional cleaning\n- WiFi, full kitchen, public transit access\n- Furnished rooms (desk, bed, heating, AC)\n\nAll included in a flat **$175/mo utilities** fee.'
  }

  if (text.includes('lease') || text.includes('term') || text.includes('summer') || text.includes('academic') || text.includes('month') || text.includes('long')) {
    return 'Three lease options for all properties:\n- **3-Month Summer**: Jun 16 – Sep 14 (fixed dates)\n- **9-Month Academic**: Sep 15 – Jun 15 (fixed dates)\n- **12-Month**: flexible start (Sep 15 recommended)\n\n+$25/month for non-standard start dates.'
  }

  if (text.includes('group') || text.includes('friend') || text.includes('roommate') || text.includes('together') || text.includes('two') || text.includes('couple') || text.includes('share') || text.includes('multiple')) {
    return 'Yes — multiple rooms can be rented together! Friend groups and roommates are welcome.\n\nFloor packages are available at grouped rates. Each person pays their own room\'s rent + $175/mo utilities. **5259 Brooklyn** is especially popular for groups.\n\nContact us at 510-309-8345 or theaxishousing.com/contact for details.'
  }

  if (text.includes('deposit') || text.includes('security')) {
    return '**5259 Brooklyn Ave NE** requires a $600 security deposit.\n**4709A and 4709B** do not have a security deposit.'
  }

  if (text.includes('address') || text.includes('location') || text.includes('where') || text.includes('uw') || text.includes('campus') || text.includes('university') || text.includes('seattle')) {
    return 'All properties are in Seattle\'s **University District**, walking distance to UW:\n- **4709A & 4709B** — 8th Ave NE\n- **5259** — Brooklyn Ave NE\n\nAll are close to campus, the Ave, light rail, and transit.'
  }

  if (text.includes('contact') || text.includes('phone') || text.includes('email') || text.includes('reach') || text.includes('call') || text.includes('text')) {
    return 'Reach us at:\n- **Phone/text:** 510-309-8345\n- **Online:** theaxishousing.com/contact\n\nWe\'re happy to answer questions, schedule tours, or walk you through the application!'
  }

  if (text.includes('hi') || text.includes('hello') || text.includes('hey') || text.includes('good morning') || text.includes('good afternoon')) {
    return 'Hi there! I\'m the Axis Housing leasing assistant. I can help with room availability, pricing, lease terms, amenities, and how to apply. What would you like to know?'
  }

  // Generic catch-all — give them something useful instead of a non-answer
  return 'Happy to help! Here\'s a quick overview:\n\n- **Rooms:** $750–$875/mo across 3 properties near UW\n- **Utilities:** $175/mo flat (cleaning, WiFi, water & trash included)\n- **Leases:** 3-month summer, 9-month academic, or 12-month\n- **Apply:** theaxishousing.com/apply\n\nFor anything specific, reach us at **510-309-8345** or theaxishousing.com/contact.'
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function renderContent(text) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g)
    return (
      <React.Fragment key={i}>
        {i > 0 && <br />}
        {parts.map((part, j) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={j}>{part.slice(2, -2)}</strong>
            : part
        )}
      </React.Fragment>
    )
  })
}

function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2Z" />
    </svg>
  )
}

export default function Chatbot() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 120)
    }
  }, [open])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    setInput('')
    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setStreaming(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      if (!GEMINI_API_KEY) {
        throw new Error('Missing VITE_GEMINI_API_KEY')
      }

      const geminiContents = newMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: geminiContents,
            generationConfig: { maxOutputTokens: 1024 },
          }),
        }
      )

      if (!response.ok) {
        const errBody = await response.text()
        throw new Error(`HTTP ${response.status}: ${errBody}`)
      }

      const data = await response.json()
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

      if (!reply) throw new Error('Empty response from API')

      // Simulate streaming by revealing text progressively
      let displayed = ''
      const words = reply.split(' ')
      for (let i = 0; i < words.length; i++) {
        if (controller.signal.aborted) break
        displayed += (i === 0 ? '' : ' ') + words[i]
        const snapshot = displayed
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: snapshot }
          return updated
        })
        if (i % 3 === 2) await new Promise(r => setTimeout(r, 18))
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Chatbot error:', err)
        const fallback = getLocalFallbackReply(text)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: fallback,
          }
          return updated
        })
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, messages, streaming])

  const handleKey = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }, [send])

  const handleClose = useCallback(() => {
    setOpen(false)
    abortRef.current?.abort()
  }, [])

  const isEmpty = messages.length === 0

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={open ? 'Close chat' : 'Open leasing assistant'}
        className="fixed z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0ea5a4] chatbot-fab"
        style={{
          background: 'linear-gradient(135deg, #0ea5a4 0%, #0b8a89 100%)',
          color: 'white',
          boxShadow: '0 4px 20px rgba(14,165,164,0.4)',
          bottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
          right: 'calc(1.5rem + env(safe-area-inset-right))',
        }}
      >
        <div className="transition-all duration-200" style={{ transform: open ? 'rotate(90deg) scale(0.85)' : 'rotate(0deg) scale(1)' }}>
          {open ? <CloseIcon /> : <ChatIcon />}
        </div>
        {!open && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
            style={{ background: '#0ea5a4', border: '2px solid white', color: 'white' }}>
            AI
          </span>
        )}
      </button>

      <div
        role="dialog"
        aria-label="Leasing assistant"
        aria-modal="true"
        className="fixed z-50 flex flex-col rounded-2xl overflow-hidden transition-all duration-300 origin-bottom-right chatbot-panel"
        style={{
          width: 'min(380px, calc(100vw - 2rem))',
          height: 'min(540px, calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 8rem))',
          bottom: 'calc(6rem + env(safe-area-inset-bottom))',
          right: 'calc(1.5rem + env(safe-area-inset-right))',
          background: 'white',
          boxShadow: '0 8px 40px rgba(15,23,42,0.18), 0 2px 8px rgba(15,23,42,0.08)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transform: open ? 'scale(1) translateY(0)' : 'scale(0.92) translateY(12px)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: 'linear-gradient(135deg, #0ea5a4 0%, #0b8a89 100%)' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }}>
            <SparkleIcon />
          </div>
          <div className="min-w-0">
            <div className="text-white font-semibold text-sm leading-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>Axis Assistant</div>
            <div className="text-xs leading-tight" style={{ color: 'rgba(255,255,255,0.75)' }}>Ask about rooms, pricing & availability</div>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close chat"
            className="ml-auto p-1 rounded-lg transition-colors hover:bg-white/20 text-white focus:outline-none"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0" style={{ background: '#f8fafc' }}>
          {isEmpty && (
            <div className="flex flex-col items-center justify-center h-full text-center px-2 gap-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0ea5a4 0%, #0b8a89 100%)' }}>
                <ChatIcon />
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>Hi! I'm your leasing assistant.</p>
                <p className="text-slate-500 text-xs leading-relaxed">Ask me about rooms, pricing, availability, or how to apply.</p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                {['What rooms are available now?', "What's included in rent?", 'How do I apply?'].map(q => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50) }}
                    className="text-left text-xs px-3 py-2 rounded-xl border transition-colors hover:border-[#0ea5a4] hover:text-[#0ea5a4] hover:bg-teal-50 focus:outline-none"
                    style={{ borderColor: '#e2e8f0', color: '#475569', background: 'white', fontFamily: 'Manrope, sans-serif' }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed"
                style={{
                  fontFamily: 'Manrope, sans-serif',
                  ...(msg.role === 'user'
                    ? { background: 'linear-gradient(135deg, #0ea5a4, #0b8a89)', color: 'white', borderBottomRightRadius: '4px' }
                    : {
                        background: msg.error ? '#fef2f2' : 'white',
                        color: msg.error ? '#991b1b' : '#1e293b',
                        border: `1px solid ${msg.error ? '#fecaca' : '#e2e8f0'}`,
                        borderBottomLeftRadius: '4px',
                        boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
                      }),
                }}
              >
                {msg.content
                  ? renderContent(msg.content)
                  : (
                    <span className="flex gap-1 items-center py-0.5">
                      {[0, 1, 2].map(d => (
                        <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#94a3b8', animationDelay: `${d * 0.15}s` }} />
                      ))}
                    </span>
                  )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-3 py-3 border-t" style={{ borderColor: '#e2e8f0', background: 'white' }}>
          <div className="flex items-end gap-2 rounded-xl border px-3 py-2 transition-colors focus-within:border-[#0ea5a4]" style={{ borderColor: '#e2e8f0' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about rooms, pricing…"
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none leading-relaxed disabled:opacity-60"
              style={{ fontFamily: 'Manrope, sans-serif', maxHeight: '80px', overflowY: 'auto' }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || streaming}
              aria-label="Send message"
              className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95 focus:outline-none"
              style={{ background: input.trim() && !streaming ? 'linear-gradient(135deg, #0ea5a4, #0b8a89)' : '#e2e8f0', color: input.trim() && !streaming ? 'white' : '#94a3b8' }}
            >
              <SendIcon />
            </button>
          </div>
          <p className="text-center text-[10px] mt-2" style={{ color: '#94a3b8', fontFamily: 'Manrope, sans-serif' }}>Powered by Gemini · Axis Housing</p>
        </div>
      </div>
    </>
  )
}
