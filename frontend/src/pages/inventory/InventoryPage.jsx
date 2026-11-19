import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import {
  Plus, PackagePlus, Warehouse, SlidersHorizontal, Download, AlertTriangle, Boxes, Wallet, TrendingDown,
} from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import { Donut, TrendChart, HBars, StockBar, COLORS } from '../../components/common/Charts'
import { useAuth } from '../../context/AuthContext'
import { formatKES } from '../../utils/format'
import { useProducts, useWarehouses, apiError } from '../../hooks/useLookups'

const orNull = (v) => (v === '' || v === undefined ? null : v)
const stamp = (v) =>
  v ? new Date(v).toLocaleString('en-KE', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi',
  }) : '—'

const TYPE_LABEL = {
  receive: 'Received', issue: 'Collected by customer', adjust: 'Adjustment',
  damage: 'Damaged', return: 'Returned', reserve: 'Reserved', release: 'Released',
}
const signed = (q) => (q < 0 ? `− ${Math.abs(q)}` : `+ ${q}`)

function Kpi({ icon: Icon, label, value, tone }) {
  const color = tone === 'bad' ? 'text-red-500' : tone === 'good' ? 'text-green-600' : tone === 'warn' ? 'text-amber-600' : ''
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className="rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200 p-2"><Icon size={18} /></div>
      <div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className={`text-xl font-semibold ${color}`}>{value}</div>
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  const map = {
    out: ['Out of stock', 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'],
    low: ['Low', 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'],
    ok: ['OK', 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'],
  }
  const [label, cls] = map[status]
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

export default function InventoryPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const [panel, setPanel] = useState(null) // 'product' | 'receive' | 'adjust' | 'warehouse'
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [days, setDays] = useState(14)

  const { data: levels, isLoading } = useQuery({
    queryKey: ['stock-levels'],
    queryFn: async () => (await api.get('/products/stock-levels')).data,
    staleTime: 0, refetchOnMount: 'always',
  })
  const { data: trend } = useQuery({
    queryKey: ['stock-trend', days],
    queryFn: async () => (await api.get('/products/stock-trend', { params: { days } })).data,
    staleTime: 0, refetchOnMount: 'always',
  })
  const { data: recent } = useQuery({
    queryKey: ['stock-movements', 'recent'],
    queryFn: async () => (await api.get('/products/stock-movements', { params: { limit: 25 } })).data,
    staleTime: 0, refetchOnMount: 'always',
  })
  const { data: productMoves } = useQuery({
    queryKey: ['stock-movements', selectedId],
    queryFn: async () => (await api.get('/products/stock-movements', { params: { product_id: selectedId, limit: 200 } })).data,
    enabled: !!selectedId,
    staleTime: 0,
  })
  const { data: products } = useProducts()
  const { data: warehouses } = useWarehouses()

  const productForm = useForm({
    defaultValues: { name: '', sku: '', barcode: '', unit: 'pcs', purchase_price: 0, selling_price: 0, reorder_level: 0, description: '' },
  })
  const receiveForm = useForm({
    defaultValues: { product_id: '', warehouse_id: '', quantity: '', batch_no: '', expiry_date: '', reference: '', notes: '' },
  })
  const adjustForm = useForm({
    defaultValues: { product_id: '', warehouse_id: '', kind: 'damage', quantity: '', reason: '' },
  })
  const warehouseForm = useForm({ defaultValues: { name: '', location: '' } })

  const rows = useMemo(
    () => (levels ?? []).map((l) => ({
      ...l,
      status: l.available <= 0 ? 'out' : l.low_stock ? 'low' : 'ok',
      value: l.available * Number(l.purchase_price),
    })),
    [levels],
  )

  const shown = rows
    .filter((r) => filter === 'all' || (filter === 'attention' ? r.status !== 'ok' : r.status === filter))
    .filter((r) => {
      const q = search.trim().toLowerCase()
      return !q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)
    })

  const kpi = useMemo(() => ({
    products: rows.length,
    units: rows.reduce((s, r) => s + r.available, 0),
    value: rows.reduce((s, r) => s + r.value, 0),
    collected: rows.reduce((s, r) => s + r.collected, 0),
    ok: rows.filter((r) => r.status === 'ok').length,
    low: rows.filter((r) => r.status === 'low').length,
    out: rows.filter((r) => r.status === 'out').length,
  }), [rows])

  const topCollected = [...rows].filter((r) => r.collected > 0)
    .sort((a, b) => b.collected - a.collected).slice(0, 6)
    .map((r) => ({ label: r.name, value: r.collected }))
  const attention = rows.filter((r) => r.status !== 'ok').sort((a, b) => a.available - b.available)

  const refreshAll = () => {
    ;['stock-levels', 'stock-trend', 'stock-movements', 'products', 'warehouses']
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  }
  const done = (msg) => { setError(''); setNotice(msg); setPanel(null); refreshAll() }
  const fail = (e) => { setNotice(''); setError(apiError(e)) }

  const productMutation = useMutation({
    mutationFn: (p) => api.post('/products', p),
    onSuccess: () => { productForm.reset(); done('Product created') }, onError: fail,
  })
  const receiveMutation = useMutation({
    mutationFn: (p) => api.post('/products/receive', p),
    onSuccess: () => { receiveForm.reset(); done('Stock received') }, onError: fail,
  })
  const adjustMutation = useMutation({
    mutationFn: (p) => api.post('/products/adjust', p),
    onSuccess: () => { adjustForm.reset({ product_id: '', warehouse_id: '', kind: 'damage', quantity: '', reason: '' }); done('Stock updated') },
    onError: fail,
  })
  const warehouseMutation = useMutation({
    mutationFn: (p) => api.post('/products/warehouses', p),
    onSuccess: () => { warehouseForm.reset(); done('Warehouse created') }, onError: fail,
  })

  const openPanel = (name, productId) => {
    setSelectedId(null)
    setError(''); setNotice('')
    if (productId) {
      if (name === 'receive') receiveForm.setValue('product_id', String(productId))
      if (name === 'adjust') adjustForm.setValue('product_id', String(productId))
    }
    setPanel((p) => (p === name && !productId ? null : name))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const exportCsv = () => {
    const head = ['Product', 'SKU', 'Received', 'Collected', 'Damaged', 'In stock', 'Reorder level', 'Status', 'Stock value (cost)']
    const lines = shown.map((r) => [r.name, r.sku, r.received, r.collected, r.damaged, r.available, r.reorder_level, r.status, r.value.toFixed(2)])
    const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const columns = [
    { key: 'name', header: 'Product', sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'sku', header: 'SKU', sortable: true },
    { key: 'received', header: 'Received', sortable: true },
    {
      key: 'collected', header: 'Collected', sortable: true,
      render: (r) => <span className={r.collected > 0 ? 'text-red-500' : ''}>{r.collected}</span>,
    },
    {
      key: 'damaged', header: 'Damaged', sortable: true,
      render: (r) => <span className={r.damaged > 0 ? 'text-amber-600' : ''}>{r.damaged}</span>,
    },
    { key: 'available', header: 'In stock', sortable: true, render: (r) => <span className="font-semibold">{r.available}</span> },
    { key: 'level', header: 'Level', render: (r) => <StockBar value={r.available} total={r.received} /> },
    { key: 'value', header: 'Stock value', sortable: true, render: (r) => formatKES(r.value) },
    { key: 'reorder_level', header: 'Reorder at' },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
  ]

  const movementColumns = (showProduct) => [
    { key: 'created_at', header: 'When', render: (r) => stamp(r.created_at) },
    ...(showProduct ? [{ key: 'product', header: 'Product' }] : []),
    {
      key: 'movement_type', header: 'Movement',
      render: (r) => (
        <span className={r.quantity < 0 ? 'text-red-500' : 'text-green-600'}>
          {TYPE_LABEL[r.movement_type] ?? r.movement_type}
        </span>
      ),
    },
    { key: 'quantity', header: 'Qty', render: (r) => <span className="font-medium">{signed(r.quantity)}</span> },
    { key: 'warehouse', header: 'Warehouse' },
    { key: 'reference', header: 'Reference' },
    { key: 'notes', header: 'Notes' },
  ]

  const selected = rows.find((r) => r.product_id === selectedId)
  const wh = warehouses ?? []
  const canAdjust = hasPermission('inventory.adjust')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Live stock. Every customer collection deducts from warehouse #1 automatically. Click a product for its full history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {canAdjust && (
            <>
              <button className="btn-secondary" onClick={() => openPanel('warehouse')}><Warehouse size={16} /> Warehouse</button>
              <button className="btn-secondary" onClick={() => openPanel('product')}><Plus size={16} /> Product</button>
              <button className="btn-secondary" onClick={() => openPanel('adjust')}><SlidersHorizontal size={16} /> Adjust</button>
            </>
          )}
          {hasPermission('inventory.receive') && (
            <button className="btn-primary" onClick={() => openPanel('receive')}><PackagePlus size={16} /> Receive Stock</button>
          )}
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-red-500">{error}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {panel === 'warehouse' && (
        <form onSubmit={warehouseForm.handleSubmit((v) =>
          warehouseMutation.mutate({ name: v.name.trim(), location: orNull(v.location) }))}
          className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="label">Warehouse name *</label><input className="input" {...warehouseForm.register('name', { required: true })} /></div>
          <div><label className="label">Location</label><input className="input" {...warehouseForm.register('location')} /></div>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn-primary" disabled={warehouseMutation.isPending}>Save</button>
            <button type="button" className="btn-secondary" onClick={() => setPanel(null)}>Cancel</button>
          </div>
          <p className="md:col-span-3 text-xs text-slate-500">
            Existing: {wh.map((w) => `#${w.id} ${w.name}`).join(', ') || 'none yet'}. Collections take stock from warehouse #1, so receive goods there.
          </p>
        </form>
      )}

      {panel === 'product' && (
        <form onSubmit={productForm.handleSubmit((v) =>
          productMutation.mutate({
            name: v.name.trim(), sku: v.sku.trim(), barcode: orNull(v.barcode),
            description: orNull(v.description), unit: v.unit || 'pcs',
            purchase_price: String(v.purchase_price || 0), selling_price: String(v.selling_price || 0),
            reorder_level: Number(v.reorder_level || 0),
          }))}
          className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="label">Name *</label><input className="input" {...productForm.register('name', { required: true })} /></div>
          <div><label className="label">SKU * (unique)</label><input className="input" {...productForm.register('sku', { required: true })} /></div>
          <div><label className="label">Barcode</label><input className="input" {...productForm.register('barcode')} /></div>
          <div><label className="label">Unit</label><input className="input" {...productForm.register('unit')} /></div>
          <div><label className="label">Purchase price</label><input type="number" step="0.01" min="0" className="input" {...productForm.register('purchase_price')} /></div>
          <div><label className="label">Selling price</label><input type="number" step="0.01" min="0" className="input" {...productForm.register('selling_price')} /></div>
          <div><label className="label">Reorder level</label><input type="number" min="0" className="input" {...productForm.register('reorder_level')} /></div>
          <div className="md:col-span-2"><label className="label">Description</label><input className="input" {...productForm.register('description')} /></div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" className="btn-primary" disabled={productMutation.isPending}>{productMutation.isPending ? 'Saving…' : 'Save Product'}</button>
            <button type="button" className="btn-secondary" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </form>
      )}

      {panel === 'receive' && (
        <form onSubmit={receiveForm.handleSubmit((v) =>
          receiveMutation.mutate({
            product_id: Number(v.product_id), warehouse_id: Number(v.warehouse_id),
            quantity: Number(v.quantity), batch_no: orNull(v.batch_no),
            expiry_date: orNull(v.expiry_date), reference: orNull(v.reference), notes: orNull(v.notes),
          }))}
          className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Product *</label>
            <select className="input" {...receiveForm.register('product_id', { required: true })}>
              <option value="">Select…</option>
              {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Warehouse *</label>
            <select className="input" {...receiveForm.register('warehouse_id', { required: true })}>
              <option value="">Select…</option>
              {wh.map((w) => <option key={w.id} value={w.id}>#{w.id} {w.name}</option>)}
            </select>
          </div>
          <div><label className="label">Quantity *</label><input type="number" min="1" className="input" {...receiveForm.register('quantity', { required: true, min: 1 })} /></div>
          <div><label className="label">Batch no.</label><input className="input" {...receiveForm.register('batch_no')} /></div>
          <div><label className="label">Expiry date</label><input type="date" className="input" {...receiveForm.register('expiry_date')} /></div>
          <div><label className="label">Reference (GRN / invoice)</label><input className="input" {...receiveForm.register('reference')} /></div>
          <div className="md:col-span-3"><label className="label">Notes</label><input className="input" {...receiveForm.register('notes')} /></div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" className="btn-primary" disabled={receiveMutation.isPending}>{receiveMutation.isPending ? 'Saving…' : 'Receive'}</button>
            <button type="button" className="btn-secondary" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </form>
      )}

      {panel === 'adjust' && (
        <form onSubmit={adjustForm.handleSubmit((v) =>
          adjustMutation.mutate({
            product_id: Number(v.product_id), warehouse_id: Number(v.warehouse_id),
            kind: v.kind, quantity: Number(v.quantity), reason: v.reason.trim(),
          }))}
          className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Product *</label>
            <select className="input" {...adjustForm.register('product_id', { required: true })}>
              <option value="">Select…</option>
              {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Warehouse *</label>
            <select className="input" {...adjustForm.register('warehouse_id', { required: true })}>
              <option value="">Select…</option>
              {wh.map((w) => <option key={w.id} value={w.id}>#{w.id} {w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Action *</label>
            <select className="input" {...adjustForm.register('kind')}>
              <option value="damage">Mark as damaged</option>
              <option value="remove">Remove stock (correction)</option>
              <option value="add">Add stock (correction)</option>
            </select>
          </div>
          <div><label className="label">Quantity *</label><input type="number" min="1" className="input" {...adjustForm.register('quantity', { required: true, min: 1 })} /></div>
          <div className="md:col-span-2"><label className="label">Reason * (kept in the audit log)</label><input className="input" placeholder="e.g. water damage, stock count difference" {...adjustForm.register('reason', { required: true })} /></div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" className="btn-primary" disabled={adjustMutation.isPending}>{adjustMutation.isPending ? 'Saving…' : 'Apply'}</button>
            <button type="button" className="btn-secondary" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={Boxes} label="Products" value={kpi.products} />
        <Kpi icon={Boxes} label="Units in stock" value={kpi.units} />
        <Kpi icon={Wallet} label="Stock value (cost)" value={formatKES(kpi.value)} />
        <Kpi icon={TrendingDown} label="Collected by customers" value={kpi.collected} tone="bad" />
        <Kpi icon={AlertTriangle} label="Need attention" value={kpi.low + kpi.out} tone={kpi.low + kpi.out > 0 ? 'warn' : 'good'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-1">
          <h2 className="font-semibold mb-4">Stock health</h2>
          <Donut centerLabel="products" segments={[
            { label: 'OK', value: kpi.ok, color: COLORS.green },
            { label: 'Low', value: kpi.low, color: COLORS.amber },
            { label: 'Out of stock', value: kpi.out, color: COLORS.red },
          ]} />
        </div>
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Received vs collected</h2>
            <select className="input max-w-[130px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
          <TrendChart data={trend ?? []} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-semibold mb-3">Most collected by customers</h2>
          <HBars rows={topCollected} color={COLORS.red} empty="No collections yet." />
        </div>
        <div className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600" /> Reorder alerts
          </h2>
          {attention.length === 0 ? (
            <p className="text-sm text-green-600">Everything is above its reorder level.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {attention.slice(0, 6).map((r) => (
                <li key={r.product_id} className="flex items-center justify-between py-2 gap-2">
                  <button className="text-left hover:underline" onClick={() => setSelectedId(r.product_id)}>
                    {r.name} <span className="text-slate-500">({r.available} left, reorder at {r.reorder_level})</span>
                  </button>
                  <div className="flex items-center gap-2">
                    <StatusPill status={r.status} />
                    {hasPermission('inventory.receive') && (
                      <button className="btn-secondary" onClick={() => openPanel('receive', r.product_id)}>Receive</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Stock by product</h2>
          <div className="flex gap-2">
            <input className="input max-w-xs" placeholder="Search name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="input max-w-[170px]" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All products</option>
              <option value="attention">Needs attention</option>
              <option value="low">Low</option>
              <option value="out">Out of stock</option>
              <option value="ok">OK</option>
            </select>
          </div>
        </div>
        {isLoading ? (
          <div className="card h-48 animate-pulse" />
        ) : (
          <DataTable columns={columns} rows={shown} rowKey="product_id"
            onRowClick={(r) => setSelectedId(r.product_id)}
            emptyMessage="No products match. Create a warehouse and a product, then receive stock." />
        )}
      </div>

      <div>
        <h2 className="font-semibold mb-2">Latest stock movements</h2>
        <DataTable columns={movementColumns(true)} rows={recent ?? []} emptyMessage="No stock movements yet." />
      </div>

      {selected && (
        <DetailPanel title={selected.name} subtitle={`SKU ${selected.sku} · ${selected.unit}`} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Received in total">{selected.received}</Field>
            <Field label="Collected by customers"><span className="text-red-500">{selected.collected}</span></Field>
            <Field label="Damaged">{selected.damaged}</Field>
            <Field label="In stock now"><span className="font-semibold">{selected.available}</span></Field>
            <Field label="Reorder level">{selected.reorder_level}</Field>
            <Field label="Status"><StatusPill status={selected.status} /></Field>
            <Field label="Cost price">{formatKES(selected.purchase_price)}</Field>
            <Field label="Stock value (cost)">{formatKES(selected.value)}</Field>
          </div>

          <div>
            <h3 className="font-semibold mb-2">By warehouse</h3>
            <DataTable rowKey="warehouse_id" rows={selected.by_warehouse} emptyMessage="No stock held in any warehouse."
              columns={[
                { key: 'warehouse', header: 'Warehouse' },
                { key: 'on_hand', header: 'On hand' },
                { key: 'damaged', header: 'Damaged' },
                { key: 'available', header: 'Available', render: (r) => <span className="font-semibold">{r.available}</span> },
              ]} />
          </div>

          <div>
            <h3 className="font-semibold mb-2">Movement history</h3>
            <DataTable columns={movementColumns(false)} rows={productMoves ?? []} emptyMessage="No movements for this product yet." />
          </div>

          <div className="flex flex-wrap gap-2 no-print">
            {hasPermission('inventory.receive') && (
              <button className="btn-primary" onClick={() => openPanel('receive', selected.product_id)}><PackagePlus size={14} /> Receive stock</button>
            )}
            {canAdjust && (
              <button className="btn-secondary" onClick={() => openPanel('adjust', selected.product_id)}><SlidersHorizontal size={14} /> Adjust / damage</button>
            )}
          </div>
        </DetailPanel>
      )}
    </div>
  )
}