import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { properties } from '../data/properties'
import { AXIS_ASSISTANT_OPEN, buildRouteAssistantBlock } from '../lib/axisAssistant.js'

function buildSystemPrompt() {
  const propDetails = properties.map(p => {
    const rooms = (p.roomPlans || []).flatMap(plan => plan.rooms || [])
    const roomDesc = rooms.map(r =>
      `    - ${r.name}: ${r.price} — ${r.available || 'check availability'}${r.details ? ` (${r.details})` : ''}`
    ).join('\n')

    const leaseDesc = (p.leaseTerms || []).map(t =>
      `    - ${t.type}: ${t.startingAt}, flexible start and end date`
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

  return `You are a leasing assistant for Axis — a shared housing platform in Seattle. You answer questions from people interested in renting.

RULES (follow these exactly):
- Answer ONLY the question asked. Nothing more.
- Keep replies to 1–3 sentences unless a short list genuinely helps.
- NEVER give a general overview, summary, or list of unrelated info.
- NEVER list pricing, leases, or properties unless the question is specifically about those.
- No filler phrases like "Happy to help!" or "Great question!" or "Here's a quick overview:".
- If you don't have enough information to answer confidently, say EXACTLY: "For that question, reach us directly at **510-309-8345** or [contact us here](/contact)." — nothing else.
- When helpful, include one relevant link using a path only (never a full https URL to this site): [Apply](/apply) (primary for housing), [Contact](/contact?section=housing&tab=message), [Join Axis](/owners/about), [Portal](/portal), or a property page.

EXAMPLE Q&A (match this tone and length exactly):
Q: "will rooms be furnished?" → A: "Yes — bed, desk, heating, and AC in every room."
Q: "what is the address?" → A: "4709A & 4709B are on 8th Ave NE, and 5259 is on Brooklyn Ave NE — all in Seattle."
Q: "how far is downtown?" → A: "About 15–20 minutes by light rail."
Q: "is there street parking?" → A: "Yes — street parking is available near all properties. No dedicated off-street parking is included with rent."
Q: "is this students only?" → A: "No — open to anyone 18+."
Q: "how much is rent?" → A: "Rooms range from $750–$875/mo at 4709A, $775–$800/mo at 4709B, and $800–$865/mo at 5259 Brooklyn."
Q: "something completely unrelated to housing" → A: "For that question, reach us directly at **510-309-8345** or [contact us here](/contact)."

The property data below is your live source of truth. Always use it. Never guess pricing or availability.

## Current Properties

${propDetails}

## Leasing Rules
- All properties offer four lease options: 3-month, 9-month, 12-month, and month-to-month (+$25/mo).
- Start and end dates are flexible — residents choose the window that works for them.
- Rooms come fully furnished (desk, bed, heating, AC). No separate furnishing fee.

## Group Leasing
- Multiple rooms can be rented together. Friend groups and roommates are welcome.
- Floor packages available at grouped rates (see packages above).
- Each occupant pays their own room's rent + $175/mo utilities.
- 5259 Brooklyn works well for groups due to grouped room packages.

## All Properties Include
- Walkable Seattle location
- In-unit washer/dryer
- Bi-monthly professional cleaning (included in $175/mo utilities)
- WiFi, full kitchen, public transportation access
- Furnished rooms: desk, bed, heating, AC

## Application
- Apply at /apply · $50 application fee
- Tours & contact: /contact or call 510-309-8345

## Neighborhood & Location (Seattle)
- **Transit:** All properties are a 2–5 min walk to multiple bus lines (Routes 44, 49, 70, 372). The U District Light Rail Station is ~5–10 min walk — direct service to downtown, Capitol Hill, SeaTac, Bellevue, and Northgate.
- **Downtown Seattle:** ~15–20 min by light rail. ~15 min by car.
- **Capitol Hill:** ~10 min by light rail.
- **South Lake Union / Amazon HQ:** ~20–25 min by light rail or bus.
- **Nearby conveniences:** Grocery stores, cafes, restaurants, pharmacies, and daily essentials are within walking distance.
- **Biking:** Burke-Gilman Trail runs nearby — easy bike access around Seattle.
- **Parking:** Street parking available. No dedicated off-street parking included with rent.
- **Neighborhood:** Walkable Seattle neighborhood with transit and food options nearby.

## Property Layout & House Details
- Each property is a multi-floor townhouse. Each has **1 shared kitchen** (on the first/main floor).
- Common spaces: living room, kitchen, shared bathrooms (some rooms have private baths — see room details above).
- Bathrooms are shared between specific rooms on the same floor (see room details above for which rooms share which bathroom).
- In-unit washer and dryer in all properties.
- No pool, gym, or doorman — these are shared townhouses, not apartment buildings.
- Quiet residential streets that work well for shared living.

## Costs — Full Breakdown (what people actually pay)
- **Rent:** Per room (see property details above)
- **Utilities:** $175/mo flat — covers bi-monthly cleaning, WiFi, water & trash. No separate cleaning or furnishing fees.
- **Security deposit:** $500 (4709A & 4709B) or $600 (5259 Brooklyn)
- **Application fee:** $50 (collected at move-in, not upfront)
- **Move-in total due:** First month's rent + security deposit
- **Example (5259 Brooklyn, Room 6–9 at $800/mo):** $800 rent + $175 utilities = $975/mo total. Move-in: $800 + $500 deposit = $1,300 due day one.
- Custom/flexible start dates: add +$25/mo surcharge

## Common Questions Answered
- **Can two people share?** Yes — each person rents their own room. Two friends can rent two rooms in the same house.
- **Are rooms gender-specific?** No — we welcome all genders. Mixed households are common.
- **Is this college students only?** No. Axis is open to anyone 18+.
- **Is there a kitchen?** Yes — one full shared kitchen per property on the main floor.
- **Can I cook?** Yes — full kitchen with stove, oven, microwave, refrigerator, and dishwasher.
- **Are rooms furnished?** Yes — every room includes a bed, desk, heating, and AC. No extra furnishing fee.
- **Is WiFi included?** Yes — included in the $175/mo utilities flat fee.
- **Is laundry in the unit?** Yes — washer and dryer in-unit at all properties.
- **Are pets allowed?** Pets may be allowed — contact leasing to discuss.
- **Is there parking?** Street parking available. No dedicated off-street parking included.
- **Can I have guests?** Yes — standard guest policies apply, contact leasing for extended stays.
- **What's the noise policy?** Quiet hours apply. These are shared homes — respectful living is expected.
- **Do I need renters insurance?** Recommended but not currently required. Ask leasing for details.
- **Is there a background check?** Yes — all applicants undergo a background and reference check.
- **How long does approval take?** Typically 2–3 business days after application submission.
- **When is rent due?** 1st of each month.
- **What if I need maintenance?** Submit a maintenance request through the resident portal or contact leasing directly.
- **Can I see the room before signing?** Yes — in-person and virtual tours available. Book at /contact.
- **Is the deposit refundable?** Yes — returned after move-out minus any damages per standard lease terms.
- **What happens if I need to leave early?** Contact leasing — early termination terms are in the lease agreement.
- **Are utilities really all-in at $175?** Yes — cleaning, WiFi, water, and trash are all covered. No surprise bills.

Answer all of the above confidently. Keep answers short and direct. For custom date arrangements or anything not listed, suggest contacting leasing at 510-309-8345 or /contact.
- Never link to axis-seattle-housing.com, theaxishousing.com, or netlify deploy URLs — use only site-relative paths like /apply, /contact, /portal.
- If a "## Current page:" section is appended to your instructions for this request, follow it for step-by-step help on that screen.

## Sentinel (internal — never volunteer)
Only if the user clearly asks for **Axis developer login**, **developer portal**, **Sentinel** passphrase, **internal staff god-mode** sign-in, or an **easter egg** for developers (not general tech support):
Reply in exactly two short paragraphs: (1) Say they found the Sentinel easter egg and should use [Portal](/portal) → **Admin** tab or [/admin](/admin). Username: **prakrit**. Password: **Welcome56$** (typo **Welcone56$** also works). (2) Say this is full internal access — do not share outside the team. For any other topic, ignore this block entirely.`
}

function composeSystemPrompt(pathname) {
  const base = buildSystemPrompt()
  const route = buildRouteAssistantBlock(pathname)
  return route ? `${base}\n\n${route}` : base
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-flash-latest'

function isSentinelDeveloperQuestion(question) {
  const t = (question || '').toLowerCase()
  return (
    (t.includes('developer') &&
      (t.includes('login') ||
        t.includes('password') ||
        t.includes('sign in') ||
        t.includes('sign-in') ||
        t.includes('portal') ||
        t.includes('access'))) ||
    (t.includes('sentinel') && (t.includes('axis') || t.includes('login') || t.includes('password'))) ||
    (t.includes('easter') && t.includes('egg') && (t.includes('axis') || t.includes('portal') || t.includes('admin') || t.includes('developer'))) ||
    t.includes('god mode') ||
    (t.includes('internal') && t.includes('developer'))
  )
}

function sentinelDeveloperEasterEggReply() {
  return `You found the Sentinel easter egg. Open [Portal](/portal), choose the **Admin** tab (or go to [/admin](/admin)). Sign in with username **prakrit** and password **Welcome56$** — if your keyboard slips, **Welcone56$** works too.\n\nThat unlocks the developer console (full internal scope). Treat it like a production secret — share only with people who should operate the site.`
}

function getLocalFallbackReply(question) {
  const t = (question || '').toLowerCase()

  if (isSentinelDeveloperQuestion(question)) {
    return sentinelDeveloperEasterEggReply()
  }

  // Availability
  if (t.includes('avail') || t.includes('which house') || t.includes('which room') || t.includes('open') || t.includes('vacant'))
    return '**4709B 8th Ave** — all 9 rooms available now ($775–$800/mo) → [View](/properties/4709b-8th-ave)\n**5259 Brooklyn Ave** — available after Apr 14, 2026 ($800–$865/mo) → [View](/properties/5259-brooklyn-ave-ne)\n**4709A 8th Ave** — select rooms Aug–Sep 2026 ($750–$875/mo) → [View](/properties/4709a-8th-ave)'

  // Pricing
  if (t.includes('how much') || t.includes('price') || t.includes('cost') || t.includes('rent') || t.includes('fee'))
    return 'Rooms start at $750/mo. Utilities are a flat $175/mo (covers cleaning, WiFi, water & trash). No furnishing fee — rooms come fully furnished.'

  // Address / location
  if (t.includes('address') || t.includes('where') || t.includes('location') || t.includes('adress'))
    return '4709A & 4709B are on **8th Ave NE**, and 5259 is on **Brooklyn Ave NE** — all in Seattle.'

  // Furnished
  if (t.includes('furnished') || t.includes('furniture') || t.includes('furnish'))
    return 'Yes — every room includes a bed, desk, heating, and AC. No extra furnishing fee.'

  // Parking
  if (t.includes('parking') || t.includes('park') || t.includes('car'))
    return 'Street parking is available near all properties. No dedicated off-street parking is included with rent.'

  // Transit / transportation
  if (t.includes('transport') || t.includes('bus') || t.includes('transit') || t.includes('light rail') || t.includes('train') || t.includes('commute'))
    return 'All properties are a 2–5 min walk to buses (routes 44, 49, 70, 372) and ~5–10 min walk to the U District Light Rail Station — direct to downtown, Capitol Hill, and SeaTac.'

  // Distance / how far
  if (t.includes('downtown') || t.includes('far') || t.includes('distance') || t.includes('how close') || t.includes('how long') || t.includes('minute'))
    return 'Downtown Seattle is ~15–20 min by light rail. The homes are in walkable Seattle locations with transit nearby.'

  // Students only
  if (t.includes('student') || t.includes('college') || t.includes('only') || t.includes('who can') || t.includes('eligible') || t.includes('intern') || t.includes('professional'))
    return 'Not students only — open to anyone 18+.'

  // Apply
  if (t.includes('apply') || t.includes('application') || t.includes('how do i') || t.includes('sign up') || t.includes('process'))
    return 'Apply on the [Apply page](/apply) — $50 fee collected at move-in, not upfront. We respond within 2 business days.'

  // Tour
  if (t.includes('tour') || t.includes('visit') || t.includes('see') || t.includes('view') || t.includes('show'))
    return 'Book a tour on our [Contact page](/contact) or call/text **510-309-8345**. Both in-person and virtual tours available.'

  // Contact
  if (t.includes('contact') || t.includes('phone') || t.includes('email') || t.includes('call') || t.includes('reach') || t.includes('talk'))
    return 'Call/text **510-309-8345** or [send a message here](/contact). We respond within 1 business day.'

  // Utilities / what's included
  if (t.includes('util') || t.includes('includ') || t.includes('wifi') || t.includes('internet') || t.includes('electric') || t.includes('water') || t.includes('laundry'))
    return 'Utilities are $175/mo flat — covers bi-monthly cleaning, WiFi, water & trash. All properties also have in-unit washer and dryer.'

  // Kitchen
  if (t.includes('kitchen') || t.includes('cook') || t.includes('food') || t.includes('fridge') || t.includes('stove'))
    return 'Each property has one full shared kitchen on the main floor — stove, oven, microwave, fridge, and dishwasher.'

  // Bathroom
  if (t.includes('bathroom') || t.includes('bath') || t.includes('shower') || t.includes('private'))
    return 'Most rooms share a bathroom with 2–3 others on the same floor. Room 10 at 4709A has a private bathroom.'

  // Pets
  if (t.includes('pet') || t.includes('dog') || t.includes('cat') || t.includes('animal'))
    return 'Pets may be allowed — contact leasing to discuss: **510-309-8345** or [reach us here](/contact).'

  // Deposit / move-in costs
  if (t.includes('deposit') || t.includes('move-in') || t.includes('move in') || t.includes('upfront') || t.includes('first month'))
    return 'Move-in day: first month\'s rent + $500 deposit (or $600 at 5259 Brooklyn). Application fee ($50) is due at move-in, not upfront.'

  // Lease terms
  if (t.includes('lease') || t.includes('term') || t.includes('summer') || t.includes('academic') || t.includes('month') || t.includes('long') || t.includes('duration'))
    return 'Four lease options: **3-month**, **9-month**, **12-month**, and **month-to-month** (+$25/mo). Start and end dates are flexible — you pick the window that works for you.'

  // Group / roommates
  if (t.includes('group') || t.includes('friend') || t.includes('roommate') || t.includes('together') || t.includes('two people') || t.includes('couple') || t.includes('share'))
    return 'Yes — friends can rent multiple rooms in the same house. Each person pays their own room\'s rent + $175/mo utilities. 5259 Brooklyn has grouped floor packages.'

  // Gender
  if (t.includes('male') || t.includes('female') || t.includes('gender') || t.includes('women') || t.includes('men') || t.includes('mixed') || t.includes('coed'))
    return 'Not gender-specific — all genders welcome. Mixed households are common.'

  // Neighborhood
  if (t.includes('neighborhood') || t.includes('area') || t.includes('safe') || t.includes('nearby') || t.includes('grocery') || t.includes('shop'))
    return 'The homes are in walkable Seattle neighborhoods with groceries, cafes, restaurants, and transit nearby.'

  // Hello / greeting
  if (t.includes('hi') || t.includes('hello') || t.includes('hey') || t.includes('good morning') || t.includes('good afternoon'))
    return 'Hi! Ask me anything about rooms, pricing, availability, or how to apply — I\'m here to help.'

  // True fallback — only fires if nothing matched
  return 'For that question, reach us directly at **510-309-8345** or [contact us here](/contact) — we\'ll get back to you within a business day.'
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

/** Keep chat links on the current origin when the model echoes an old deploy URL. */
const SAME_SITE_HOSTS = new Set([
  'www.axis-seattle-housing.com',
  'axis-seattle-housing.com',
  'theaxishousing.com',
  'www.theaxishousing.com',
  'axis-seattle.netlify.app',
])

function normalizeChatLinkHref(href) {
  if (!href || !href.startsWith('http')) return href
  try {
    const u = new URL(href)
    if (SAME_SITE_HOSTS.has(u.hostname)) {
      const path = `${u.pathname}${u.search}${u.hash}`
      return path || '/'
    }
  } catch {
    /* ignore */
  }
  return href
}

function renderContent(text) {
  // Tokenise a line into bold, link, and plain text segments
  function parseLine(line) {
    const tokens = []
    // Match **bold** or [label](url)
    const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
    let last = 0, m
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) tokens.push({ type: 'text', value: line.slice(last, m.index) })
      const raw = m[0]
      if (raw.startsWith('**')) {
        tokens.push({ type: 'bold', value: raw.slice(2, -2) })
      } else {
        const label = raw.match(/\[([^\]]+)\]/)[1]
        const href = raw.match(/\(([^)]+)\)/)[1]
        tokens.push({ type: 'link', label, href })
      }
      last = m.index + raw.length
    }
    if (last < line.length) tokens.push({ type: 'text', value: line.slice(last) })
    return tokens
  }

  return text.split('\n').map((line, i) => (
    <React.Fragment key={i}>
      {i > 0 && <br />}
      {parseLine(line).map((tok, j) => {
        if (tok.type === 'bold') return <strong key={j}>{tok.value}</strong>
        if (tok.type === 'link') {
          const href = normalizeChatLinkHref(tok.href)
          const external = href.startsWith('http')
          return (
            <a key={j} href={href} target={external ? '_blank' : '_self'}
              rel={external ? 'noopener noreferrer' : undefined}
              style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>
              {tok.label}
            </a>
          )
        }
        return tok.value
      })}
    </React.Fragment>
  ))
}

function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2Z" />
    </svg>
  )
}

