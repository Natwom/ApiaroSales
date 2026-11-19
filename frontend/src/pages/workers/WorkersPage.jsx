import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Plus, Eye, Download, Users, ShieldCheck, ShieldAlert, CalendarClock } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import { Donut, HBars, COLORS } from '../../components/common/Charts'
import { Kpi, Card, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatKES, formatDate } from '../../utils/format'
import {
  useWorkers, useOrganizations, useLpos, useOrders, nameMap, apiError,
} from '../../hooks/useLookups'

const DAY = 86400000
const iso = (d) => d.toISOString().slice(0, 10)
const parseDay = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00`)
const orNull = (v) => (v === '' || v === undefined ? null : v)
const EMPTY = {
  organization_id: '', full_name: '', employee_no: '', department: '', phone: '', email: '',
  collection_authorized: false, auth_start_date: '', auth_expiry_date: '', notes: '',
}

const AUTH = {
  active: ['Authorized', 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300', COLORS.green],
  expiring: ['Expiring soon', 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300', COLORS.amber],
  expired: ['Expired', 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300', COLORS.red],
  pending: ['Not started', 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', COLORS.slate],
  none: ['Not authorized', 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300', '#64748b'],
}
function authState(w) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  if (!w.collection_authorized) return 'none'
  if (w.auth_expiry_date && parseDay(w.auth_expiry_date) < today) return 'expired'
  if (w.auth_start_date && parseDay(w.auth_start_date) > today) return 'pending'
  if (w.auth_expiry_date && (parseDay(w.auth_expiry_date) - today) / DAY <= 30) return 'expiring'
  return 'active'
}
function AuthPill({ state }) {
  const [label, cls] = AUTH[state]
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

export default function WorkersPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [authFilter, setAuthFilter] = useState('')
  const [dates, setDates] = useState({ start: '', end: '' })

  const { data: workers, isLoading } = useWorkers()
  const { data: orgs } = useOrganizations()
  const { data: lpos } = useLpos()
  const { data: orders } = useOrders()
  const orgNames = nameMap(orgs)
  const { register, handleSubmit, reset } = useForm({ defaultValues: EMPTY })

  const rows = useMemo(() => (workers ?? []).map((w) => ({
    ...w,
    customer: orgNames[w.organization_id] ?? '…',
    auth: authState(w),
    lpoCount: (lpos ?? []).filter((l) => l.worker_id === w.id).length,
    orderCount: (orders ?? []).filter((o) => o.worker_id === w.id).length,
  })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [workers, orgs, lpos, orders])

  const filtered = rows
    .filter((w) => !customerFilter || String(w.organization_id) === customerFilter)
    .filter((w) => !authFilter || w.auth === authFilter)
    .filter((w) => {
      const q = search.trim().toLowerCase()
      return !q || [w.full_name, w.employee_no, w.customer, w.department, w.phone].some((x) => String(x ?? '').toLowerCase().includes(q))
    })

  const count = (s) => filtered.filter((w) => w.auth === s).length
  const donut = Object.keys(AUTH).map((k) => ({ label: AUTH[k][0], value: count(k), color: AUTH[k][2] }))
  const perCustomer = Object.entries(filtered.reduce((m, w) => ({ ...m, [w.customer]: (m[w.customer] ?? 0) + 1 }), {}))
    .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6)

  const refresh = () => qc.invalidateQueries({ queryKey: ['workers'] })

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/workers', payload),
    onSuccess: (res) => { refresh(); setShowForm(false); reset(EMPTY); setError(''); setNotice(`${res.data?.full_name ?? 'Worker'} added.`) },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to save worker')) },
  })
  const authMutation = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/workers/${id}/authorization`, body),
    onSuccess: () => { refresh(); setError(''); setNotice('Authorization updated.') },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to update authorization')) },
  })

  const onSubmit = (v) =>
    createMutation.mutate({
      organization_id: Number(v.organization_id),
      full_name: v.full_name.trim(), employee_no: v.employee_no.trim(),
      department: orNull(v.department), phone: orNull(v.phone), email: orNull(v.email),
      collection_authorized: !!v.collection_authorized,
      auth_start_date: orNull(v.auth_start_date), auth_expiry_date: orNull(v.auth_expiry_date), notes: orNull(v.notes),
    })

  const canAuthorize = hasPermission('worker.authorize')
  const toggleAuth = (w) => authMutation.mutate({ id: w.id, body: { collection_authorized: !w.collection_authorized } })
  const authButton = (w) => canAuthorize && (
    <button className={w.collection_authorized ? 'btn-secondary' : 'btn-primary'} disabled={authMutation.isPending} onClick={() => toggleAuth(w)}>
      {w.collection_authorized ? 'Revoke' : 'Authorize'}
    </button>
  )

  const exportCsv = () =>
    downloadCsv(`workers-${iso(new Date())}.csv`,
      ['Name', 'Employee No.', 'Customer', 'Department', 'Phone', 'Email', 'Collection authorization', 'Expires', 'LPOs', 'Orders'],
      filtered.map((w) => [w.full_name, w.employee_no, w.customer, w.department ?? '', w.phone ?? '', w.email ?? '',
        AUTH[w.auth][0], w.auth_expiry_date ?? '', w.lpoCount, w.orderCount]))

  const columns = [
    { key: 'full_name', header: 'Name', sortable: true, render: (r) => <span className="font-medium">{r.full_name}</span> },
    { key: 'employee_no', header: 'Employee No.', sortable: true },
    { key: 'customer', header: 'Customer', sortable: true },
    { key: 'department', header: 'Department' },
    { key: 'phone', header: 'Phone' },
    { key: 'lpoCount', header: 'LPOs', sortable: true },
    { key: 'orderCount', header: 'Orders', sortable: true },
    { key: 'auth', header: 'Collection', render: (r) => <AuthPill state={r.auth} /> },
    { key: 'auth_expiry_date', header: 'Expires', render: (r) => formatDate(r.auth_expiry_date) },
    {
      key: 'actions', header: '',
      render: (r) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button className="btn-secondary" onClick={() => { setSelectedId(r.id); setDates({ start: r.auth_start_date ?? '', end: r.auth_expiry_date ?? '' }) }}><Eye size={14} /> View</button>
          {authButton(r)}
        </div>
      ),
    },
  ]

  const sel = rows.find((w) => w.id === selectedId)
  const selLpos = sel ? (lpos ?? []).filter((l) => l.worker_id === sel.id) : []
  const selOrders = sel ? (orders ?? []).filter((o) => o.worker_id === sel.id) : []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Workers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Customer staff who own LPOs and collect goods. Only authorized, unexpired workers can collect.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {hasPermission('worker.create') && (
            <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}>
              <Plus size={16} /> New Worker
            </button>
          )}
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-red-500">{error}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Organization *</label>
            <select className="input" {...register('organization_id', { required: true })}>
              <option value="">Select…</option>
              {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div><label className="label">Full name *</label><input className="input" {...register('full_name', { required: true })} /></div>
          <div><label className="label">Employee no. *</label><input className="input" {...register('employee_no', { required: true })} /></div>
          <div><label className="label">Department</label><input className="input" {...register('department')} /></div>
          <div><label className="label">Phone</label><input className="input" {...register('phone')} /></div>
          <div><label className="label">Email</label><input type="email" className="input" {...register('email')} /></div>
          <div><label className="label">Authorization start</label><input type="date" className="input" {...register('auth_start_date')} /></div>
          <div><label className="label">Authorization expiry</label><input type="date" className="input" {...register('auth_expiry_date')} /></div>
          <label className="flex items-center gap-2 text-sm pt-6"><input type="checkbox" {...register('collection_authorized')} /> Authorized to collect goods</label>
          <div className="md:col-span-3"><label className="label">Notes</label><input className="input" {...register('notes')} /></div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? 'Saving…' : 'Save Worker'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search name, employee no., department…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[200px]" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
          <option value="">All customers</option>
          {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="input max-w-[190px]" value={authFilter} onChange={(e) => setAuthFilter(e.target.value)}>
          <option value="">All authorization states</option>
          {Object.keys(AUTH).map((k) => <option key={k} value={k}>{AUTH[k][0]}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Users} label="Workers" value={filtered.length} />
        <Kpi icon={ShieldCheck} tone="green" label="Can collect now" value={count('active') + count('expiring')} />
        <Kpi icon={CalendarClock} tone="amber" label="Expiring within 30 days" value={count('expiring')} />
        <Kpi icon={ShieldAlert} tone="red" label="Expired / not authorized" value={count('expired') + count('none')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Collection authorization"><Donut centerLabel="workers" segments={donut} /></Card>
        <Card title="Workers per customer"><HBars rows={perCustomer} empty="No workers yet." /></Card>
      </div>

      {isLoading ? <div className="card h-48 animate-pulse" /> : (
        <DataTable columns={columns} rows={filtered}
          onRowClick={(r) => { setSelectedId(r.id); setDates({ start: r.auth_start_date ?? '', end: r.auth_expiry_date ?? '' }) }}
          emptyMessage="No workers match." />
      )}

      {sel && (
        <DetailPanel title={sel.full_name} subtitle={`${sel.customer} · ${sel.employee_no}`} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Customer">{sel.customer}</Field>
            <Field label="Department">{sel.department}</Field>
            <Field label="Phone">{sel.phone}</Field>
            <Field label="Email">{sel.email}</Field>
            <Field label="Collection"><AuthPill state={sel.auth} /></Field>
            <Field label="Valid from">{formatDate(sel.auth_start_date)}</Field>
            <Field label="Valid until">{formatDate(sel.auth_expiry_date)}</Field>
            <Field label="Employment"><span className="capitalize">{sel.employment_status}</span></Field>
          </div>

          {canAuthorize && (
            <div className="no-print rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <h3 className="font-semibold">Manage authorization</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div><label className="label">Valid from</label><input type="date" className="input" value={dates.start} onChange={(e) => setDates((d) => ({ ...d, start: e.target.value }))} /></div>
                <div><label className="label">Valid until</label><input type="date" className="input" value={dates.end} onChange={(e) => setDates((d) => ({ ...d, end: e.target.value }))} /></div>
                <div className="flex gap-2">
                  <button className="btn-secondary" disabled={authMutation.isPending}
                    onClick={() => authMutation.mutate({ id: sel.id, body: { auth_start_date: dates.start || null, auth_expiry_date: dates.end || null } })}>
                    Save dates
                  </button>
                  {authButton(sel)}
                </div>
              </div>
            </div>
          )}

          <div>
            <h3 className="font-semibold mb-2">LPOs owned</h3>
            <DataTable rows={selLpos} emptyMessage="This worker owns no LPOs."
              columns={[
                { key: 'customer_lpo_no', header: 'LPO No.' },
                { key: 'authorized_total', header: 'Authorized', render: (r) => formatKES(r.authorized_total) },
                { key: 'remaining_value', header: 'Value left', render: (r) => formatKES(r.remaining_value) },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]} />
          </div>
          <div>
            <h3 className="font-semibold mb-2">Orders</h3>
            <DataTable rows={selOrders} emptyMessage="No orders."
              columns={[
                { key: 'internal_ref', header: 'Order' },
                { key: 'total', header: 'Total', render: (r) => formatKES(r.total) },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]} />
          </div>
        </DetailPanel>
      )}
    </div>
  )
}