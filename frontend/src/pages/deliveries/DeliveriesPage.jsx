import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Plus, Eye, Download, Truck, CalendarClock, CheckCircle2, XCircle, Send } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import AreaChart from '../../components/common/AreaChart'
import { Donut, HBars, COLORS } from '../../components/common/Charts'
import { Kpi, Card, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../utils/format'
import { apiError } from '../../hooks/useLookups'

const DAY = 86400000
const iso = (d) => d.toISOString().slice(0, 10)
const dayKey = (v) => new Date(v).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
const stamp = (v) =>
  v ? new Date(v).toLocaleString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi',
  }) : '—'
const goods = (items) => items.map((i) => `${i.product} ×${i.quantity}`).join(', ')
const EMPTY = () => ({ collection_id: '', driver_name: '', vehicle_reg: '', delivery_address: '', scheduled_date: iso(new Date()), notes: '' })

export default function DeliveriesPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const can = hasPermission('delivery.confirm')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [days, setDays] = useState(14)

  const { data: deliveries, isLoading, error: loadError } = useQuery({
    queryKey: ['deliveries'],
    queryFn: async () => (await api.get('/deliveries')).data,
  })
  const { data: eligible } = useQuery({
    queryKey: ['deliveries-eligible'],
    queryFn: async () => (await api.get('/deliveries/eligible')).data,
  })

  const { register, handleSubmit, setValue, reset } = useForm({ defaultValues: EMPTY() })

  const rows = useMemo(() => (deliveries ?? []).map((d) => ({ ...d, goods: goods(d.items), units: d.items.reduce((s, i) => s + i.quantity, 0) })), [deliveries])
  const filtered = rows
    .filter((d) => !statusFilter || d.status === statusFilter)
    .filter((d) => {
      const q = search.trim().toLowerCase()
      return !q || [d.internal_ref, d.customer, d.driver_name, d.vehicle_reg, d.order_ref, d.collection_ref, d.goods]
        .some((x) => String(x ?? '').toLowerCase().includes(q))
    })

  const count = (s) => rows.filter((d) => d.status === s).length
  const today = dayKey(new Date())
  const lateOnes = rows.filter((d) => ['scheduled', 'in_transit'].includes(d.status) && String(d.scheduled_date) < today)

  const chartData = useMemo(() => {
    const m = {}
    rows.filter((d) => d.status === 'delivered' && d.delivered_at).forEach((d) => { const k = dayKey(d.delivered_at); m[k] = (m[k] ?? 0) + 1 })
    const out = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY)
      out.push({ label: d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', timeZone: 'Africa/Nairobi' }), a: m[dayKey(d)] ?? 0 })
    }
    return out
  }, [rows, days])
  const donut = [
    { label: 'Scheduled', value: count('scheduled'), color: COLORS.slate },
    { label: 'In transit', value: count('in_transit'), color: COLORS.brand },
    { label: 'Delivered', value: count('delivered'), color: COLORS.green },
    { label: 'Failed', value: count('failed'), color: COLORS.red },
  ]
  const byDriver = Object.entries(rows.filter((d) => d.status === 'delivered').reduce((m, d) => ({ ...m, [d.driver_name]: (m[d.driver_name] ?? 0) + 1 }), {}))
    .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5)

  const refresh = () => ['deliveries', 'deliveries-eligible'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const ok = (msg) => { refresh(); setError(''); setNotice(msg) }
  const bad = (fallback) => (e) => { setNotice(''); setError(apiError(e, fallback)) }

  const createMutation = useMutation({
    mutationFn: (p) => api.post('/deliveries', p),
    onSuccess: (res) => { setShowForm(false); reset(EMPTY()); ok(`Delivery ${res.data?.internal_ref ?? ''} scheduled.`) },
    onError: bad('Failed to schedule delivery'),
  })
  const dispatchMutation = useMutation({
    mutationFn: (id) => api.post(`/deliveries/${id}/dispatch`),
    onSuccess: () => ok('Delivery dispatched.'), onError: bad('Failed to dispatch'),
  })
  const confirmMutation = useMutation({
    mutationFn: ({ id, name }) => api.post(`/deliveries/${id}/confirm`, { received_by_name: name }),
    onSuccess: () => ok('Delivery confirmed.'), onError: bad('Failed to confirm'),
  })
  const failMutation = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/deliveries/${id}/fail`, { reason }),
    onSuccess: () => ok('Delivery marked as failed. The collection can be scheduled again.'), onError: bad('Failed to update'),
  })

  const onConfirm = (d) => {
    const name = window.prompt('Name of the person who received the goods (required):', d.customer ?? '')
    if (name && name.trim()) confirmMutation.mutate({ id: d.id, name: name.trim() })
  }
  const onFail = (d) => {
    const reason = window.prompt('Why did the delivery fail? (required):')
    if (reason && reason.trim()) failMutation.mutate({ id: d.id, reason: reason.trim() })
  }

  const schedule = (c) => {
    setShowForm(true); setError(''); setNotice('')
    reset({ ...EMPTY(), collection_id: String(c.id), delivery_address: c.delivery_address ?? '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const onSubmit = (v) =>
    createMutation.mutate({
      collection_id: Number(v.collection_id), driver_name: v.driver_name.trim(),
      vehicle_reg: v.vehicle_reg || null, delivery_address: v.delivery_address || null,
      scheduled_date: v.scheduled_date, notes: v.notes || null,
    })

  const busy = dispatchMutation.isPending || confirmMutation.isPending || failMutation.isPending
  const actions = (d) => can && (
    <>
      {d.status === 'scheduled' && <button className="btn-secondary" disabled={busy} onClick={() => dispatchMutation.mutate(d.id)}><Send size={14} /> Dispatch</button>}
      {['scheduled', 'in_transit'].includes(d.status) && (
        <>
          <button className="btn-primary" disabled={busy} onClick={() => onConfirm(d)}>Delivered</button>
          <button className="btn-secondary" disabled={busy} onClick={() => onFail(d)}>Failed</button>
        </>
      )}
    </>
  )

  const exportCsv = () =>
    downloadCsv(`deliveries-${iso(new Date())}.csv`,
      ['Delivery', 'Customer', 'Order', 'Collection', 'Driver', 'Vehicle', 'Address', 'Scheduled', 'Delivered', 'Received by', 'Goods', 'Status'],
      filtered.map((d) => [d.internal_ref, d.customer ?? '', d.order_ref ?? '', d.collection_ref ?? '', d.driver_name, d.vehicle_reg ?? '',
        d.delivery_address ?? '', d.scheduled_date, d.delivered_at ? stamp(d.delivered_at) : '', d.received_by_name ?? '', d.goods, d.status]))

  const columns = [
    { key: 'internal_ref', header: 'Delivery', sortable: true },
    { key: 'customer', header: 'Customer', sortable: true, render: (r) => <span className="font-medium">{r.customer}</span> },
    { key: 'order_ref', header: 'Order' },
    { key: 'driver_name', header: 'Driver', sortable: true, render: (r) => `${r.driver_name}${r.vehicle_reg ? ` · ${r.vehicle_reg}` : ''}` },
    {
      key: 'scheduled_date', header: 'Scheduled', sortable: true,
      render: (r) => {
        const late = ['scheduled', 'in_transit'].includes(r.status) && String(r.scheduled_date) < today
        return <span className={late ? 'text-red-500' : ''}>{formatDate(r.scheduled_date)}{late ? ' · late' : ''}</span>
      },
    },
    { key: 'goods', header: 'Goods' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions', header: '',
      render: (r) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button className="btn-secondary" onClick={() => setSelectedId(r.id)}><Eye size={14} /> View</button>
          {actions(r)}
        </div>
      ),
    },
  ]

  const waitingColumns = [
    { key: 'internal_ref', header: 'Collection' },
    { key: 'customer', header: 'Customer', render: (r) => <span className="font-medium">{r.customer}</span> },
    { key: 'order_ref', header: 'Order' },
    { key: 'worker', header: 'Worker' },
    { key: 'collected_at', header: 'Collected', render: (r) => stamp(r.collected_at) },
    { key: 'goods', header: 'Goods', render: (r) => goods(r.items) },
    { key: 'actions', header: '', render: (r) => can && <button className="btn-primary" onClick={() => schedule(r)}><Truck size={14} /> Schedule delivery</button> },
  ]

  const sel = rows.find((d) => d.id === selectedId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Deliveries</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Schedule goods released on a collection for delivery, dispatch them, and confirm who received them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {can && (
            <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}>
              <Plus size={16} /> Schedule Delivery
            </button>
          )}
        </div>
      </div>

      {(error || loadError) && <div className="card p-3 text-sm text-red-500">{error || apiError(loadError)}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {lateOnes.length > 0 && statusFilter === '' && (
        <div className="card p-4 border-l-4 border-l-red-500 text-sm">
          <b>{lateOnes.length}</b> delivery{lateOnes.length > 1 ? 'ies are' : ' is'} past the scheduled date and not yet delivered.
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="label">Collection to deliver *</label>
            <select className="input" {...register('collection_id', {
              required: true,
              onChange: (e) => { const c = (eligible ?? []).find((x) => String(x.id) === e.target.value); setValue('delivery_address', c?.delivery_address ?? '') },
            })}>
              <option value="">Select…</option>
              {(eligible ?? []).map((c) => <option key={c.id} value={c.id}>{c.internal_ref} — {c.customer} — {goods(c.items)}</option>)}
            </select>
            {(eligible ?? []).length === 0 && <p className="text-xs text-amber-600 mt-1">No collections are waiting for delivery. Record a collection first.</p>}
          </div>
          <div><label className="label">Scheduled date *</label><input type="date" className="input" {...register('scheduled_date', { required: true })} /></div>
          <div><label className="label">Driver *</label><input className="input" {...register('driver_name', { required: true })} /></div>
          <div><label className="label">Vehicle registration</label><input className="input" placeholder="e.g. KDA 123A" {...register('vehicle_reg')} /></div>
          <div><label className="label">Delivery address</label><input className="input" {...register('delivery_address')} /></div>
          <div className="md:col-span-3"><label className="label">Notes</label><input className="input" {...register('notes')} /></div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? 'Saving…' : 'Schedule'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={Truck} label="Deliveries" value={rows.length} />
        <Kpi icon={CalendarClock} tone="amber" label="Scheduled" value={count('scheduled')} />
        <Kpi icon={Send} label="In transit" value={count('in_transit')} />
        <Kpi icon={CheckCircle2} tone="green" label="Delivered" value={count('delivered')} />
        <Kpi icon={XCircle} tone="red" label="Failed" value={count('failed')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Deliveries completed per day" className="lg:col-span-2"
          action={
            <select className="input max-w-[130px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
            </select>
          }>
          <AreaChart data={chartData} height={200} format={(v) => String(Math.round(v))} series={[{ key: 'a', label: 'Delivered', color: COLORS.green }]} />
        </Card>
        <Card title="By status"><Donut centerLabel="deliveries" segments={donut} /></Card>
      </div>
      <Card title="Deliveries completed by driver"><HBars rows={byDriver} color={COLORS.green} empty="No completed deliveries yet." /></Card>

      <div>
        <h2 className="font-semibold mb-2">Collections waiting to be scheduled</h2>
        <DataTable columns={waitingColumns} rows={(eligible ?? []).map((c) => ({ ...c }))} emptyMessage="Every collection already has a delivery." />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">All deliveries</h2>
          <div className="flex gap-2">
            <input className="input max-w-xs" placeholder="Search delivery, customer, driver…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="input max-w-[170px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="scheduled">Scheduled</option><option value="in_transit">In transit</option>
              <option value="delivered">Delivered</option><option value="failed">Failed</option>
            </select>
          </div>
        </div>
        {isLoading ? <div className="card h-48 animate-pulse" /> : (
          <DataTable columns={columns} rows={filtered} onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No deliveries yet." />
        )}
      </div>

      {sel && (
        <DetailPanel title={`Delivery note ${sel.internal_ref}`} subtitle={`${sel.customer} — ${sel.driver_name}`} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Customer">{sel.customer}</Field>
            <Field label="Status"><StatusBadge status={sel.status} /></Field>
            <Field label="Order">{sel.order_ref}</Field>
            <Field label="Collection">{sel.collection_ref}</Field>
            <Field label="Driver">{sel.driver_name}</Field>
            <Field label="Vehicle">{sel.vehicle_reg}</Field>
            <Field label="Scheduled">{formatDate(sel.scheduled_date)}</Field>
            <Field label="Collected by worker">{sel.worker}</Field>
            <Field label="Dispatched">{stamp(sel.dispatched_at)}</Field>
            <Field label="Delivered">{stamp(sel.delivered_at)}</Field>
            <Field label="Received by">{sel.received_by_name}</Field>
            <Field label="Deliver to">{sel.delivery_address}</Field>
          </div>
          {sel.failure_reason && <p className="text-sm text-red-500">Failed: {sel.failure_reason}</p>}
          {sel.notes && <p className="text-sm text-slate-500">Notes: {sel.notes}</p>}
          <DataTable rowKey="product_id" rows={sel.items}
            columns={[{ key: 'product', header: 'Product' }, { key: 'quantity', header: 'Quantity' }]} />
          <div className="grid grid-cols-2 gap-10 pt-8 text-xs text-slate-500">
            <div className="border-t border-slate-400 pt-1">Driver (name and signature)</div>
            <div className="border-t border-slate-400 pt-1">Received by (name, signature and date)</div>
          </div>
          <div className="flex gap-2 no-print">{actions(sel)}</div>
        </DetailPanel>
      )}
    </div>
  )
}