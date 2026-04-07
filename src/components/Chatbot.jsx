import React, { useState, useRef, useEffect, useCallback } from 'react'

const SYSTEM_PROMPT = `You are an Axis Housing leasing assistant. Axis is a student-focused shared housing company in Seattle's University District. Be helpful, warm, and concise. Answer questions about properties, pricing, availability, amenities, and the application process.

## Properties

### 4709A 8th Ave NE (University District)
- **Type:** Affordable shared housing | 10 bedrooms, 3.5 baths
- **Rent:** $750–$875/month
- **Layout:** 3 floors. Room 9 ($750/mo, Floor 1). Room 10 ($875/mo, Floor 1, private bath). Rooms 1–4 ($775/mo, Floor 2). Rooms 5–8 ($775/mo, Floor 3).
- **Availability:** Room 9 (Sep 1 2026+), Room 10 (Aug 10 2026+), Rooms 2 & 4 (Sep 2026+), Room 1 (Jan 2027+), Room 3 (unavailable), Room 8 (Mar–May 2026 then Aug 2026+), Rooms 5–7 (unavailable).
- **Fees:** App $50 · Utilities $175/mo (includes cleaning, WiFi, water & trash)
- **Leasing packages:** Full 2nd floor $3,100/mo; Full 3rd floor $3,100/mo
- **Lease terms:** 3-Month Summer (Jun 16–Sep 14, $750/mo), 9-Month Academic (Sep 15–Jun 15, $775/mo), 12-Month (flexible start — Sep 15 recommended, $775/mo)

### 4709B 8th Ave NE (University District)
- **Type:** Affordable shared housing | 9 bedrooms, 2.5 baths
- **Rent:** $775–$800/month
- **Lease terms:** 3-Month Summer (Jun 16–Sep 14, $775/mo — fixed dates), 9-Month Academic (Sep 15–Jun 15, $800/mo — fixed dates), 12-Month (flexible start — Sep 15 recommended, $800/mo)
- **Layout:** Room 1 ($775/mo, Floor 1). Rooms 2–5 ($800/mo, Floor 2). Rooms 6–9 ($800/mo, Floor 3).
- **Availability:** All rooms available now.
- **Fees:** App $50 · Utilities $175/mo (includes cleaning, WiFi, water & trash)
- **Leasing packages:** Full 2nd floor $3,200/mo; Full 3rd floor $3,200/mo

### 5259 Brooklyn Ave NE (University District)
- **Type:** Modern multi-bedroom townhouse | 9 bedrooms, 3 baths
- **Rent:** $800–$865/month
- **Lease terms:** 3-Month Summer ($800/mo — fixed dates), 9-Month Academic ($800/mo — fixed dates), 12-Month (flexible start — Sep 15 recommended, $800/mo)
- **Layout:** Room 1 ($865/mo, Floor 1). Room 2 ($865/mo), Rooms 3–5 ($825/mo) on Floor 2. Rooms 6–9 ($800/mo, Floor 3).
- **Availability:** All rooms available after April 14, 2026.
- **Fees:** App $50 · Utilities $175/mo (includes cleaning, WiFi, water & trash) · Security deposit $600
- **Leasing packages:** Rooms 1+2 $1,730/mo; Rooms 3–5 $2,475/mo; Rooms 6–9 $3,200/mo

## Leasing Rules
- All three properties offer 3-Month Summer, 9-Month Academic, and 12-Month lease options.
- Summer (Jun 16) and Academic (Sep 15) start dates are fixed.
- 12-Month start date is flexible. September 15 is recommended for students.
- Any non-standard start date carries a +$25/month surcharge.
- Custom date ranges (e.g. May–August) are possible but carry the +$25/month flexible date surcharge. Direct them to contact leasing to confirm.
- Rooms come fully furnished (desk, bed, heating, AC). No additional furnishing fee.

## Group Leasing
- Multiple rooms can be rented together. Friend groups and roommates are welcome.
- Floor packages available: renters can lease a full floor together at a grouped rate.
- Each room is individually priced. Multiple people sharing one property each pay their own room's rent + $175/mo utilities.
- 5259 Brooklyn is popular for friend groups due to the grouped room packages.

## All Properties Include
- Walk to University of Washington campus
- In-unit washer/dryer
- Bi-monthly professional cleaning (included in utilities)
- WiFi, full kitchen, public transportation access
- Furnished rooms: desk, bed, heating, AC

## Application
- Apply at theaxishousing.com/apply · $50 application fee
- Contact via theaxishousing.com/contact for tours

Keep answers short and direct. If unsure, suggest contacting the team.`

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-2.0-flash-lite'

