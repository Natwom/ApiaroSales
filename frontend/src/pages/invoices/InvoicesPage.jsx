import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { Plus, Trash2, Eye, Download, Receipt, Banknote, AlertTriangle, Clock } from 'lucide-react'
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
  useInvoices, useOrders, useOrganizations, useProducts, useLpos, useWorkers, nameMap, apiError,
} from '../../hooks/useLookups'

const DAY = 86400000
const num = (v) => Number(v ?? 0)
const iso = (d) => d.toISOString().slice(0, 10)
const parseDay = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00`)
const EMPTY = () => ({
  organization_id: '', order_id: '', invoice_date: iso(new Date()),
  due_date: iso(new Date(Date.now() + 30 * DAY)), tax_rate: 0,
  items: [{ product_id: '', description: '', quantity: 1, unit_price: '' }],
})

export default function InvoicesPage() {
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
  const [range, setRange] = useState('all')
  const [months, setMonths] = useState(6)

  const { data: invoices, isLoading } = useInvoices()
  const { data: orders } = useOrders()
  const { data: orgs } = useOrganizations()
  const { data: products } = useProducts()
  const { data: lpos } = useLpos()
  const { data: workers } = useWorkers()
  const { data: payments } = useQuery({
    queryKey: ['payments'],
    queryFn: async () => (await api.get('/payments/customer')).data,
    enabled: hasPermission('payment.record'),
  })

  const { register, handleSubmit, control, watch, setValue, reset } = useForm({ defaultValues: EMPTY() })
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' })
  const orgId = watch('organization_id')
  const orderId = watch('order_id')
  const formItems = watch('items')
  const formTax = num(watch('tax_rate'))

  const orgNames = nameMap(orgs)
  const productNames = nameMap(products)
  const orderRefs = nameMap(orders, 'internal_ref')
  const lpoNos = nameMap(lpos, 'customer_lpo_no')
  const workerNames = nameMap(workers, 'full_name')
  const orderById = useMemo(() => Object.fromEntries((orders ?? []).map((o) => [o.id, o])), [orders])
  const orgOrders = (orders ?? []).filter((o) => String(o.organization_id) === String(orgId))

  const todayD = new Date(); todayD.setHours(0, 0, 0, 0)

  const enriched = useMemo(
    () => (invoices ?? []).map((i) => {
      const o = orderById[i.order_id]
      const out = num(i.total) - num(i.paid_amount)
      const daysOver = out > 0 && i.due_date ? Math.floor((todayD - parseDay(i.due_date)) / DAY) : 0
      return {
        ...i,
        customer: orgNames[i.organization_id] ?? '…',
        worker: o?.worker_id ? workerNames[o.worker_id] ?? '—' : '—',
        worker_id: o?.worker_id ?? null,
        outstanding: out,
        daysOver,
        overdue: daysOver > 0,
        order_ref: o?.internal_ref ?? null,
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, orderById, orgs, workers],
  )

  const filtered = enriched
    .filter((i) => !customerFilter || String(i.organization_id) === customerFilter)
    .filter((i) => !workerFilter || String(i.worker_id) === workerFilter)
    .filter((i) => !statusFilter || (statusFilter === 'overdue' ? i.overdue : i.status === statusFilter))
    .filter((i) => range === 'all' || Date.now() - parseDay(i.invoice_date).getTime() <= Number(range) * DAY)
    .filter((i) => {
      const q = search.trim().toLowerCase()
      return !q || [i.internal_ref, i.customer, i.worker, i.order_ref]
        .some((x) => String(x ?? '').toLowerCase().includes(q))
    })

  // ---------- KPIs ----------
  const invoiced = filtered.reduce((s, i) => s + num(i.total), 0)
  const paid = filtered.reduce((s, i) => s + num(i.paid_amount), 0)
  const out = invoiced - paid
  const overdueList = filtered.filter((i) => i.overdue)
  const overdueAmt = overdueList.reduce((s, i) => s + i.outstanding, 0)
  const rate = invoiced > 0 ? Math.round((paid / invoiced) * 100) : 0

  // ---------- charts ----------
  const chartData = useMemo(() => {
    const now = new Date()
    const b = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      b.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-KE', { month: 'short' }), a: 0, b: 0,
      })
    }
    filtered.forEach((i) => {
      const x = b.find((m) => m.key === String(i.invoice_date).slice(0, 7))
      if (x) { x.a += num(i.total); x.b += num(i.paid_amount) }
    })
    return b
  }, [filtered, months])

  const donut = [
    { label: 'Not paid', value: filtered.filter((i) => i.status === 'unpaid').length, color: COLORS.red },
    { label: 'Part paid', value: filtered.filter((i) => i.status === 'partially_paid').length, color: COLORS.amber },
    { label: 'Fully paid', value: filtered.filter((i) => i.status === 'fully_paid').length, color: COLORS.green },
  ]
  const aging = [
    { label: 'Not yet due', value: 0, color: COLORS.green },
    { label: '1–30 days overdue', value: 0, color: COLORS.amber },
    { label: '31–60 days overdue', value: 0, color: '#f97316' },
    { label: '61–90 days overdue', value: 0, color: COLORS.red },
    { label: 'Over 90 days', value: 0, color: '#991b1b' },
  ]
  filtered.forEach((i) => {
    if (i.outstanding <= 0) return
    const d = i.daysOver
    aging[d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4].value += i.outstanding
  })
  const owing = Object.entries(
    filtered.reduce((m, i) => ({ ...m, [i.customer]: (m[i.customer] ?? 0) + i.outstanding }), {}),
  ).map(([l, value]) => ({ label: l, value })).filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value).slice(0, 5)

  // ---------- form ----------
  // Quantity already invoiced per order+product, so pre-fill only offers what is not yet billed.
  const invoicedQty = useMemo(() => {
    const m = {}
    ;(invoices ?? []).forEach((inv) => {
      if (!inv.order_id) return
      inv.items.forEach((it) => {
        const k = `${inv.order_id}:${it.product_id}`
        m[k] = (m[k] ?? 0) + num(it.quantity)
      })
    })
    return m
  }, [invoices])

  const onOrderChange = (e) => {
    const order = orderById[e.target.value]
    if (!order) return
    const lines = order.items
      .map((i) => ({
        product_id: String(i.product_id), description: '',
        quantity: i.qty_collected - (invoicedQty[`${order.id}:${i.product_id}`] ?? 0),
        unit_price: i.unit_price,
      }))
      .filter((l) => l.quantity > 0)
    replace(lines.length ? lines : EMPTY().items)
    setValue('tax_rate', order.tax_rate ?? 0)
    if (!lines.length) setError('Everything collected on this order has already been invoiced (or nothing is collected yet).')
    else setError('')
  }

  const subtotal = (formItems ?? []).reduce((s, i) => s + num(i.quantity) * num(i.unit_price), 0)
  const tax = (subtotal * formTax) / 100

  const mutation = useMutation({
    mutationFn: (payload) => api.post('/invoices', payload),
    onSuccess: (res) => {
      ;['invoices', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      setShowForm(false); reset(EMPTY()); setError('')
      setNotice(`Invoice ${res.data?.internal_ref ?? ''} created and posted to the books.`)
    },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to create invoice')) },
  })

  const onSubmit = (v) =>
    mutation.mutate({
      organization_id: Number(v.organization_id),
      order_id: v.order_id ? Number(v.order_id) : null,
      lpo_id: v.order_id ? orderById[v.order_id]?.lpo_id ?? null : null,
      invoice_date: v.invoice_date,
      due_date: v.due_date || null,
      tax_rate: String(v.tax_rate || 0),
      items: v.items.map((i) => ({
        product_id: Number(i.product_id),
        description: i.description || null,
        quantity: Number(i.quantity),
        unit_price: String(i.unit_price || 0),
      })),
    })

  const exportCsv = () =>
    downloadCsv(`invoices-${iso(new Date())}.csv`,
      ['Invoice', 'Date', 'Due', 'Customer', 'Worker', 'Order', 'Total', 'Paid', 'Outstanding', 'Days overdue', 'Status'],
      filtered.map((i) => [i.internal_ref, i.invoice_date, i.due_date ?? '', i.customer, i.worker, i.order_ref ?? '',
        num(i.total).toFixed(2), num(i.paid_amount).toFixed(2), i.outstanding.toFixed(2), i.daysOver > 0 ? i.daysOver : 0, i.status]))

  const columns = [
    { key: 'internal_ref', header: 'Invoice', sortable: true },
    { key: 'customer', header: 'Customer', sortable: true, render: (r) => <span className="font-medium">{r.customer}</span> },
    { key: 'worker', header: 'Worker', sortable: true },
    { key: 'invoice_date', header: 'Date', sortable: true, render: (r) => formatDate(r.invoice_date) },
    {
      key: 'due_date', header: 'Due',
      render: (r) => (
        <span className={r.overdue ? 'text-red-500' : ''}>
          {formatDate(r.due_date)}{r.overdue ? ` · ${r.daysOver}d late` : ''}
        </span>
      ),
    },
    { key: 'total', header: 'Total', sortable: true, render: (r) => formatKES(r.total) },
    { key: 'paid_amount', header: 'Paid', render: (r) => <span className="text-green-600">{formatKES(r.paid_amount)}</span> },
    {
      key: 'outstanding', header: 'Outstanding', sortable: true,
      render: (r) => <span className={r.outstanding > 0 ? 'text-red-500 font-medium' : ''}>{formatKES(r.outstanding)}</span>,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'view', header: '',
      render: (r) => (
        <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id) }}>
          <Eye size={14} /> View
        </button>
      ),
    },
  ]

  const inv = enriched.find((i) => i.id === selectedId)
  const invPayments = inv
    ? (payments ?? [])
        .filter((p) => p.allocations.some((a) => a.invoice_id === inv.id))
        .map((p) => ({
          ...p,
          applied: p.allocations.filter((a) => a.invoice_id === inv.id).reduce((s, a) => s + num(a.amount), 0),
        }))
    : []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Invoices cover goods already collected. Click a row for the printable invoice and its payments.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {hasPermission('invoice.create') && (
            <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}>
              <Plus size={16} /> New Invoice
            </button>
          )}
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-red-500">{error}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Customer *</label>
            <select className="input" {...register('organization_id', {
              required: true, onChange: () => setValue('order_id', ''),
            })}>
              <option value="">Select…</option>
              {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Order (pre-fills goods not yet invoiced)</label>
            <select className="input" {...register('order_id', { onChange: onOrderChange })}>
              <option value="">No order</option>
              {orgOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.internal_ref} — {workerNames[o.worker_id] ?? 'no worker'} — {o.status.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Tax rate (%)</label>
            <input type="number" step="0.01" min="0" className="input" {...register('tax_rate')} />
          </div>
          <div>
            <label className="label">Invoice date *</label>
            <input type="date" className="input" {...register('invoice_date', { required: true })} />
          </div>
          <div>
            <label className="label">Due date (default 30 days)</label>
            <input type="date" className="input" {...register('due_date')} />
          </div>
          <div />

          <div className="md:col-span-3 space-y-2">
            <div className="label">Items</div>
            {fields.map((f, idx) => (
              <div key={f.id} className="grid grid-cols-12 gap-2">
                <div className="col-span-4">
                  <select className="input" {...register(`items.${idx}.product_id`, { required: true })}>
                    <option value="">Product…</option>
                    {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <input className="input" placeholder="Description" {...register(`items.${idx}.description`)} />
                </div>
                <div className="col-span-2">
                  <input type="number" min="1" className="input" placeholder="Qty"
                    {...register(`items.${idx}.quantity`, { required: true, min: 1 })} />
                </div>
                <div className="col-span-2">
                  <input type="number" step="0.01" min="0" className="input" placeholder="Unit price"
                    {...register(`items.${idx}.unit_price`, { required: true })} />
                </div>
                <div className="col-span-1">
                  <button type="button" className="btn-secondary" disabled={fields.length === 1} onClick={() => remove(idx)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button type="button" className="btn-secondary"
                onClick={() => append({ product_id: '', description: '', quantity: 1, unit_price: '' })}>
                <Plus size={14} /> Add item
              </button>
              <div className="text-sm space-y-0.5 min-w-[220px]">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatKES(subtotal)}</span></div>
                <div className="flex justify-between"><span>Tax ({formTax}%)</span><span>{formatKES(tax)}</span></div>
                <div className="flex justify-between font-semibold border-t pt-0.5"><span>Total</span><span>{formatKES(subtotal + tax)}</span></div>
              </div>
            </div>
            {orderId && (
              <p className="text-xs text-slate-500">
                Only goods already collected on this order can be invoiced.
              </p>
            )}
          </div>

          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? 'Saving…' : 'Create Invoice'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search invoice, customer, worker…"
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
        <select className="input max-w-[170px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="unpaid">Not paid</option>
          <option value="partially_paid">Partially paid</option>
          <option value="fully_paid">Fully paid</option>
          <option value="overdue">Overdue</option>
        </select>
        <select className="input max-w-[150px]" value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="all">All time</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={Receipt} label="Invoices" value={filtered.length} />
        <Kpi icon={Receipt} label="Total invoiced" value={formatKES(invoiced)} />
        <Kpi icon={Banknote} tone="green" label="Paid" value={formatKES(paid)} sub={`${rate}% of invoiced`} />
        <Kpi icon={Clock} tone="amber" label="Not paid" value={formatKES(out)} />
        <Kpi icon={AlertTriangle} tone="red" label="Overdue" value={formatKES(overdueAmt)} sub={`${overdueList.length} invoices`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Invoiced vs paid per month" className="lg:col-span-2"
          action={
            <select className="input max-w-[130px]" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value={3}>Last 3 months</option>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
            </select>
          }>
          <AreaChart data={chartData} height={210} series={[
            { key: 'a', label: 'Invoiced', color: COLORS.brand },
            { key: 'b', label: 'Paid', color: COLORS.green },
          ]} />
        </Card>
        <Card title="Invoices by status"><Donut centerLabel="invoices" segments={donut} /></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Money owed by age"><MoneyBars rows={aging} empty="No unpaid invoices." /></Card>
        <Card title="Customers who owe the most"><MoneyBars rows={owing} color={COLORS.red} empty="Nobody owes anything." /></Card>
      </div>

      {isLoading ? (
        <div className="card h-48 animate-pulse" />
      ) : (
        <DataTable columns={columns} rows={filtered}
          onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No invoices match." />
      )}

      {inv && (
        <DetailPanel title={`Invoice ${inv.internal_ref}`} subtitle="Apiaro Contractors and Supplies Ltd"
          onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Bill to">{inv.customer}</Field>
            <Field label="Worker">{inv.worker}</Field>
            <Field label="Status"><StatusBadge status={inv.status} /></Field>
            <Field label="Invoice date">{formatDate(inv.invoice_date)}</Field>
            <Field label="Due date">
              {formatDate(inv.due_date)}{inv.overdue ? ` (${inv.daysOver} days overdue)` : ''}
            </Field>
            <Field label="Order">{inv.order_ref ?? (inv.order_id ? `#${inv.order_id}` : null)}</Field>
            <Field label="LPO No.">{inv.lpo_id ? lpoNos[inv.lpo_id] ?? `#${inv.lpo_id}` : null}</Field>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Items</h3>
            <DataTable rowKey="_n" rows={inv.items.map((i, n) => ({ ...i, _n: n }))}
              columns={[
                { key: 'product_id', header: 'Product', render: (r) => productNames[r.product_id] ?? r.product_id },
                { key: 'description', header: 'Description' },
                { key: 'quantity', header: 'Qty' },
                { key: 'unit_price', header: 'Unit price', render: (r) => formatKES(r.unit_price) },
                { key: 'line_total', header: 'Line total', render: (r) => formatKES(r.line_total) },
              ]} />
          </div>

          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatKES(inv.subtotal)}</span></div>
            <div className="flex justify-between"><span>Tax</span><span>{formatKES(inv.tax_amount)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-1"><span>Total</span><span>{formatKES(inv.total)}</span></div>
            <div className="flex justify-between text-green-600"><span>Paid</span><span>{formatKES(inv.paid_amount)}</span></div>
            <div className="flex justify-between font-semibold text-red-500"><span>Balance due</span><span>{formatKES(inv.outstanding)}</span></div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Payments applied</h3>
            {!hasPermission('payment.record') ? (
              <p className="text-sm text-slate-500">You don't have permission to view payments.</p>
            ) : (
              <DataTable rows={invPayments} emptyMessage="No payments recorded against this invoice."
                columns={[
                  { key: 'internal_ref', header: 'Payment' },
                  { key: 'payment_date', header: 'Date', render: (r) => formatDate(r.payment_date) },
                  { key: 'method', header: 'Method', render: (r) => r.method.replaceAll('_', ' ') },
                  { key: 'transaction_ref', header: 'Transaction Ref' },
                  { key: 'applied', header: 'Applied', render: (r) => formatKES(r.applied) },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                ]} />
            )}
            <p className="text-xs text-slate-500 mt-1">Only verified payments reduce the balance.</p>
          </div>

          {inv.outstanding > 0 && hasPermission('payment.record') && (
            <div className="no-print">
              <Link to="/payments" className="btn-primary inline-flex">Record a payment for this invoice</Link>
            </div>
          )}
        </DetailPanel>
      )}
    </div>
  )
}