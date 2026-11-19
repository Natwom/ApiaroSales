import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Plus, Download, Eye, PackageCheck, Boxes, Banknote, Clock, ClipboardList } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import AreaChart from '../../components/common/AreaChart'
import { Donut, HBars, COLORS } from '../../components/common/Charts'
import { useAuth } from '../../context/AuthContext'
import { formatKES } from '../../utils/format'
import {
  useOrganizations, useProducts, useWorkers, useLpos, nameMap, apiError,
} from '../../hooks/useLookups'

const EMPTY = { organization_id: '', order_id: '', recipient_name: '' }
const COLLECTABLE = ['approved', 'partially_fulfilled']
const DAY = 86400000

const num = (v) => Number(v ?? 0)
const unitsOf = (c) => c.items.reduce((s, i) => s + num(i.quantity), 0)
const valueOf = (c) => c.items.reduce((s, i) => s + num(i.quantity) * num(i.unit_price), 0)
const dayKey = (v) => new Date(v).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
const stamp = (v) =>
  v ? new Date(v).toLocaleString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Africa/Nairobi',
  }) : '—'

const TONES = {
  brand: 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200',
  green: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
}

function Kpi({ icon: Icon, label, value, sub, tone = 'brand' }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className={`rounded-lg p-2.5 ${TONES[tone]}`}><Icon size={18} /></div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className="text-xl font-semibold truncate">{value}</div>
        {sub && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function Card({ title, action, children, className = '' }) {
  return (
    <div className={`card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function MoneyBars({ rows, color = COLORS.brand, empty }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-xs mb-1 gap-2">
            <span className="truncate">{r.label}</span>
            <span className="font-semibold whitespace-nowrap">{formatKES(r.value)}</span>
          </div>
          <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div className="h-2 rounded" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Progress({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="w-32">
      <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div className="h-2 rounded bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{done} of {total} collected ({pct}%)</div>
    </div>
  )
}

export default function CollectionsPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [qtys, setQtys] = useState({})
  const [selectedId, setSelectedId] = useState(null)

  // filters
  const [search, setSearch] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [workerFilter, setWorkerFilter] = useState('')
  const [range, setRange] = useState('all')
  const [days, setDays] = useState(14)

  const { data: collections, isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: async () => (await api.get('/collections')).data,
  })
  const { data: orders } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => (await api.get('/orders')).data,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const { data: stock } = useQuery({
    queryKey: ['stock-levels'],
    queryFn: async () => (await api.get('/products/stock-levels')).data,
    enabled: hasPermission('inventory.receive'),
    staleTime: 0,
  })
  const { data: orgs } = useOrganizations()
  const { data: products } = useProducts()
  const { data: workers } = useWorkers()
  const { data: lpos } = useLpos()

  const { register, handleSubmit, watch, reset, setValue } = useForm({ defaultValues: EMPTY })
  const orgId = watch('organization_id')
  const orderId = watch('order_id')

  const orgNames = nameMap(orgs)
  const productNames = nameMap(products)
  const workerNames = nameMap(workers, 'full_name')
  const orderRefs = nameMap(orders, 'internal_ref')
  const lpoNos = nameMap(lpos, 'customer_lpo_no')
  const stockOf = Object.fromEntries((stock ?? []).map((s) => [s.product_id, s.available]))

  const orderById = useMemo(() => Object.fromEntries((orders ?? []).map((o) => [o.id, o])), [orders])

  // ---------- enriched + filtered data ----------
  const enriched = useMemo(
    () => (collections ?? []).map((c) => {
      const o = orderById[c.order_id]
      return {
        ...c,
        customer: orgNames[c.organization_id] ?? '…',
        worker: workerNames[c.worker_id] ?? '—',
        order_ref: o?.internal_ref ?? `#${c.order_id}`,
        lpo_no: o?.lpo_id ? lpoNos[o.lpo_id] ?? `#${o.lpo_id}` : '—',
        units: unitsOf(c),
        value: valueOf(c),
        goods: c.items.map((i) => `${productNames[i.product_id] ?? i.product_id} ×${i.quantity}`).join(', '),
      }
    }),
    [collections, orderById, orgNames, workerNames, lpoNos, productNames],
  )

  const scoped = enriched
    .filter((c) => !customerFilter || String(c.organization_id) === customerFilter)
    .filter((c) => !workerFilter || String(c.worker_id) === workerFilter)

  const filtered = scoped
    .filter((c) => range === 'all' || Date.now() - new Date(c.collected_at).getTime() <= Number(range) * DAY)
    .filter((c) => {
      const q = search.trim().toLowerCase()
      return !q || [c.internal_ref, c.order_ref, c.customer, c.worker, c.recipient_name, c.lpo_no, c.goods]
        .some((x) => String(x ?? '').toLowerCase().includes(q))
    })

  const collectable = (orders ?? []).filter(
    (o) => COLLECTABLE.includes(o.status) && o.items.some((i) => i.remaining_qty > 0),
  )
  const awaiting = collectable
    .filter((o) => !customerFilter || String(o.organization_id) === customerFilter)
    .filter((o) => !workerFilter || String(o.worker_id) === workerFilter)

  // ---------- KPIs ----------
  const totalUnits = filtered.reduce((s, c) => s + c.units, 0)
  const totalValue = filtered.reduce((s, c) => s + c.value, 0)
  const unitsLeft = awaiting.reduce((s, o) => s + o.items.reduce((a, i) => a + i.remaining_qty, 0), 0)
  const todayKey = dayKey(new Date())
  const todayCount = scoped.filter((c) => dayKey(c.collected_at) === todayKey).length

  // ---------- charts ----------
  const trendData = useMemo(() => {
    const map = {}
    scoped.forEach((c) => { const k = dayKey(c.collected_at); map[k] = (map[k] ?? 0) + c.units })
    const out = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY)
      out.push({
        label: d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', timeZone: 'Africa/Nairobi' }),
        a: map[dayKey(d)] ?? 0,
      })
    }
    return out
  }, [scoped, days])

  const scopedOrders = (orders ?? [])
    .filter((o) => !customerFilter || String(o.organization_id) === customerFilter)
    .filter((o) => !workerFilter || String(o.worker_id) === workerFilter)
  const donut = [
    { label: 'Not started', value: scopedOrders.filter((o) => o.status === 'approved').length, color: COLORS.slate },
    { label: 'In progress', value: scopedOrders.filter((o) => o.status === 'partially_fulfilled').length, color: COLORS.amber },
    { label: 'Completed', value: scopedOrders.filter((o) => o.status === 'fully_fulfilled').length, color: COLORS.green },
  ]

  const sumBy = (keyFn, valFn) => {
    const m = {}
    filtered.forEach((c) => { const k = keyFn(c); m[k] = (m[k] ?? 0) + valFn(c) })
    return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5)
  }
  const byWorker = sumBy((c) => c.worker, (c) => c.units)
  const byCustomer = sumBy((c) => c.customer, (c) => c.value)
  const byProduct = (() => {
    const m = {}
    filtered.forEach((c) => c.items.forEach((i) => {
      const k = productNames[i.product_id] ?? `Product ${i.product_id}`
      m[k] = (m[k] ?? 0) + num(i.quantity)
    }))
    return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5)
  })()

  // ---------- form ----------
  const eligibleOrders = collectable.filter((o) => !orgId || String(o.organization_id) === String(orgId))
  const order = collectable.find((o) => String(o.id) === String(orderId))
  const orderWorker = order ? (workers ?? []).find((w) => w.id === order.worker_id) : null
  const workerOk = !!orderWorker && orderWorker.collection_authorized

  const openFor = (o) => {
    setShowForm(true)
    setError('')
    setNotice('')
    setQtys({})
    reset({ ...EMPTY, organization_id: String(o.organization_id), order_id: String(o.id) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const fillAll = () => {
    if (!order) return
    setQtys(Object.fromEntries(order.items.filter((i) => i.remaining_qty > 0).map((i) => [i.id, String(i.remaining_qty)])))
  }

  const mutation = useMutation({
    mutationFn: (payload) => api.post('/collections', payload),
    onSuccess: (res) => {
      ;['collections', 'orders', 'lpos', 'stock-levels', 'stock-movements', 'stock-trend', 'dashboard']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      setShowForm(false)
      reset(EMPTY)
      setQtys({})
      setError('')
      setNotice(`Collection ${res.data?.internal_ref ?? ''} recorded and stock deducted.`)
    },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to record collection')) },
  })

  const onSubmit = (v) => {
    if (!order) return
    if (!workerOk) {
      setError('The worker who owns this order is not authorized to collect goods.')
      return
    }
    const items = order.items
      .filter((i) => Number(qtys[i.id]) > 0)
      .map((i) => ({ order_item_id: i.id, quantity: Number(qtys[i.id]) }))
    if (items.length === 0) {
      setError('Enter a quantity for at least one item')
      return
    }
    for (const i of order.items) {
      const q = Number(qtys[i.id] ?? 0)
      if (q > i.remaining_qty) {
        setError(`${productNames[i.product_id] ?? 'Product'}: only ${i.remaining_qty} remaining on this order`)
        return
      }
    }
    mutation.mutate({
      organization_id: Number(v.organization_id),
      order_id: Number(v.order_id),
      worker_id: Number(order.worker_id),
      recipient_name: v.recipient_name || null,
      items,
    })
  }

  const exportCsv = () => {
    const head = ['Reference', 'Date', 'Customer', 'Worker', 'Order', 'LPO No.', 'Recipient', 'Units', 'Value (KSh)', 'Goods']
    const lines = filtered.map((c) => [
      c.internal_ref, stamp(c.collected_at), c.customer, c.worker, c.order_ref, c.lpo_no,
      c.recipient_name ?? '', c.units, c.value.toFixed(2), c.goods,
    ])
    const csv = [head, ...lines].map((l) => l.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `collections-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ---------- tables ----------
  const awaitingColumns = [
    { key: 'internal_ref', header: 'Order', sortable: true },
    { key: 'organization_id', header: 'Customer', render: (r) => <span className="font-medium">{orgNames[r.organization_id] ?? r.organization_id}</span> },
    { key: 'worker_id', header: 'Worker', render: (r) => workerNames[r.worker_id] ?? '—' },
    { key: 'lpo_id', header: 'LPO No.', render: (r) => (r.lpo_id ? lpoNos[r.lpo_id] ?? r.lpo_id : '—') },
    {
      key: 'progress', header: 'Progress',
      render: (r) => (
        <Progress done={r.items.reduce((s, i) => s + i.qty_collected, 0)} total={r.items.reduce((s, i) => s + i.quantity, 0)} />
      ),
    },
    { key: 'remaining', header: 'Left', render: (r) => r.items.reduce((s, i) => s + i.remaining_qty, 0) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions', header: '',
      render: (r) => hasPermission('collection.issue') && (
        <button className="btn-primary" onClick={() => openFor(r)}><PackageCheck size={14} /> Collect</button>
      ),
    },
  ]

  const columns = [
    { key: 'internal_ref', header: 'Reference', sortable: true },
    { key: 'collected_at', header: 'Collected', sortable: true, render: (r) => stamp(r.collected_at) },
    { key: 'customer', header: 'Customer', sortable: true, render: (r) => <span className="font-medium">{r.customer}</span> },
    { key: 'worker', header: 'Worker', sortable: true },
    { key: 'order_ref', header: 'Order' },
    { key: 'units', header: 'Units', sortable: true },
    { key: 'value', header: 'Value', sortable: true, render: (r) => formatKES(r.value) },
    { key: 'goods', header: 'Goods' },
    {
      key: 'view', header: '',
      render: (r) => (
        <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id) }}>
          <Eye size={14} /> View
        </button>
      ),
    },
  ]

  const sel = enriched.find((c) => c.id === selectedId)
  const selOrder = sel ? orderById[sel.order_id] : null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Collections</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Only the worker who owns an order can collect against it. Each collection deducts stock from warehouse #1 automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {hasPermission('collection.issue') && (
            <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}>
              <Plus size={16} /> New Collection
            </button>
          )}
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-red-500">{error}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Customer *</label>
            <select className="input" {...register('organization_id', {
              required: true,
              onChange: () => { setValue('order_id', ''); setQtys({}) },
            })}>
              <option value="">Select…</option>
              {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Order * (approved or partially fulfilled)</label>
            <select className="input" {...register('order_id', {
              required: true,
              onChange: (e) => {
                const o = collectable.find((x) => String(x.id) === e.target.value)
                if (o) setValue('organization_id', String(o.organization_id))
                setQtys({})
              },
            })}>
              <option value="">Select…</option>
              {eligibleOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.internal_ref} — {orgNames[o.organization_id] ?? o.organization_id} — {workerNames[o.worker_id] ?? 'no worker'}
                </option>
              ))}
            </select>
            {eligibleOrders.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                No approved orders with goods remaining{orgId ? ' for this customer' : ''}.
              </p>
            )}
          </div>

          {order && (
            <div className="md:col-span-2 text-sm">
              <span className="label">Collecting worker (owner of this order)</span>
              <div className="font-medium">
                {orderWorker ? `${orderWorker.full_name} (${orderWorker.employee_no})` : 'No worker on this order'}
                {order.lpo_id ? <span className="text-slate-500 font-normal"> · LPO {lpoNos[order.lpo_id] ?? order.lpo_id}</span> : null}
              </div>
              {!workerOk && (
                <p className="text-xs text-amber-600 mt-1">
                  This worker is not authorized to collect goods, so this order cannot be collected until they are.
                </p>
              )}
            </div>
          )}

          <div className="md:col-span-2">
            <label className="label">Recipient name (defaults to the worker)</label>
            <input className="input" {...register('recipient_name')} />
          </div>

          {order && (
            <div className="md:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="label">Quantities to collect now</div>
                <button type="button" className="btn-secondary" onClick={fillAll}>Collect everything remaining</button>
              </div>
              {order.items.map((i) => {
                const q = Number(qtys[i.id] ?? 0)
                const avail = stockOf[i.product_id]
                return (
                  <div key={i.id} className="space-y-1">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-7 text-sm">
                        {productNames[i.product_id] ?? `Product ${i.product_id}`}
                        <span className="text-slate-500"> — remaining {i.remaining_qty} of {i.quantity}</span>
                        {avail !== undefined && <span className="text-slate-500"> · in stock {avail}</span>}
                      </div>
                      <div className="col-span-5">
                        <input type="number" min="0" max={i.remaining_qty} className="input"
                          disabled={i.remaining_qty === 0}
                          value={qtys[i.id] ?? ''}
                          onChange={(e) => setQtys((s) => ({ ...s, [i.id]: e.target.value }))} />
                      </div>
                    </div>
                    {avail !== undefined && q > avail && (
                      <p className="text-xs text-red-500">Only {avail} in stock. The collection will be refused.</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="md:col-span-2 flex gap-2">
            <button type="submit" disabled={mutation.isPending || !workerOk} className="btn-primary">
              {mutation.isPending ? 'Saving…' : 'Record Collection'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search reference, customer, worker, goods…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[200px]" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
          <option value="">All customers</option>
          {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="input max-w-[200px]" value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)}>
          <option value="">All workers</option>
          {(workers ?? [])
            .filter((w) => !customerFilter || String(w.organization_id) === customerFilter)
            .map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
        </select>
        <select className="input max-w-[170px]" value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="all">All time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={ClipboardList} label="Collections" value={filtered.length} sub={`${todayCount} today`} />
        <Kpi icon={Boxes} tone="green" label="Units collected" value={totalUnits} />
        <Kpi icon={Banknote} tone="green" label="Value collected" value={formatKES(totalValue)} />
        <Kpi icon={Clock} tone="amber" label="Orders awaiting collection" value={awaiting.length} />
        <Kpi icon={PackageCheck} tone="amber" label="Units still to collect" value={unitsLeft} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Units collected per day" className="lg:col-span-2"
          action={
            <select className="input max-w-[130px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
            </select>
          }>
          <AreaChart data={trendData} height={210}
            series={[{ key: 'a', label: 'Units collected', color: COLORS.brand }]} />
        </Card>
        <Card title="Order fulfilment">
          <Donut centerLabel="orders" segments={donut} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Units by worker"><HBars rows={byWorker} empty="No collections yet." /></Card>
        <Card title="Most collected products"><HBars rows={byProduct} color={COLORS.green} empty="No collections yet." /></Card>
        <Card title="Value by customer"><MoneyBars rows={byCustomer} color={COLORS.amber} empty="No collections yet." /></Card>
      </div>

      {/* Awaiting */}
      <div>
        <h2 className="font-semibold mb-2">Awaiting collection</h2>
        <DataTable columns={awaitingColumns} rows={awaiting}
          emptyMessage="No approved orders are waiting for collection." />
      </div>

      {/* History */}
      <div>
        <h2 className="font-semibold mb-2">Collection history</h2>
        {isLoading ? (
          <div className="card h-32 animate-pulse" />
        ) : (
          <DataTable columns={columns} rows={filtered}
            onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No collections match." />
        )}
      </div>

      {/* Detail */}
      {sel && (
        <DetailPanel title={`Goods note ${sel.internal_ref}`} subtitle={`${sel.customer} — ${sel.worker}`}
          onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Customer">{sel.customer}</Field>
            <Field label="Collecting worker">{sel.worker}</Field>
            <Field label="Recipient">{sel.recipient_name}</Field>
            <Field label="Collected">{stamp(sel.collected_at)}</Field>
            <Field label="Order">{sel.order_ref}</Field>
            <Field label="LPO No.">{sel.lpo_no}</Field>
            <Field label="Order status">{selOrder ? <StatusBadge status={selOrder.status} /> : null}</Field>
            <Field label="Value">{formatKES(sel.value)}</Field>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Goods released</h3>
            <DataTable rowKey="_n"
              columns={[
                { key: 'product_id', header: 'Product', render: (r) => productNames[r.product_id] ?? r.product_id },
                { key: 'quantity', header: 'Quantity' },
                { key: 'unit_price', header: 'Unit price', render: (r) => formatKES(r.unit_price) },
                { key: 'line', header: 'Value', render: (r) => formatKES(num(r.quantity) * num(r.unit_price)) },
                { key: 'remaining_after', header: 'Left on order after' },
              ]}
              rows={sel.items.map((i, n) => ({ ...i, _n: n }))} />
          </div>

          {selOrder && (
            <div>
              <h3 className="font-semibold mb-2">Order progress now</h3>
              <Progress done={selOrder.items.reduce((s, i) => s + i.qty_collected, 0)}
                total={selOrder.items.reduce((s, i) => s + i.quantity, 0)} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-10 pt-8 text-xs text-slate-500">
            <div className="border-t border-slate-400 pt-1">Released by (Apiaro)</div>
            <div className="border-t border-slate-400 pt-1">Received by (signature and date)</div>
          </div>
        </DetailPanel>
      )}
    </div>
  )
}