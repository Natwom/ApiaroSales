import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { Plus, Trash2, Eye, Download, ClipboardList, Clock, Truck, Wallet, PackageCheck } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import AreaChart from '../../components/common/AreaChart'
import { Donut, COLORS } from '../../components/common/Charts'
import { Kpi, Card, MoneyBars, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatKES, formatDate } from '../../utils/format'
import { useProducts, useWarehouses, nameMap, apiError } from '../../hooks/useLookups'

const num = (v) => Number(v ?? 0)
const iso = (d) => d.toISOString().slice(0, 10)
const OPEN = ['approved', 'partially_received']
const EMPTY = () => ({
  supplier_id: '', order_date: iso(new Date()), expected_date: '', notes: '',
  items: [{ product_id: '', quantity: 1, unit_cost: '' }],
})

function Progress({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="w-32">
      <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div className="h-2 rounded bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{done} of {total} received</div>
    </div>
  )
}

export default function ProcurementPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [months, setMonths] = useState(6)
  const [recv, setRecv] = useState({ warehouse_id: '', reference: '', batch_no: '', expiry_date: '', qtys: {} })

  const { data: pos, isLoading, error: loadError } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => (await api.get('/procurement')).data,
  })
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data,
  })
  const { data: products } = useProducts()
  const { data: warehouses } = useWarehouses()

  const { register, handleSubmit, control, setValue, watch, reset } = useForm({ defaultValues: EMPTY() })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const formItems = watch('items')

  const supplierNames = nameMap(suppliers)
  const productNames = nameMap(products)

  const enriched = useMemo(() => (pos ?? []).map((p) => {
    const ordered = p.items.reduce((s, i) => s + i.quantity, 0)
    const received = p.items.reduce((s, i) => s + i.qty_received, 0)
    const receivedValue = p.items.reduce((s, i) => s + i.qty_received * num(i.unit_cost), 0)
    return { ...p, supplier: supplierNames[p.supplier_id] ?? '…', ordered, received, receivedValue }
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [pos, suppliers])

  const filtered = enriched
    .filter((p) => !supplierFilter || String(p.supplier_id) === supplierFilter)
    .filter((p) => !statusFilter || p.status === statusFilter)
    .filter((p) => {
      const q = search.trim().toLowerCase()
      return !q || [p.internal_ref, p.supplier, p.notes].some((x) => String(x ?? '').toLowerCase().includes(q))
    })

  const pending = filtered.filter((p) => p.status === 'pending_approval')
  const inbound = filtered.filter((p) => OPEN.includes(p.status))
  const counted = filtered.filter((p) => p.status !== 'cancelled')
  const spend = counted.reduce((s, p) => s + num(p.total), 0)
  const owedInbound = inbound.reduce((s, p) => s + (num(p.total) - p.receivedValue), 0)

  const chartData = useMemo(() => {
    const now = new Date(); const b = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      b.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-KE', { month: 'short' }), a: 0 })
    }
    counted.forEach((p) => { const x = b.find((m) => m.key === String(p.order_date).slice(0, 7)); if (x) x.a += num(p.total) })
    return b
  }, [counted, months])

  const donut = [
    { label: 'Awaiting approval', value: filtered.filter((p) => p.status === 'pending_approval').length, color: COLORS.amber },
    { label: 'Awaiting goods', value: filtered.filter((p) => p.status === 'approved').length, color: COLORS.brand },
    { label: 'Part received', value: filtered.filter((p) => p.status === 'partially_received').length, color: '#6366f1' },
    { label: 'Received', value: filtered.filter((p) => p.status === 'fully_received').length, color: COLORS.green },
    { label: 'Cancelled', value: filtered.filter((p) => p.status === 'cancelled').length, color: COLORS.slate },
  ]
  const bySupplier = Object.entries(counted.reduce((m, p) => ({ ...m, [p.supplier]: (m[p.supplier] ?? 0) + num(p.total) }), {}))
    .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5)

  // form
  const fillCost = (idx, pid) => {
    const p = (products ?? []).find((x) => String(x.id) === String(pid))
    if (p) setValue(`items.${idx}.unit_cost`, p.purchase_price)
  }
  const formTotal = (formItems ?? []).reduce((s, i) => s + num(i.quantity) * num(i.unit_cost), 0)

  const refresh = () => ['purchase-orders', 'stock-levels', 'stock-movements', 'stock-trend', 'dashboard']
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }))

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/procurement', payload),
    onSuccess: (res) => {
      refresh(); setShowForm(false); reset(EMPTY()); setError('')
      setNotice(`Purchase order ${res.data?.internal_ref ?? ''} created. A different user must approve it.`)
    },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to create purchase order')) },
  })
  const approveMutation = useMutation({
    mutationFn: ({ id, approve, reason }) => api.post(`/procurement/${id}/approve`, { approve, reason: reason || null }),
    onSuccess: (_r, v) => { refresh(); setError(''); setNotice(v.approve ? 'Purchase order approved. Goods can now be received.' : 'Purchase order rejected.') },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Action failed')) },
  })
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/procurement/${id}/cancel`, { approve: false, reason }),
    onSuccess: () => { refresh(); setError(''); setNotice('Purchase order cancelled.') },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Action failed')) },
  })
  const receiveMutation = useMutation({
    mutationFn: ({ id, body }) => api.post(`/procurement/${id}/receive`, body),
    onSuccess: () => {
      refresh(); setError(''); setRecv((r) => ({ ...r, qtys: {}, reference: '', batch_no: '', expiry_date: '' }))
      setNotice('Goods received and added to stock.')
    },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to receive goods')) },
  })

  const onReject = (p) => {
    const reason = window.prompt('Reject purchase order — reason (required):')
    if (reason && reason.trim()) approveMutation.mutate({ id: p.id, approve: false, reason: reason.trim() })
  }
  const onCancel = (p) => {
    const reason = window.prompt('Cancel purchase order — reason (required):')
    if (reason && reason.trim()) cancelMutation.mutate({ id: p.id, reason: reason.trim() })
  }

  const onSubmit = (v) =>
    createMutation.mutate({
      supplier_id: Number(v.supplier_id), order_date: v.order_date,
      expected_date: v.expected_date || null, notes: v.notes || null,
      items: v.items.map((i) => ({ product_id: Number(i.product_id), quantity: Number(i.quantity), unit_cost: String(i.unit_cost || 0) })),
    })

  const sel = enriched.find((p) => p.id === selectedId)
  const openDetail = (p) => {
    setSelectedId(p.id)
    setRecv({ warehouse_id: String((warehouses ?? [])[0]?.id ?? ''), reference: '', batch_no: '', expiry_date: '', qtys: {} })
  }

  const submitReceive = () => {
    const items = sel.items.filter((i) => num(recv.qtys[i.id]) > 0)
      .map((i) => ({ item_id: i.id, quantity: Number(recv.qtys[i.id]) }))
    if (!recv.warehouse_id) { setError('Choose the warehouse the goods go into.'); return }
    if (items.length === 0) { setError('Enter a quantity for at least one item.'); return }
    receiveMutation.mutate({
      id: sel.id,
      body: {
        warehouse_id: Number(recv.warehouse_id), reference: recv.reference || null,
        batch_no: recv.batch_no || null, expiry_date: recv.expiry_date || null, items,
      },
    })
  }
  const receiveAll = () =>
    setRecv((r) => ({ ...r, qtys: Object.fromEntries(sel.items.filter((i) => i.outstanding_qty > 0).map((i) => [i.id, String(i.outstanding_qty)])) }))

  const canApprove = (p) => p.status === 'pending_approval' && hasPermission('invoice.approve')
  const approveButtons = (p) => canApprove(p) && (
    <>
      <button className="btn-primary" disabled={approveMutation.isPending}
        onClick={() => approveMutation.mutate({ id: p.id, approve: true, reason: 'Approved' })}>Approve</button>
      <button className="btn-secondary" disabled={approveMutation.isPending} onClick={() => onReject(p)}>Reject</button>
    </>
  )

  const exportCsv = () =>
    downloadCsv(`purchase-orders-${iso(new Date())}.csv`,
      ['PO', 'Supplier', 'Order date', 'Expected', 'Ordered', 'Received', 'Total', 'Status'],
      filtered.map((p) => [p.internal_ref, p.supplier, p.order_date, p.expected_date ?? '', p.ordered, p.received, num(p.total).toFixed(2), p.status]))

  const columns = [
    { key: 'internal_ref', header: 'PO', sortable: true },
    { key: 'supplier', header: 'Supplier', sortable: true, render: (r) => <span className="font-medium">{r.supplier}</span> },
    { key: 'order_date', header: 'Ordered', sortable: true, render: (r) => formatDate(r.order_date) },
    { key: 'expected_date', header: 'Expected', render: (r) => formatDate(r.expected_date) },
    { key: 'progress', header: 'Received', render: (r) => <Progress done={r.received} total={r.ordered} /> },
    { key: 'total', header: 'Total', sortable: true, render: (r) => formatKES(r.total) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions', header: '',
      render: (r) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button className="btn-secondary" onClick={() => openDetail(r)}><Eye size={14} /> View</button>
          {approveButtons(r)}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Procurement</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Purchase orders to suppliers. A different user approves each one, then goods are received against it into stock.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {hasPermission('inventory.receive') && (
            <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}>
              <Plus size={16} /> New Purchase Order
            </button>
          )}
        </div>
      </div>

      {(error || loadError) && <div className="card p-3 text-sm text-red-500">{error || apiError(loadError)}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {pending.length > 0 && hasPermission('invoice.approve') && statusFilter !== 'pending_approval' && (
        <div className="card p-4 border-l-4 border-l-amber-500 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm"><b>{pending.length}</b> purchase order{pending.length > 1 ? 's' : ''} waiting for approval.</span>
          <button className="btn-secondary" onClick={() => setStatusFilter('pending_approval')}>Show them</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Supplier *</label>
            <select className="input" {...register('supplier_id', { required: true })}>
              <option value="">Select supplier…</option>
              {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {(suppliers ?? []).length === 0 && <p className="text-xs text-amber-600 mt-1">No suppliers yet. Add one under Suppliers first.</p>}
          </div>
          <div><label className="label">Order date *</label><input type="date" className="input" {...register('order_date', { required: true })} /></div>
          <div><label className="label">Expected delivery</label><input type="date" className="input" {...register('expected_date')} /></div>
          <div className="md:col-span-3"><label className="label">Notes</label><input className="input" {...register('notes')} /></div>

          <div className="md:col-span-3 space-y-2">
            <div className="label">Items (each product once)</div>
            {fields.map((f, idx) => (
              <div key={f.id} className="grid grid-cols-12 gap-2">
                <div className="col-span-6">
                  <select className="input" {...register(`items.${idx}.product_id`, { required: true, onChange: (e) => fillCost(idx, e.target.value) })}>
                    <option value="">Product…</option>
                    {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                </div>
                <div className="col-span-2"><input type="number" min="1" className="input" placeholder="Qty" {...register(`items.${idx}.quantity`, { required: true, min: 1 })} /></div>
                <div className="col-span-3"><input type="number" step="0.01" min="0" className="input" placeholder="Unit cost" {...register(`items.${idx}.unit_cost`, { required: true })} /></div>
                <div className="col-span-1"><button type="button" className="btn-secondary" disabled={fields.length === 1} onClick={() => remove(idx)}><Trash2 size={14} /></button></div>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="btn-secondary" onClick={() => append({ product_id: '', quantity: 1, unit_cost: '' })}><Plus size={14} /> Add item</button>
              <span className="text-sm">Order total: <b>{formatKES(formTotal)}</b></span>
            </div>
          </div>

          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? 'Saving…' : 'Create Purchase Order'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search PO, supplier, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[200px]" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
          <option value="">All suppliers</option>
          {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input max-w-[200px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending_approval">Awaiting approval</option>
          <option value="approved">Awaiting goods</option>
          <option value="partially_received">Part received</option>
          <option value="fully_received">Received</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={ClipboardList} label="Purchase orders" value={filtered.length} />
        <Kpi icon={Wallet} label="Total ordered" value={formatKES(spend)} sub="excluding cancelled" />
        <Kpi icon={Clock} tone="amber" label="Awaiting approval" value={pending.length} />
        <Kpi icon={Truck} tone="amber" label="Goods still to arrive" value={inbound.length} sub={formatKES(owedInbound)} />
        <Kpi icon={PackageCheck} tone="green" label="Fully received" value={filtered.filter((p) => p.status === 'fully_received').length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Purchases per month" className="lg:col-span-2"
          action={
            <select className="input max-w-[130px]" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value={3}>Last 3 months</option><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option>
            </select>
          }>
          <AreaChart data={chartData} height={210} series={[{ key: 'a', label: 'Ordered value', color: COLORS.brand }]} />
        </Card>
        <Card title="Purchase orders by status"><Donut centerLabel="POs" segments={donut} /></Card>
      </div>
      <Card title="Spend by supplier"><MoneyBars rows={bySupplier} color={COLORS.amber} empty="No purchase orders yet." /></Card>

      {isLoading ? <div className="card h-48 animate-pulse" /> : (
        <DataTable columns={columns} rows={filtered} onRowClick={openDetail}
          emptyMessage="No purchase orders yet. Click New Purchase Order to start." />
      )}

      {sel && (
        <DetailPanel title={`Purchase order ${sel.internal_ref}`} subtitle={sel.supplier} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Supplier">{sel.supplier}</Field>
            <Field label="Status"><StatusBadge status={sel.status} /></Field>
            <Field label="Order date">{formatDate(sel.order_date)}</Field>
            <Field label="Expected">{formatDate(sel.expected_date)}</Field>
            <Field label="Total">{formatKES(sel.total)}</Field>
            <Field label="Received value">{formatKES(sel.receivedValue)}</Field>
            <Field label="Notes">{sel.notes}</Field>
          </div>
          <div><h3 className="font-semibold mb-2">Progress</h3><Progress done={sel.received} total={sel.ordered} /></div>
          <DataTable rowKey="id" rows={sel.items}
            columns={[
              { key: 'product_id', header: 'Product', render: (r) => productNames[r.product_id] ?? r.product_id },
              { key: 'quantity', header: 'Ordered' },
              { key: 'qty_received', header: 'Received' },
              { key: 'outstanding_qty', header: 'Outstanding' },
              { key: 'unit_cost', header: 'Unit cost', render: (r) => formatKES(r.unit_cost) },
              { key: 'line', header: 'Value', render: (r) => formatKES(r.quantity * num(r.unit_cost)) },
            ]} />

          {OPEN.includes(sel.status) && hasPermission('inventory.receive') && (
            <div className="no-print rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Receive goods into stock</h3>
                <button className="btn-secondary" onClick={receiveAll}>Receive everything outstanding</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="label">Warehouse *</label>
                  <select className="input" value={recv.warehouse_id} onChange={(e) => setRecv((r) => ({ ...r, warehouse_id: e.target.value }))}>
                    <option value="">Select…</option>
                    {(warehouses ?? []).map((w) => <option key={w.id} value={w.id}>#{w.id} {w.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Supplier delivery note no.</label><input className="input" value={recv.reference} onChange={(e) => setRecv((r) => ({ ...r, reference: e.target.value }))} /></div>
                <div><label className="label">Batch no.</label><input className="input" value={recv.batch_no} onChange={(e) => setRecv((r) => ({ ...r, batch_no: e.target.value }))} /></div>
                <div><label className="label">Expiry date</label><input type="date" className="input" value={recv.expiry_date} onChange={(e) => setRecv((r) => ({ ...r, expiry_date: e.target.value }))} /></div>
              </div>
              {sel.items.filter((i) => i.outstanding_qty > 0).map((i) => (
                <div key={i.id} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-7 text-sm">{productNames[i.product_id] ?? i.product_id}
                    <span className="text-slate-500"> — {i.outstanding_qty} outstanding</span></div>
                  <div className="col-span-5">
                    <input type="number" min="0" max={i.outstanding_qty} className="input" placeholder="Quantity arriving now"
                      value={recv.qtys[i.id] ?? ''} onChange={(e) => setRecv((r) => ({ ...r, qtys: { ...r.qtys, [i.id]: e.target.value } }))} />
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-500">Collections take stock from warehouse #1, so receive goods there unless you plan otherwise.</p>
              <button className="btn-primary" disabled={receiveMutation.isPending} onClick={submitReceive}>
                {receiveMutation.isPending ? 'Saving…' : 'Receive into stock'}
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 no-print">
            {approveButtons(sel)}
            {sel.status === 'approved' && sel.received === 0 && hasPermission('invoice.approve') && (
              <button className="btn-secondary" onClick={() => onCancel(sel)}>Cancel purchase order</button>
            )}
          </div>
        </DetailPanel>
      )}
    </div>
  )
}