function getLocalFallbackReply(question) {
  const text = question.toLowerCase()

  if (text.includes('available') || text.includes('availability')) {
    return '**4709B 8th Ave NE** — all 9 rooms available now.\n\n**5259 Brooklyn Ave NE** — all 9 rooms available after April 14, 2026.\n\n**4709A 8th Ave NE** — select rooms available starting Aug–Sep 2026.\n\nContact us for the most up-to-date details!'
  }

  if (text.includes('room') || text.includes('bedroom')) {
    return 'All three properties are shared housing near UW:\n- **4709A** — 10 bedrooms, 3.5 baths ($750–$875/mo)\n- **4709B** — 9 bedrooms, 2.5 baths ($775–$800/mo)\n- **5259 Brooklyn** — 9 bedrooms, 3 baths ($800–$865/mo)\n\nAll rooms are furnished with a desk, bed, heating, and AC.'
  }

  if (text.includes('rent') || text.includes('price') || text.includes('pricing') || text.includes('cost') || text.includes('how much')) {
    return 'Room prices by property:\n- **4709A** 8th Ave: $750–$875/mo\n- **4709B** 8th Ave: $775–$800/mo\n- **5259 Brooklyn**: $800–$865/mo\n\nUtilities are a flat **$175/mo** (covers cleaning, WiFi, water & trash). Application fee is $50. No furnishing fee — rooms come furnished.'
  }

  if (text.includes('apply') || text.includes('application')) {
    return 'You can apply directly from the **Apply page** on this site. The application fee is $50. We typically get back to you within 2 business days.'
  }

  if (text.includes('tour') || text.includes('visit') || text.includes('schedule') || text.includes('see')) {
    return 'To schedule a tour, visit the **Contact page** or use the "Request tour" button. You can also reach us at 510-309-8345.'
  }

  if (text.includes('includ') || text.includes('ameniti') || text.includes('utility') || text.includes('utilities') || text.includes('wifi') || text.includes('internet')) {
    return 'All properties include:\n- Walk to UW campus\n- In-unit washer/dryer\n- Bi-monthly professional cleaning (included in utilities)\n- WiFi + full kitchen\n- Public transit access\n- Furnished rooms (desk, bed, heating, AC)\n\nUtilities are a flat $175/mo and cover cleaning, WiFi, water & trash.'
  }

  if (text.includes('lease') || text.includes('term') || text.includes('month') || text.includes('summer') || text.includes('academic')) {
    return 'All three properties offer the same three lease options:\n- **3-Month Summer**: Jun 16 – Sep 14 (fixed dates)\n- **9-Month Academic**: Sep 15 – Jun 15 (fixed dates)\n- **12-Month**: flexible start date (Sep 15 recommended for students)\n\nA +$25/month surcharge applies for non-standard start dates.'
  }

  if (text.includes('address') || text.includes('location') || text.includes('where') || text.includes('university') || text.includes('uw') || text.includes('campus')) {
    return 'All three properties are in Seattle\'s **University District**, walking distance to the University of Washington campus:\n- 4709A & 4709B 8th Ave NE\n- 5259 Brooklyn Ave NE'
  }

  if (text.includes('contact') || text.includes('phone') || text.includes('email') || text.includes('reach') || text.includes('call')) {
    return 'You can reach us through the **Contact page** on this site, or call/text us at **510-309-8345**. We\'re happy to answer any questions!'
  }

  if (text.includes('deposit') || text.includes('security')) {
    return '5259 Brooklyn Ave NE requires a $600 security deposit. 4709A and 4709B do not have a security deposit.'
  }

  if (text.includes('hi') || text.includes('hello') || text.includes('hey')) {
    return 'Hi there! I\'m the Axis Housing leasing assistant. I can help with room availability, pricing, lease terms, amenities, and the application process. What would you like to know?'
  }

  return 'I can help with questions about room availability, pricing, lease terms, amenities, how to apply, or scheduling a tour. What would you like to know?'
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
