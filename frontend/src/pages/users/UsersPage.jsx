import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Plus, Eye, UserCheck, UserX, ShieldCheck, Users } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import Tabs from '../../components/common/Tabs'
import { Kpi } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { apiError } from '../../hooks/useLookups'

const EMPTY = { full_name: '', email: '', phone: '', password: '' }
const pill = (on) => `inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${on ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`

export default function UsersPage() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const [tab, setTab] = useState('users')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [newRoles, setNewRoles] = useState([])
  const [editRoles, setEditRoles] = useState([])
  const [reset, setReset] = useState('')

  const { data: users, isLoading, error: loadError } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get('/users')).data })
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: async () => (await api.get('/users/roles')).data })
  const { register, handleSubmit, reset: resetForm } = useForm({ defaultValues: EMPTY })

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] })
  const bad = (f) => (e) => { setNotice(''); setError(apiError(e, f)) }
  const createMutation = useMutation({
    mutationFn: (p) => api.post('/users', p),
    onSuccess: () => { refresh(); setShowForm(false); resetForm(EMPTY); setNewRoles([]); setError(''); setNotice('User created.') },
    onError: bad('Failed to create user'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/users/${id}`, body),
    onSuccess: () => { refresh(); setError(''); setNotice('User updated.'); setReset('') },
    onError: bad('Failed to update user'),
  })

  const toggleRole = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const onSubmit = (v) => {
    if (newRoles.length === 0) { setError('Choose at least one role.'); return }
    createMutation.mutate({ full_name: v.full_name.trim(), email: v.email.trim(), phone: v.phone || null, password: v.password, role_ids: newRoles })
  }

  const rows = useMemo(() => (users ?? []).filter((u) => !search.trim() || [u.full_name, u.email, ...u.roles].some((x) => String(x).toLowerCase().includes(search.trim().toLowerCase()))), [users, search])
  const sel = (users ?? []).find((u) => u.id === selectedId)
  const open = (u) => { setSelectedId(u.id); setEditRoles(u.role_ids); setReset(''); setError(''); setNotice('') }

  const RoleBoxes = ({ value, onToggle }) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
      {(roles ?? []).map((r) => (
        <label key={r.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.includes(r.id)} onChange={() => onToggle(r.id)} /> {r.name}</label>
      ))}
    </div>
  )

  const columns = [
    { key: 'full_name', header: 'Name', sortable: true, render: (r) => <span className="font-medium">{r.full_name}{r.id === me?.id ? ' (you)' : ''}</span> },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'phone', header: 'Phone' },
    { key: 'roles', header: 'Roles', render: (r) => r.roles.join(', ') },
    { key: 'is_active', header: 'Status', render: (r) => <span className={pill(r.is_active)}>{r.is_active ? 'Active' : 'Deactivated'}</span> },
    { key: 'view', header: '', render: (r) => <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); open(r) }}><Eye size={14} /> Manage</button> },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Users & Roles</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Who can sign in, and what each role is allowed to do.</p>
        </div>
        <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setTab('users'); setError(''); setNotice('') }}><Plus size={16} /> New User</button>
      </div>

      {(error || loadError) && <div className="card p-3 text-sm text-red-500">{error || apiError(loadError)}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi icon={Users} label="Users" value={(users ?? []).length} />
        <Kpi icon={UserCheck} tone="green" label="Active" value={(users ?? []).filter((u) => u.is_active).length} />
        <Kpi icon={UserX} tone="amber" label="Deactivated" value={(users ?? []).filter((u) => !u.is_active).length} />
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="label">Full name *</label><input className="input" {...register('full_name', { required: true })} /></div>
          <div><label className="label">Email *</label><input type="email" className="input" {...register('email', { required: true })} /></div>
          <div><label className="label">Phone</label><input className="input" {...register('phone')} /></div>
          <div><label className="label">Temporary password * (min 8)</label><input type="password" autoComplete="new-password" className="input" {...register('password', { required: true, minLength: 8 })} /></div>
          <div className="md:col-span-2"><label className="label">Roles *</label><RoleBoxes value={newRoles} onToggle={(id) => toggleRole(newRoles, setNewRoles, id)} /></div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" className="btn-primary" disabled={createMutation.isPending}>{createMutation.isPending ? 'Saving…' : 'Create user'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'users', label: 'Users' }, { key: 'roles', label: 'Roles & permissions' }]} />

      {tab === 'users' && (
        <div className="space-y-3">
          <input className="input max-w-xs" placeholder="Search name, email, role…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {isLoading ? <div className="card h-48 animate-pulse" /> : <DataTable columns={columns} rows={rows} onRowClick={open} emptyMessage="No users match." />}
        </div>
      )}

      {tab === 'roles' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(roles ?? []).map((r) => (
            <div key={r.id} className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold flex items-center gap-2"><ShieldCheck size={16} className="text-brand-500" /> {r.name}</h3>
                <span className="text-xs text-slate-500">{(users ?? []).filter((u) => u.roles.includes(r.name)).length} users</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.permissions.length === 0 && <span className="text-sm text-slate-500">No permissions.</span>}
                {r.permissions.map((p) => <span key={p} className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs">{p}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {sel && (
        <DetailPanel title={sel.full_name} subtitle={sel.email} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Status"><span className={pill(sel.is_active)}>{sel.is_active ? 'Active' : 'Deactivated'}</span></Field>
            <Field label="Phone">{sel.phone}</Field>
            <Field label="Roles">{sel.roles.join(', ')}</Field>
          </div>
          <div className="space-y-4 no-print">
            <div>
              <h3 className="font-semibold mb-2">Roles</h3>
              <RoleBoxes value={editRoles} onToggle={(id) => toggleRole(editRoles, setEditRoles, id)} />
              <button className="btn-primary mt-3" disabled={updateMutation.isPending || editRoles.length === 0}
                onClick={() => updateMutation.mutate({ id: sel.id, body: { role_ids: editRoles } })}>Save roles</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="md:col-span-2"><label className="label">Reset password (min 8)</label>
                <input type="password" autoComplete="new-password" className="input" value={reset} onChange={(e) => setReset(e.target.value)} /></div>
              <button className="btn-secondary" disabled={reset.length < 8 || updateMutation.isPending}
                onClick={() => updateMutation.mutate({ id: sel.id, body: { password: reset } })}>Set new password</button>
            </div>
            <button className={sel.is_active ? 'btn-secondary' : 'btn-primary'} disabled={updateMutation.isPending || sel.id === me?.id}
              onClick={() => updateMutation.mutate({ id: sel.id, body: { is_active: !sel.is_active } })}>
              {sel.is_active ? 'Deactivate user' : 'Reactivate user'}
            </button>
            {sel.id === me?.id && <p className="text-xs text-slate-500">You cannot deactivate your own account.</p>}
          </div>
        </DetailPanel>
      )}
    </div>
  )
}