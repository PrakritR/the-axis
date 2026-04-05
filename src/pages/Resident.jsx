import { useEffect, useState } from 'react'
import { supabase, supabaseReady } from '../lib/supabase'

const CATEGORIES = [
  { id: 'maintenance', label: 'Maintenance / Repair', icon: '🔧' },
  { id: 'plumbing',   label: 'Plumbing',              icon: '🚿' },
  { id: 'electrical', label: 'Electrical',            icon: '⚡' },
  { id: 'appliance',  label: 'Appliance Issue',       icon: '🏠' },
  { id: 'noise',      label: 'Noise Complaint',       icon: '🔊' },
  { id: 'cleaning',   label: 'Cleaning / Sanitation', icon: '🧹' },
  { id: 'billing',    label: 'Billing / Payment',     icon: '💳' },
  { id: 'other',      label: 'Other',                 icon: '📋' },
]

const STATUS_STYLES = {
  open:        'bg-amber-50 text-amber-700 border-amber-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  resolved:    'bg-green-50 text-green-700 border-green-200',
}
const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved' }

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setInfo(''); setLoading(true)
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email)
        if (error) throw error
        setInfo('Password reset email sent — check your inbox.')
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setInfo('Account created! Check your email to confirm, then log in.')
        setMode('login')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        onLogin()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900">
            <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-slate-900">Resident Portal</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {mode === 'login' ? 'Sign in to submit and track your requests.' : mode === 'signup' ? 'Create your resident account.' : 'Reset your password.'}
          </p>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-7 shadow-soft">
          {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {info  && <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-700">{info}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none placeholder:text-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/8 transition-colors" />
            </div>
            {mode !== 'forgot' && (
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Password</label>
                <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none placeholder:text-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/8 transition-colors" />
              </div>
            )}
            <button type="submit" disabled={loading}
              className="w-full rounded-full bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Email'}
            </button>
          </form>

          <div className="mt-5 space-y-2 border-t border-slate-100 pt-5 text-center text-xs text-slate-500">
            {mode === 'login' && <>
              <button onClick={() => setMode('forgot')} className="block w-full hover:text-slate-900">Forgot password?</button>
              <button onClick={() => setMode('signup')} className="block w-full hover:text-slate-900">Don't have an account? <span className="font-semibold text-slate-700">Sign up</span></button>
            </>}
            {mode !== 'login' && (
              <button onClick={() => setMode('login')} className="hover:text-slate-900">← Back to sign in</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── New Request Form ─────────────────────────────────────────────────────────
function NewRequestForm({ user, onSubmitted }) {
  const [category, setCategory] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('normal')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error } = await supabase.from('work_orders').insert({
      resident_id: user.id,
      resident_email: user.email,
      category,
      title,
      description,
      priority,
      status: 'open',
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    onSubmitted()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div>
        <label className="mb-3 block text-sm font-semibold text-slate-700">Category</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CATEGORIES.map(c => (
            <button key={c.id} type="button" onClick={() => setCategory(c.id)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-semibold transition-all ${category === c.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
              <span className="text-lg">{c.icon}</span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Title <span className="text-red-400">*</span></label>
        <input required value={title} onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Kitchen sink is leaking"
          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none placeholder:text-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/8 transition-colors" />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Description <span className="text-red-400">*</span></label>
        <textarea required value={description} onChange={e => setDescription(e.target.value)} rows={4}
          placeholder="Describe the issue in detail — when it started, how severe it is, etc."
          className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none placeholder:text-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/8 transition-colors" />
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">Priority</label>
        <div className="flex gap-2">
          {[['low','Low','bg-slate-50 text-slate-600'],['normal','Normal','bg-amber-50 text-amber-700'],['urgent','Urgent','bg-red-50 text-red-700']].map(([val, label, style]) => (
            <button key={val} type="button" onClick={() => setPriority(val)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition-all ${priority === val ? 'border-slate-900 bg-slate-900 text-white' : `border-slate-200 ${style} hover:border-slate-400`}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={loading || !category || !title || !description}
          className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-7 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {loading
            ? <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Submitting…</>
            : 'Submit Request'}
        </button>
      </div>
    </form>
  )
}

// ─── Request Thread ───────────────────────────────────────────────────────────
function RequestThread({ request, user, onBack }) {
  const [messages, setMessages] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetchMessages()
    const sub = supabase
      .channel(`work_order_${request.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_order_messages', filter: `work_order_id=eq.${request.id}` }, () => fetchMessages())
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [request.id])

  async function fetchMessages() {
    const { data } = await supabase.from('work_order_messages').select('*').eq('work_order_id', request.id).order('created_at', { ascending: true })
    setMessages(data || [])
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!newMsg.trim()) return
    setSending(true)
    await supabase.from('work_order_messages').insert({ work_order_id: request.id, sender_id: user.id, sender_email: user.email, is_admin: false, message: newMsg.trim() })
    setNewMsg('')
    setSending(false)
  }

  const cat = CATEGORIES.find(c => c.id === request.category)

  return (
    <div>
      <button onClick={onBack} className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
        All requests
      </button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">{cat?.icon}</span>
            <h2 className="text-xl font-black text-slate-900">{request.title}</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">Submitted {formatDate(request.created_at)}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLES[request.status]}`}>
          {STATUS_LABELS[request.status]}
        </span>
      </div>

      <div className="mb-5 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
        {request.description}
      </div>

      {/* Message thread */}
      <div className="mb-4 space-y-3">
        {messages.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-400">No messages yet. Send an update below.</p>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.is_admin ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-6 ${msg.is_admin ? 'rounded-tl-sm bg-slate-100 text-slate-800' : 'rounded-tr-sm bg-slate-900 text-white'}`}>
              {msg.is_admin && <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Axis Leasing</div>}
              <p>{msg.message}</p>
              <p className={`mt-1 text-[11px] ${msg.is_admin ? 'text-slate-400' : 'text-white/50'}`}>{formatTime(msg.created_at)}</p>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={sendMessage} className="flex gap-2">
        <input value={newMsg} onChange={e => setNewMsg(e.target.value)}
          placeholder="Send a message or update…"
          className="flex-1 rounded-full border border-slate-200 px-4 py-2.5 text-sm outline-none placeholder:text-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/8 transition-colors" />
        <button type="submit" disabled={sending || !newMsg.trim()}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 transition-colors">
          Send
        </button>
      </form>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ user, onLogout }) {
  const [tab, setTab] = useState('requests')
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRequest, setSelectedRequest] = useState(null)

  useEffect(() => { fetchRequests() }, [])

  async function fetchRequests() {
    setLoading(true)
    const { data } = await supabase.from('work_orders').select('*').eq('resident_id', user.id).order('created_at', { ascending: false })
    setRequests(data || [])
    setLoading(false)
  }

  if (selectedRequest) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)]">
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">Resident Portal</div>
            <button onClick={onLogout} className="text-xs text-slate-400 hover:text-slate-700">Sign out</button>
          </div>
        </header>
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
            <RequestThread request={selectedRequest} user={user} onBack={() => { setSelectedRequest(null); fetchRequests() }} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)]">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Resident Portal</div>
            <div className="text-xs text-slate-400">{user.email}</div>
          </div>
          <button onClick={onLogout} className="rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400 transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-slate-900">My Requests</h1>
          <p className="mt-1 text-sm text-slate-500">Submit and track maintenance requests, work orders, and issues.</p>
        </div>

        <div className="mb-6 flex gap-1 rounded-2xl border border-slate-100 bg-slate-50 p-1">
          {[['requests','My Requests'],['new','New Request']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex flex-1 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
          {tab === 'new' && (
            <NewRequestForm user={user} onSubmitted={() => { fetchRequests(); setTab('requests') }} />
          )}

          {tab === 'requests' && (
            loading ? (
              <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-14 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">📋</div>
                <div>
                  <div className="font-semibold text-slate-900">No requests yet</div>
                  <p className="mt-1 text-sm text-slate-500">Submit your first request using the "New Request" tab.</p>
                </div>
                <button onClick={() => setTab('new')} className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Submit a request
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map(req => {
                  const cat = CATEGORIES.find(c => c.id === req.category)
                  return (
                    <button key={req.id} onClick={() => setSelectedRequest(req)}
                      className="group flex w-full items-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-slate-900 hover:shadow-sm">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl">{cat?.icon || '📋'}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{req.title}</span>
                          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[req.status]}`}>{STATUS_LABELS[req.status]}</span>
                          {req.priority === 'urgent' && <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">Urgent</span>}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-slate-500">{req.description}</p>
                        <p className="mt-1 text-xs text-slate-400">{formatDate(req.created_at)}</p>
                      </div>
                      <svg className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-slate-900" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                    </button>
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Setup required screen ────────────────────────────────────────────────────
function SetupRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <svg className="h-7 w-7 text-slate-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
          </svg>
        </div>
        <h1 className="text-2xl font-black text-slate-900">Resident Portal Setup Required</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          The resident portal needs Supabase configured to work. Add your Supabase credentials to Vercel environment variables to activate it.
        </p>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-soft">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Required env vars</div>
          <div className="space-y-2 font-mono text-xs text-slate-700">
            <div className="rounded-lg bg-slate-50 px-3 py-2">VITE_SUPABASE_URL</div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">VITE_SUPABASE_ANON_KEY</div>
          </div>
          <p className="mt-4 text-xs text-slate-400">Get these from supabase.com → your project → Settings → API</p>
        </div>
        <a href="/" className="mt-6 inline-block text-sm font-semibold text-slate-500 hover:text-slate-900">← Back to site</a>
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function Resident() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!supabaseReady) { setChecking(false); return }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setChecking(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
  }

  if (!supabaseReady) return <SetupRequired />
  if (checking) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">Loading…</div>
  if (!user) return <LoginScreen onLogin={() => {}} />
  return <Dashboard user={user} onLogout={handleLogout} />
}
