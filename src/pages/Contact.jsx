import { useEffect, useState } from 'react'
import { Seo } from '../lib/seo'

const CONTACT_PHONE_DISPLAY = '(510) 309-8345'
const CONTACT_PHONE_RAW = '15103098345'
const CONTACT_EMAIL = 'info@axis-seattle-housing.com'
const CONTACT_TOPICS = [
  'Schedule a tour',
  'Current room availability',
  'Lease length and pricing',
  'Which home is the best fit',
]
const CONTACT_PROMISES = [
  ['Direct reply', 'Direct to leasing, not a general inbox.'],
  ['Fast routing', 'All inquiries routed to the right person.'],
  ['Clear follow-up', 'Room questions get room-specific answers.'],
]

// Paste your Google Calendar appointment scheduling link here.
// To get it: Google Calendar → Create → "Appointment schedule" → Share → copy the booking page URL.
const GOOGLE_CALENDAR_BOOKING_URL = 'https://calendar.app.google/Vim4nAuCuhQvj4Rg9'

export default function Contact(){
  const [activeTab, setActiveTab] = useState('tour')

  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://www.cognitoforms.com/f/iframe.js'
    script.async = true
    document.body.appendChild(script)
    return () => document.body.removeChild(script)
  }, [])

  return (
    <div className="bg-[linear-gradient(180deg,#fcfcfa_0%,#ffffff_32%,#f8fafc_100%)]">
      <Seo
        title="Contact Axis Seattle | Tours and Housing Availability"
        description="Contact Axis Seattle to ask about room availability, schedule a tour, or learn more about affordable housing options in Seattle."
        pathname="/contact"
      />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="grid gap-8 border-b border-slate-200 pb-10 lg:grid-cols-[minmax(0,1.15fr)_320px] lg:pb-14">
          <div className="max-w-4xl">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Contact Axis Seattle</div>
            <h1 className="font-editorial mt-4 text-[2rem] leading-[1.1] text-slate-900 sm:text-[3rem] sm:leading-[0.96] lg:text-[4.3rem]">
              Contact leasing directly.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Ask about availability, schedule a tour, or get help choosing a property.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href={`tel:${CONTACT_PHONE_RAW}`} className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                Call now
              </a>
              <a href={`sms:${CONTACT_PHONE_RAW}`} className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-500">
                Text now
              </a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-500">
                Email direct
              </a>
            </div>

            <div className="mt-10 grid gap-4 border-t border-slate-200 pt-6 sm:grid-cols-4">
              {CONTACT_TOPICS.map((topic) => (
                <div key={topic}>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Common request</div>
                  <div className="mt-2 text-base font-semibold text-slate-900">{topic}</div>
                </div>
              ))}
            </div>
          </div>

          <aside className="flex flex-col justify-between border-t border-slate-200 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-1">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Reach us directly</div>
              <a href={`tel:${CONTACT_PHONE_RAW}`} className="mt-3 block text-2xl font-black text-slate-900 hover:text-axis">
                {CONTACT_PHONE_DISPLAY}
              </a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="mt-2 block break-all text-sm leading-7 text-slate-600 hover:text-axis">
                {CONTACT_EMAIL}
              </a>
            </div>
            <div className="mt-8 space-y-4">
              {CONTACT_PROMISES.map(([title, text]) => (
                <div key={title} className="border-t border-slate-200 pt-4">
                  <div className="text-sm font-semibold text-slate-900">{title}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">{text}</div>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <div className="mt-10 grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
          <div className="space-y-5">
            <div className="rounded-[24px] border border-slate-200 bg-stone-50 p-6">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Best uses</div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">What to send here</h2>
              <div className="mt-5 space-y-3">
                {[
                  'Questions about which room is actually available now',
                  'Tour requests for a specific property or room',
                  'Lease term, pricing, and move-in timing questions',
                  'Follow-up after viewing a listing on the site',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <span className="mt-1 inline-flex h-2.5 w-2.5 rounded-full bg-axis" />
                    <div className="text-sm leading-6 text-slate-700">{item}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-900 p-6 text-white">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-200">Quick contact</div>
              <div className="mt-3 text-2xl font-black">Prefer a faster route?</div>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Know which room you want? Call or text.
              </p>
              <div className="mt-5 flex flex-col gap-3">
                <a href={`tel:${CONTACT_PHONE_RAW}`} className="rounded-full bg-white px-5 py-3 text-center text-sm font-semibold text-slate-900">
                  Call {CONTACT_PHONE_DISPLAY}
                </a>
                <a href={`sms:${CONTACT_PHONE_RAW}`} className="rounded-full border border-white/15 bg-white/10 px-5 py-3 text-center text-sm font-semibold text-white">
                  Text leasing
                </a>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
            {/* Tab switcher */}
            <div className="mb-6 flex gap-1 rounded-2xl border border-slate-100 bg-slate-50 p-1">
              <button
                onClick={() => setActiveTab('tour')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                  activeTab === 'tour'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Schedule a Tour
              </button>
              <button
                onClick={() => setActiveTab('message')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                  activeTab === 'message'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Send a Message
              </button>
            </div>

            {activeTab === 'tour' ? (
              <div>
                <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-axis">Book a tour</div>
                    <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Pick a time that works</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                      Choose an available slot and we'll confirm your tour of the property.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">
                    Slots added to your Google Calendar automatically.
                  </div>
                </div>
                <iframe
                  src={GOOGLE_CALENDAR_BOOKING_URL}
                  style={{ border: 0, width: '100%', minHeight: '600px' }}
                  frameBorder="0"
                  scrolling="no"
                  title="Schedule a tour with Axis Seattle"
                />
              </div>
            ) : (
              <div>
                <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-axis">Send a message</div>
                    <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Tell us what you need</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                      Tell us what you need and we'll follow up.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">
                    Best for tour requests and availability questions.
                  </div>
                </div>
                <iframe
                  src="https://www.cognitoforms.com/f/zIns1FUelkCIZ-tnBbSN-Q/1"
                  allow="payment"
                  style={{ border: 0, width: '100%' }}
                  height="901"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
