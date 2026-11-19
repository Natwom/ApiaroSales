import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Lock, Mail, Loader2, Eye, EyeOff, ShieldCheck, PackageCheck, FileText, BarChart3 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const FEATURES = [
  { icon: FileText, title: 'LPO tracking', text: 'Every customer LPO drawn down until exhausted, balance always on record.' },
  { icon: PackageCheck, title: 'Live stock', text: 'Each collection deducts inventory automatically.' },
  { icon: BarChart3, title: 'Money in view', text: 'Invoices, payments and what is still owed, per customer and worker.' },
  { icon: ShieldCheck, title: 'Controlled approvals', text: 'Maker and checker rules with a full audit trail.' },
]

function safeGet(k) { try { return localStorage.getItem(k) ?? '' } catch { return '' } }
function safeSet(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* ignore */ } }

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  const [remember, setRemember] = useState(!!safeGet('remember_email'))

  const { register, handleSubmit, setFocus, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: safeGet('remember_email'), password: '' },
  })

  useEffect(() => {
    setFocus(safeGet('remember_email') ? 'password' : 'email')
  }, [setFocus])

  const onSubmit = async (values) => {
    setError('')
    try {
      await login(values.email.trim(), values.password)
      safeSet('remember_email', remember ? values.email.trim() : '')
      navigate('/')
    } catch (e) {
      const d = e.response?.data?.detail
      if (!e.response) setError('Cannot reach the server. Check that the backend is running.')
      else if (e.response.status === 401 || e.response.status === 403) setError(typeof d === 'string' ? d : 'Wrong email or password.')
      else setError(typeof d === 'string' ? d : 'Login failed. Please try again.')
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-navy-950 text-slate-200">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden
                      bg-gradient-to-br from-navy-900 via-navy-950 to-brand-900">
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-400/10 blur-3xl" />
        <div className="relative">
          <img src="/logo-full-light.svg" alt="APIARO" className="h-16 w-auto" />
          <p className="text-slate-400 text-sm mt-2">Contractors and Supplies Ltd</p>
        </div>

        <div className="relative space-y-8 max-w-md">
          <h1 className="text-3xl font-bold text-white leading-tight">
            Run LPOs, stock, invoices and payments from one place.
          </h1>
          <ul className="space-y-5">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <div className="rounded-lg bg-white/10 p-2 h-fit"><f.icon size={18} className="text-brand-400" /></div>
                <div>
                  <div className="font-medium text-white">{f.title}</div>
                  <div className="text-sm text-slate-400">{f.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-500">All amounts are displayed in Kenyan Shillings (KSh)</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            <img src="/logo-full-light.svg" alt="APIARO" className="h-14 w-auto mx-auto" />
            <p className="text-slate-400 text-sm mt-2">Enterprise Business Management Platform</p>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white">Welcome back</h2>
            <p className="text-sm text-slate-400 mt-1">Sign in to continue to your workspace.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate
            className="rounded-2xl border border-navy-800 bg-navy-900 p-6 space-y-5 shadow-xl shadow-black/20">
            {error && (
              <div role="alert" className="rounded-lg bg-red-900/40 border border-red-800 text-red-300 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
              <div className="auth-field">
                <Mail size={17} className="auth-icon" />
                <input id="email" type="email" autoComplete="username"
                  className="auth-input"
                  placeholder="you@apiaro.co.ke" {...register('email')} />
              </div>
              {errors.email && <p className="text-xs text-red-400 mt-1.5">{errors.email.message}</p>}
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
              <div className="auth-field">
                <Lock size={17} className="auth-icon" />
                <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password"
                  className="auth-input"
                  placeholder="Enter your password"
                  onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock') ?? false)}
                  {...register('password')} />
                <button type="button" onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  className="auth-toggle">
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {caps && <p className="text-xs text-amber-400 mt-1.5">Caps Lock is on.</p>}
              {errors.password && <p className="text-xs text-red-400 mt-1.5">{errors.password.message}</p>}
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-400 select-none cursor-pointer">
              <input type="checkbox" className="h-3.5 w-3.5 rounded accent-brand-500"
                checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember my email on this device
            </label>

            <button type="submit" disabled={isSubmitting}
              className="btn-primary w-full justify-center !py-3 !rounded-xl">
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
              {isSubmitting ? 'Signing in…' : 'Sign In'}
            </button>

            <p className="text-center text-xs text-slate-500 lg:hidden">
              All amounts are displayed in Kenyan Shillings (KSh)
            </p>
          </form>

          <p className="text-center text-xs text-slate-600 mt-6">
            Authorized users only. Activity is recorded in the audit log.
          </p>
        </div>
      </div>
    </div>
  )
}