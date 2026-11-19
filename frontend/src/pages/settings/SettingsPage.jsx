import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Sun, Moon, Monitor, LogOut } from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { apiError } from '../../hooks/useLookups'

const getMode = () => { try { return localStorage.getItem('theme') ?? 'system' } catch { return 'system' } }
const applyTheme = (mode) => {
  try { mode === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', mode) } catch { /* ignore */ }
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export default function SettingsPage() {
  const { user, logout } = useAuth()
  const [mode, setMode] = useState(getMode())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const { register, handleSubmit, reset, watch } = useForm({ defaultValues: { current_password: '', new_password: '', confirm: '' } })

  const mutation = useMutation({
    mutationFn: (p) => api.post('/users/me/password', p),
    onSuccess: () => { reset(); setError(''); setNotice('Password changed. Use it next time you sign in.') },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to change password')) },
  })
  const onSubmit = (v) => {
    if (v.new_password !== v.confirm) { setError('The new passwords do not match.'); return }
    mutation.mutate({ current_password: v.current_password, new_password: v.new_password })
  }

  const pick = (m) => { setMode(m); applyTheme(m) }
  const perms = [...(user?.permissions ?? [])].sort()
  const groups = perms.reduce((m, p) => { const [g] = p.split('.'); (m[g] ??= []).push(p); return m }, {})
  const newPw = watch('new_password') ?? ''

  const Mode = ({ id, icon: Icon, label }) => (
    <button onClick={() => pick(id)} className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm ${mode === id ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-400' : 'border-slate-300 dark:border-slate-700'}`}>
      <Icon size={16} /> {label}
    </button>
  )

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Your account, appearance and company information.</p>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="font-semibold">Your account</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div><div className="text-xs text-slate-500">Name</div><div className="font-medium">{user?.full_name ?? '—'}</div></div>
          <div><div className="text-xs text-slate-500">Email</div><div className="font-medium">{user?.email ?? '—'}</div></div>
          <div><div className="text-xs text-slate-500">Permissions</div><div className="font-medium">{perms.length}</div></div>
        </div>
        <button className="btn-secondary" onClick={logout}><LogOut size={14} /> Sign out</button>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="font-semibold">Appearance</h2>
        <div className="flex flex-wrap gap-2">
          <Mode id="light" icon={Sun} label="Light" /><Mode id="dark" icon={Moon} label="Dark" /><Mode id="system" icon={Monitor} label="Match my device" />
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        <h2 className="font-semibold md:col-span-3">Change password</h2>
        {error && <div className="md:col-span-3 text-sm text-red-500">{error}</div>}
        {notice && <div className="md:col-span-3 text-sm text-green-600">{notice}</div>}
        <div><label className="label">Current password</label><input type="password" autoComplete="current-password" className="input" {...register('current_password', { required: true })} /></div>
        <div><label className="label">New password (min 8)</label><input type="password" autoComplete="new-password" className="input" {...register('new_password', { required: true, minLength: 8 })} />
          {newPw && newPw.length < 8 && <p className="text-xs text-amber-600 mt-1">At least 8 characters.</p>}</div>
        <div><label className="label">Confirm new password</label><input type="password" autoComplete="new-password" className="input" {...register('confirm', { required: true })} /></div>
        <div className="md:col-span-3"><button type="submit" className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Change password'}</button></div>
      </form>

      <div className="card p-5 space-y-3">
        <h2 className="font-semibold">What you are allowed to do</h2>
        {perms.length === 0 ? <p className="text-sm text-slate-500">No permissions assigned.</p> : (
          <div className="space-y-3">
            {Object.entries(groups).map(([g, list]) => (
              <div key={g}>
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">{g}</div>
                <div className="flex flex-wrap gap-1.5">{list.map((p) => <span key={p} className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs">{p}</span>)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5 space-y-2 text-sm">
        <h2 className="font-semibold">Company</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><div className="text-xs text-slate-500">Business</div>Apiaro Contractors and Supplies Ltd</div>
          <div><div className="text-xs text-slate-500">Currency</div>Kenyan Shillings (KSh)</div>
          <div><div className="text-xs text-slate-500">Time zone</div>Africa/Nairobi</div>
        </div>
        <p className="text-xs text-slate-500">Collections take stock from warehouse #1. Roles and permissions are managed under Users & Roles.</p>
      </div>
    </div>
  )
}