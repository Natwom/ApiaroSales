import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { Plus, Trash2, Eye, Download, ShoppingCart, Clock, PackageCheck, CheckCircle2, Wallet } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import AreaChart from '../../components/common/AreaChart'
import { Donut, HBars, COLORS } from '../../components/common/Charts'
import { Kpi, Card, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatKES } from '../../utils/format'
import {
  useOrders, useOrganizations, useProducts, useWorkers, useLpos, nameMap, apiError,
} from '../../hooks/useLookups'

const num = (v) => Number(v ?? 0)
const iso = (d) => d.toISOString().slice(0, 10)
const OPEN_LPO = ['approved', 'partially_fulfilled']
const EMPTY = {
  organization_id: '', lpo_id: '', worker_id: '', required_date: '', discount: 0, tax_rate: 0,
  items: [{ product_id: '', quantity: 1, unit_price: '' }],
}

function Progress({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="w-32">
      <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div className="h-2 rounded bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{done} of {total} collected</div>
    </div>
  )
}

export default function OrdersPage() {
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

  const { data: orders, isLoading } = useOrders()
  const { data: orgs } = useOrganizations()
  const { data: products } = useProducts()
  const { data: workers } = useWorkers()
  const { data: lpos } = useLpos()

  const { register, handleSubmit, control, watch, setValue, reset } = useForm({ defaultValues: EMPTY })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const orgId = watch('organization_id')
  const lpoId = watch('lpo_id')
  const workerId = watch('worker_id')
  const formItems = watch('items')
  const discount = num(watch('discount'))
  const taxRate = num(watch('tax_rate'))

  const orgNames = nameMap(orgs)
  const productNames = nameMap(products)
  const lpoNos = nameMap(lpos, 'customer_lpo_no')
  const workerNames = nameMap(workers, 'full_name')
  const lpoObj = (lpos ?? []).find((l) => String(l.id) === String(lpoId))

  useEffect(() => {
    if (!lpoObj) return
    setValue('organization_id', String(lpoObj.organization_id))
    setValue('worker_id', lpoObj.worker_id ? String(lpoObj.worker_id) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpoObj?.id])

  const enriched = useMemo(() => (orders ?? []).map((o) => ({
    ...o,
    customer: orgNames[o.organization_id] ?? '…',
    worker: workerNames[o.worker_id] ?? '—',
    lpo_no: o.lpo_id ? lpoNos[o.lpo_id] ?? `#${o.lpo_id}` : '—',
    collected: o.items.reduce((s, i) => s + i.qty_collected, 0),
    ordered: o.items.reduce((s, i) => s + i.quantity, 0),
  })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [orders, orgs, workers, lpos])

  const filtered = enriched
    .filter((o) => !customerFilter || String(o.organization_id) === customerFilter)
    .filter((o) => !workerFilter || String(o.worker_id) === workerFilter)
    .filter((o) => !statusFilter || o.status === statusFilter)
    .filter((o) => {
      const q = search.trim().toLowerCase()
      return !q || [o.internal_ref, o.customer, o.worker, o.lpo_no].some((x) => String(x ?? '').toLowerCase().includes(q))
    })

  const pending = filtered.filter((o) => o.status === 'pending_approval')
  const waiting = filtered.filter((o) => ['approved', 'partially_fulfilled'].includes(o.status))
  const done = filtered.filter((o) => o.status === 'fully_fulfilled')
  const totalValue = filtered.reduce((s, o) => s + num(o.total), 0)

  const chartData = useMemo(() => {
    const now = new Date(); const b = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      b.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-KE', { month: 'short' }), a: 0 })
    }
    // Orders carry no date field, so group by the month shown in the reference (created order).
    filtered.forEach((o) => { if (o.created_at) { const x = b.find((m) => m.key === String(o.created_at).slice(0, 7)); if (x) x.a += num(o.total) } })
    return b
  }, [filtered, months])
  const hasDates = filtered.some((o) => o.created_at)

  const donut = [
    { label: 'Awaiting approval', value: pending.length, color: COLORS.amber },
    { label: 'Approved / collecting', value: waiting.length, color: COLORS.brand },
    { label: 'Completed', value: done.length, color: COLORS.green },
  ]
  const byWorker = Object.entries(filtered.reduce((m, o) => ({ ...m, [o.worker]: (m[o.worker] ?? 0) + 1 }), {}))
    .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6)

  // Form
  const openLpos = (lpos ?? []).filter((l) =>
    OPEN_LPO.includes(l.status) && l.total_remaining_to_order > 0 &&
    (!orgId || String(l.organization_id) === String(orgId)) &&
    (!workerId || String(l.worker_id) === String(workerId)))
  const workerOptions = lpoObj
    ? (workers ?? []).filter((w) => w.id === lpoObj.worker_id)
    : (workers ?? []).filter((w) => String(w.organization_id) === String(orgId))
  const productOptions = lpoObj ? (products ?? []).filter((p) => lpoObj.items.some((i) => i.product_id === p.id)) : products ?? []
  const remainingFor = (pid) => lpoObj?.items.find((i) => String(i.product_id) === String(pid))?.remaining_to_order
  const fillPrice = (idx, pid) => {
    const li = lpoObj?.items?.find((i) => String(i.product_id) === String(pid))
    const p = (products ?? []).find((x) => String(x.id) === String(pid))
    setValue(`items.${idx}.unit_price`, li?.unit_price ?? p?.selling_price ?? '')
  }
  const subtotal = (formItems ?? []).reduce((s, i) => s + num(i.quantity) * num(i.unit_price), 0)
  const taxable = Math.max(subtotal - discount, 0)
  const tax = (taxable * taxRate) / 100

  const refresh = () => ['orders', 'lpos', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/orders', payload),
    onSuccess: (res) => {
      refresh(); setShowForm(false); reset(EMPTY); setError('')
      setNotice(`Order ${res.data?.internal_ref ?? ''} created. It needs approval before collection.`)
    },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to create order')) },
  })
  const approveMutation = useMutation({
    mutationFn: (id) => api.post(`/orders/${id}/approve`),
    onSuccess: () => { refresh(); setError(''); setNotice('Order approved. It can now be collected.') },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to approve order')) },
  })

  const onSubmit = (v) => {
    if (lpoObj) {
      for (const i of v.items) {
        const left = remainingFor(i.product_id)
        if (left !== undefined && num(i.quantity) > left) {
          setError(`${productNames[i.product_id] ?? 'Product'}: only ${left} left on the LPO.`)
          return
        }
      }
    }
    createMutation.mutate({
      organization_id: Number(v.organization_id),
      lpo_id: v.lpo_id ? Number(v.lpo_id) : null,
      worker_id: Number(v.worker_id),
      required_date: v.required_date || null,
      discount: String(v.discount || 0),
      tax_rate: String(v.tax_rate || 0),
      items: v.items.map((i) => ({ product_id: Number(i.product_id), quantity: Number(i.quantity), unit_price: String(i.unit_price || 0) })),
    })
  }

  const approveBtn = (o) => o.status === 'pending_approval' && hasPermission('order.approve') && (
    <button className="btn-primary" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(o.id)}>Approve</button>
  )

  const exportCsv = () =>
    downloadCsv(`orders-${iso(new Date())}.csv`,
      ['Order', 'Customer', 'Worker', 'LPO No.', 'Items', 'Ordered', 'Collected', 'Total', 'Status'],
      filtered.map((o) => [o.internal_ref, o.customer, o.worker, o.lpo_no, o.items.length, o.ordered, o.collected, num(o.total).toFixed(2), o.status]))

  const columns = [
    { key: 'internal_ref', header: 'Order', sortable: true },
    { key: 'customer', header: 'Customer', sortable: true, render: (r) => <span className="font-medium">{r.customer}</span> },
    { key: 'worker', header: 'Worker', sortable: true },
    { key: 'lpo_no', header: 'LPO No.', sortable: true },
    { key: 'progress', header: 'Collection', render: (r) => <Progress done={r.collected} total={r.ordered} /> },
    { key: 'total', header: 'Total', sortable: true, render: (r) => formatKES(r.total) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions', header: '',
      render: (r) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button className="btn-secondary" onClick={() => setSelectedId(r.id)}><Eye size={14} /> View</button>
          {approveBtn(r)}
        </div>
      ),
    },
  ]

  const sel = enriched.find((o) => o.id === selectedId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Orders draw from the owner worker's LPO only, and cannot exceed what is left on it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {hasPermission('order.create') && (
            <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}>
              <Plus size={16} /> New Order
            </button>
          )}
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-red-500">{error}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {pending.length > 0 && hasPermission('order.approve') && statusFilter !== 'pending_approval' && (
        <div className="card p-4 border-l-4 border-l-amber-500 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm"><b>{pending.length}</b> order{pending.length > 1 ? 's' : ''} waiting for approval.</span>
          <button className="btn-secondary" onClick={() => setStatusFilter('pending_approval')}>Show them</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Customer *</label>
            <select className="input" {...register('organization_id', { required: true, onChange: () => { setValue('lpo_id', ''); setValue('worker_id', '') } })}>
              <option value="">Select customer…</option>
              {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">LPO (optional)</label>
            <select className="input" {...register('lpo_id')}>
              <option value="">No LPO</option>
              {openLpos.map((l) => (
                <option key={l.id} value={l.id}>
                  {orgNames[l.organization_id] ?? l.organization_id} — {l.customer_lpo_no} — {workerNames[l.worker_id] ?? 'no worker'} — {l.total_remaining_to_order} left to order
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Worker *</label>
            <select className="input" {...register('worker_id', { required: true })}>
              <option value="">Select worker…</option>
              {workerOptions.map((w) => <option key={w.id} value={w.id}>{w.full_name} ({w.employee_no})</option>)}
            </select>
            {lpoObj && <p className="text-xs text-slate-500 mt-1">Fixed to the owner of this LPO.</p>}
            {!lpoObj && orgId && workerOptions.length === 0 && <p className="text-xs text-amber-600 mt-1">No workers for this customer yet.</p>}
          </div>
          <div><label className="label">Required date</label><input type="date" className="input" {...register('required_date')} /></div>
          <div><label className="label">Discount (KSh)</label><input type="number" step="0.01" min="0" className="input" {...register('discount')} /></div>
          <div><label className="label">Tax rate (%)</label><input type="number" step="0.01" min="0" className="input" {...register('tax_rate')} /></div>

          <div className="md:col-span-3 space-y-2">
            <div className="label">Items {lpoObj ? '(only products on the LPO)' : ''}</div>
            {fields.map((f, idx) => {
              const left = remainingFor(formItems?.[idx]?.product_id)
              const over = left !== undefined && num(formItems?.[idx]?.quantity) > left
              return (
                <div key={f.id} className="space-y-1">
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-6">
                      <select className="input" {...register(`items.${idx}.product_id`, { required: true, onChange: (e) => fillPrice(idx, e.target.value) })}>
                        <option value="">Product…</option>
                        {productOptions.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                      </select>
                    </div>
                    <div className="col-span-2"><input type="number" min="1" max={left ?? undefined} className="input" placeholder="Qty" {...register(`items.${idx}.quantity`, { required: true, min: 1 })} /></div>
                    <div className="col-span-3"><input type="number" step="0.01" min="0" className="input" placeholder="Unit price" {...register(`items.${idx}.unit_price`, { required: true })} /></div>
                    <div className="col-span-1"><button type="button" className="btn-secondary" disabled={fields.length === 1} onClick={() => remove(idx)}><Trash2 size={14} /></button></div>
                  </div>
                  {left !== undefined && <p className={`text-xs ${over ? 'text-red-500' : 'text-slate-500'}`}>{over ? 'More than is left on the LPO. ' : ''}Left on the LPO for this product: {left}</p>}
                </div>
              )
            })}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button type="button" className="btn-secondary" onClick={() => append({ product_id: '', quantity: 1, unit_price: '' })}><Plus size={14} /> Add item</button>
              <div className="text-sm space-y-0.5 min-w-[230px]">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatKES(subtotal)}</span></div>
                <div className="flex justify-between"><span>Discount</span><span>− {formatKES(discount)}</span></div>
                <div className="flex justify-between"><span>Tax ({taxRate}%)</span><span>{formatKES(tax)}</span></div>
                <div className="flex justify-between font-semibold border-t pt-0.5"><span>Total</span><span>{formatKES(taxable + tax)}</span></div>
              </div>
            </div>
          </div>

          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? 'Saving…' : 'Create Order'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search order, customer, worker, LPO…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[200px]" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
          <option value="">All customers</option>
          {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="input max-w-[200px]" value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)}>
          <option value="">All workers</option>
          {(workers ?? []).filter((w) => !customerFilter || String(w.organization_id) === customerFilter)
            .map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
        </select>
        <select className="input max-w-[200px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending_approval">Awaiting approval</option>
          <option value="approved">Approved</option>
          <option value="partially_fulfilled">Part collected</option>
          <option value="fully_fulfilled">Completed</option>
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={ShoppingCart} label="Orders" value={filtered.length} />
        <Kpi icon={Wallet} label="Order value" value={formatKES(totalValue)} />
        <Kpi icon={Clock} tone="amber" label="Awaiting approval" value={pending.length} />
        <Kpi icon={PackageCheck} tone="amber" label="Waiting for collection" value={waiting.length} />
        <Kpi icon={CheckCircle2} tone="green" label="Completed" value={done.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {hasDates ? (
          <Card title="Order value per month" className="lg:col-span-2"
            action={
              <select className="input max-w-[130px]" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                <option value={3}>Last 3 months</option><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option>
              </select>
            }>
            <AreaChart data={chartData} height={210} series={[{ key: 'a', label: 'Order value', color: COLORS.brand }]} />
          </Card>
        ) : (
          <Card title="Orders per worker" className="lg:col-span-2"><HBars rows={byWorker} empty="No orders yet." /></Card>
        )}
        <Card title="Orders by status"><Donut centerLabel="orders" segments={donut} /></Card>
      </div>
      {hasDates && <Card title="Orders per worker"><HBars rows={byWorker} empty="No orders yet." /></Card>}

      {isLoading ? <div className="card h-48 animate-pulse" /> : (
        <DataTable columns={columns} rows={filtered} onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No orders match." />
      )}

      {sel && (
        <DetailPanel title={`Order ${sel.internal_ref}`} subtitle={`${sel.customer} — ${sel.worker}`} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Customer">{sel.customer}</Field>
            <Field label="Worker">{sel.worker}</Field>
            <Field label="LPO No.">{sel.lpo_no === '—' ? null : sel.lpo_no}</Field>
            <Field label="Status"><StatusBadge status={sel.status} /></Field>
            <Field label="Total">{formatKES(sel.total)}</Field>
            <Field label="Tax rate">{sel.tax_rate}%</Field>
          </div>
          <div><h3 className="font-semibold mb-2">Collection progress</h3><Progress done={sel.collected} total={sel.ordered} /></div>
          <DataTable rowKey="id" rows={sel.items}
            columns={[
              { key: 'product_id', header: 'Product', render: (r) => productNames[r.product_id] ?? r.product_id },
              { key: 'quantity', header: 'Ordered' },
              { key: 'qty_collected', header: 'Collected' },
              { key: 'remaining_qty', header: 'Remaining' },
              { key: 'unit_price', header: 'Unit price', render: (r) => formatKES(r.unit_price) },
              { key: 'line', header: 'Value', render: (r) => formatKES(r.quantity * num(r.unit_price)) },
            ]} />
          <div className="flex gap-2 no-print">{approveBtn(sel)}</div>
        </DetailPanel>
      )}
    </div>
  )
}