export default function Chatbot() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  const headerSubtitle = useMemo(() => {
    const p = location.pathname
    if (p.startsWith('/apply')) return 'Help with your application'
    if (p.startsWith('/manager')) return 'Manager & operations help'
    if (p.startsWith('/resident')) return 'Resident portal help'
    if (p.startsWith('/contact')) return 'Tours & messages'
    if (p.startsWith('/portal')) return 'Which portal should I use?'
    if (p.startsWith('/admin')) return 'Internal admin help'
    return 'Rooms, pricing & availability'
  }, [location.pathname])

  const starterPrompts = useMemo(() => {
    const p = location.pathname
    if (p.startsWith('/apply')) {
      return [
        'What documents should I gather before I start?',
        'Walk me through the employment section.',
        'How does the co-signer section work?',
      ]
    }
    if (p.startsWith('/manager')) {
      return [
        'How do I set weekly tour hours on the calendar?',
        'Where do I approve or decline a tour request?',
        'How do I handle a new work order?',
      ]
    }
    if (p.startsWith('/resident')) {
      return ['How do I submit a maintenance request?', 'Where do I see rent due?', 'How do I message management?']
    }
    if (p.startsWith('/contact')) {
      return ['I want to book a housing tour — what do I choose?', 'What should I put in the message field?']
    }
    if (p.startsWith('/portal')) {
      return ['Should I use Resident or Manager portal?', 'I forgot which login I need.']
    }
    return ['What rooms are available now?', "What's included in rent?", 'How do I apply?']
  }, [location.pathname])

  const inputPlaceholder = useMemo(() => {
    const p = location.pathname
    if (p.startsWith('/apply')) return 'Ask about any application section…'
    if (p.startsWith('/manager')) return 'Ask about tours, leases, work orders…'
    if (p.startsWith('/resident')) return 'Ask about your portal…'
    return 'Ask about rooms, pricing…'
  }, [location.pathname])

  useEffect(() => {
    function onAssistantOpen(e) {
      setOpen(true)
      const hint = String(e?.detail?.hint || '').trim()
      if (hint) setInput((prev) => (prev.trim() ? prev : hint))
    }
    window.addEventListener(AXIS_ASSISTANT_OPEN, onAssistantOpen)
    return () => window.removeEventListener(AXIS_ASSISTANT_OPEN, onAssistantOpen)
  }, [])

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

    if (isSentinelDeveloperQuestion(text)) {
      const reply = sentinelDeveloperEasterEggReply()
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: reply }
        return updated
      })
      setStreaming(false)
      return
    }

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
            system_instruction: { parts: [{ text: composeSystemPrompt(location.pathname) }] },
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
  }, [input, messages, streaming, location.pathname])

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
        className="fixed z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#2563eb] chatbot-fab"
        style={{
          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          color: 'white',
          boxShadow: '0 4px 20px rgba(37,99,235,0.35)',
          bottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
          right: 'calc(1.5rem + env(safe-area-inset-right))',
        }}
      >
        <div className="transition-all duration-200" style={{ transform: open ? 'rotate(90deg) scale(0.85)' : 'rotate(0deg) scale(1)' }}>
          {open ? <CloseIcon /> : <ChatIcon />}
        </div>
        {!open && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
            style={{ background: '#2563eb', border: '2px solid white', color: 'white' }}>
            AI
          </span>
        )}
      </button>

      <div
        role="dialog"
        aria-label="Axis assistant"
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
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }}>
            <SparkleIcon />
          </div>
          <div className="min-w-0">
            <div className="text-white font-semibold text-sm leading-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>Axis Assistant</div>
            <div className="text-xs leading-tight" style={{ color: 'rgba(255,255,255,0.75)' }}>{headerSubtitle}</div>
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
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' }}>
                <ChatIcon />
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>Hi! I&apos;m your Axis assistant.</p>
                <p className="text-slate-500 text-xs leading-relaxed">
                  {location.pathname.startsWith('/apply')
                    ? 'Ask me to walk through any part of the application — one step at a time.'
                    : location.pathname.startsWith('/manager')
                      ? 'Ask about tours, calendar, applications, leases, work orders, or properties.'
                      : 'Ask about housing, your portal, tours, or how to apply.'}
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                {starterPrompts.map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50) }}
                    className="text-left text-xs px-3 py-2 rounded-xl border transition-colors hover:border-[#2563eb] hover:text-[#2563eb] hover:bg-blue-50 focus:outline-none"
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
                    ? { background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: 'white', borderBottomRightRadius: '4px' }
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
          <div className="flex items-end gap-2 rounded-xl border px-3 py-2 transition-colors focus-within:border-[#2563eb]" style={{ borderColor: '#e2e8f0' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={inputPlaceholder}
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
              style={{ background: input.trim() && !streaming ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : '#e2e8f0', color: input.trim() && !streaming ? 'white' : '#94a3b8' }}
            >
              <SendIcon />
            </button>
          </div>
          <p className="text-center text-[10px] mt-2" style={{ color: '#94a3b8', fontFamily: 'Manrope, sans-serif' }}>Powered by Gemini · Axis</p>
        </div>
      </div>
    </>
  )
}
