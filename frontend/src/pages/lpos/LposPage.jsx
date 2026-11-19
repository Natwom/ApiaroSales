import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { Plus, Trash2, Eye, Download, FileText, Wallet, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import AreaChart from '../../components/common/AreaChart'
import { Donut, COLORS } from '../../components/common/Charts'
import { Kpi, Card, MoneyBars, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatKES, formatDate } from '../../utils/format'
import {
  useLpos, useOrders, useOrganizations, useProducts, useWorkers, nameMap, apiError,
} from '../../hooks/useLookups'

const DAY = 86400000
const num = (v) => Number(v ?? 0)
const iso = (d) => d.toISOString().slice(0, 10)
const parseDay = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00`)
const OPEN = ['approved', 'partially_fulfilled']
const EMPTY = () => ({
  organization_id: '', worker_id: '', customer_lpo_no: '', issue_date: iso(new Date()), expiry_date: '', terms: '',
  items: [{ product_id: '', authorized_qty: 1, unit_price: '' }],
})

function Progress({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="w-32">
      <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div className="h-2 rounded bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{done} of {total} units ({pct}%)</div>
    </div>
  )
}

export default function LposPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [workerFilter, setWorkerFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [months, setMonths] = useState(6)

  const { data: lpos, isLoading } = useLpos()
  const { data: orders } = useOrders()
  const { data: orgs } = useOrganizations()
  const { data: products } = useProducts()
  const { data: workers } = useWorkers()

  const { register, handleSubmit, control, setValue, watch, reset } = useForm({ defaultValues: EMPTY() })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const orgId = watch('organization_id')
  const formItems = watch('items')

  const orgNames = nameMap(orgs)
  const productNames = nameMap(products)
  const workerNames = nameMap(workers, 'full_name')
  const orgWorkers = (workers ?? []).filter((w) => String(w.organization_id) === String(orgId))

  const todayD = new Date(); todayD.setHours(0, 0, 0, 0)

  const enriched = useMemo(() => (lpos ?? []).map((l) => {
    const left = l.expiry_date ? Math.ceil((parseDay(l.expiry_date) - todayD) / DAY) : null
    const open = OPEN.includes(l.status)
    return {
      ...l,
      customer: orgNames[l.organization_id] ?? '…',
      worker: workerNames[l.worker_id] ?? '—',
      daysLeft: left,
      expiring: open && left !== null && left >= 0 && left <= 14,
      expired: open && left !== null && left < 0,
    }
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [lpos, orgs, workers])

  const filtered = enriched
    .filter((l) => !customerFilter || String(l.organization_id) === customerFilter)
    .filter((l) => !workerFilter || String(l.worker_id) === workerFilter)
    .filter((l) => !statusFilter || l.status === statusFilter)
    .filter((l) => {
      const q = search.trim().toLowerCase()
      return !q || [l.customer_lpo_no, l.internal_ref, l.customer, l.worker].some((x) => String(x ?? '').toLowerCase().includes(q))
    })

  // KPIs
  const active = filtered.filter((l) => OPEN.includes(l.status))
  const authorized = filtered.reduce((s, l) => s + num(l.authorized_total), 0)
  const valueLeft = active.reduce((s, l) => s + num(l.remaining_value), 0)
  const awaiting = filtered.filter((l) => ['submitted', 'under_review'].includes(l.status))
  const expiring = filtered.filter((l) => l.expiring || l.expired)

  // Charts
  const chartData = useMemo(() => {
    const now = new Date(); const b = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      b.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-KE', { month: 'short' }), a: 0 })
    }
    filtered.forEach((l) => { const x = b.find((m) => m.key === String(l.issue_date).slice(0, 7)); if (x) x.a += num(l.authorized_total) })
    return b
  }, [filtered, months])
  const donut = [
    { label: 'Awaiting approval', value: filtered.filter((l) => ['submitted', 'under_review'].includes(l.status)).length, color: COLORS.slate },
    { label: 'Open', value: filtered.filter((l) => l.status === 'approved').length, color: COLORS.brand },
    { label: 'Part collected', value: filtered.filter((l) => l.status === 'partially_fulfilled').length, color: COLORS.amber },
    { label: 'Exhausted', value: filtered.filter((l) => l.status === 'fully_fulfilled').length, color: COLORS.green },
    { label: 'Draft / rejected', value: filtered.filter((l) => l.status === 'draft').length, color: COLORS.red },
  ]
  const leftByCustomer = Object.entries(
    active.reduce((m, l) => ({ ...m, [l.customer]: (m[l.customer] ?? 0) + num(l.remaining_value) }), {}),
  ).map(([label, value]) => ({ label, value })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 5)

  // Form
  const fillPrice = (idx, productId) => {
    const p = (products ?? []).find((x) => String(x.id) === String(productId))
    if (p) setValue(`items.${idx}.unit_price`, p.selling_price)
  }
  const formTotal = (formItems ?? []).reduce((s, i) => s + num(i.authorized_qty) * num(i.unit_price), 0)

  const refresh = () => ['lpos', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/lpos', payload),
    onSuccess: (res) => {
      refresh(); setShowForm(false); reset(EMPTY()); setError('')
      setNotice(`LPO ${res.data?.internal_ref ?? ''} saved. A different user must approve it.`)
    },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to create LPO')) },
  })
  const approveMutation = useMutation({
    mutationFn: ({ id, approve, reason }) => api.post(`/lpos/${id}/approve`, { approve, reason: reason || null }),
    onSuccess: (_r, v) => { refresh(); setError(''); setNotice(v.approve ? 'LPO approved.' : 'LPO rejected.') },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Action failed')) },
  })
  const onReject = (l) => {
    const reason = window.prompt('Reject LPO — reason (required):')
    if (reason && reason.trim()) approveMutation.mutate({ id: l.id, approve: false, reason: reason.trim() })
  }

  const onSubmit = (v) => {
    const ids = v.items.map((i) => i.product_id)
    if (new Set(ids).size !== ids.length) { setError('A product can appear only once on an LPO.'); return }
    createMutation.mutate({
      customer_lpo_no: v.customer_lpo_no.trim(),
      organization_id: Number(v.organization_id),
      worker_id: Number(v.worker_id),
      issue_date: v.issue_date,
      expiry_date: v.expiry_date || null,
      terms: v.terms || null,
      items: v.items.map((i) => ({
        product_id: Number(i.product_id), authorized_qty: Number(i.authorized_qty), unit_price: String(i.unit_price || 0),
      })),
    })
  }

  const canApprove = (l) => ['submitted', 'under_review'].includes(l.status) && hasPermission('lpo.approve')
  const approveButtons = (l) => canApprove(l) && (
    <>
      <button className="btn-primary" disabled={approveMutation.isPending}
        onClick={() => approveMutation.mutate({ id: l.id, approve: true, reason: 'Approved' })}>Approve</button>
      <button className="btn-secondary" disabled={approveMutation.isPending} onClick={() => onReject(l)}>Reject</button>
    </>
  )

  const exportCsv = () =>
    downloadCsv(`lpos-${iso(new Date())}.csv`,
      ['Customer', 'Worker', 'LPO No.', 'Our Ref', 'Issued', 'Expires', 'Authorized', 'Value left', 'Units left', 'Status'],
      filtered.map((l) => [l.customer, l.worker, l.customer_lpo_no, l.internal_ref, l.issue_date, l.expiry_date ?? '',
        num(l.authorized_total).toFixed(2), num(l.remaining_value).toFixed(2), l.total_remaining_qty ?? 0, l.status]))

  const columns = [
    { key: 'customer', header: 'Customer', sortable: true, render: (r) => <span className="font-medium">{r.customer}</span> },
    { key: 'worker', header: 'Worker', sortable: true },
    { key: 'customer_lpo_no', header: 'LPO No.', sortable: true },
    { key: 'internal_ref', header: 'Our Ref' },
    {
      key: 'expiry_date', header: 'Expires',
      render: (r) => (
        <span className={r.expired ? 'text-red-500' : r.expiring ? 'text-amber-600' : ''}>
          {formatDate(r.expiry_date)}{r.expired ? ' · expired' : r.expiring ? ` · ${r.daysLeft}d left` : ''}
        </span>
      ),
    },
    { key: 'authorized_total', header: 'Authorized', sortable: true, render: (r) => formatKES(r.authorized_total) },
    { key: 'progress', header: 'Collected', render: (r) => <Progress done={r.total_collected_qty ?? 0} total={r.total_authorized_qty ?? 0} /> },
    { key: 'remaining_value', header: 'Value left', sortable: true, render: (r) => formatKES(r.remaining_value) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions', header: '',
      render: (r) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button className="btn-secondary" onClick={() => setSelectedId(r.id)}><Eye size={14} /> View</button>
          {approveButtons(r)}
        </div>
      ),
    },
  ]

  const sel = enriched.find((l) => l.id === selectedId)
  const selOrders = sel ? (orders ?? []).filter((o) => o.lpo_id === sel.id) : []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">LPOs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Each LPO belongs to one customer and one worker. Goods are drawn down until it is exhausted; the balance is always recorded.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {hasPermission('lpo.create') && (
            <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}>
              <Plus size={16} /> New LPO
            </button>
          )}
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-red-500">{error}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {awaiting.length > 0 && hasPermission('lpo.approve') && statusFilter !== 'submitted' && (
        <div className="card p-4 border-l-4 border-l-amber-500 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm"><b>{awaiting.length}</b> LPO{awaiting.length > 1 ? 's' : ''} waiting for approval.</span>
          <button className="btn-secondary" onClick={() => setStatusFilter('submitted')}>Show them</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Customer *</label>
            <select className="input" {...register('organization_id', { required: true, onChange: () => setValue('worker_id', '') })}>
              <option value="">Select customer…</option>
              {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Worker (owner of this LPO) *</label>
            <select className="input" {...register('worker_id', { required: true })}>
              <option value="">Select worker…</option>
              {orgWorkers.map((w) => <option key={w.id} value={w.id}>{w.full_name} ({w.employee_no})</option>)}
            </select>
            {orgId && orgWorkers.length === 0 && <p className="text-xs text-amber-600 mt-1">No workers for this customer yet. Add one under Workers.</p>}
          </div>
          <div>
            <label className="label">Customer LPO number *</label>
            <input className="input" placeholder="e.g. WV-LPO-0045" {...register('customer_lpo_no', { required: true })} />
          </div>
          <div><label className="label">Issue date *</label><input type="date" className="input" {...register('issue_date', { required: true })} /></div>
          <div><label className="label">Expiry date</label><input type="date" className="input" {...register('expiry_date')} /></div>
          <div><label className="label">Terms</label><input className="input" {...register('terms')} /></div>

          <div className="md:col-span-3 space-y-2">
            <div className="label">Authorized items (each product once)</div>
            {(products ?? []).length === 0 && <p className="text-sm text-amber-600">No products exist yet. Create products under Inventory first.</p>}
            {fields.map((f, idx) => (
              <div key={f.id} className="grid grid-cols-12 gap-2">
                <div className="col-span-6">
                  <select className="input" {...register(`items.${idx}.product_id`, { required: true, onChange: (e) => fillPrice(idx, e.target.value) })}>
                    <option value="">Product…</option>
                    {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                </div>
                <div className="col-span-2"><input type="number" min="1" className="input" placeholder="Qty" {...register(`items.${idx}.authorized_qty`, { required: true, min: 1 })} /></div>
                <div className="col-span-3"><input type="number" step="0.01" min="0" className="input" placeholder="Unit price" {...register(`items.${idx}.unit_price`, { required: true })} /></div>
                <div className="col-span-1"><button type="button" className="btn-secondary" disabled={fields.length === 1} onClick={() => remove(idx)}><Trash2 size={14} /></button></div>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="btn-secondary" onClick={() => append({ product_id: '', authorized_qty: 1, unit_price: '' })}><Plus size={14} /> Add item</button>
              <span className="text-sm">Authorized total: <b>{formatKES(formTotal)}</b></span>
            </div>
          </div>

          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? 'Saving…' : 'Save LPO'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search LPO no., customer, worker…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[200px]" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
          <option value="">All customers</option>
          {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="input max-w-[200px]" value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)}>
          <option value="">All workers</option>
          {(workers ?? []).filter((w) => !customerFilter || String(w.organization_id) === customerFilter)
            .map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
        </select>
        <select className="input max-w-[190px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="submitted">Awaiting approval</option>
          <option value="approved">Open</option>
          <option value="partially_fulfilled">Part collected</option>
          <option value="fully_fulfilled">Exhausted</option>
          <option value="draft">Draft / rejected</option>
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={FileText} label="LPOs" value={filtered.length} sub={`${active.length} active`} />
        <Kpi icon={Wallet} label="Authorized value" value={formatKES(authorized)} />
        <Kpi icon={CheckCircle2} tone="green" label="Value still to collect" value={formatKES(valueLeft)} />
        <Kpi icon={Clock} tone="amber" label="Awaiting approval" value={awaiting.length} />
        <Kpi icon={AlertTriangle} tone="red" label="Expiring / expired" value={expiring.length} sub="within 14 days or past" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="LPO value issued per month" className="lg:col-span-2"
          action={
            <select className="input max-w-[130px]" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value={3}>Last 3 months</option><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option>
            </select>
          }>
          <AreaChart data={chartData} height={210} series={[{ key: 'a', label: 'Authorized value', color: COLORS.brand }]} />
        </Card>
        <Card title="LPOs by status"><Donut centerLabel="LPOs" segments={donut} /></Card>
      </div>
      <Card title="Value still to collect, by customer">
        <MoneyBars rows={leftByCustomer} color={COLORS.amber} empty="No active LPOs." />
      </Card>

      {isLoading ? <div className="card h-48 animate-pulse" /> : (
        <DataTable columns={columns} rows={filtered} onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No LPOs match." />
      )}

      {sel && (
        <DetailPanel title={`LPO ${sel.customer_lpo_no}`} subtitle={`${sel.customer} — ${sel.worker} (${sel.internal_ref})`} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Customer">{sel.customer}</Field>
            <Field label="Worker (owner)">{sel.worker}</Field>
            <Field label="Status"><StatusBadge status={sel.status} /></Field>
            <Field label="Issued">{formatDate(sel.issue_date)}</Field>
            <Field label="Expires">{formatDate(sel.expiry_date)}{sel.expired ? ' (expired)' : sel.expiring ? ` (${sel.daysLeft} days left)` : ''}</Field>
            <Field label="Authorized">{formatKES(sel.authorized_total)}</Field>
            <Field label="Value left to collect">{formatKES(sel.remaining_value)}</Field>
            <Field label="Terms">{sel.terms}</Field>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Balance</h3>
            <Progress done={sel.total_collected_qty ?? 0} total={sel.total_authorized_qty ?? 0} />
          </div>
          <DataTable rowKey="id" rows={sel.items}
            columns={[
              { key: 'product_id', header: 'Product', render: (r) => productNames[r.product_id] ?? r.product_id },
              { key: 'authorized_qty', header: 'Authorized' },
              { key: 'ordered_qty', header: 'Ordered' },
              { key: 'collected_qty', header: 'Collected' },
              { key: 'remaining_to_order', header: 'Left to order' },
              { key: 'remaining_qty', header: 'Left to collect' },
              { key: 'unit_price', header: 'Unit price', render: (r) => formatKES(r.unit_price) },
            ]} />
          <div>
            <h3 className="font-semibold mb-2">Orders on this LPO</h3>
            <DataTable rows={selOrders} emptyMessage="No orders raised yet."
              columns={[
                { key: 'internal_ref', header: 'Order' },
                { key: 'total', header: 'Total', render: (r) => formatKES(r.total) },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]} />
          </div>
          {sel.status === 'fully_fulfilled' && <p className="text-sm text-green-600">This LPO is exhausted. No further orders can be raised against it.</p>}
          <div className="flex gap-2 no-print">{approveButtons(sel)}</div>
        </DetailPanel>
      )}
    </div>
  )
}