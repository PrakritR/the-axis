import React, { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import emailjs from '@emailjs/browser'
import toast from 'react-hot-toast'
import { Seo } from '../lib/seo'

const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY
const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
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

if (PUBLIC_KEY) {
  emailjs.init({ publicKey: PUBLIC_KEY })
}

export default function Contact(){
  const location = useLocation()

  const prefilledSubject = useMemo(() => {
    const query = new URLSearchParams(location.search)
    return query.get('subject') || ''
  }, [location.search])

  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: prefilledSubject, message: '' })
  const [status, setStatus] = useState('idle') // idle | sending | success | error

  useEffect(() => {
    if (!prefilledSubject) return
    setForm((prev) => ({ ...prev, subject: prefilledSubject }))
  }, [prefilledSubject])

  async function onSubmit(e){
    e.preventDefault()
    setStatus('sending')

    if (!PUBLIC_KEY || !SERVICE_ID || !TEMPLATE_ID) {
      console.error('EmailJS config missing:', {
        hasPublicKey: !!PUBLIC_KEY,
        hasServiceId: !!SERVICE_ID,
        hasTemplateId: !!TEMPLATE_ID,
      })
      setStatus('error')
      return
    }

    try {
      await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
        from_name:  form.name,
        user_name:  form.name,
        name:       form.name,
        from_email: form.email,
        user_email: form.email,
        email:      form.email,
        reply_to:   form.email,
        phone:      form.phone || 'Not provided',
        subject:    form.subject || 'General inquiry',
        message:    `Subject: ${form.subject || 'General inquiry'}\n\n${form.message}`,
      }, { publicKey: PUBLIC_KEY })
      setStatus('success')
      setForm({ name: '', email: '', phone: '', subject: prefilledSubject, message: '' })
      toast.success("Message sent! We'll be in touch soon.")
    } catch (err) {
      console.error('EmailJS error:', err)
      setStatus('error')
      toast.error('Something went wrong. Please call or email us directly.')
    }
  }

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
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
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

            <form className="mt-8 space-y-5" onSubmit={onSubmit}>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Name</span>
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  required
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-axis focus:ring-4 focus:ring-teal-100"
                  placeholder="Your full name"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  required
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-axis focus:ring-4 focus:ring-teal-100"
                  placeholder="you@example.com"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Phone Number <span className="font-normal text-slate-400">(optional)</span></span>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-axis focus:ring-4 focus:ring-teal-100"
                  placeholder="(555) 555-5555"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Subject</span>
                <input
                  value={form.subject}
                  onChange={e => setForm(p => ({ ...p, subject: e.target.value }))}
                  required
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-axis focus:ring-4 focus:ring-teal-100"
                  placeholder="Tour request for 4709B 8th Ave, Room 3"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Message</span>
                <textarea
                  value={form.message}
                  onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                  required
                  rows={6}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-axis focus:ring-4 focus:ring-teal-100"
                  placeholder="Which room? Move-in timing? Any questions?"
                />
              </label>

              <div className="flex flex-col gap-3 border-t border-slate-100 pt-2 sm:flex-row sm:items-center">
                <button
                  type="submit"
                  disabled={status === 'sending'}
                  className="rounded-full bg-slate-900 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {status === 'sending' ? 'Sending…' : 'Send Message'}
                </button>
                <button
                  type="button"
                  onClick={() => { setForm({ name: '', email: '', phone: '', subject: prefilledSubject, message: '' }); setStatus('idle') }}
                  className="rounded-full border border-slate-300 px-5 py-3 font-semibold text-slate-700"
                >
                  Clear
                </button>
              </div>
            </form>
        </div>
      </div>
      </div>
    </div>
  )
}
